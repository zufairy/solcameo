import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { loadMarketPosition } from "@/lib/server/marketPosition";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One wallet's position in one coin: entry, value, realized and unrealized P&L. Public on-chain data, so no sign-in needed. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "", mint = req.nextUrl.searchParams.get("mint") ?? "";
  try { new PublicKey(wallet); new PublicKey(mint); } catch { return NextResponse.json({ error: "invalid_address" }, { status: 400 }); }
  try {
    const position = await loadMarketPosition(wallet, mint, req.nextUrl.searchParams.get("refresh") === "1");
    return NextResponse.json({ position }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Position data is temporarily unavailable. Please retry." }, { status: 503 });
  }
}
