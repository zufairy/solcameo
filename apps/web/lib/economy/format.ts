/**
 * USDC amount formatting for the Earnings card + transaction history.
 *
 * USDC has 6 native decimals, so a campaign-reward payout can be sub-cent dust
 * (e.g. $0.000450 = 1 view × $0.50/1000 × 90%). A plain `.toFixed(2)` rounds
 * that to "$0.00" — the payout becomes invisible and you can't see it land.
 * These helpers ALWAYS surface all 6 decimals so dust is never hidden, even on
 * whole-dollar balances (you can watch the dust tick up).
 *
 * Rule: always 6 decimals ("6.960000", "50.000000", "0.000000", "0.000450").
 * Sign is preserved. Pair with `font-mono tabular-nums` so the columns align.
 *
 * Pure + dependency-free (no React / Convex / Node) so it imports cleanly into
 * both the browser bundle and the Convex function runtime.
 */

/** USDC magnitude as a bare decimal string (no `$`): always 6 dp so sub-cent
 *  dust is never hidden, even on whole-dollar balances ("6.960000",
 *  "0.000450"). Sign preserved ("-0.000450"). Non-finite input degrades to
 *  "0.000000" rather than "NaN". */
export function formatUsdc6(n: number): string {
  if (!Number.isFinite(n)) return "0.000000";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + abs.toFixed(6);
}

/** Signed, `$`-prefixed USDC for the transaction-history rows: "+$0.000450"
 *  (credit) / "−$1.234560" (debit). Renders the magnitude at the same always-6dp
 *  as `formatUsdc6` and uses the U+2212 minus to match the Earnings card's "−$". */
export function formatSignedUsdc6(n: number): string {
  return `${n < 0 ? "−" : "+"}$${formatUsdc6(Math.abs(n))}`;
}

/**
 * Protocol fee in basis points — MUST mirror the on-chain
 * `PlatformConfig.protocol_fee_bps` (currently 1000 = 10%). The escrow's
 * `claim_payout` splits each accrued reward: agent gets (10000−fee)/10000,
 * treasury gets fee/10000. Submissions store the GROSS accrued
 * (`payoutAmountUsdc`/`paidUsdc`), so the agent-facing UI applies this at the
 * DISPLAY layer to show the net that actually lands in the wallet. If the
 * on-chain fee ever changes, change this too.
 */
export const PROTOCOL_FEE_BPS = 1000;

/** The agent's NET share of a GROSS accrued reward (after the protocol fee) —
 *  what actually hits the agent wallet on claim_payout. Non-finite → 0. */
export function agentNetUsdc(gross: number): number {
  if (!Number.isFinite(gross)) return 0;
  return (gross * (10000 - PROTOCOL_FEE_BPS)) / 10000;
}

/** The protocol's cut of a GROSS accrued reward (the treasury's 10%). Non-finite → 0. */
export function protocolFeeUsdc(gross: number): number {
  if (!Number.isFinite(gross)) return 0;
  return (gross * PROTOCOL_FEE_BPS) / 10000;
}
