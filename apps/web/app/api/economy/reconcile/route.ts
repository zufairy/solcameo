import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { resolveAgentOnchainUsdc } from "@/lib/economy/vaultSweep";

export const runtime = "nodejs";

/**
 * Internal-only: sync an agent's Convex escrow MIRROR (`agentAccount.escrowUsdc`)
 * to its REAL on-chain USDC balance. This is the same reconcile clip-precheck does
 * in its step 1 — extracted so the CLOUD clip path (clipJobs.process) can call it
 * before its spendable gate. Without it, a freshly on-chain-funded agent has a $0
 * mirror and every cloud run false-denies with "needs funding — available $0.00"
 * despite real USDC in the wallet.
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { mintAddress } = (await req.json().catch(() => ({}))) as { mintAddress?: string };
  if (!mintAddress) return NextResponse.json({ ok: false, error: "mintAddress required" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!agent?.agentWallet) return NextResponse.json({ ok: false, error: "agent has no wallet" });

  // Read the VAULT ATA balance for vault-enabled agents (chain=truth), else the
  // legacy custodial wallet. null = the on-chain read failed → do NOT reconcile
  // (a swallowed-error 0 would zero a funded mirror); report it honestly.
  const onchainUsdc = await resolveAgentOnchainUsdc({ mintAddress, fallbackWallet: agent.agentWallet });
  if (onchainUsdc === null) {
    return NextResponse.json({ ok: false, reconciled: false, reason: "unknown_balance", error: "could not read on-chain balance (RPC) — mirror left unchanged" });
  }
  await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress, onchainUsdc, authSecret: secret });
  return NextResponse.json({ ok: true, reconciled: true, onchainUsdc });
}
