import { NextRequest, NextResponse } from "next/server";
import { generationCollectionWallet } from "@/lib/server/generationCollectionWallet";
import { randomUUID } from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getSignatureStatus, getCurrentBlockHeight } from "@/lib/trader/usdcTransfer";
import { sweepAgentTabOnchain, resolveAgentOnchainUsdc, ONCHAIN_FEE_ALREADY_PROCESSED, ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL, ONCHAIN_FEE_TREASURY_MISCONFIG_TERMINAL, type SweepResult } from "@/lib/economy/vaultSweep";
import { parseInflight } from "@/lib/economy/settlementSentinel";
import { STRAND_ALERT_AFTER_ATTEMPTS } from "@/lib/economy/constants";
import { checkSettlementFeePayerSol } from "@/lib/economy/settlementSignerHealth";
import { decideUnknownSettlement } from "@/lib/economy/recoveryDecisions";

export const runtime = "nodejs";
export const maxDuration = 60;

const TREASURY = generationCollectionWallet();

type RowOutcome =
  | { settlementId: string; result: "paid"; txSignature: string; verified?: boolean }
  | { settlementId: string; result: "ambiguous_left" }
  | { settlementId: string; result: "retransferred_expired"; txSignature: string }
  | { settlementId: string; result: "released" }
  | { settlementId: string; result: "skipped"; reason: string };

/**
 * RECOVERY KEEPER. Re-drives stranded fee settlements — booked debits whose
 * on-chain escrow→treasury transfer never confirmed (the original in-band settle
 * crashed, the transfer pre-broadcast-failed and was released, or it confirm-step
 * failed). Internal-secret gated; driven by the `recover stranded fee settlements`
 * cron (convex/crons.ts) which mirrors the existing settleDueTabs cron→route
 * pattern.
 *
 * Per stranded row:
 *   1. Re-CLAIM it (steals an expired lease via claimSettlement) — the per-row
 *      lock, so a concurrent in-band settle can't also move USDC for this debit.
 *   2. If the prior attempt left a CONFIRM-STEP signature in the sentinel, verify
 *      that signature on-chain FIRST. If it already landed, just markSettlementPaid
 *      (no re-transfer → no double spend). If it's known-failed, re-transfer.
 *      If status is UNKNOWN (RPC flaky / dropped-but-maybe-not), decide via
 *      blockhash expiry (decideUnknownSettlement): if the tx's blockhash is
 *      PROVABLY expired (cluster tip > its lastValidBlockHeight) the sig can never
 *      land → safe to re-transfer; otherwise re-attach the sig + an incremented
 *      attempt count and LEAVE it for a later tick — never re-transfer on
 *      ambiguity. Once the ambiguous-pass count crosses the alert threshold we
 *      emit a loud `[settlement-strand]` console.error so a stuck row is never
 *      silent (F2).
 *   3. Otherwise (no prior sig) re-transfer and markSettlementPaid on success;
 *      release on pre-broadcast failure; re-annotate on confirm-ambiguous failure.
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!TREASURY) return NextResponse.json({ error: "treasury not configured" }, { status: 500 });

  // Pre-flight the CUSTODIAL sweep's gas signer (silent-strand guard). Vault-LESS
  // agents settle via transferUsdc with sponsored gas from PLATFORM_FEE_PAYER_SECRET;
  // a drained (or rotated-bad) fee-payer makes every such sweep fail PRE-broadcast
  // ({ok:false, step:"fees"|"load-feepayer"} — no USDC moves, fail-closed) and strand
  // SILENTLY (released + retried each tick, no page). Mirror the oracle claim keeper's
  // MIN_SIGNER_SOL guard: read the signer's SOL ONCE, `sendAlert` with a DISTINCT
  // reason, and SKIP the tick when it's unhealthy — the stranded rows are UNTOUCHED
  // (already fail-closed) and retry next tick once the wallet is topped up. Fail-OPEN
  // on an unreadable balance so a flaky RPC never strands settlements. Observability
  // only: this never marks a settlement paid and never moves USDC.
  const feePayerHealth = await checkSettlementFeePayerSol();
  // A drained sponsor wallet no longer stops recovery: the sweep falls back to the agent paying its own network fee
  // (topping up a little SOL from its USDC when it has none), so owed money keeps flowing while the alert is acted on.
  if (!feePayerHealth.healthy) console.warn(`[recover-settlements] fee-payer signer unhealthy (${feePayerHealth.reason ?? "unknown"}); recovering with agent-paid gas`);

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  const stranded = await convex.query(api.usage.listStrandedSettlements, {
    nowMs: Date.now(), authSecret: secret, limit: 10,
  });

  const outcomes: RowOutcome[] = [];
  const deadline = Date.now() + 40_000;
  for (const s of stranded) {
    if (Date.now() >= deadline) break;
    try {
      const outcome = await recoverOne(convex, secret, s);
      outcomes.push(outcome);
      // An overloaded RPC won't improve by trying every other unpaid row now.
      if (outcome.result === "skipped" && outcome.reason === "rpc_rate_limited") break;
    } catch (e) {
      outcomes.push({ settlementId: s.settlementId, result: "skipped", reason: e instanceof Error ? e.message : "error" });
    }
  }

  const recovered = outcomes.filter((o) => o.result === "paid" || o.result === "retransferred_expired").length;
  return NextResponse.json({ ok: true, scanned: outcomes.length, recovered, outcomes });
}

/** MED-A: re-reconcile the escrow mirror to the post-sweep VAULT balance (mirrors
 *  settleAgent step 5 / settle-tab). Without it escrowUsdc stays stale-HIGH and
 *  spendable over-reports. Best-effort — a reconcile hiccup must not undo a recorded
 *  payment. */
async function reconcileAfterPay(convex: ConvexHttpClient, secret: string, mintAddress: string, fallbackWallet: string): Promise<void> {
  try {
    const onchainUsdc = await resolveAgentOnchainUsdc({ mintAddress, fallbackWallet });
    await convex.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress, onchainUsdc, authSecret: secret });
  } catch (e) {
    console.warn(`[recover-settlements] post-sweep reconcile failed for ${mintAddress}: ${e instanceof Error ? e.message : e}`);
  }
}

async function recoverOne(
  convex: ConvexHttpClient,
  secret: string,
  s: { settlementId: string; mintAddress: string; amountUsdc: number; coversUsageIds: string[]; sentinel: string | null; at: number },
): Promise<RowOutcome> {
  const id = s.settlementId as Id<"feeSettlements">;

  // Resolve the agent wallet. MED-B: debit_fee is signed + PAID by the platform
  // vault-authority, so the agent's own wallet SECRET is unused on this path — the
  // old `!agent.agentWalletSecret` gate was vestigial from the custodial-transfer
  // era (and inconsistent with the other two sweep callers, which require only
  // agentWallet). Require only agentWallet (the reconcile fallback + existence check).
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: s.mintAddress, authSecret: secret });
  if (!agent?.agentWallet) {
    return { settlementId: s.settlementId, result: "skipped", reason: "no agent wallet" };
  }

  // 1) Re-claim (steal the expired lease via the per-row compare-and-set lock).
  const claimToken = randomUUID();
  const claim = await convex.mutation(api.usage.claimSettlement, {
    settlementId: id, claimToken, nowMs: Date.now(), authSecret: secret,
  });
  if (!claim.claimed) {
    return { settlementId: s.settlementId, result: "skipped", reason: `not claimable (${(claim as { reason?: string }).reason ?? "locked"})` };
  }

  const amountUsdc = claim.amountUsdc;

  // 2) Confirm-ambiguous prior attempt: verify the embedded signature on-chain
  //    BEFORE deciding to re-transfer. NEVER re-transfer without this check.
  const priorParsed = parseInflight(s.sentinel);
  const priorSig = priorParsed?.confirmSig;
  if (priorSig) {
    const status = await getSignatureStatus(priorSig);
    if (status === "landed") {
      // The earlier transfer DID land — mark paid, do NOT re-transfer.
      await convex.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: priorSig, authSecret: secret });
      await reconcileAfterPay(convex, secret, s.mintAddress, agent.agentWallet); // MED-A
      return { settlementId: s.settlementId, result: "paid", txSignature: priorSig, verified: true };
    }
    if (status === "unknown") {
      // Can't (yet) prove landed or failed. Resolve via the BLOCKHASH-EXPIRY rule:
      // only when the cluster tip has passed the tx's lastValidBlockHeight is the
      // sig provably unable to land — then, and only then, re-transfer is safe.
      const currentHeight = await getCurrentBlockHeight();
      const decision = decideUnknownSettlement({ lastValidBlockHeight: priorParsed?.lastValidBlockHeight, currentHeight });
      if (decision === "defer") {
        // Re-attach the sig + lvbh under our fresh lease and leave it for a later
        // tick. Re-transferring here could double-spend, so we never do. Carry an
        // incremented attempt count so a genuinely-stuck row eventually ALERTS.
        const attempts = (priorParsed?.attempts ?? 0) + 1;
        await convex.mutation(api.usage.markSettlementConfirmAmbiguous, {
          settlementId: id, claimToken, confirmSig: priorSig,
          ...(priorParsed?.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: priorParsed.lastValidBlockHeight } : {}),
          attempts, authSecret: secret,
        });
        if (attempts >= STRAND_ALERT_AFTER_ATTEMPTS) {
          // LOUD, never silent: a settlement has been confirm-ambiguous across
          // `attempts` keeper passes without resolving (tip not yet past lvbh, or
          // a legacy row with no lvbh). Surface it for human/ops attention.
          console.error(
            `[settlement-strand] settlementId=${s.settlementId} sig=${priorSig} ` +
            `lvbh=${priorParsed?.lastValidBlockHeight ?? "unknown"} attempts=${attempts} ` +
            `amountUsdc=${amountUsdc} mint=${s.mintAddress} — confirm-ambiguous and not yet resolvable; manual review needed`,
          );
        }
        return { settlementId: s.settlementId, result: "ambiguous_left" };
      }
      // decision === "retransfer": blockhash provably expired → the sig can NEVER
      // land. Fall through to re-transfer (re-claim already done; markPaid below).
    }
    // status === "failed" → the earlier tx errored on-chain; safe to re-transfer.
  }

  // Did we reach the (re-)sweep after a prior dropped tx was PROVABLY expired
  // (blockhash past its lvbh, so it can never land)? Then this is a recovery of a
  // dropped tx, labelled distinctly so it's observable. (priorSig + we didn't
  // return in the unknown branch ⇒ status was "failed" or "retransfer".)
  const recoveringDropped = !!priorSig;

  // 3) (Re-)sweep on-chain. A vault-enabled agent debits the vault (debit_fee is
  //    idempotent per settlementId — a replayed runId collides with the on-chain
  //    FeeRecord → already-swept, so re-driving is ZERO double-charge risk). A
  //    vault-LESS agent falls back to a CUSTODIAL transferUsdc, which is NOT
  //    on-chain idempotent — so its confirm-ambiguity MUST be verified on-chain
  //    before any re-transfer (handled below + on the next pass via priorSig). We
  //    only ever REACH this (re-)transfer after the prior sig (if any) was proven
  //    dead — landed→returned above, in-window→deferred above — so it can't double-spend.
  let sweep: SweepResult;
  try {
    sweep = await sweepAgentTabOnchain({ mintAddress: s.mintAddress, settlementId: s.settlementId, amountUsdc });
  } catch (e) {
    // Hard config / no-vault error — release so a later pass retries once fixed.
    await convex.mutation(api.usage.releaseSettlement, { settlementId: id, claimToken, nowMs: Date.now(), authSecret: secret });
    return { settlementId: s.settlementId, result: "skipped", reason: e instanceof Error ? e.message : "sweep error" };
  }
  if (!sweep.ok) {
    if (sweep.ambiguous && sweep.txSignature) {
      // Custodial confirm-ambiguity on THIS re-sweep: a new sig was broadcast but
      // not confirmed. Do NOT release (that drops the sig → the next pass would
      // re-transfer = double-spend). Stamp the new sig + lvbh so the next keeper
      // pass verifies it on-chain before re-transferring. Carry the attempt count
      // so a genuinely-stuck row eventually alerts.
      const attempts = (priorParsed?.attempts ?? 0) + 1;
      await convex.mutation(api.usage.markSettlementConfirmAmbiguous, {
        settlementId: id, claimToken, confirmSig: sweep.txSignature,
        ...(sweep.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: sweep.lastValidBlockHeight } : {}),
        attempts, authSecret: secret,
      });
      if (attempts >= STRAND_ALERT_AFTER_ATTEMPTS) {
        console.error(
          `[settlement-strand] settlementId=${s.settlementId} sig=${sweep.txSignature} ` +
          `attempts=${attempts} amountUsdc=${amountUsdc} mint=${s.mintAddress} — ` +
          `custodial sweep confirm-ambiguous across passes; manual review needed`,
        );
      }
      return { settlementId: s.settlementId, result: "ambiguous_left" };
    }
    await convex.mutation(api.usage.releaseSettlement, { settlementId: id, claimToken, nowMs: Date.now(), authSecret: secret, retryDelayMs: sweep.retryDelayMs });
    return { settlementId: s.settlementId, result: "skipped", reason: sweep.reason ?? "sweep deferred for retry" };
  }

  if (sweep.txSignature === ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL || sweep.txSignature === ONCHAIN_FEE_TREASURY_MISCONFIG_TERMINAL) {
    await convex.mutation(api.usage.releaseSettlement, { settlementId: id, claimToken, nowMs: Date.now(), retryDelayMs: 3600000, authSecret: secret });
    return { settlementId: s.settlementId, result: "skipped", reason: sweep.txSignature };
  }
  const paidSig = sweep.txSignature ?? ONCHAIN_FEE_ALREADY_PROCESSED;
  await convex.mutation(api.usage.markSettlementPaid, { settlementId: id, txSignature: paidSig, authSecret: secret });
  await reconcileAfterPay(convex, secret, s.mintAddress, agent.agentWallet); // MED-A
  return recoveringDropped
    ? { settlementId: s.settlementId, result: "retransferred_expired", txSignature: paidSig }
    : { settlementId: s.settlementId, result: "paid", txSignature: paidSig };
}
