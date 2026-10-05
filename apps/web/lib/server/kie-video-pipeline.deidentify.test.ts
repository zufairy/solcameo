import { describe, expect, it } from "vitest";
import { deidentifyImagePrompt } from "./kie-video-pipeline";

describe("deidentifyImagePrompt", () => {
  const src =
    "ONE specific real person. Copy that face precisely. Render photorealistic, " +
    "instantly recognizable as that EXACT individual. Use the reference photo.";
  const out = deidentifyImagePrompt(src);

  it("removes the prominent-public-figure trigger phrases", () => {
    expect(out).not.toMatch(/\breal person\b/i);
    expect(out).not.toMatch(/ONE specific real person/i);
    expect(out).not.toMatch(/copy that face precisely/i);
    expect(out).not.toMatch(/\bphotorealistic\b/i);
    expect(out).not.toMatch(/recognizable as that/i);
  });

  it("adds an explicit fictional-original-character framing up front", () => {
    expect(out).toMatch(/FICTIONAL, ORIGINAL/);
    expect(out).toMatch(/NOT a real, famous, or recognizable public figure/i);
  });

  it("preserves cross-panel CONSISTENCY intent (not a semantic gut)", () => {
    expect(out.toLowerCase()).toContain("consistent");
  });
});
