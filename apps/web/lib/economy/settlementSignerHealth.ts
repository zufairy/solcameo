/**
 * Pre-flight health check for the SETTLEMENT fee-payer signer.
 *
 * Vault-LESS agents settle their compute tab CUSTODIALLY: `sweepAgentTabCustodial`
 * (lib/economy/vaultSweep.ts) transfers the fee agent-wallet → treasury with
 * sponsored gas paid by `PLATFORM_FEE_PAYER_SECRET`. If that fee-payer wallet is
 * drained of SOL (< ~5000 lamports) or rotated to a bad key, `transferUsdc` returns
 * a PRE-broadcast `{ok:false, step:"fees"|"load-feepayer"}` (usdcTransfer.ts) — no
 * signature, so NO USDC moves (fail-closed, self-heals once SOL is refunded). But the
 * keeper just releases + retry-loops with a `console.warn` and emits NO alert, so
 * every vault-less agent's settlement strands indefinitely and SILENTLY — the
 * treasury collects nothing and no one is paged.
 *
 * This mirrors the oracle CLAIM keeper's signer-SOL pre-flight (app/api/oracle/claim/
 * route.ts, env VELLO_MIN_SIGNER_SOL): read the fee-payer's SOL ONCE per keeper tick
 * and, when it is below the fee threshold (or the key is unloadable), `sendAlert` with
 * a DISTINCT, actionable reason so the drain is caught at its ROOT before rows strand.
 *
 * OBSERVABILITY ONLY — this never reads or moves USDC and never touches a settlement
 * row. The keeper skips the tick on an unhealthy signer (rows stay held/released,
 * already fail-closed) and retries next tick once the wallet is topped up.
 */
import { getSolBalanceStrict, loadKeypair } from "@/lib/trader/usdcTransfer";
import { sendAlert } from "@/lib/server/alert";

/**
 * Minimum SOL the settlement fee-payer signer must hold for the custodial compute-tab
 * sweep to broadcast. Reuses the oracle keeper's `VELLO_MIN_SIGNER_SOL` (default 0.05
 * SOL) so both money keepers share one floor; a settlement-specific
 * `VELLO_MIN_SETTLEMENT_SIGNER_SOL` overrides it when set.
 */
const MIN_SETTLEMENT_SIGNER_SOL = Number(
  process.env.VELLO_MIN_SETTLEMENT_SIGNER_SOL ?? process.env.VELLO_MIN_SIGNER_SOL ?? "0.05",
);

export interface SettlementSignerHealth {
  /** False → the keeper should SKIP the tick (already alerted). */
  healthy: boolean;
  /** Human-readable skip reason (surfaced in the keeper's 200 response). */
  reason?: string;
  /** The observed SOL balance, when it could be read. */
  balanceSol?: number;
}

/**
 * Read the settlement fee-payer signer's SOL and alert (once) when it can no longer
 * sponsor gas. Returns `{ healthy:false }` when the keeper should SKIP the tick.
 *
 *  - No `PLATFORM_FEE_PAYER_SECRET` configured → healthy (nothing to pre-flight; the
 *    custodial path just wouldn't sponsor gas — not this strand).
 *  - Key won't load (rotated/malformed) → alert `settlement-signer-bad-key`, unhealthy.
 *  - Balance below the SOL floor → alert `settlement-signer-low-sol`, unhealthy.
 *  - Balance UNREADABLE (RPC null) → fail-OPEN (healthy): a flaky RPC must never
 *    strand settlements by masquerading as a drained signer.
 *  - Balance at/above the floor → healthy.
 *
 * Never throws (alerting is fail-safe) and never moves money.
 */
export async function checkSettlementFeePayerSol(): Promise<SettlementSignerHealth> {
  const secret = process.env.PLATFORM_FEE_PAYER_SECRET?.trim();
  if (!secret) return { healthy: true }; // no sponsored fee-payer → nothing to pre-flight

  let pubkey: string;
  try {
    pubkey = loadKeypair(secret).publicKey.toBase58();
  } catch {
    // A malformed/rotated fee-payer key strands EVERY custodial sweep pre-broadcast
    // (transferUsdc → {ok:false, step:"load-feepayer"}). Page it — retrying can't fix it.
    await sendAlert("settlement-signer-bad-key", {
      signer: "fee-payer",
      note: "PLATFORM_FEE_PAYER_SECRET is not a valid keypair — every vault-less agent's compute-tab settlement will strand pre-broadcast until it is fixed",
    });
    console.error("[recover-settlements] fee-payer secret is not a valid keypair — skipping tick, settlements retry next tick");
    return { healthy: false, reason: "fee-payer signer key invalid" };
  }

  const sol = await getSolBalanceStrict(pubkey);
  if (sol === null) {
    // Fail-OPEN: an unreadable balance (flaky RPC / 429) must NOT strand settlements.
    console.warn("[recover-settlements] fee-payer SOL pre-flight read failed — proceeding (fail-open)");
    return { healthy: true };
  }
  if (sol < MIN_SETTLEMENT_SIGNER_SOL) {
    await sendAlert("settlement-signer-low-sol", {
      signer: "fee-payer",
      pubkey,
      balanceSol: sol,
      thresholdSol: MIN_SETTLEMENT_SIGNER_SOL,
      note: "custodial compute-tab settlements will strand pre-broadcast — top up PLATFORM_FEE_PAYER_SECRET's wallet",
    });
    console.error(
      `[recover-settlements] fee-payer signer low on SOL (${sol} < ${MIN_SETTLEMENT_SIGNER_SOL}) — skipping tick, settlements retry next tick`,
    );
    return { healthy: false, reason: "fee-payer signer low on SOL", balanceSol: sol };
  }
  return { healthy: true, balanceSol: sol };
}
