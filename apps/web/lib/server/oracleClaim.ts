/**
 * Pure claim-settlement money math for the oracle claim keeper.
 *
 * Extracted from `app/api/oracle/claim/route.ts` so the load-bearing arithmetic
 * is unit-testable WITHOUT the Solana toolchain (the on-chain reads are
 * runtime-dead until `anchor build`). The route wires this between the confirmed
 * `claim_payout` and the Convex mirror; this module owns ONLY the numbers.
 *
 * All amounts cross the boundary as decimal USDC, but every comparison and the
 * fee are computed in micro-USDC (integer base units) so the off-chain net
 * matches the chain's integer floor exactly (no fee double-count, no rounding
 * drift). USDC has 6 decimals → 1 USDC = 1_000_000 base units.
 */

const USDC_BASE = 1_000_000;

/** Decimal USDC → integer base units, rounded to the nearest base unit. The
 *  on-chain amounts are exact base units; the off-chain mirror carries them as
 *  decimals, so a round here recovers the integer without float dust. */
function toBase(usdc: number): number {
  return Math.round(usdc * USDC_BASE);
}

export function computeClaimSettlement(input: {
  /** submission.paidUsdc mirror BEFORE this tick (cumulative paid last seen). */
  paidUsdcBefore: number;
  /** On-chain ClaimRecord.paid (converted to USDC) AFTER this tick's crank. */
  newPaidUsdc: number;
  /** Off-chain payout estimate from markVerified (the dueForClaim target). */
  payoutAmountUsdc: number;
  /** Cumulative NET already credited to NAV for this submission (mirror). */
  navCreditedUsdc: number;
  /** PlatformConfig.protocol_fee_bps. Ignored when feeKnown is false. */
  feeBps: number;
  /** false when the on-chain PlatformConfig read failed — fail-closed. */
  feeKnown: boolean;
}): {
  /** max(0, newPaidUsdc − paidUsdcBefore) — gross USDC paid THIS tick. */
  grossThisTick: number;
  /** Amount to credit NAV this tick (0 when fee unknown — back-fills later). */
  netDeltaToCredit: number;
  /** navCreditedUsdc + netDeltaToCredit — the new persisted cumulative. */
  newNavCreditedUsdc: number;
  /** Terminal: nothing more will ever be paid (leaves the claim set). */
  claimDone: boolean;
} {
  const beforeBase = toBase(input.paidUsdcBefore);
  const newPaidBase = toBase(input.newPaidUsdc);
  const payoutBase = toBase(input.payoutAmountUsdc);
  const creditedBase = toBase(input.navCreditedUsdc);
  const feeBps = Math.trunc(input.feeBps);

  // Gross paid this tick (clamp: the mirror can momentarily lead the chain).
  const grossBase = Math.max(0, newPaidBase - beforeBase);

  // Cumulative NET after fee = floor(newPaid * (10000 − feeBps) / 10000). Floor
  // mirrors the chain's integer truncation of the protocol fee.
  const netCumulativeBase = Math.floor((newPaidBase * (10000 - feeBps)) / 10000);

  // Per-tranche delta vs what was already credited. Fail-closed when the fee is
  // unknown: credit nothing this tick (navCreditedUsdc lags, so a later tick
  // with feeKnown back-fills the full cumulative net against it).
  const netDeltaBase = input.feeKnown ? Math.max(0, netCumulativeBase - creditedBase) : 0;

  const newCreditedBase = creditedBase + netDeltaBase;

  // Terminal when a successful crank paid nothing more (budget exhausted /
  // nothing owed) OR the on-chain paid has met the off-chain estimate.
  const claimDone = grossBase === 0 || newPaidBase >= payoutBase;

  return {
    grossThisTick: grossBase / USDC_BASE,
    netDeltaToCredit: netDeltaBase / USDC_BASE,
    newNavCreditedUsdc: newCreditedBase / USDC_BASE,
    claimDone,
  };
}

/**
 * XCUT-1 — reserve-before-credit orchestration for one claim tranche.
 *
 * The NAV credit is IRREVERSIBLE: it raises the vault NAV + mints founder shares
 * through an idempotent external ledger. The submission's `navCreditedUsdc`
 * watermark is what the NEXT tick subtracts to size the next tranche's delta. If
 * the credit LANDS but the watermark write is lost, and on-chain `paid` then grows
 * across ticks, the next tick recomputes a delta against a STALE (too-low)
 * watermark and RE-credits the already-paid portion → double-credit / overpay.
 *
 * Fix: commit the watermark (`reserve`) STRICTLY BEFORE issuing the `credit`.
 *  - If `reserve` throws, the credit is NEVER issued; the caller's row handler
 *    catches, skips the row, and retries next tick with an UNCHANGED watermark —
 *    the paid-growth is credited exactly once, never twice (fail-closed, no overpay).
 *  - If `reserve` commits but `credit` then fails, the money already left the vault
 *    on-chain; only the off-chain NAV bookkeeping lags (UNDER-credit). That is a
 *    fail-closed strand — surfaced via `stranded: true` so the caller can alert —
 *    NEVER an overpay.
 *
 * `credit` must be idempotent on its tranche key (distribute-earnings dedups), so
 * a re-drive of the same tranche is a safe no-op.
 */
export async function settleClaimTranche(args: {
  /** settlement.netDeltaToCredit — USDC to credit this tick (0 ⇒ nothing to do). */
  netDeltaToCredit: number;
  /** Persist `navCreditedUsdc` (the watermark). MUST commit before the credit. */
  reserve: () => Promise<void>;
  /** Issue the idempotent NAV credit. Resolves true only when it actually landed. */
  credit: () => Promise<boolean>;
}): Promise<{ reserved: boolean; credited: boolean; stranded: boolean }> {
  if (!(args.netDeltaToCredit > 0)) {
    return { reserved: false, credited: false, stranded: false };
  }
  // Reserve FIRST. A throw here propagates to the caller (row skipped, retried
  // next tick) — the credit below is never reached, so there is no
  // credit-landed-but-watermark-lost window.
  await args.reserve();
  const credited = await args.credit();
  return { reserved: true, credited, stranded: !credited };
}
