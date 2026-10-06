import { describe, expect, it } from "vitest";
import { FUNDING_FEE_BPS, previewFundingSplit, splitFundingAmount } from "./fundingFee";

describe("splitFundingAmount", () => {
  it("takes 3% and leaves 97%", () => {
    expect(FUNDING_FEE_BPS).toBe(300);
    expect(splitFundingAmount(10_000_000n)).toEqual({ fee: 300_000n, net: 9_700_000n });
  });
  it("rounds the fee down and always sums to the total", () => {
    for (const t of [1n, 33n, 34n, 99n, 1_234_567n, 5_000_000_001n]) {
      const { fee, net } = splitFundingAmount(t);
      expect(fee + net).toBe(t);
      expect(fee).toBe((t * 300n) / 10_000n);
    }
  });
  it("rejects zero, negative and bad bps", () => {
    expect(() => splitFundingAmount(0n)).toThrow();
    expect(() => splitFundingAmount(-1n)).toThrow();
    expect(() => splitFundingAmount(100n, 10_001)).toThrow();
  });
  it("previews human amounts", () => {
    expect(previewFundingSplit(100)).toEqual({ fee: 3, net: 97 });
    expect(previewFundingSplit(0)).toEqual({ fee: 0, net: 0 });
  });
});
