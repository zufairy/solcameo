import { describe, expect, it } from "vitest";
import { getBaseTokenForSwap, getMigrationBaseToken, getMigrationThresholdPrice, getTotalVestingAmount, MigrationOption } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { ALLOCATION, TOTAL_SUPPLY } from "../tokenomics/platformToken";
import { buildDbcCurve, PLATFORM_LEFTOVER_TOKENS, PLATFORM_TEAM_TOKENS } from "./curve";
import { PLATFORM_DBC } from "./options";

const whole = (v: { toString(): string }) => Number(BigInt(v.toString()) / 1_000_000n);
const pct = (tokens: number) => (tokens / TOTAL_SUPPLY) * 100;

describe("platform token curve", () => {
  const curve = buildDbcCurve(PLATFORM_DBC, "platform");
  const migrationPrice = getMigrationThresholdPrice(curve.migrationQuoteThreshold, curve.sqrtStartPrice, curve.curve);
  const sold = whole(getBaseTokenForSwap(curve.sqrtStartPrice, migrationPrice, curve.curve));
  const liquidity = whole(getMigrationBaseToken(curve.migrationQuoteThreshold, migrationPrice, MigrationOption.MET_DAMM_V2));
  const vesting = whole(getTotalVestingAmount(curve.lockedVesting));
  const alloc = (key: string) => ALLOCATION.find((a) => a.key === key)!.pct;

  it("launches with anti-sniper protection on", () => {
    expect(PLATFORM_DBC.antiSniper).toBe(true);
    expect(PLATFORM_DBC.antiSniperLevel).toBe("standard");
  });
  it("splits the 1B supply exactly as the tokenomics page states", () => {
    expect((curve.tokenSupply as { preMigrationTokenSupply: BN }).preMigrationTokenSupply.toString()).toBe(String(TOTAL_SUPPLY * 1e6));
    expect(vesting).toBe(PLATFORM_TEAM_TOKENS);
    expect(TOTAL_SUPPLY - vesting - sold - liquidity).toBeCloseTo(PLATFORM_LEFTOVER_TOKENS, -2); // dust from integer maths
    expect(pct(vesting)).toBeCloseTo(alloc("team"), 1);
    expect(pct(PLATFORM_LEFTOVER_TOKENS)).toBeCloseTo(alloc("treasury") + alloc("rewards"), 1);
    expect(Math.abs(pct(sold) - alloc("public"))).toBeLessThan(0.6);
    expect(Math.abs(pct(liquidity) - alloc("liquidity"))).toBeLessThan(0.6);
  });
  it("allocation percentages add up to 100", () => {
    expect(ALLOCATION.reduce((n, a) => n + a.pct, 0)).toBe(100);
  });
  it("vests the team 12 months after graduation, monthly over 36 periods", () => {
    expect(curve.lockedVesting.cliffDurationFromMigrationTime.toString()).toBe(String(12 * 30 * 86_400));
    expect(curve.lockedVesting.numberOfPeriod.toString()).toBe("36");
  });
});
