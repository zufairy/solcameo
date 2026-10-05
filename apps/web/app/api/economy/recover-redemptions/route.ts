import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getSignatureStatus, getCurrentBlockHeight, transferUsdc } from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";
import {
  REDEMPTION_GRACE_MS,
  REDEMPTION_STRAND_ALERT_AFTER_ATTEMPTS,
} from "@/lib/economy/constants";
import { decideUnknownRedemption } from "@/lib/economy/recoveryDecisions";

export const runtime = "nodejs";
export const maxDuration = 60;

// shareRedemptions is a NEW Convex module — string refs until `npx convex deploy`
// regenerates the `api` types (mirrors the redeem-shares route + clipJobs CRM_UPSERT).
const SR_LIST_STRANDED = makeFunctionReference<"query">("shareRedemptions:listStranded");
const SR_MARK_PAID = makeFunctionReference<"mutation">("shareRedemptions:markPaid");
const SR_MARK_AMBIGUOUS = makeFunctionReference<"mutation">("shareRedemptions:markAmbiguous");
const SR_MARK_FAILED = makeFunctionReference<"mutation">("shareRedemptions:markFailed");

type StrandedRedemption = {
  redemptionId: string;
  mintAddress: string;
  holderWallet: string;
  payoutUsdc: number;
  txSignature: string | null;
  lastValidBlockHeight: number | null;
  attempts: number;
};

type RowOutcome =
  | { redemptionId: string; result: "paid"; txSignature: string; verified?: boolean }
  | { redemptionId: string; result: "retransferred_expired"; txSignature: string }
  | { redemptionId: string; result: "ambiguous_left" }
  | { redemptionId: string; result: "reversed" }
  | { redemptionId: string; result: "deferred" }
  | { redemptionId: string; result: "skipped"; reason: string };

/**
 * RECOVERY KEEPER for stranded share redemptions (H4). Re-drives redemptions whose
 * burn committed but whose USDC payout never confirmed (route crashed pre-transfer,
 * or a confirm-timeout left the outcome unknown). Internal-secret gated; driven by
 * the `recover stranded share redemptions` cron.
 *
 * Per stranded pending row (a plain USDC transfer is NOT on-chain-idempotent, so the
 * row's `attempts` counter is a broadcast-attempt marker — see constants.ts):
 *   1. A prior payout SIGNATURE is recorded → verify it on-chain FIRST. Landed →
 *      markPaid (no re-transfer). Failed/provably-expired → re-transfer. Unknown +
 *      not-yet-expired → re-annotate (attempts++) and DEFER (never re-transfer on
 *      ambiguity), alerting once it crosses the strand threshold.
 *   2. NO sig + attempts ≥ 1 → a transfer WAS attempted but its outcome wasn't
 *      recorded (crash after transferUsdc returned). The USDC MAY have moved → NEVER
 *      re-transfer OR reverse; ALERT for manual review (never silent).
 *   3. NO sig + attempts === 0 → the process died BEFORE any transfer → no USDC moved
 *      → re-transfer: soft-claim (clearSig + attempts++ so an overlapping pass skips
 *      it and a crash-after-broadcast can't double-pay) → transferUsdc → markPaid on
 *      success, markAmbiguous on a confirm-timeout, markFailed (REVERSE the burn,
 *      restoring the holder's shares) on a pre-broadcast failure.
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  const stranded = (await convex.query(SR_LIST_STRANDED, {
    nowMs: Date.now(), graceMs: REDEMPTION_GRACE_MS, limit: 50, authSecret: secret,
  })) as StrandedRedemption[];

  const outcomes: RowOutcome[] = [];
  for (const r of stranded) {
    try {
      outcomes.push(await recoverOne(convex, secret, r));
    } catch (e) {
      outcomes.push({ redemptionId: r.redemptionId, result: "skipped", reason: e instanceof Error ? e.message : "error" });
    }
  }

  const recovered = outcomes.filter((o) => o.result === "paid" || o.result === "retransferred_expired").length;
  const reversed = outcomes.filter((o) => o.result === "reversed").length;
  return NextResponse.json({ ok: true, scanned: stranded.length, recovered, reversed, outcomes });
}

async function recoverOne(convex: ConvexHttpClient, secret: string, r: StrandedRedemption): Promise<RowOutcome> {
  // Resolve the agent's custodial wallet (payout SOURCE) + its secret.
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: r.mintAddress, authSecret: secret });
  if (!agent?.agentWallet || !agent.agentWalletSecret) {
    return { redemptionId: r.redemptionId, result: "skipped", reason: "agent has no escrow wallet" };
  }

  // 1) A prior broadcast sig → verify on-chain BEFORE any re-transfer.
  if (r.txSignature) {
    const status = await getSignatureStatus(r.txSignature);
    if (status === "landed") {
      await convex.mutation(SR_MARK_PAID, { redemptionId: r.redemptionId, txSignature: r.txSignature, authSecret: secret });
      return { redemptionId: r.redemptionId, result: "paid", txSignature: r.txSignature, verified: true };
    }
    if (status === "unknown") {
      const currentHeight = await getCurrentBlockHeight();
      const decision = decideUnknownRedemption({ lastValidBlockHeight: r.lastValidBlockHeight, currentHeight });
      if (decision === "defer") {
        const attempts = r.attempts + 1;
        await convex.mutation(SR_MARK_AMBIGUOUS, {
          redemptionId: r.redemptionId, txSignature: r.txSignature,
          ...(r.lastValidBlockHeight !== null ? { lastValidBlockHeight: r.lastValidBlockHeight } : {}),
          attempts, authSecret: secret,
        });
        if (attempts >= REDEMPTION_STRAND_ALERT_AFTER_ATTEMPTS) {
          console.error(
            `[redemption-strand] redemptionId=${r.redemptionId} sig=${r.txSignature} ` +
            `lvbh=${r.lastValidBlockHeight ?? "unknown"} attempts=${attempts} payoutUsdc=${r.payoutUsdc} ` +
            `holder=${r.holderWallet} mint=${r.mintAddress} — confirm-ambiguous and not yet resolvable; manual review needed`,
          );
        }
        return { redemptionId: r.redemptionId, result: "ambiguous_left" };
      }
      // decision === "retransfer": blockhash provably expired → fall through.
    }
    // status === "failed" → the prior tx errored on-chain; safe to re-transfer.
  } else if (r.attempts >= 1) {
    // 2) NO sig, but a transfer WAS attempted (attempts≥1) and its outcome was never
    //    recorded — the process crashed in the window after transferUsdc returned.
    //    A plain USDC transfer is NOT idempotent, so the USDC MAY have moved: we can
    //    neither safely re-transfer (→ double-pay) NOR reverse (→ shares AND payout).
    //    Leave pending, ALERT for manual review, and touch (soft-lease) so we don't
    //    hammer it. The never-silent guarantee.
    await convex.mutation(SR_MARK_AMBIGUOUS, { redemptionId: r.redemptionId, attempts: r.attempts + 1, authSecret: secret });
    console.error(
      `[redemption-strand] redemptionId=${r.redemptionId} attempts=${r.attempts + 1} ` +
      `payoutUsdc=${r.payoutUsdc} holder=${r.holderWallet} mint=${r.mintAddress} — a transfer was ` +
      `attempted but its outcome is unrecorded (no signature); outcome UNKNOWN, manual review needed`,
    );
    return { redemptionId: r.redemptionId, result: "deferred" };
  }
  // else: NO sig, attempts === 0 → the process died BEFORE any transfer was attempted
  //       → no USDC moved → safe to re-transfer (falls through).

  const recoveringDropped = !!r.txSignature;
  const nextAttempts = r.attempts + 1;

  // 3) Re-transfer. BROADCAST-ATTEMPT MARKER + soft-lease: CLEAR any stale (failed/
  //    expired) sig and bump attempts (≥1) + updatedAt BEFORE the transfer, so (a) an
  //    overlapping keeper pass skips this row while the transfer is in-flight, and
  //    (b) if THIS pass crashes after the fresh transfer moves USDC, the next pass
  //    sees attempts≥1/NO-sig and alerts instead of re-reading the stale sig and
  //    double-paying. clearSig is a harmless no-op for the no-sig attempts===0 case.
  await convex.mutation(SR_MARK_AMBIGUOUS, { redemptionId: r.redemptionId, attempts: nextAttempts, clearSig: true, authSecret: secret });

  const transfer = await transferUsdc({
    fromSecretBase64: readAgentSecret(agent.agentWalletSecret),
    fromPubkey: agent.agentWallet,
    toPubkey: r.holderWallet,
    amountUsdc: r.payoutUsdc,
  });

  if (transfer.ok) {
    await convex.mutation(SR_MARK_PAID, { redemptionId: r.redemptionId, txSignature: transfer.txSignature!, authSecret: secret });
    return recoveringDropped
      ? { redemptionId: r.redemptionId, result: "retransferred_expired", txSignature: transfer.txSignature! }
      : { redemptionId: r.redemptionId, result: "paid", txSignature: transfer.txSignature! };
  }
  if (transfer.txSignature) {
    // Confirm-ambiguous — keep the NEW sig + lvbh for the next pass to verify.
    await convex.mutation(SR_MARK_AMBIGUOUS, {
      redemptionId: r.redemptionId, txSignature: transfer.txSignature,
      ...(transfer.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: transfer.lastValidBlockHeight } : {}),
      attempts: nextAttempts, authSecret: secret,
    });
    return { redemptionId: r.redemptionId, result: "ambiguous_left" };
  }
  // Pre-broadcast failure of a transfer WE just made (no USDC moved) → REVERSE the
  // burn (restore the holder's shares). markFailed refuses if a sig is present, so
  // this only reverses a genuinely sig-less row — the "failed sig → re-transfer"
  // case (which kept its old sig) is left pending to re-verify next pass.
  const failRes = (await convex.mutation(SR_MARK_FAILED, {
    redemptionId: r.redemptionId,
    reason: `payout could not be delivered (${transfer.step}: ${transfer.error ?? "pre-broadcast failure"}) — shares restored`,
    authSecret: secret,
  })) as { ok?: boolean; reason?: string; reversed?: boolean };
  if (failRes?.reversed) {
    console.error(`[redemption-strand] REVERSED redemptionId=${r.redemptionId} payoutUsdc=${r.payoutUsdc} holder=${r.holderWallet} mint=${r.mintAddress} — unpayable (${transfer.step})`);
    return { redemptionId: r.redemptionId, result: "reversed" };
  }
  return { redemptionId: r.redemptionId, result: "deferred" };
}
