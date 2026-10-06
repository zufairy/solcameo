import { describe, expect, it } from "vitest";
import { LAUNCH_MIN_LAMPORTS, buildCostBreakdown, formatSol } from "./launchCost";

describe("launch cost", () => {
  it("needs more for the whole launch than for the pool step alone", () => {
    expect(LAUNCH_MIN_LAMPORTS.total).toBeGreaterThan(LAUNCH_MIN_LAMPORTS.pool);
  });
  it("covers what a real mainnet pool step cost (20,591,640 lamports) and the whole launch (about 26.6M)", () => {
    expect(LAUNCH_MIN_LAMPORTS.pool).toBeGreaterThan(20_591_640);
    expect(LAUNCH_MIN_LAMPORTS.total).toBeGreaterThan(26_575_720);
  });
  it("itemises the launch and recommends at least the minimum", () => {
    const rent = (bytes: number) => bytes * 5080 + 128 * 5080; // mainnet rate observed at measurement time
    const b = buildCostBreakdown(rent);
    expect(b.items.map((i) => i.id)).toEqual(["config", "pool", "mint", "vaults", "metadata", "fees"]);
    expect(b.subtotalLamports).toBe(b.items.reduce((n, i) => n + i.lamports, 0));
    expect(b.recommendedLamports).toBeGreaterThanOrEqual(LAUNCH_MIN_LAMPORTS.total);
    expect(b.recommendedLamports).toBeGreaterThan(b.subtotalLamports);
  });
  it("formats SOL without trailing zeros", () => {
    expect(formatSol(36_000_000)).toBe("0.036");
    expect(formatSol(171_067)).toBe("0.0002");
    expect(formatSol(0)).toBe("0");
  });
});
