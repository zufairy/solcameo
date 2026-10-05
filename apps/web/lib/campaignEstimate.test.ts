import { describe, expect, it } from "vitest";
import { budgetFromSlider, compactNumber, estimateReward, sliderFromBudget } from "./campaignEstimate";

describe("campaignEstimate", () => {
  it("prices views from budget and rate", () => {
    const e = estimateReward(1000, 2);
    expect(e.views).toBe(500_000);
    expect(e.perPostUsdc).toBeCloseTo(1.6);
    expect(e.per10kUsdc).toBe(20);
    expect(e.posts).toBe(625);
    expect(e.uniqueViewers).toBeLessThan(e.views);
  });
  it("returns zeros for junk input", () => {
    expect(estimateReward(0, 3).views).toBe(0);
    expect(estimateReward(1000, 0).views).toBe(0);
    expect(estimateReward(NaN, 3).views).toBe(0);
  });
  it("formats compactly", () => {
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(1200)).toBe("1.2K");
    expect(compactNumber(840_000)).toBe("840K");
    expect(compactNumber(1_200_000)).toBe("1.2M");
  });
  it("maps the slider across 1K to 50K and back", () => {
    expect(budgetFromSlider(0)).toBe(1000);
    expect(budgetFromSlider(100)).toBe(50_000);
    for (const p of [10, 35, 60, 90]) {
      const b = budgetFromSlider(p);
      expect(b).toBeGreaterThanOrEqual(1000);
      expect(Math.abs(sliderFromBudget(b) - p)).toBeLessThanOrEqual(3);
    }
    expect(sliderFromBudget(250_000)).toBe(100);
  });
});
