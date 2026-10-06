import { describe, expect, it } from "vitest";
import { feeBreakdown, POLICY_SPLIT, splitShares } from "./liveMath";

const L = (sol: number) => String(Math.round(sol * 1e9));

describe("feeBreakdown", () => {
  it("splits a pool's fee counters into creator, platform and Meteora, and derives claimed from unclaimed", () => {
    const b = feeBreakdown({ totalTradingQuoteFee: L(0.8), totalProtocolQuoteFee: L(0.2), creatorTradingFeePercentage: 50, creatorQuoteFee: L(0.1), partnerQuoteFee: L(0.4) });
    expect(b.feesSol).toBeCloseTo(1);
    expect(b.protocolSol).toBeCloseTo(0.2);
    expect(b.creatorEarnedSol).toBeCloseTo(0.4);
    expect(b.creatorClaimedSol).toBeCloseTo(0.3);
    expect(b.creatorUnclaimedSol).toBeCloseTo(0.1);
    expect(b.platformEarnedSol).toBeCloseTo(0.4);
    expect(b.platformClaimedSol).toBeCloseTo(0);
  });
  it("never reports negative claims when the unclaimed counter exceeds earned", () => {
    const b = feeBreakdown({ totalTradingQuoteFee: L(0.1), totalProtocolQuoteFee: L(0.025), creatorTradingFeePercentage: 50, creatorQuoteFee: L(9), partnerQuoteFee: L(9) });
    expect(b.creatorClaimedSol).toBeGreaterThanOrEqual(0);
    expect(b.platformClaimedSol).toBeGreaterThanOrEqual(0);
  });
  it("treats missing values as zero", () => {
    expect(feeBreakdown({ totalTradingQuoteFee: undefined, totalProtocolQuoteFee: null, creatorTradingFeePercentage: undefined, creatorQuoteFee: undefined, partnerQuoteFee: undefined }).feesSol).toBe(0);
  });
});

describe("splitShares", () => {
  it("falls back to the 40/20/20/20 policy before any fee exists", () => {
    expect(splitShares({ creatorEarnedSol: 0, platformEarnedSol: 0, protocolSol: 0 })).toEqual({ live: false, shares: { ...POLICY_SPLIT } });
  });
  it("reads the live split and sums to one", () => {
    const { shares, live } = splitShares({ creatorEarnedSol: 0.4, platformEarnedSol: 0.4, protocolSol: 0.2 });
    expect(live).toBe(true);
    expect(shares.creator).toBeCloseTo(0.4); expect(shares.content).toBeCloseTo(0.2); expect(shares.platform).toBeCloseTo(0.2); expect(shares.meteora).toBeCloseTo(0.2);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});
