import { describe, it, expect } from "vitest";
import { getEngineAdapter } from "./engineAdapters";

describe("engine adapters", () => {
  it("veo rounds UP to the first of {4,6,8} >= seconds, falling back to 8", () => {
    const a = getEngineAdapter("veo3_fast");
    expect(a.promptDialect).toBe("veo");
    expect(a.supportsNativeExtend).toBe(true);
    // Matches the real pipeline's `validDurations.find(d => d >= secs) ?? 8`
    // (kie-video-pipeline.ts) — round UP, not nearest-snap.
    expect(a.encodeDuration(3)).toBe(4);
    expect(a.encodeDuration(5)).toBe(6);
    expect(a.encodeDuration(7)).toBe(8);
    expect(a.encodeDuration(20)).toBe(8); // no valid duration >= 20 → fallback 8
  });

  it("gemini matches the pipeline's reduce over {4,6,8,10} seeded at 10", () => {
    const a = getEngineAdapter("gemini-omni");
    // Matches kie-video-pipeline.ts's snapGeminiDuration: allowed.reduce(
    // (best, v) => Math.abs(v - secs) < Math.abs(best - secs) ? v : best, 10)
    // — seeding at 10 (not allowed[0]=4) means ties favor the HIGHER value.
    expect(a.encodeDuration(9)).toBe(10);
    expect(a.encodeDuration(7)).toBe(6);
    expect(a.encodeDuration(5)).toBe(4);
  });

  it("grok clamps duration to 6..30 and uses the grok dialect", () => {
    const a = getEngineAdapter("grok-imagine-15");
    expect(a.encodeDuration(45)).toBeLessThanOrEqual(30);
    expect(a.encodeDuration(2)).toBeGreaterThanOrEqual(6);
    expect(a.promptDialect).toBe("grok");
  });

  it("seedance clamps to 5..15 and stitches (no native extend)", () => {
    const a = getEngineAdapter("seedance-v2");
    expect(a.encodeDuration(40)).toBeLessThanOrEqual(15);
    expect(a.supportsNativeExtend).toBe(false);
  });

  it("falls back to a generic adapter for unknown engines", () => {
    const a = getEngineAdapter("totally-new-model");
    expect(a.promptDialect).toBe("generic");
  });
});
