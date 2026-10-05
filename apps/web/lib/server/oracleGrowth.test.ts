import { describe, expect, it } from "vitest";
import { confirmViewGrowth, GROWTH_CONFIRM_MS, MAX_GROWTH_VIEWS_PER_SYNC } from "./oracleGrowth";

describe("confirmed view growth", () => {
  it("does not pay a first spike", () => {
    expect(confirmViewGrowth({ verifiedViews: 100, measuredViews: 1000, now: 1000 }).confirmedViews).toBe(100);
  });
  it("pays only growth still present after the confirmation window", () => {
    const first = confirmViewGrowth({ verifiedViews: 100, measuredViews: 1000, now: 1000 });
    expect(confirmViewGrowth({ verifiedViews: 100, measuredViews: 1200, candidateViews: first.candidateViews, candidateAt: first.candidateAt, now: 1000 + GROWTH_CONFIRM_MS }).confirmedViews).toBe(1000);
  });
  it("resets on a dip and caps each increment", () => {
    expect(confirmViewGrowth({ verifiedViews: 100, measuredViews: 200, candidateViews: 1000, candidateAt: 1000, now: 1000 + GROWTH_CONFIRM_MS }).confirmedViews).toBe(100);
    expect(confirmViewGrowth({ verifiedViews: 100, measuredViews: 100000, candidateViews: 100000, candidateAt: 1000, now: 1000 + GROWTH_CONFIRM_MS }).confirmedViews).toBe(100 + MAX_GROWTH_VIEWS_PER_SYNC);
  });
});
