import { NextRequest, NextResponse } from "next/server";
import { isConvexIdString, readBoundedJson } from "@/lib/server/solstarRoute";
import { syncMarket } from "@/lib/server/marketChainSync";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pulls a coin's newest on-chain swaps, holders and price into Convex. The market page calls it when the pool
 * moves; it answers immediately with a count and the page reads the result reactively from Convex. Public and
 * idempotent: it only copies public chain data, and calls are coalesced and rate limited per coin.
 */
export async function POST(req: NextRequest) {
  const parsed = await readBoundedJson(req, 512);
  if (!parsed.ok) return parsed.res;
  const characterId = (parsed.body as { characterId?: unknown } | null)?.characterId;
  if (!isConvexIdString(characterId)) return NextResponse.json({ error: "Invalid character" }, { status: 400 });
  try {
    return NextResponse.json(await syncMarket(characterId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, ingested: 0, skipped: "failed" }, { status: 502 });
  }
}
