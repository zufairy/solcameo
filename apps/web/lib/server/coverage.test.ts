import { describe, it, expect } from "vitest";
import { planCoverage } from "./coverage";
import { GROK_BASE_MAX_SECONDS, GROK_EXTEND_MAX_SECONDS } from "./videoSegmentation";

describe("planCoverage", () => {
  it("veo covers a duration with 8s clips via native extend", () => {
    const plan = planCoverage(24, "veo3_fast");
    expect(plan.strategy).toBe("native-extend");
    expect(plan.steps[0]).toEqual({ kind: "generate", seconds: 8 });
    expect(plan.steps.slice(1).every((s) => s.kind === "extend")).toBe(true);
    expect(plan.totalSeconds).toBeGreaterThanOrEqual(24);
  });

  it("seedance covers a long duration by stitching clamped clips", () => {
    const plan = planCoverage(40, "seedance-v2");
    expect(plan.strategy).toBe("stitch");
    expect(plan.steps.every((s) => s.kind === "generate")).toBe(true);
    expect(Math.max(...plan.steps.map((s) => s.seconds))).toBeLessThanOrEqual(15);
    expect(plan.steps.reduce((a, s) => a + s.seconds, 0)).toBeGreaterThanOrEqual(40);
  });

  it("grok uses base+extend windows within its caps", () => {
    const plan = planCoverage(30, "grok-imagine-15");
    expect(plan.strategy).toBe("native-extend");
    expect(plan.steps[0].kind).toBe("generate");
    // Assert against the caps planCoverage actually mirrors (videoSegmentation.ts)
    // — the extend cap was deliberately raised 10s → 15s to match Kie's real
    // per-extend ceiling, so a hardcoded "<= 10" here was a stale expectation.
    expect(plan.steps[0].seconds).toBeLessThanOrEqual(GROK_BASE_MAX_SECONDS);
    expect(plan.steps.slice(1).every((s) => s.kind === "extend" && s.seconds <= GROK_EXTEND_MAX_SECONDS)).toBe(true);
    expect(plan.totalSeconds).toBe(30);
  });

  it("short durations produce a single clip", () => {
    const plan = planCoverage(6, "veo3_fast");
    expect(plan.strategy).toBe("single");
    expect(plan.steps).toHaveLength(1);
  });

  it("never returns zero steps", () => {
    for (const e of ["veo3_fast", "seedance-v2", "kling-v3", "grok-imagine-15", "gemini-omni"]) {
      expect(planCoverage(24, e).steps.length).toBeGreaterThan(0);
    }
  });
});
