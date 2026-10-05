/**
 * GET /api/campaigns/match-content-reward?url=<encoded-video-url>
 *
 * Internal-only endpoint: given a video source URL, resolve which active jobtepi
 * clipping content_reward it belongs to. Returns `{ contentRewardId: string | null }`.
 *
 * Used by the Convex `campaignTranscribe.autoLinkContentReward` action (scheduled
 * from `campaigns.create`) to auto-link a newly funded v2 campaign to its
 * corresponding content_reward. Follows the same caller pattern as
 * `pretranscribe` → `/api/video/transcribe-clip`.
 *
 * Auth: internal secret only (X-Internal-Secret header). Not browser-callable.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { matchSourceToContentReward } from "@/lib/server/campaignSourceMatch";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url") ?? "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ contentRewardId: null });
  }

  try {
    const contentRewardId = await matchSourceToContentReward(url);
    return NextResponse.json({ contentRewardId: contentRewardId ?? null });
  } catch (e) {
    // Graceful: Supabase down / misconfigured → no match, never 500
    console.warn("[match-content-reward] lookup failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ contentRewardId: null });
  }
}
