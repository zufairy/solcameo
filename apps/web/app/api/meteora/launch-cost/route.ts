import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { dbcConnection } from "@/lib/server/meteoraLaunch";
import { buildCostBreakdown } from "@/lib/meteora/launchCost";

export const runtime = "nodejs";

const rentCache = new Map<number, { value: number; at: number }>();

/** Itemised cost to launch a coin, priced from live network rent, plus the caller's wallet balance. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("wallet");
  let wallet: PublicKey | null = null;
  try { if (address) wallet = new PublicKey(address); }
  catch { return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 }); }
  try {
    const connection = dbcConnection();
    const sizes = [...new Set([1048, 424, 82, 165])];
    const now = Date.now();
    await Promise.all(sizes.map(async (bytes) => {
      const hit = rentCache.get(bytes);
      if (!hit || now - hit.at > 10 * 60_000) rentCache.set(bytes, { value: await connection.getMinimumBalanceForRentExemption(bytes), at: now });
    }));
    const breakdown = buildCostBreakdown((bytes) => rentCache.get(bytes)?.value ?? 0);
    const balanceLamports = wallet ? await connection.getBalance(wallet, "confirmed") : null;
    return NextResponse.json({ ...breakdown, balanceLamports, checkedAt: now }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read launch costs from Solana. Retry shortly." }, { status: 503 });
  }
}
