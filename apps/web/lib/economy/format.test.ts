import { describe, it, expect } from "vitest";
import { formatUsdc6, formatSignedUsdc6, agentNetUsdc, protocolFeeUsdc } from "./format";

describe("formatUsdc6", () => {
  it("renders a whole-cent value at always 6 decimals", () => {
    expect(formatUsdc6(6.96)).toBe("6.960000");
    expect(formatUsdc6(50)).toBe("50.000000");
    expect(formatUsdc6(0.45)).toBe("0.450000");
  });

  it("renders sub-cent dust at 6 decimals (visible)", () => {
    expect(formatUsdc6(0.00045)).toBe("0.000450");
    expect(formatUsdc6(0.000001)).toBe("0.000001");
    // whole part + dust → still 6 dp so the dust is not hidden
    expect(formatUsdc6(6.9595)).toBe("6.959500");
  });

  it("renders zero as always 6 decimals", () => {
    expect(formatUsdc6(0)).toBe("0.000000");
  });

  it("preserves a negative sign", () => {
    expect(formatUsdc6(-6.96)).toBe("-6.960000");
    expect(formatUsdc6(-0.00045)).toBe("-0.000450");
  });

  it("always renders 6 decimals even through float noise", () => {
    // 0.1 + 0.2 = 0.30000000000000004 — .toFixed(6) still yields a clean 6 dp.
    expect(formatUsdc6(0.1 + 0.2)).toBe("0.300000");
  });

  it("degrades non-finite input to 0.000000 instead of NaN", () => {
    expect(formatUsdc6(NaN)).toBe("0.000000");
    expect(formatUsdc6(Infinity)).toBe("0.000000");
  });
});

describe("formatSignedUsdc6", () => {
  it("prefixes +$ for a credit, −$ for a debit (always 6 decimals)", () => {
    expect(formatSignedUsdc6(1.23)).toBe("+$1.230000");
    expect(formatSignedUsdc6(-1.23456)).toBe("−$1.234560");
  });

  it("shows an incoming dust reward with all six decimals", () => {
    expect(formatSignedUsdc6(0.00045)).toBe("+$0.000450");
  });

  it("treats zero as a credit (always 6 decimals)", () => {
    expect(formatSignedUsdc6(0)).toBe("+$0.000000");
  });
});

describe("agentNetUsdc / protocolFeeUsdc (10% protocol fee split)", () => {
  it("splits a gross reward 90/10 (agent net vs protocol fee)", () => {
    expect(agentNetUsdc(0.0005)).toBeCloseTo(0.00045, 9);
    expect(protocolFeeUsdc(0.0005)).toBeCloseTo(0.00005, 9);
    expect(agentNetUsdc(100)).toBeCloseTo(90, 9);
    expect(protocolFeeUsdc(100)).toBeCloseTo(10, 9);
  });

  it("net + fee sum back to the gross", () => {
    const gross = 0.0007;
    expect(agentNetUsdc(gross) + protocolFeeUsdc(gross)).toBeCloseTo(gross, 9);
  });

  it("zero / non-finite → 0", () => {
    expect(agentNetUsdc(0)).toBe(0);
    expect(protocolFeeUsdc(0)).toBe(0);
    expect(agentNetUsdc(NaN)).toBe(0);
    expect(protocolFeeUsdc(Infinity)).toBe(0);
  });
});
