import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { sweepAgentTabOnchain, resolveAgentOnchainUsdc, ONCHAIN_FEE_ALREADY_PROCESSED, type SweepResult } from "@/lib/economy/vaultSweep";

export const runtime = "nodejs";

const TREASURY = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET ?? "";

export async function POST(req: NextRequest) {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress } = await req.json();
  if (!mintAddress) return NextResponse.json({ error: "missing mintAddress" }, { status: 400 });
  if (!TREASURY) return NextResponse.json({ error: "treasury not configured" }, { status: 500 });

  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  // debit_fee is signed + paid by the platform vault-authority, so the agent's own
  // wallet secret / SOL are no longer needed to sweep. We still resolve the agent
  // (for the ownership gate below via creatorWallet).
  if (!agent?.agentWallet) {
    return NextResponse.json({ error: "agent has no escrow wallet" }, { status: 400 });
  }

  // Ownership gate for user (Bearer) callers — internal cron callers skip. A
  // settle sweeps the agent's USDC to the treasury, so only the SIWS-proven owner
  // may trigger it. The agent record above carries creatorWallet.
  if (!auth.internal) {
    const ownershipError = requireOwnerWithSiws(auth, agent);
    if (ownershipError) return ownershipError;
  }

  // 1) Book (pure: zeroes tab, inserts feeSettlements row with NO txSignature).
  const settled = await convex.mutation(api.usage.settleTab, { mintAddress, authSecret: secret });
  if (!settled.settled) return NextResponse.json({ ok: true, settled: false });

  // 2) CLAIM the row (per-row compare-and-set lock) before moving any USDC.
  const claimToken = randomUUID();
  const claim = await convex.mutation(api.usage.claimSettlement, {
    settlementId: settled.settlementId, claimToken, nowMs: Date.now(), authSecret: secret,
  });
  if (!claim.claimed) {
    return NextResponse.json(
      { ok: true, settled: false, reason: "settlement already claimed", settlementId: settled.settlementId },
    );
  }

  // 3) Sweep on-chain. Vault-enabled agents debit_fee (vault → treasury,
  //    idempotent per settlementId); vault-less agents fall back to a CUSTODIAL
  //    transferUsdc (agent wallet → treasury). Both use sponsored gas so the AGENT
  //    wallet needs no SOL. A THROW here is a pre-broadcast config/query error
  //    (transferUsdc + debit_fee never throw AFTER broadcasting) → nothing moved →
  //    release the claim so the row isn't left INFLIGHT behind an uncaught 500.
  let sweep: SweepResult;
  try {
    sweep = await sweepAgentTabOnchain({ mintAddress, settlementId: settled.settlementId, amountUsdc: claim.amountUsdc });
  } catch (e) {
    await convex.mutation(api.usage.releaseSettlement, {
      settlementId: settled.settlementId, claimToken, nowMs: Date.now(), authSecret: secret,
    });
    return NextResponse.json(
      { error: `settlement sweep errored; settlement ${settled.settlementId} released for retry`, detail: e instanceof Error ? e.message : String(e), settlementId: settled.settlementId },
      { status: 502 },
    );
  }
  if (!sweep.ok) {
    if (sweep.ambiguous && sweep.txSignature) {
      // Custodial confirm-ambiguity: a sig was broadcast but not confirmed — the
      // USDC MAY have moved. Do NOT release (a re-transfer could double-spend).
      // Stamp the sig + lvbh so recover-settlements verifies it on-chain first.
      await convex.mutation(api.usage.markSettlementConfirmAmbiguous, {
        settlementId: settled.settlementId, claimToken, confirmSig: sweep.txSignature,
        ...(sweep.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: sweep.lastValidBlockHeight } : {}),
        attempts: 1, authSecret: secret,
      });
      return NextResponse.json(
        { ok: false, pending: true, txSignature: sweep.txSignature, reason: "custodial sweep confirm-ambiguous — keeper will verify on-chain", settlementId: settled.settlementId },
        { status: 502 },
      );
    }
    await convex.mutation(api.usage.releaseSettlement, {
      settlementId: settled.settlementId, claimToken, nowMs: Date.now(), authSecret: secret,
      retryDelayMs: sweep.retryDelayMs,
    });
    return NextResponse.json(
      { error: `settlement sweep deferred`, reason: sweep.reason, retryAfterMs: sweep.retryDelayMs ?? 300_000, settlementId: settled.settlementId },
      { status: 502 },
    );
  }

  const paidSig = sweep.txSignature ?? ONCHAIN_FEE_ALREADY_PROCESSED;
  await convex.mutation(api.usage.markSettlementPaid, { settlementId: settled.settlementId, txSignature: paidSig, authSecret: secret });

  // 4) Re-reconcile so the escrow mirror reflects the post-sweep VAULT balance
  //    (MED-A — mirrors settleAgent step 5). Without this the mirror stays
  //    stale-HIGH and spendable over-reports (~1 op of free compute) until the next
  //    reconcile. Best-effort: a reconcile hiccup must not undo the recorded pay.
  try {
    const afterUsdc = await resolveAgentOnchainUsdc({ mintAddress, fallbackWallet: agent.agentWallet });
    await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress, onchainUsdc: afterUsdc, authSecret: secret });
  } catch (e) {
    console.warn(`[settle-tab] post-sweep reconcile failed for ${mintAddress}: ${e instanceof Error ? e.message : e}`);
  }

  return NextResponse.json({ ok: true, settled: true, amountUsdc: claim.amountUsdc, txSignature: paidSig });
}
