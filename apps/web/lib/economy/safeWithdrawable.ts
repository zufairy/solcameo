import { MIN_SHARES_FOR_FLOOR } from "./constants";

/**
 * PURE safe-withdrawable formula (lives outside the withdraw route because
 * Next.js forbids non-handler route exports; unit-tested directly):
 *
 *   safe = max(0, realOnchainUsdc − unsettledTab − pendingSettlement − reserved
 *                 − shareBackedFloor − pendingRedemptionPayouts)
 *   shareBackedFloor = floorApplies ? sharesOutstanding × navPerShare : 0
 *   floorApplies     = investEnabled AND sharesOutstanding ≥ MIN_SHARES_FOR_FLOOR
 *
 * The share-backed floor is ZERO in two cases:
 *   1) Invest is globally OFF (`investEnabled === false`) → there are ZERO external
 *      share buyers to protect, so nothing in the wallet is share-backed. This is the
 *      primary fix: because navPerShare = (escrow − tab) / sharesOutstanding, a dust
 *      founder share made the floor equal the WHOLE escrow, so `safeWithdrawable`
 *      was 0 and Withdraw was disabled for every solo clipper.
 *   2) `sharesOutstanding` is below MIN_SHARES_FOR_FLOOR (dust) → a founder
 *      earnings-credit artifact, not protectable third-party capital. Kept even when
 *      Invest is later re-enabled so a fraction-of-a-share can never lock 100% of the
 *      balance. Real investor holdings are ≥ 1 share (see MIN_SHARES_FOR_FLOOR).
 * `investEnabled` defaults to true (money-safe: apply the floor unless told otherwise);
 * the route passes the real flag, tests pass it explicitly.
 *
 * `real === null` means the strict on-chain read was UNKNOWN (RPC 429/timeout/drop)
 * → returns null so the caller ABORTS (never trust the mirror / never treat unknown
 * as 0 for money-out). The share floor is 0 for the common no-investor clipper.
 *
 * `pendingRedemptionPayouts` (default 0) holds back the SUM of USDC owed by
 * in-flight share redemptions. A redemption BURNS its shares — dropping
 * sharesOutstanding and therefore the floor — the instant shareRedemptions.begin
 * commits, but its payout only leaves the wallet once transferUsdc confirms
 * (seconds, or minutes on a confirm-ambiguous 202 the keeper resolves). During that
 * window the fresh on-chain `real` STILL physically holds the payout while the floor
 * no longer accounts for it, so without this term the owner could withdraw the
 * redeemer's earmarked capital (and if the payout later reverts + the keeper restores
 * the shares, the holder is left backed by a drained wallet). 0 for the common
 * clipper (no redemptions) → the formula is unchanged.
 */
export function computeSafeWithdrawable(args: {
  real: number | null;
  unsettledTab: number;
  pendingSettlement: number;
  reserved: number;
  sharesOutstanding: number;
  navPerShare: number;
  pendingRedemptionPayouts?: number;
  investEnabled?: boolean;
}): number | null {
  if (args.real === null) return null; // RPC unknown → caller must abort
  // Share-backed floor applies ONLY when Invest is on (there exist external buyers to
  // protect) AND the outstanding shares are ≥ MIN_SHARES_FOR_FLOOR (dust founder
  // artifacts back the whole pool via navPerShare = (escrow−tab)/shares — never lock
  // the owner out for those). Defaults to on (money-safe) when the flag is omitted.
  const investOn = args.investEnabled ?? true;
  const floorApplies = investOn && args.sharesOutstanding >= MIN_SHARES_FOR_FLOOR;
  const floor = floorApplies ? args.sharesOutstanding * args.navPerShare : 0;
  const pendingRedemptions = args.pendingRedemptionPayouts ?? 0;
  return Math.max(0, args.real - args.unsettledTab - args.pendingSettlement - args.reserved - floor - pendingRedemptions);
}
