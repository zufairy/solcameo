import { describe, it, expect } from "vitest";
import { computeRandomJumpCuts } from "./jumpCuts";

describe("computeRandomJumpCuts", () => {
  it("is deterministic — the same seed always produces the same pattern", () => {
    const a = computeRandomJumpCuts(60, 12345);
    const b = computeRandomJumpCuts(60, 12345);
    expect(a).toEqual(b);
  });

  it("a different seed produces a different pattern (the 'more variations' point)", () => {
    const a = computeRandomJumpCuts(60, 1);
    const b = computeRandomJumpCuts(60, 2);
    expect(a).not.toEqual(b);
  });

  it("never returns a cut inside the edge margin (never eats the hook or the outro)", () => {
    const margin = 1.5;
    const cuts = computeRandomJumpCuts(60, 42, { edgeMarginSec: margin, count: 4 });
    for (const c of cuts) {
      expect(c.start).toBeGreaterThanOrEqual(margin - 1e-9);
      expect(c.end).toBeLessThanOrEqual(60 - margin + 1e-9);
    }
  });

  it("returns non-overlapping, start-ascending ranges (merged, not raw)", () => {
    const cuts = computeRandomJumpCuts(90, 7, { count: 4 });
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i].start).toBeGreaterThanOrEqual(cuts[i - 1].end);
    }
  });

  it("too short a clip yields no cuts at all", () => {
    expect(computeRandomJumpCuts(3, 1)).toEqual([]);
    expect(computeRandomJumpCuts(0, 1)).toEqual([]);
  });

  it("respects an explicit count and cutLenRange", () => {
    const cuts = computeRandomJumpCuts(120, 9, { count: 2, cutLenRange: [0.2, 0.2] });
    expect(cuts.length).toBeLessThanOrEqual(2); // <=, since adjacent raw cuts can merge
    for (const c of cuts) {
      expect(c.end - c.start).toBeGreaterThan(0);
    }
  });
});
