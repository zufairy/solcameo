import { NextRequest, NextResponse } from "next/server";
import { isConvexIdString } from "@/lib/server/solstarRoute";
import { poolRefFor, snapshotMany } from "@/lib/server/poolSnapshots";

export const runtime = "nodejs";

/** One coin's full pool state and trade history. Served from the same shared caches as the batched list endpoint. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("characterId");
  if (!isConvexIdString(id)) return NextResponse.json({ error: "Invalid character" }, { status: 400 });
  try {
    const ref = await poolRefFor(id);
    if (!ref) return NextResponse.json({ available: false });
    const snap = (await snapshotMany([ref], ref.network, 1000))[id];
    if (!snap) throw new Error("unavailable");
    return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ available: false, error: "Meteora RPC is temporarily unavailable." }, { status: 503 });
  }
}
