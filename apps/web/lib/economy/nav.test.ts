import { describe, it, expect } from "vitest";
import {
  floorTo, navPerShare, spendableUsdc, effectiveSpendableUsdc, canSpend,
  sharesForDeposit, redeemPayout, exceedsWalletCap,
  founderSharesForEarnings,
} from "./nav";
import { SEED_SHARE_PRICE_USDC } from "./constants";

describe("floorTo", () => {
  it("floors to the given decimals", () => {
    expect(floorTo(1.2345678, 6)).toBe(1.234567);
    expect(floorTo(10, 6)).toBe(10);
  });
});

describe("navPerShare", () => {
  it("uses seed price when no shares exist", () => {
    expect(navPerShare({ escrowUsdc: 0, unsettledTabUsdc: 0, sharesOutstanding: 0 }))
      .toBe(SEED_SHARE_PRICE_USDC);
  });
  it("is (escrow - tab) / shares", () => {
    expect(navPerShare({ escrowUsdc: 150000, unsettledTabUsdc: 0, sharesOutstanding: 1_000_000 }))
      .toBeCloseTo(0.15, 6);
  });
  it("nets out the unsettled tab", () => {
    expect(navPerShare({ escrowUsdc: 150000, unsettledTabUsdc: 30000, sharesOutstanding: 1_000_000 }))
      .toBeCloseTo(0.12, 6);
  });
  it("never goes negative", () => {
    expect(navPerShare({ escrowUsdc: 10, unsettledTabUsdc: 50, sharesOutstanding: 100 })).toBe(0);
  });
});

describe("spendableUsdc / canSpend", () => {
  it("spendable is escrow minus tab, floored at 0", () => {
    expect(spendableUsdc({ escrowUsdc: 100, unsettledTabUsdc: 30 })).toBe(70);
    expect(spendableUsdc({ escrowUsdc: 10, unsettledTabUsdc: 30 })).toBe(0);
  });
  it("canSpend gates on spendable >= price", () => {
    expect(canSpend({ escrowUsdc: 100, unsettledTabUsdc: 30 }, 70)).toBe(true);
    expect(canSpend({ escrowUsdc: 100, unsettledTabUsdc: 30 }, 70.01)).toBe(false);
  });
});

describe("sharesForDeposit", () => {
  it("mints deposit / nav, rounded DOWN (favors the pool)", () => {
    expect(sharesForDeposit({ depositUsdc: 10000, nav: 0.1 })).toBe(100000);
    // 100 / 3 = 33.333... → floored to 6dp
    expect(sharesForDeposit({ depositUsdc: 100, nav: 3 })).toBe(33.333333);
  });
  it("throws when nav is non-positive (underwater agent)", () => {
    expect(() => sharesForDeposit({ depositUsdc: 100, nav: 0 })).toThrow(RangeError);
    expect(() => sharesForDeposit({ depositUsdc: 100, nav: -1 })).toThrow();
  });
});

describe("redeemPayout", () => {
  it("applies the exit fee and rounds payout DOWN", () => {
    const r = redeemPayout({ sharesToBurn: 100000, nav: 0.15 });
    expect(r.gross).toBeCloseTo(15000, 6);
    expect(r.exitFee).toBeCloseTo(300, 6);
    expect(r.payout).toBe(14700);
  });
  it("honors a custom exit fee (0%)", () => {
    const r = redeemPayout({ sharesToBurn: 100000, nav: 0.15, exitFeePct: 0 });
    expect(r.exitFee).toBe(0);
    expect(r.payout).toBe(15000);
  });
});

describe("exceedsWalletCap", () => {
  it("caps a wallet at 10% of the planned supply (100k of 1M)", () => {
    expect(exceedsWalletCap({ walletSharesAfter: 100001, plannedSupply: 1_000_000 })).toBe(true);
    expect(exceedsWalletCap({ walletSharesAfter: 100000, plannedSupply: 1_000_000 })).toBe(false);
  });
  it("lets the first buyer into an empty pool take up to the cap", () => {
    expect(exceedsWalletCap({ walletSharesAfter: 100000, plannedSupply: 1_000_000 })).toBe(false);
  });
});

describe("founderSharesForEarnings", () => {
  it("mints 15% of earnings value at the post-credit NAV", () => {
    // earnings 10000, navAfterEscrow 2.0 → 0.15*10000/2 = 750 shares
    expect(founderSharesForEarnings({ amount: 10000, navAfterEscrow: 2 })).toBe(750);
  });
  it("throws on non-positive NAV", () => {
    expect(() => founderSharesForEarnings({ amount: 100, navAfterEscrow: 0 })).toThrow(RangeError);
  });
});

describe("effectiveSpendableUsdc", () => {
  const broke = { escrowUsdc: 0, unsettledTabUsdc: 0 };

  it("adds the owner's credit balance at 1 credit = $0.01", () => {
    expect(effectiveSpendableUsdc({ escrowUsdc: 5, unsettledTabUsdc: 1 }, 250)).toBe(6.5);
  });

  // THE regression this helper exists for: the upstream funding gates used to
  // read spendableUsdc alone, so a credit-funded agent with $0 of its own USDC
  // was denied before recordUsage (which spends credits FIRST) ever ran.
  it("lets a credits-only agent clear a gate its own USDC could never cover", () => {
    expect(spendableUsdc(broke)).toBe(0);
    expect(effectiveSpendableUsdc(broke, 1000)).toBe(10);
    expect(effectiveSpendableUsdc(broke, 1000) >= 0.4).toBe(true);
  });

  it("treats null / undefined / negative credits as no credits", () => {
    expect(effectiveSpendableUsdc({ escrowUsdc: 3, unsettledTabUsdc: 0 }, null)).toBe(3);
    expect(effectiveSpendableUsdc({ escrowUsdc: 3, unsettledTabUsdc: 0 }, undefined)).toBe(3);
    expect(effectiveSpendableUsdc({ escrowUsdc: 3, unsettledTabUsdc: 0 }, -500)).toBe(3);
    expect(effectiveSpendableUsdc({ escrowUsdc: 3, unsettledTabUsdc: 0 }, Number.NaN)).toBe(3);
  });

  it("never goes below the (floored-at-0) USDC spendable", () => {
    expect(effectiveSpendableUsdc({ escrowUsdc: 1, unsettledTabUsdc: 9 }, 0)).toBe(0);
  });
});
