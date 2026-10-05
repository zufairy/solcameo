/**
 * Pure decision functions for the campaign-launch flow. Kept side-effect-free so
 * the double-charge-safety logic can be unit-tested without a wallet, RPC, or
 * React. The component wires these to on-chain reads (checkVaultFunded) and the
 * balance gate (checkFunding) — the functions themselves only encode WHAT to do
 * given already-observed facts.
 */
export type LaunchDecision =
  | { action: "fund-wallet"; reason: "usdc" | "sol" }
  | { action: "skip-funding-finalize" }
  | { action: "sign-escrow" }
  | { action: "error"; reason: string };

/** What to do right before prompting the wallet.
 *  vaultFunded MUST come from getEscrowBalance(pda) >= budget so a prior
 *  timed-out attempt that actually landed never funds a second escrow. */
export function decideBeforeSign(opts: {
  vaultFunded: boolean;
  funding: { ok: boolean; needUsdc: boolean; needSol: boolean };
}): LaunchDecision {
  if (opts.vaultFunded) return { action: "skip-funding-finalize" };
  if (opts.funding.needUsdc) return { action: "fund-wallet", reason: "usdc" };
  if (opts.funding.needSol) return { action: "fund-wallet", reason: "sol" };
  return { action: "sign-escrow" };
}

/** After createCampaignTx throws (often a confirmation timeout even though the
 *  tx landed): re-read the vault. Funded → finalize; still empty → honest error,
 *  never a re-charge. */
export function decideAfterSignError(opts: { vaultFundedAfter: boolean }): LaunchDecision {
  if (opts.vaultFundedAfter) return { action: "skip-funding-finalize" };
  return { action: "error", reason: "deposit-unconfirmed" };
}

// The on-chain create_campaign bounds the deadline to
// [now + MIN_CAMPAIGN_DURATION_SECS, now + MAX_CAMPAIGN_DURATION_SECS]
// (programs/vello-escrow/src/lib.rs: MIN = REFUND_GRACE_SECS = 6h, MAX = 365d)
// and reverts InvalidDeadline (6002) outside it. Mirror BOTH bounds here — the
// form previously enforced only the min, so a too-far deadline (e.g. 2029) sailed
// past validation and reverted on-chain, which the wallet reports as a misleading
// "not enough SOL / failed to simulate". Keep these in lockstep with lib.rs.
export const CAMPAIGN_MIN_DURATION_MS = 6 * 60 * 60 * 1000; // 6h
export const CAMPAIGN_MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 365d

/** Validate a chosen campaign deadline against the on-chain bounds. Returns a
 *  user-facing error string, or null when the deadline is acceptable. The max
 *  ceiling only rises as on-chain time advances, so no clock-skew margin is
 *  needed there; the min floor rises too, but date-granularity input keeps the
 *  practical floor well above 6h. */
export function campaignDeadlineError(deadlineMs: number, nowMs: number): string | null {
  if (!Number.isFinite(deadlineMs)) return "Deadline required";
  if (deadlineMs < nowMs + CAMPAIGN_MIN_DURATION_MS) {
    return "Deadline must be at least 6 hours from now (program minimum).";
  }
  if (deadlineMs > nowMs + CAMPAIGN_MAX_DURATION_MS) {
    return "Deadline must be within 1 year (program maximum).";
  }
  return null;
}

/** Classify a thrown createCampaignTx error. DETERMINISTIC = an on-chain
 *  constraint revert (bad input) that will fail identically on retry, so the UI
 *  must tell the user to FIX something, never "click Launch again". Everything
 *  else (confirmation timeout, RPC blip, unknown) is transient and retry-safe —
 *  the deposit may even have landed, so the caller re-reads the vault. Kept pure
 *  so the classification is unit-tested without a wallet. */
export function classifyLaunchError(message: string): { deterministic: boolean; message: string } {
  const m = (message || "").toLowerCase();
  if (m.includes("invaliddeadline") || m.includes("deadline must")) {
    return {
      deterministic: true,
      message: "That deadline is outside the allowed range (6 hours to 1 year from now). Pick a closer date, then launch again.",
    };
  }
  if (m.includes("invalidamount")) {
    return {
      deterministic: true,
      message: "The deposit amount is invalid — it must be greater than 0. Fix the budget, then launch again.",
    };
  }
  // A landed-but-timed-out first attempt already created + funded the campaign PDA;
  // a retry (esp. with a changed budget) re-inits it → "account already in use".
  // Retrying never helps — the deposit is already on-chain. Guide to resume, not
  // "click again", so the operator doesn't strand funds chasing a doomed re-init.
  if (m.includes("already in use")) {
    return {
      deterministic: true,
      message: "This campaign was already created and funded on-chain (an earlier attempt landed). Reload the page and resume it from your drafts — don't launch again, and keep the budget unchanged.",
    };
  }
  // Any other Anchor constraint revert is deterministic too: surface the raw
  // reason (better than a false "click again"), but flag it as needs-fixing.
  if (m.includes("anchorerror") || m.includes("error code:")) {
    return {
      deterministic: true,
      message: `The launch was rejected on-chain and won't succeed on retry until the input is fixed: ${message}`,
    };
  }
  return { deterministic: false, message };
}

/** Rough SOL a launch needs for gas + PDA/ATA rent. A little above the ~0.005
 *  actual so a funder isn't left stuck at the edge. */
export const CAMPAIGN_LAUNCH_SOL_ESTIMATE = 0.02;

/** Actionable "you need SOL for gas" guidance for a 0-SOL launcher: the amount,
 *  the exact wallet address to fund, and a network-appropriate way to get SOL
 *  (devnet faucet vs mainnet exchange withdrawal). Replaces the old dead-end
 *  message. Pure so the copy is unit-tested. */
export function describeSolShortfall(opts: { network: string; walletAddress: string }): string {
  const { network, walletAddress } = opts;
  const amt = CAMPAIGN_LAUNCH_SOL_ESTIMATE.toFixed(2);
  const where = walletAddress ? ` to your wallet ${walletAddress}` : " to your wallet";
  const howTo = network === "mainnet-beta"
    ? "Buy SOL on any exchange and withdraw it to that address."
    : "On devnet, get free SOL from faucet.solana.com.";
  return `This launch needs a little SOL for network gas — about ${amt} SOL, and your wallet has ~0. Send ~${amt} SOL${where}, then click Launch again — your draft is saved. ${howTo}`;
}
