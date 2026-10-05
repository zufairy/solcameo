import { SEED_SHARE_PRICE_USDC, EXIT_FEE_PCT, BUY_CAP_PCT, FOUNDER_PCT, SHARE_DECIMALS, USDC_DECIMALS } from "./constants";

/** Floor a number to `decimals` places (avoids float dust accumulating in our favor). */
export function floorTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(value * f) / f;
}

/** NAV per share = (escrow − unsettled tab) / shares, never negative.
 *  Seed price when there are no shares yet. Spec invariant 1. */
export function navPerShare(a: { escrowUsdc: number; unsettledTabUsdc: number; sharesOutstanding: number }): number {
  if (a.sharesOutstanding <= 0) return SEED_SHARE_PRICE_USDC;
  return Math.max(0, a.escrowUsdc - a.unsettledTabUsdc) / a.sharesOutstanding;
}

/** USDC available to spend on services = escrow − tab, floored at 0. */
export function spendableUsdc(a: { escrowUsdc: number; unsettledTabUsdc: number }): number {
  return Math.max(0, a.escrowUsdc - a.unsettledTabUsdc);
}

/** TOTAL funds a run may draw on = the agent's own spendable USDC PLUS the
 *  owner's prepaid credit balance (1 credit = $0.01), which `recordUsage` spends
 *  FIRST. Every upstream funding gate must use this, not `spendableUsdc` alone —
 *  gating on the agent's USDC only would deny a credit-funded user whose charge
 *  recordUsage would happily have covered from credits.
 *  `creditsBalanceCredits` is in CREDITS (not USD); null/undefined/negative are
 *  treated as no credits. */
export function effectiveSpendableUsdc(
  a: { escrowUsdc: number; unsettledTabUsdc: number },
  creditsBalanceCredits: number | null | undefined,
): number {
  const credits = typeof creditsBalanceCredits === "number" && Number.isFinite(creditsBalanceCredits)
    ? Math.max(0, creditsBalanceCredits)
    : 0;
  return +(spendableUsdc(a) + credits / 100).toFixed(6);
}

/** Spec invariant 2: a paid service may run only if spendable ≥ price. */
export function canSpend(a: { escrowUsdc: number; unsettledTabUsdc: number }, priceUsdc: number): boolean {
  return spendableUsdc(a) >= priceUsdc;
}

/** Shares minted for a deposit at the given NAV, rounded DOWN. Spec §13.
 *  Throws if nav <= 0 (an underwater agent must be handled explicitly by the caller). */
export function sharesForDeposit(a: { depositUsdc: number; nav: number }): number {
  if (a.nav <= 0) throw new RangeError("sharesForDeposit: nav must be > 0");
  return floorTo(a.depositUsdc / a.nav, SHARE_DECIMALS);
}

/** Gross/fee/payout for redeeming shares at NAV, all in USDC precision.
 *  The exit fee stays in escrow; all three values are floored to USDC_DECIMALS. */
export function redeemPayout(a: { sharesToBurn: number; nav: number; exitFeePct?: number }): {
  gross: number; exitFee: number; payout: number;
} {
  const pct = a.exitFeePct ?? EXIT_FEE_PCT;
  const gross = floorTo(a.sharesToBurn * a.nav, USDC_DECIMALS);
  const exitFee = floorTo(gross * pct, USDC_DECIMALS);
  const payout = floorTo(gross - exitFee, USDC_DECIMALS);
  return { gross, exitFee, payout };
}

/** Founder shares to mint for an earnings credit: worth FOUNDER_PCT of the
 *  earnings at the post-credit NAV. Rounded DOWN. Throws if navAfterEscrow <= 0. */
export function founderSharesForEarnings(a: { amount: number; navAfterEscrow: number; founderPct?: number }): number {
  if (a.navAfterEscrow <= 0) throw new RangeError("founderSharesForEarnings: navAfterEscrow must be > 0");
  const pct = a.founderPct ?? FOUNDER_PCT;
  return floorTo((pct * a.amount) / a.navAfterEscrow, SHARE_DECIMALS);
}

/** Spec invariant 3: a wallet may not hold more than BUY_CAP_PCT of the agent's
 *  PLANNED share supply (a fixed denominator, so the first buyer can take up to
 *  the cap rather than 100% of a tiny pool). */
export function exceedsWalletCap(a: { walletSharesAfter: number; plannedSupply: number; capPct?: number }): boolean {
  const cap = (a.capPct ?? BUY_CAP_PCT) * a.plannedSupply;
  const epsilon = 10 ** -SHARE_DECIMALS; // tolerate float noise; allows an exact-cap buy
  return a.walletSharesAfter > cap + epsilon;
}
