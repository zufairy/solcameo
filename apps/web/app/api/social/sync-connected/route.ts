import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getProfile, resolveUsername, isConfigured } from "@/lib/server/uploadPost";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Sync EVERY agent's CONNECTED social platforms from upload-post into the
 * influencers.connectedPlatforms cache — so the public /agents cards can show the
 * connected-account badges WITHOUT relying on each owner having opened their own
 * Posting tab (the owner-gated /api/social/status write only ever fired for the
 * agent's own owner, so most agents' caches stayed empty). Internal-secret gated;
 * called by the syncConnectedSocials cron and safe to POST on demand.
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
    return NextResponse.json({ ok: true, skipped: "upload-post not configured", scanned: 0, updated: 0 });
  }

  const convex = new ConvexHttpClient(CONVEX_URL);
  // The public list already returns each agent's mint; map to the fields we need.
  const agents = (await convex.query(api.influencers.listAll, {})) as Array<{ mintAddress?: string }>;
  const mints = agents.map((a) => a?.mintAddress).filter((m): m is string => typeof m === "string" && m.length > 0);

  let scanned = 0;
  let updated = 0;
  let errors = 0;

  // Bounded concurrency so a big roster can't hammer upload-post's rate limit.
  const CONCURRENCY = 5;
  for (let i = 0; i < mints.length; i += CONCURRENCY) {
    const batch = mints.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (mint) => {
        scanned++;
        try {
          const username = resolveUsername(mint);
          if (!username) return;
          const prof = await getProfile(username);
          const connectedIds = Object.entries(prof.connected)
            .filter(([, v]) => v != null)
            .map(([id]) => id);
          const accounts = Object.fromEntries(Object.entries(prof.connected)
            .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1] != null)
            .map(([id, account]) => [id, {
              ...(account.id ? { id: account.id } : {}),
              ...(account.handle ? { handle: account.handle } : {}),
              ...(account.displayName ? { displayName: account.displayName } : {}),
            }]));
          // setConnectedPlatforms no-ops when the set is unchanged, so re-running
          // is cheap and only writes when an agent's connections actually change.
          const r = await convex.mutation(api.influencers.setConnectedPlatforms, {
            mintAddress: mint,
            platforms: connectedIds,
            accounts,
            authSecret: secret,
          });
          if ((r as { changed?: boolean } | null)?.changed) updated++;
        } catch {
          errors++;
        }
      }),
    );
  }

  return NextResponse.json({ ok: true, scanned, updated, errors });
}
