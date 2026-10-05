import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { evaluateCampaignsForAgent, toAutoClipCandidates } from "@/lib/server/campaignEvaluate";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// Bounds so a prolific niche can't make one scout unbounded (Drive listings are the
// slow leg). Overflow is picked up on later cycles as earlier candidates get clipped.
const MAX_CANDIDATES = 6;

/**
 * SERVER-ONLY candidate gathering for autonomous clipping (spec
 * 2026-07-03-autonomous-clipping-design.md). This lives in a Next route (not the
 * Convex isolate) because resolving sources needs Supabase (content_rewards) + the
 * Google Drive API (folder expansion) + the on-chain restriction gates — none of
 * which run in Convex. The Convex action convex/autoClip.runAutoClipForMint fetches
 * this, then does the money gate (dedup + funding/cap) + charge + enqueue.
 *
 * Returns fit-matched + FUNDED + RESTRICTION-SAFE candidates with their resolved
 * source videos (Drive folders already expanded), plus the KIE key to forward into
 * the clip pipeline (Convex env has none — see lib/server/kie-claude.ts). Only
 * candidates with >=1 resolvable source are returned.
 *
 * Body: { mintAddress: string }
 * Auth: X-Internal-Secret header (INTERNAL_CRON_SECRET).
 * Returns: { ok: true; candidates: AutoClipCandidate[]; kieApiKey?: string }
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { mintAddress?: string };
  const mintAddress = body.mintAddress;
  if (!mintAddress) {
    return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });
  }
  if (!CONVEX_URL) {
    return NextResponse.json({ ok: false, error: "CONVEX_URL not configured" }, { status: 500 });
  }
  // The agent DECIDES here: every open campaign on both rails is scored
  // (lib/server/campaignFit — niche, platforms, deadline, treasury, expected
  // net per clip from its own view track record), the verdicts are persisted
  // as campaignMemberships (operator join/leave from the Work tab always wins),
  // and only ACTIVE memberships become clip candidates, best-scoring first.
  const evaluated = await evaluateCampaignsForAgent(mintAddress, { persist: true });
  if (!evaluated) {
    return NextResponse.json({ ok: false, error: "agent not found" }, { status: 404 });
  }
  const agent = await new ConvexHttpClient(CONVEX_URL).query(api.influencers.getByMint, { mintAddress });
  if (!agent?.autoClipEnabled || !agent.campaignWorkConsent) {
    return NextResponse.json({ ok: true, candidates: [], evaluated: evaluated.results.length, active: 0, reason: "campaign work not authorized" });
  }
  const candidates = toAutoClipCandidates(evaluated.results, MAX_CANDIDATES, agent.campaignWorkConsent.autoJoin);
  const kieApiKey = process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || undefined;
  return NextResponse.json({ ok: true, candidates, kieApiKey, evaluated: evaluated.results.length, active: candidates.length });
}
