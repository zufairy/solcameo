import { describe, expect, it } from "vitest";
import { isBudgetSufficient } from "./campaignBudget";

describe("isBudgetSufficient", () => {
  it("blocks a marketing campaign whose budget is below the per-1K rate", () => {
    // The reported money-loss bug: $2 budget, $10/1K rate → can't pay one reward.
    expect(isBudgetSufficient(2, 10, "marketing")).toBe(false);
    expect(isBudgetSufficient(1, 3, "marketing")).toBe(false);
  });

  it("allows budget exactly equal to the rate (covers one 1,000-view payout)", () => {
    expect(isBudgetSufficient(3, 3, "marketing")).toBe(true);
    expect(isBudgetSufficient(10, 10, "marketing")).toBe(true);
  });

  it("allows budget greater than the rate", () => {
    expect(isBudgetSufficient(100, 3, "marketing")).toBe(true);
    expect(isBudgetSufficient(2.5, 0.5, "marketing")).toBe(true);
  });

  it("exempts non-marketing campaign types (no per-1K pricing)", () => {
    // Bounty / agent_task pay a fixed reward, not per-view — never blocked here.
    expect(isBudgetSufficient(1, 100, "bounty")).toBe(true);
    expect(isBudgetSufficient(1, 100, "agent_task")).toBe(true);
    expect(isBudgetSufficient(0, 100, "")).toBe(true);
  });

  it("exempts a marketing campaign with no configured rate", () => {
    expect(isBudgetSufficient(5, 0, "marketing")).toBe(true);
    expect(isBudgetSufficient(0, 0, "marketing")).toBe(true);
  });

  it("blocks zero or negative budget for a rated marketing campaign", () => {
    expect(isBudgetSufficient(0, 3, "marketing")).toBe(false);
    expect(isBudgetSufficient(-5, 3, "marketing")).toBe(false);
  });

  it("blocks non-finite inputs (NaN / Infinity) for a rated marketing campaign", () => {
    expect(isBudgetSufficient(Number.NaN, 3, "marketing")).toBe(false);
    expect(isBudgetSufficient(Number.POSITIVE_INFINITY, Number.NaN, "marketing")).toBe(false);
  });
});
