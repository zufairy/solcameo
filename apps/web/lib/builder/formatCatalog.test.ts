import { describe, it, expect } from "vitest";
import { VIDEO_FORMATS, formatById, clampFormatDuration, formatRequiresStartFrame } from "./formatCatalog";

describe("VIDEO_FORMATS", () => {
  it("contains the launch formats with exact ids", () => {
    expect(VIDEO_FORMATS.map((f) => f.id).sort()).toEqual([
      "absurd", "anime", "cartoon", "case-study", "clipper", "commercial", "documentary", "founder-talk", "news-commentary", "no-voice-candids", "skit", "street-interview", "voiceover",
    ]);
  });
  it("every generate-pipeline format has a template with a {topic} slot and at least one engine", () => {
    for (const f of VIDEO_FORMATS.filter((x) => x.pipeline === "generate")) {
      expect(f.promptTemplate).toContain("{topic}");
      expect(f.engines.length).toBeGreaterThan(0);
      expect(f.durationSec.min).toBeLessThan(f.durationSec.max);
      expect(f.durationSec.default).toBeGreaterThanOrEqual(f.durationSec.min);
      expect(f.durationSec.default).toBeLessThanOrEqual(f.durationSec.max);
    }
  });
});

describe("clampFormatDuration", () => {
  it("clamps into the band and defaults when undefined", () => {
    expect(clampFormatDuration("skit", 3)).toBe(5); // catalog floor lowered for engine test lengths
    expect(clampFormatDuration("skit", 500)).toBe(45);
    expect(clampFormatDuration("skit", undefined)).toBe(25);
    expect(clampFormatDuration("nope", undefined)).toBe(30); // unknown → global default 30
  });
  it("formatById resolves and misses cleanly", () => {
    expect(formatById("anime")?.voice).toBe("voiceover");
    expect(formatById("nope")).toBeUndefined();
  });
});

describe("formatRequiresStartFrame", () => {
  it("true for cast-bearing generate formats, false otherwise", () => {
    expect(formatRequiresStartFrame("founder-talk")).toBe(true);
    expect(formatRequiresStartFrame("skit")).toBe(true);
    expect(formatRequiresStartFrame("anime")).toBe(true);
    expect(formatRequiresStartFrame("cartoon")).toBe(true);
    expect(formatRequiresStartFrame("voiceover")).toBe(false);
    expect(formatRequiresStartFrame("documentary")).toBe(false);
    expect(formatRequiresStartFrame("nope")).toBe(false);
  });
});
