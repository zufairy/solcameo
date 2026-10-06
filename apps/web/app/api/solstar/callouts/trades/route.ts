import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { loadCalloutTrades } from "@/lib/server/calloutTrades";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") || "";
  try { new PublicKey(wallet); } catch { return NextResponse.json({ error: "invalid_wallet" }, { status: 400 }); }
  try { return NextResponse.json(await loadCalloutTrades(wallet, undefined, req.nextUrl.searchParams.get("refresh") === "1"), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Trades are temporarily unavailable. Please retry." }, { status: 503 }); }
}
