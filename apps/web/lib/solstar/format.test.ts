import { describe, expect, it } from "vitest";
import { formatCompactSol, formatPct, formatSol } from "./format";

describe("formatSol", () => {
  it("formats whole and fractional SOL, trimming trailing zeros", () => {
    expect(formatSol("30000000000")).toBe("30");
    expect(formatSol("1500000000")).toBe("1.5");
    expect(formatSol("0")).toBe("0");
  });
  it("returns <min for nonzero below precision", () => {
    expect(formatSol("1")).toBe("<0.0001");
    expect(formatSol("99999")).toBe("<0.0001");
  });
  it("respects maxDecimals (trim zeros: launch price 30 lamports)", () => {
    expect(formatSol("1", 9)).toBe("0.000000001");
    expect(formatSol("30", 9)).toBe("0.00000003");
  });
  it("truncates rather than rounds up", () => {
    expect(formatSol("1999999999")).toBe("1.9999");
    expect(formatSol("1000099999")).toBe("1");
  });
  it("returns an em dash for invalid input", () => {
    expect(formatSol("abc")).toBe("—");
    expect(formatSol("")).toBe("—");
    expect(formatSol("-1")).toBe("—");
    expect(formatSol("1.5")).toBe("—");
  });
});

describe("formatPct", () => {
  it("signs and formats basis points", () => {
    expect(formatPct("10000")).toBe("+100.0%");
    expect(formatPct("-5000")).toBe("-50.0%");
    expect(formatPct("0")).toBe("0.0%");
    expect(formatPct("1234")).toBe("+12.3%");
    expect(formatPct("-1")).toBe("0.0%");
  });
  it("returns an em dash for invalid input", () => {
    expect(formatPct("abc")).toBe("—");
    expect(formatPct("")).toBe("—");
  });
});

describe("formatCompactSol", () => {
  it("uses K/M/B suffixes", () => {
    expect(formatCompactSol("1200000000000")).toBe("1.2K");
    expect(formatCompactSol("3400000000000000")).toBe("3.4M");
    expect(formatCompactSol("5000000000000000000")).toBe("5B");
  });
  it("shows small values with up to 3 decimals", () => {
    expect(formatCompactSol("999000000")).toBe("0.999");
    expect(formatCompactSol("30000000000")).toBe("30");
  });
  it("returns an em dash for invalid input", () => {
    expect(formatCompactSol("abc")).toBe("—");
    expect(formatCompactSol("-1")).toBe("—");
  });
});

describe("edge cases", () => {
  const sol = (n: bigint) => (n * 1_000_000_000n).toString();
  it("compact truncates, never rounds up", () => {
    expect(formatCompactSol(sol(999_999n))).toBe("999.9K");
    expect(formatCompactSol(sol(1_000_000n))).toBe("1M");
    expect(formatCompactSol(sol(1_999n))).toBe("1.9K");
    expect(formatCompactSol("999999900")).toBe("0.999");
  });
  it("handles very large values", () => {
    expect(formatCompactSol("1" + "0".repeat(27))).toBe("1000000000B");
    expect(formatSol("1234567890123456789012", 2)).toBe("1234567890123.45");
  });
  it("formatSol zero at 9 decimals and non-finite decimals", () => {
    expect(formatSol("0", 9)).toBe("0");
    expect(formatSol("1500000000", Number.NaN)).toBe("1.5");
    expect(formatSol("1", Number.POSITIVE_INFINITY)).toBe("<0.0001");
  });
  it("formatPct negative zero", () => {
    expect(formatPct("-0")).toBe("0.0%");
  });
});
