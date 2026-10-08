import { describe, expect, it } from "vitest";
import { MARGIN_SHARE, REFERRAL_TIERS, referralShare, tierFor } from "./program";

describe("referral program rules", () => {
  it("unlocks a tier only at its SOLCAMEO holding in dollars", () => {
    expect(tierFor(0)).toBeNull();
    expect(tierFor(4.99)).toBeNull();
    expect(tierFor(5)?.name).toBe("Starter");
    expect(tierFor(49.99)?.name).toBe("Starter");
    expect(tierFor(50)?.name).toBe("Builder");
    expect(tierFor(5_000)?.name).toBe("Partner");
  });
  it("pays a bigger share of the margin for a bigger holding", () => {
    expect(REFERRAL_TIERS.map((t) => t.rate)).toEqual([0.5, 0.6, 0.8]);
  });
  it("takes the margin as 15/115 of what the user paid", () => {
    expect(MARGIN_SHARE).toBeCloseTo(0.15 / 1.15, 6);
    // $100 of spend carries about $13.04 of margin; a Builder (60%) gets about $7.83 of it.
    expect(referralShare(100, 0.6)).toBeCloseTo(7.83, 2);
  });
});
