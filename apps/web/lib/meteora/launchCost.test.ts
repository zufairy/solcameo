import { describe, expect, it } from "vitest";
import { LAUNCH_MIN_LAMPORTS, formatSol } from "./launchCost";

describe("launch cost", () => {
  it("needs more for the whole launch than for the pool step alone", () => {
    expect(LAUNCH_MIN_LAMPORTS.total).toBeGreaterThan(LAUNCH_MIN_LAMPORTS.pool);
  });
  it("covers the metadata rent that failed a real launch (13,733,800 lamports) with room for the pool and vaults", () => {
    expect(LAUNCH_MIN_LAMPORTS.pool).toBeGreaterThan(13_733_800 + 3_000_000 + 4_200_000 + 1_500_000);
  });
  it("formats SOL without trailing zeros", () => {
    expect(formatSol(36_000_000)).toBe("0.036");
    expect(formatSol(171_067)).toBe("0.0002");
    expect(formatSol(0)).toBe("0");
  });
});
