import { describe, expect, it } from "vitest";
import { formatAmount, formatCompact, formatPercent } from "./appleNumber";

describe("formatAmount", () => {
  it("never shows -0 or +0 for a value that rounds to nothing", () => {
    expect(formatAmount(-0)).toBe("0");
    expect(formatAmount(-1e-12, { signed: true })).toBe("0");
    expect(formatAmount(1e-12, { signed: true })).toBe("0");
  });
  it("gives small amounts enough digits to be meaningful", () => {
    expect(formatAmount(-0.00042)).toBe("−0.00042");
    expect(formatAmount(0.0213)).toBe("0.0213");
    expect(formatAmount(0.0000123)).toBe("0.0000123");
  });
  it("trims zeros, groups thousands and signs on request", () => {
    expect(formatAmount(1.5)).toBe("1.5");
    expect(formatAmount(12345.678)).toBe("12,346");
    expect(formatAmount(2.345, { signed: true })).toBe("+2.35");
    expect(formatAmount(-7.1, { signed: true })).toBe("−7.1");
    expect(formatAmount(NaN)).toBe("—");
  });
});
describe("formatPercent and formatCompact", () => {
  it("uses real signs and one decimal", () => {
    expect(formatPercent(-1.84)).toBe("−1.8%");
    expect(formatPercent(0.02)).toBe("0%");
    expect(formatPercent(12)).toBe("+12%");
    expect(formatPercent(null)).toBe("—");
    expect(formatCompact(1_234_000)).toBe("1.23M");
    expect(formatCompact(950)).toBe("950");
  });
});
