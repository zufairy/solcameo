import { randomUUID } from "crypto";
import { generationCollectionWallet } from "@/lib/server/generationCollectionWallet";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { accrueReferralForSettlement } from "@/lib/server/referrals";
import { sweepAgentTabOnchain, resolveAgentOnchainUsdc, ONCHAIN_FEE_ALREADY_PROCESSED } from "@/lib/economy/vaultSweep";
import { after } from "next/server";
import { takeRecentBalance } from "@/lib/server/balanceMemo";

/** Sweep the tab on-chain once it reaches this much. Configurable via
 *  VELLO_SETTLE_THRESHOLD_USDC — set it to 0 for immediate per-task on-chain
 *  deduction, or higher to batch (fewer fees). Default 0.05 ≈ near-immediate. */
const SETTLE_THRESHOLD_USDC = Number(process.env.VELLO_SETTLE_THRESHOLD_USDC ?? "0");

const TREASURY = generationCollectionWallet();

export type SettleResult =
  | { status: "credited"; coveredUsdc: number }
  | { status: "skipped"; reason: string }
  | { status: "accruing"; tabUsdc: number; reason: string }
  | { status: "settled"; amountUsdc: number; txSignature: string; tabUsdc: number };

/**
 * Reconcile an agent's escrow mirror to its real on-chain USDC — the agent-vault
 * VAULT balance when vault-enabled, else the legacy custodial wallet (chain =
 * truth) — then, when the accrued tab has reached the threshold AND a treasury is
 * configured, sweep the tab on-chain via agent-vault `debit_fee` (vault →
 * treasury) and record it. The platform vault-authority signs AND pays the fee, so
 * the AGENT needs no SOL and no wallet secret. Otherwise the tab keeps accruing
 * (the UI already reflects it as spent via `available = on-chain − tab`). NEVER
 * throws — settlement is best-effort and must not break task execution.
 */
export async function settleAgentEconomics(mintAddress: string, opts: { immediate?: boolean; threshold?: number; requireTransfer?: boolean } = {}): Promise<SettleResult> {
  try {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    if (!agent?.agentWallet) return { status: "skipped", reason: "no agent wallet" };

    // 1) Reconcile the mirror to the chain (the VAULT ATA when vault-enabled) so
    //    spendable math is real.
    // The pay-before-generate path has just read this balance (refreshAgentFunds), so it is not read a second time.
    const onchainUsdc = (opts.immediate ? takeRecentBalance(agent.agentWallet) : null) ?? await resolveAgentOnchainUsdc({ mintAddress, fallbackWallet: agent.agentWallet });
    const recon = await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, {
      mintAddress,
      onchainUsdc,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    const tabUsdc = recon.ok ? recon.unsettledTabUsdc : 0;

    // 2) Decide whether to sweep on-chain now.
    // `immediate` is the pay-before-generate path: whatever is on the tab moves on-chain now, however small.
    if (!opts.immediate && (tabUsdc <= 0 || tabUsdc < (opts.threshold ?? SETTLE_THRESHOLD_USDC))) return { status: "accruing", tabUsdc, reason: "below threshold" };
    if (!TREASURY) return { status: "accruing", tabUsdc, reason: "no treasury configured" };

    // 3) Book the settlement in Convex (collapses unsettled rows into a
    //    feeSettlements row + reduces the tab). settleTab NO LONGER debits the
    //    escrow mirror — the on-chain vault + reconcile own that now (chain=truth);
    //    the booked-unpaid fee is held out of spendable by the reconcile guard
    //    until the sweep lands. It inserts a feeSettlements row with NO txSignature.
    const settled = await convex.mutation(api.usage.settleTab, { mintAddress, ...(opts.requireTransfer ? { requireTransfer: true } : {}), authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    if ("credited" in settled && settled.credited) return { status: "credited", coveredUsdc: settled.coveredUsdc };
    if (!settled.settled) return { status: "accruing", tabUsdc, reason: "nothing to settle" };

    // 3a) CLAIM the row (per-row compare-and-set lock) BEFORE moving any USDC, so a
    //     concurrent settle (other cron tick / run-task / manual route) can't also
    //     debit for the same booked fee.
    const claimToken = randomUUID();
    const claim = await convex.mutation(api.usage.claimSettlement, {
      settlementId: settled.settlementId,
      claimToken,
      nowMs: Date.now(),
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    if (!claim.claimed) {
      // Another settler holds the lock — leave it to them / the keeper.
      return { status: "accruing", tabUsdc: settled.amountUsdc, reason: "settlement already claimed" };
    }

    // 4) Sweep on-chain. Vault-enabled agents debit_fee (vault → treasury,
    //    idempotent per settlementId); vault-less agents fall back to a CUSTODIAL
    //    transferUsdc (agent wallet → treasury). A failed vault sweep is SAFE to
    //    release for a keeper retry (per-chunk FeeRecord idempotency). A failed
    //    CUSTODIAL sweep may be confirm-AMBIGUOUS instead — the transfer is not
    //    on-chain idempotent, so we must NOT release it.
    const sweep = await sweepAgentTabOnchain({ mintAddress, settlementId: settled.settlementId, amountUsdc: claim.amountUsdc });
    if (!sweep.ok) {
      if (sweep.ambiguous && sweep.txSignature) {
        // Custodial confirm-ambiguity: a sig was broadcast but not confirmed — the
        // USDC MAY have moved. Do NOT release (that drops the sig and lets a later
        // pass re-transfer = double-spend). Stamp the sig + lvbh so
        // recover-settlements verifies it on-chain before EVER re-transferring.
        await convex.mutation(api.usage.markSettlementConfirmAmbiguous, {
          settlementId: settled.settlementId,
          claimToken,
          confirmSig: sweep.txSignature,
          ...(sweep.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: sweep.lastValidBlockHeight } : {}),
          attempts: 1,
          authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
        });
        return { status: "accruing", tabUsdc: claim.amountUsdc, reason: "custodial sweep confirm-ambiguous — keeper will verify on-chain" };
      }
      // Pre-broadcast / vault transient failure: no sig, nothing moved → release.
      await convex.mutation(api.usage.releaseSettlement, {
        retryDelayMs: sweep.retryDelayMs,
        settlementId: settled.settlementId,
        claimToken,
        nowMs: Date.now(),
        authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
      return { status: "accruing", tabUsdc: claim.amountUsdc, reason: sweep.reason ?? "sweep deferred for retry" };
    }
    const paidSig = sweep.txSignature ?? ONCHAIN_FEE_ALREADY_PROCESSED;
    await convex.mutation(api.usage.markSettlementPaid, {
      settlementId: settled.settlementId,
      txSignature: paidSig,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    // Referral bookkeeping does not gate generation once payment is recorded.
    const recordReferral = async () => {
      try { await accrueReferralForSettlement({ settlementId: String(settled.settlementId), mintAddress, amountUsdc: claim.amountUsdc }); }
      catch { /* best effort; the referral accrual is idempotent */ }
    };
    if (opts.immediate) { try { after(recordReferral); } catch { void recordReferral(); } }
    else await recordReferral();

    // 5) Re-reconcile so the mirror reflects the post-sweep balance. The payment is already confirmed and recorded, so this is
    //    off the critical path: the video starts now, and every later charge re-reads the chain before it books anything.
    const reconcileAfter = async () => {
      const afterUsdc = await resolveAgentOnchainUsdc({ mintAddress, fallbackWallet: agent.agentWallet! });
      await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress, onchainUsdc: afterUsdc, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    };
    if (opts.immediate) { try { after(reconcileAfter); } catch { void reconcileAfter().catch(() => undefined); } }
    else await reconcileAfter();

    return { status: "settled", amountUsdc: claim.amountUsdc, txSignature: paidSig, tabUsdc: 0 };
  } catch (e) {
    return { status: "skipped", reason: e instanceof Error ? e.message : "settle error" };
  }
}
