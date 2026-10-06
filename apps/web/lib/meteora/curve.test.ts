// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_DBC, PLATFORM_DBC, dbcOptionsSchema } from "./options";
import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buildDbcCurve, previewDbc } from "./curve";
import { CREATOR_TRADING_FEE_PERCENTAGE, FEE_SPLIT_PERCENT } from "./feePolicy";
describe("Meteora DBC economics", () => {
  it("builds the separate platform preset without influencer launch taxes", () => {
    const c = buildDbcCurve(PLATFORM_DBC, "platform");
    expect(PLATFORM_DBC).toMatchObject({ initialCapSol: 20, graduationCapSol: 600, antiSniper: false, dynamicFee: true, autopilot: false });
    expect(c.tokenUpdateAuthority).toBe(1);
    expect(Number(c.poolFees.baseFee.cliffFeeNumerator.toString())).toBe(10_000_000);
    expect(c.creatorTradingFeePercentage).toBe(100);
    expect(c.creatorPermanentLockedLiquidityPercentage).toBe(100);
    expect(c.partnerLiquidityPercentage).toBe(0);
    expect(c.migrationOption).toBe(1);
    expect(c.migratedPoolFee?.poolFeeBps).toBe(200);
    expect(c.migratedPoolFee?.dynamicFee).toBe(1);
    expect(Number(c.migrationQuoteThreshold.toString())).toBeGreaterThan(0);
  });
  it.each(["classic", "steady", "rocket", "whale"] as const)(
    "constructs %s with accurate graduation and buy quotes",
    (shape) => {
      const options = { ...DEFAULT_DBC, shape },
        p = previewDbc(options),
        config = buildDbcCurve(options);
      expect(p.points[0].capSol).toBe(30);
      expect(p.points.at(-1)!.capSol).toBeCloseTo(250, 3);
      expect(p.raisedSol).toBeGreaterThan(0);
      expect(
        p.points.every(
          (point, i) => !i || point.capSol >= p.points[i - 1].capSol,
        ),
      ).toBe(true);
      expect(p.examples[1].tokens).toBeGreaterThan(p.examples[0].tokens);
      expect(config.migrationOption).toBe(1);
      expect(config.migrationFeeOption).toBe(6);
      expect(config.migratedPoolFee?.poolFeeBps).toBe(150);
      expect(config.migratedPoolFee?.dynamicFee).toBe(0);
      expect(config.creatorPermanentLockedLiquidityPercentage).toBe(50);
      expect(config.tokenUpdateAuthority).toBe(1);
      expect(config.creatorTradingFeePercentage).toBe(50);
    },
  );
  it("charges the flat 1.5% fee whatever an older stored option says", () => {
    expect(DEFAULT_DBC.feeBps).toBe(150);
    const stored = previewDbc({ ...DEFAULT_DBC, feeBps: 25 }), flat = previewDbc(DEFAULT_DBC);
    expect(stored.feeBps).toBe(150);
    expect(stored.examples[1].tokens).toBeCloseTo(flat.examples[1].tokens, 6);
    expect(buildDbcCurve({ ...DEFAULT_DBC, feeBps: 200 }).migratedPoolFee?.poolFeeBps).toBe(150);
  });
  it("sets the on-chain creator share so creator 40 / platform+content 40 / Meteora 20 holds", () => {
    expect(CREATOR_TRADING_FEE_PERCENTAGE).toBe(50);
    expect(FEE_SPLIT_PERCENT.meteora + FEE_SPLIT_PERCENT.creator + FEE_SPLIT_PERCENT.platform + FEE_SPLIT_PERCENT.content).toBe(100);
    expect(FEE_SPLIT_PERCENT.platform).toBe(30);
  });
  it("rejects inverted caps, nonfinite values, and unsupported fee rates", () => {
    expect(
      dbcOptionsSchema.safeParse({ ...DEFAULT_DBC, graduationCapSol: 30 })
        .success,
    ).toBe(false);
    expect(
      dbcOptionsSchema.safeParse({ ...DEFAULT_DBC, initialCapSol: Infinity })
        .success,
    ).toBe(false);
    expect(
      dbcOptionsSchema.safeParse({ ...DEFAULT_DBC, feeBps: 9999 }).success,
    ).toBe(false);
  });
});

describe("launch switches", () => {
  it.each(["light", "standard", "strict"] as const)("builds a valid %s anti-sniper fee schedule", (antiSniperLevel) => {
    const config = buildDbcCurve({ ...DEFAULT_DBC, antiSniper: true, antiSniperLevel }) as unknown as { poolFees: { baseFee: { cliffFeeNumerator: { toString(): string }; firstFactor: number; baseFeeMode: number } }; enableFirstSwapWithMinFee?: number | boolean };
    // Starts well above the flat fee and decays over several periods (exponential mode).
    expect(Number(config.poolFees.baseFee.cliffFeeNumerator.toString())).toBeGreaterThan(100_000_000);
    expect(config.poolFees.baseFee.firstFactor).toBeGreaterThan(0);
    expect(config.poolFees.baseFee.baseFeeMode).toBe(1);
  });
  it("keeps a flat fee when anti-sniper is off", () => {
    const config = buildDbcCurve({ ...DEFAULT_DBC, antiSniper: false }) as unknown as { poolFees: { baseFee: { cliffFeeNumerator: { toString(): string }; firstFactor: number } } };
    expect(config.poolFees.baseFee.firstFactor).toBe(0);
    expect(Number(config.poolFees.baseFee.cliffFeeNumerator.toString())).toBe(150 * 100_000);
  });
  it("switches dynamic fees on both the curve and the graduated pool", () => {
    const on = buildDbcCurve({ ...DEFAULT_DBC, dynamicFee: true }) as unknown as { poolFees: { dynamicFee?: unknown }; migratedPoolFee?: { dynamicFee: number } };
    const off = buildDbcCurve({ ...DEFAULT_DBC, dynamicFee: false }) as unknown as { poolFees: { dynamicFee?: unknown }; migratedPoolFee?: { dynamicFee: number } };
    expect(on.migratedPoolFee?.dynamicFee).toBe(1);
    expect(off.migratedPoolFee?.dynamicFee).toBe(0);
    expect(on.poolFees.dynamicFee).toBeTruthy();
  });
  it("previews steady-state pricing and still builds for every fee tier with anti-sniper on", () => {
    expect(() => buildDbcCurve({ ...DEFAULT_DBC, antiSniper: true, dynamicFee: true })).not.toThrow();
    expect(previewDbc({ ...DEFAULT_DBC, antiSniper: true }).examples[1].tokens).toBeCloseTo(previewDbc({ ...DEFAULT_DBC, antiSniper: false }).examples[1].tokens, 6);
  });
  it("passes the SDK's own on-chain fee validation for every switch combination", () => {
    for (const antiSniperLevel of ["light", "standard", "strict"] as const) for (const dynamicFee of [false, true]) {
      const c = buildDbcCurve({ ...DEFAULT_DBC, antiSniper: true, antiSniperLevel, dynamicFee });
      expect(sdk.validatePoolFees(c.poolFees as never, c.collectFeeMode, c.activationType)).toBe(true);
    }
  });
});
