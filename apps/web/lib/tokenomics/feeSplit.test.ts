import { describe, expect, it } from "vitest";
import { splitClaimedFees } from "./feeSplit";

describe("claimed fee split", () => {
  it("gives 40% to operations, 30% to treasury and keeps 30% for the buyback", () => {
    expect(splitClaimedFees(1_000_000_000n)).toEqual({ ops: 400_000_000n, buyback: 300_000_000n, treasury: 300_000_000n });
  });
  it("always adds up to the claim, whatever the rounding", () => {
    for (const n of [1n, 7n, 999_999_999n, 123_456_789_012n]) {
      const s = splitClaimedFees(n);
      expect(s.ops + s.buyback + s.treasury).toBe(n);
    }
  });
  it("rejects negative amounts", () => {
    expect(() => splitClaimedFees(-1n)).toThrow();
  });
});
