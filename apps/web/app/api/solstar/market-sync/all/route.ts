import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { syncAllMarkets } from "@/lib/server/marketChainSync";
import { LIVE_NETWORK } from "@/lib/solstar/liveNetwork";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Refresh every live coin's Convex tables from Helius. Called by a Convex cron so the leaderboard is never cold. */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await syncAllMarkets(LIVE_NETWORK));
}
