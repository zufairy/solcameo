import { describe, expect, it } from "vitest";
import { ALLOCATION, TIERS, discountedCost, distributeRewards, epochStart, marginOf, splitBuyback, splitRevenue, tierFor } from "./platformToken";

describe("platform token math", () => {
  it("allocates exactly 100% of supply", () => {
    expect(ALLOCATION.reduce((s, a) => s + a.pct, 0)).toBe(100);
  });
  it("maps balances to tiers at the thresholds", () => {
    expect(tierFor(0).key).toBe("none");
    expect(tierFor(249_999).key).toBe("none");
    expect(tierFor(250_000).key).toBe("bronze");
    expect(tierFor(5_000_000).key).toBe("gold");
    expect(tierFor(1e12).key).toBe("diamond");
    expect(tierFor(Number.NaN).key).toBe("none");
    expect(TIERS.every((t, i) => i === 0 || t.minTokens > TIERS[i - 1].minTokens)).toBe(true);
  });
  it("discounts to 6 decimals and never beyond the top tier", () => {
    expect(discountedCost(1, 10)).toBe(0.9);
    expect(discountedCost(0.333333, 3)).toBe(0.323333);
    expect(discountedCost(1, 90)).toBe(0.85);
    expect(discountedCost(1, -5)).toBe(1);
  });
  it("splits revenue with no leftover", () => {
    for (const r of [0n, 1n, 999_999n, 123_456_789n]) {
      const p = splitRevenue(r);
      expect(p.buyback + p.ops + p.treasury).toBe(r);
    }
    expect(splitRevenue(1_000_000n).buyback).toBe(400_000n);
    expect(() => splitRevenue(-1n)).toThrow();
  });
  it("takes the 10% fee margin out of settled spend", () => {
    expect(marginOf(1_100_000n)).toBe(99_990n);
  });
  it("splits a buyback and pays the reward pool out exactly", () => {
    const s = splitBuyback(1001n);
    expect(s.burn + s.rewards).toBe(1001n);
    const out = distributeRewards(1_000_003n, [
      { wallet: "a", balance: 300_000 }, { wallet: "b", balance: 6_000_000 }, { wallet: "c", balance: 10 },
    ]);
    expect(out.map((o) => o.wallet).sort()).toEqual(["a", "b"]);
    expect(out.reduce((s2, o) => s2 + o.amount, 0n)).toBe(1_000_003n);
    expect(out.find((o) => o.wallet === "b")!.amount > out.find((o) => o.wallet === "a")!.amount).toBe(true);
    expect(distributeRewards(100n, [])).toEqual([]);
  });
  it("starts epochs on Monday 00:00 UTC", () => {
    const wed = Date.UTC(2026, 9, 7, 15, 30);
    expect(new Date(epochStart(wed)).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(epochStart(epochStart(wed))).toBe(epochStart(wed));
  });
});
