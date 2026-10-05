import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getProfileFollowers, resolveUsername, isConfigured } from "@/lib/server/uploadPost";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Agents refreshed per run. upload-post's analytics endpoint rate-limits after
 *  a handful of calls (429 "Too many requests"), so each run only takes the
 *  STALEST few; the syncFollowerCounts cron (every 10 min) rotates through the
 *  whole roster — every connected agent refreshes roughly every 40-50 minutes. */
const PER_RUN = 6;
/** Gap between analytics calls — each already takes ~2-12s upstream. */
const GAP_MS = 1500;

/**
 * Refresh live follower counts (upload-post profile analytics,
 * GET /api/analytics/{profile}) for the agents whose counts are oldest, and store
 * them on the influencer doc (followerCount / followersByPlatform / 24h delta)
 * for the public /agents cards. Sequential + paced; stops the pass at the first
 * 429 so the next tick continues. A failed call keeps the last stored count.
 * Internal-secret gated; safe to POST on demand.
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!CONVEX_URL || !secret) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ ok: true, skipped: "upload-post not configured", synced: 0 });
  }
  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.max(1, Math.min(40, Number(body.limit) || PER_RUN));

  const convex = new ConvexHttpClient(CONVEX_URL);
  const agents = (await convex.query(api.influencers.listAll, {})) as Array<{
    mintAddress?: string;
    connectedPlatforms?: string[];
    followersSyncedAt?: number;
  }>;
  // Only agents with connected accounts (the syncConnectedSocials cron keeps
  // connectedPlatforms fresh), stalest first — never-synced agents lead.
  const due = agents
    .filter((a) => a.mintAddress && (a.connectedPlatforms?.length ?? 0) > 0)
    .sort((a, b) => (a.followersSyncedAt ?? 0) - (b.followersSyncedAt ?? 0))
    .slice(0, limit);

  const results: { mint: string; total?: number; error?: string }[] = [];
  let rateLimited = false;
  for (let i = 0; i < due.length; i++) {
    const a = due[i];
    const mint = a.mintAddress!;
    if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
    const f = await getProfileFollowers(resolveUsername(mint), a.connectedPlatforms ?? []);
    if (f.rateLimited) {
      rateLimited = true;
      break;
    }
    if (!f.ok) {
      await convex.mutation(api.influencers.setFollowerStats, {
        mintAddress: mint, total: 0, byPlatform: {}, authSecret: secret, failed: true,
      });
      results.push({ mint, error: f.error });
      continue;
    }
    await convex.mutation(api.influencers.setFollowerStats, {
      mintAddress: mint, total: f.total, byPlatform: f.byPlatform, authSecret: secret,
    });
    results.push({ mint, total: f.total });
  }

  return NextResponse.json({
    ok: true,
    due: due.length,
    synced: results.filter((r) => r.error === undefined).length,
    rateLimited,
    results,
  });
}
