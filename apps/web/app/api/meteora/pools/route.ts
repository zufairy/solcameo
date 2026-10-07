import { NextRequest, NextResponse } from "next/server";
import { poolRefs, snapshotMany } from "@/lib/server/poolSnapshots";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Every live coin's pool state in ONE response. The market page used to make a request per coin every 5 seconds,
 * each with its own Convex query and several RPC calls. This is the same for every visitor, so the CDN can serve it
 * for 2 seconds and revalidate in the background while the server shares one RPC read across all callers.
 */
export async function GET(req: NextRequest) {
  const network = req.nextUrl.searchParams.get("network") === "devnet" ? "devnet" : "mainnet";
  try {
    const refs = await poolRefs(network);
    const pools = await snapshotMany(refs, network, 48);
    return NextResponse.json({ pools, checkedAt: Date.now() }, { headers: { "Cache-Control": "public, s-maxage=2, stale-while-revalidate=15" } });
  } catch {
    return NextResponse.json({ pools: {}, error: "Meteora RPC is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
