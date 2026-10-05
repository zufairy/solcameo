// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_DBC, dbcOptionsSchema } from "./options";
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
      expect(config.creatorPermanentLockedLiquidityPercentage).toBe(100);
      expect(config.tokenUpdateAuthority).toBe(1);
      expect(config.creatorTradingFeePercentage).toBe(100);
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
