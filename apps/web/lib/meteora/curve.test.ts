// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_DBC, dbcOptionsSchema } from "./options";
import * as sdk from "@meteora-ag/dynamic-bonding-curve-sdk";
import { buildDbcCurve, previewDbc } from "./curve";
describe("Meteora DBC economics", () => {
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
      expect(config.migratedPoolFee?.poolFeeBps).toBe(options.feeBps);
      expect(config.migratedPoolFee?.dynamicFee).toBe(0);
      expect(config.creatorPermanentLockedLiquidityPercentage).toBe(50);
      expect(config.tokenUpdateAuthority).toBe(1);
      expect(config.creatorTradingFeePercentage).toBe(50);
    },
  );
  it("charges the selected fee in simulated buys", () => {
    const lower = previewDbc({ ...DEFAULT_DBC, feeBps: 25 }),
      higher = previewDbc({ ...DEFAULT_DBC, feeBps: 200 });
    expect(lower.examples[1].tokens).toBeGreaterThan(higher.examples[1].tokens);
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
    expect(Number(config.poolFees.baseFee.cliffFeeNumerator.toString())).toBe(DEFAULT_DBC.feeBps * 100_000);
  });
  it("switches dynamic fees on both the curve and the graduated pool", () => {
    const on = buildDbcCurve({ ...DEFAULT_DBC, dynamicFee: true }) as unknown as { poolFees: { dynamicFee?: unknown }; migratedPoolFee?: { dynamicFee: number } };
    const off = buildDbcCurve({ ...DEFAULT_DBC, dynamicFee: false }) as unknown as { poolFees: { dynamicFee?: unknown }; migratedPoolFee?: { dynamicFee: number } };
    expect(on.migratedPoolFee?.dynamicFee).toBe(1);
    expect(off.migratedPoolFee?.dynamicFee).toBe(0);
    expect(on.poolFees.dynamicFee).toBeTruthy();
  });
  it("previews steady-state pricing and still builds for every fee tier with anti-sniper on", () => {
    for (const feeBps of [25, 100, 200] as const) expect(() => buildDbcCurve({ ...DEFAULT_DBC, feeBps, antiSniper: true, dynamicFee: true })).not.toThrow();
    expect(previewDbc({ ...DEFAULT_DBC, antiSniper: true }).examples[1].tokens).toBeCloseTo(previewDbc({ ...DEFAULT_DBC, antiSniper: false }).examples[1].tokens, 6);
  });
  it("passes the SDK's own on-chain fee validation for every switch combination", () => {
    for (const antiSniperLevel of ["light", "standard", "strict"] as const) for (const feeBps of [25, 100, 200] as const) for (const dynamicFee of [false, true]) {
      const c = buildDbcCurve({ ...DEFAULT_DBC, antiSniper: true, antiSniperLevel, feeBps, dynamicFee });
      expect(sdk.validatePoolFees(c.poolFees as never, c.collectFeeMode, c.activationType)).toBe(true);
    }
  });
});
