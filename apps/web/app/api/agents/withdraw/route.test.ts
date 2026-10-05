// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeSafeWithdrawable } from "@/lib/economy/safeWithdrawable";

/**
 * The safe-withdrawable formula:
 *   safe = max(0, real − unsettledTab − pendingSettlement − reserved − shareFloor)
 *   shareFloor = sharesOutstanding > 0 ? sharesOutstanding × navPerShare : 0
 * and — critically for money-out — `real === null` (RPC UNKNOWN) returns null so
 * the route ABORTS rather than trusting the mirror or treating unknown as 0.
 */
describe("computeSafeWithdrawable", () => {
  it("RPC-null (unknown balance) returns null → caller must abort, never send", () => {
    expect(
      computeSafeWithdrawable({ real: null, unsettledTab: 0, pendingSettlement: 0, reserved: 0, sharesOutstanding: 0, navPerShare: 0 }),
    ).toBeNull();
  });

  it("no investors (0 shares): floor is 0 → real minus obligations", () => {
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 10, pendingSettlement: 5, reserved: 2, sharesOutstanding: 0, navPerShare: 1 }),
    ).toBeCloseTo(83, 6);
  });

  it("with investors: the share-backed floor is held back", () => {
    // real 100, floor = 50 shares × $1 NAV = 50, no other obligations → 50 withdrawable
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 0, pendingSettlement: 0, reserved: 0, sharesOutstanding: 50, navPerShare: 1 }),
    ).toBeCloseTo(50, 6);
  });

  it("share floor + obligations stack", () => {
    // 100 − 10 − 5 − 2 − (20 × 2 = 40) = 43
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 10, pendingSettlement: 5, reserved: 2, sharesOutstanding: 20, navPerShare: 2 }),
    ).toBeCloseTo(43, 6);
  });

  it("clamps to 0 when obligations exceed the on-chain balance", () => {
    expect(
      computeSafeWithdrawable({ real: 5, unsettledTab: 10, pendingSettlement: 0, reserved: 0, sharesOutstanding: 0, navPerShare: 0 }),
    ).toBe(0);
  });

  it("0 shares with a non-zero NAV still yields a 0 floor (guard on sharesOutstanding>0)", () => {
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 0, pendingSettlement: 0, reserved: 0, sharesOutstanding: 0, navPerShare: 2.5 }),
    ).toBeCloseTo(100, 6);
  });

  it("a confirmed 0 balance (not null) yields 0, not an abort", () => {
    expect(
      computeSafeWithdrawable({ real: 0, unsettledTab: 0, pendingSettlement: 0, reserved: 0, sharesOutstanding: 0, navPerShare: 0 }),
    ).toBe(0);
  });

  // ── In-flight share redemption (F1-0 double-spend) ──────────────────────────
  // A redemption BURNS the shares (sharesOutstanding drops → the share floor drops)
  // seconds/minutes BEFORE its USDC payout confirms on-chain. During that window the
  // fresh on-chain balance STILL physically holds the payout, so without this the
  // owner could withdraw the redeemer's earmarked capital. `pendingRedemptionPayouts`
  // holds it back.
  it("holds back an in-flight redemption's payout (safeWithdrawable drops by P even with 0 shares)", () => {
    // real 100, shares already burned to 0 (floor 0), but a $30 redemption payout is
    // in-flight and still in the wallet → only 70 is safe to withdraw.
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 0, pendingSettlement: 0, reserved: 0, sharesOutstanding: 0, navPerShare: 0, pendingRedemptionPayouts: 30 }),
    ).toBeCloseTo(70, 6);
  });

  it("pendingRedemptionPayouts stacks with the share floor + other obligations", () => {
    // 100 − 10 − 5 − 2 − (20 × 2 = 40 floor) − 8 pending = 35
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 10, pendingSettlement: 5, reserved: 2, sharesOutstanding: 20, navPerShare: 2, pendingRedemptionPayouts: 8 }),
    ).toBeCloseTo(35, 6);
  });

  it("is INERT for the common clipper: omitted or 0 pendingRedemptionPayouts leaves the floor unchanged", () => {
    // Same inputs as "no investors" (expects 83); adding an explicit 0 must not change it,
    // and omitting the field entirely must behave identically (backwards compatible).
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 10, pendingSettlement: 5, reserved: 2, sharesOutstanding: 0, navPerShare: 1, pendingRedemptionPayouts: 0 }),
    ).toBeCloseTo(83, 6);
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 10, pendingSettlement: 5, reserved: 2, sharesOutstanding: 0, navPerShare: 1 }),
    ).toBeCloseTo(83, 6);
  });

  // ── Invest-disabled gate + dust-share guard (the Withdraw-button unblock) ─────
  // navPerShare = (escrow − tab) / sharesOutstanding, so ANY positive sharesOutstanding
  // makes the floor collapse to the WHOLE (escrow − tab). A founder earnings-credit
  // leaves a DUST fraction of a share outstanding with no real investor, so the floor
  // equalled the whole escrow → safeWithdrawable 0 → Withdraw disabled for every solo
  // clipper. Invest is globally OFF (no external buyers to protect), so the floor is 0.
  it("Invest DISABLED: dust founder shares (0.000067 @ navPerShare 96877) → full available, NOT 0", () => {
    // 6.49 escrow, no obligations. Without the gate: floor = 0.000067 × 96877 ≈ 6.49
    // → safeWithdrawable ≈ 0 (the live bug). With investEnabled:false → floor 0.
    expect(
      computeSafeWithdrawable({
        real: 6.49, unsettledTab: 0, pendingSettlement: 0, reserved: 0,
        sharesOutstanding: 0.000067, navPerShare: 96877, investEnabled: false,
      }),
    ).toBeCloseTo(6.49, 6);
  });

  it("Invest DISABLED still subtracts the OTHER holdbacks (only the share floor is zeroed)", () => {
    // Real whole-share position would floor to escrow−tab, but Invest off zeroes the
    // floor; the tab / pendingSettlement / reserved / redemption holdbacks remain.
    expect(
      computeSafeWithdrawable({
        real: 100, unsettledTab: 10, pendingSettlement: 5, reserved: 2,
        sharesOutstanding: 50, navPerShare: 1, pendingRedemptionPayouts: 3, investEnabled: false,
      }),
    ).toBeCloseTo(80, 6); // 100 − 10 − 5 − 2 − 0 floor − 3 = 80
  });

  it("dust-share guard: sub-1-share total → floor 0 EVEN WHEN Invest is enabled", () => {
    // The re-enable safety net: a fraction-of-a-share founder artifact must never lock
    // 100% of the balance, so it is treated as 0 shares (no floor) regardless of the flag.
    expect(
      computeSafeWithdrawable({
        real: 6.49, unsettledTab: 0, pendingSettlement: 0, reserved: 0,
        sharesOutstanding: 0.000067, navPerShare: 96877, investEnabled: true,
      }),
    ).toBeCloseTo(6.49, 6);
  });

  it("Invest ENABLED + real whole-share investors → floor still applies (unchanged)", () => {
    // 50 shares × $1 = 50 held back; 100 − 50 = 50 withdrawable. The gate/guard leave
    // legitimate investor protection intact.
    expect(
      computeSafeWithdrawable({
        real: 100, unsettledTab: 0, pendingSettlement: 0, reserved: 0,
        sharesOutstanding: 50, navPerShare: 1, investEnabled: true,
      }),
    ).toBeCloseTo(50, 6);
  });

  it("exactly 1 whole share (the threshold) still applies the floor", () => {
    // Boundary: MIN_SHARES_FOR_FLOOR is inclusive — 1 share is a real position.
    expect(
      computeSafeWithdrawable({
        real: 100, unsettledTab: 0, pendingSettlement: 0, reserved: 0,
        sharesOutstanding: 1, navPerShare: 40, investEnabled: true,
      }),
    ).toBeCloseTo(60, 6); // 100 − (1 × 40) = 60
  });

  it("investEnabled defaults to true (money-safe) when omitted — existing callers unaffected", () => {
    // Omitting the flag must keep the floor for a real whole-share position.
    expect(
      computeSafeWithdrawable({ real: 100, unsettledTab: 0, pendingSettlement: 0, reserved: 0, sharesOutstanding: 50, navPerShare: 1 }),
    ).toBeCloseTo(50, 6);
  });
});
