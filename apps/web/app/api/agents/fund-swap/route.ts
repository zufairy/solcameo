import { NextRequest, NextResponse } from "next/server";
import { failoverConnection } from "@/lib/solana/failoverConnection";
import { PublicKey } from "@solana/web3.js";
import { getNetwork } from "@/lib/solana/network";
import { buildFundSwapTransaction, quoteFundSwap } from "@/lib/server/fundSwap";

export const runtime = "nodejs";
export const maxDuration = 30;

const pubkey = (v: unknown) => { try { return typeof v === "string" ? new PublicKey(v) : null; } catch { return null; } };

/**
 * Fund an agent from a SOL-only wallet. "quote" prices an exact USDC amount in SOL; "build" returns the unsigned Jupiter
 * swap (SOL in, exact USDC out, straight into the agent wallet's USDC account) for the payer's wallet to sign.
 */
export async function POST(req: NextRequest) {
  if (getNetwork() !== "mainnet-beta") return NextResponse.json({ error: "Swaps are only available on mainnet." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { action?: string; usdc?: number; payer?: string; agentWallet?: string } | null;
  const usdc = Number(body?.usdc);
  if (!body || !Number.isFinite(usdc)) return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  try {
    if (body.action === "quote") {
      const { summary } = await quoteFundSwap(usdc);
      return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
    }
    const payer = pubkey(body.payer), agentWallet = pubkey(body.agentWallet);
    if (body.action !== "build" || !payer || !agentWallet) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const connection = failoverConnection({ network: "mainnet-beta" });
    const built = await buildFundSwapTransaction({ payer, agentWallet, usdc, connection });
    return NextResponse.json(built, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "Could not prepare the swap." }, { status: 502 });
  }
}
