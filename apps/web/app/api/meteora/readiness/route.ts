import { dbcTreasury } from "@/lib/server/dbcTreasury";
import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { dbcConnection, dbcReadiness } from "@/lib/server/meteoraLaunch";
import { assertDevnet } from "@/lib/server/devnetGuard";
import { r2ImageConfigured } from "@/lib/server/imageStorage";
export const maxDuration = 30;
export async function GET(req: NextRequest) {
  const configured = dbcReadiness();
  const storage = r2ImageConfigured();
  const address = req.nextUrl.searchParams.get("wallet");
  let wallet: PublicKey | undefined;
  try { if (address) wallet = new PublicKey(address); }
  catch { return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 }); }
  if (!configured.ready || !storage) return NextResponse.json({ ready: false, network: configured.network, error: !storage ? "Coin metadata storage is not configured." : configured.reason }, { status: 503 });
  try {
    const treasury=dbcTreasury();
    const connection = dbcConnection();
    if (configured.network === "devnet") await assertDevnet(connection);
    const [slot, program, balance] = await Promise.all([
      connection.getSlot("confirmed"), connection.getAccountInfo(DYNAMIC_BONDING_CURVE_PROGRAM_ID, "confirmed"),
      wallet ? connection.getBalance(wallet, "confirmed") : Promise.resolve(null),
    ]);
    if (!program?.executable) throw new Error("Meteora DBC is unavailable on this RPC network.");
    return NextResponse.json({ ready: true, network: configured.network, slot, program: DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(), metadataConfigured: true, balanceLamports: balance, treasuryWallet:treasury.publicKey.toBase58(), checkedAt: Date.now() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ready: false, network: configured.network, error: "Could not verify the configured Solana network and Meteora program. Retry or check the RPC configuration." }, { status: 503 });
  }
}
