import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { settleAgentEconomics } from "@/lib/economy/settleAgent";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Reconcile an agent's escrow mirror to its on-chain USDC and, when the accrued
 * tab is large enough (and a treasury + SOL are available), sweep it on-chain.
 * Best-effort: always 200 with a status describing what happened. Used by crons
 * and the deferred-video job to settle costs after a task executes.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress } = await req.json().catch(() => ({}));
  if (!mintAddress) return NextResponse.json({ error: "missing mintAddress" }, { status: 400 });

  // Ownership gate for user (Bearer) callers — internal cron callers skip. A
  // settle moves the agent's USDC on-chain, so only the SIWS-proven owner may run it.
  if (!auth.internal) {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const agent = await convex.query(api.influencers.getByMintServer, {
      mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    const ownershipError = requireOwnerWithSiws(auth, agent);
    if (ownershipError) return ownershipError;
  }

  const result = await settleAgentEconomics(mintAddress);
  return NextResponse.json({ ok: true, ...result });
}
