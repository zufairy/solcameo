import { describe, expect, it } from "vitest";
import catalog from "./prompt-references.json";
import { cameoReferencePrompt, engineSeconds, EXPLORE_MODELS, modelForReference, referenceEstimate } from "./models";

describe("Explore reference generation routing", () => {
  it("preserves motion transfer for existing and saved references", () => {
    expect(modelForReference()).toMatchObject({ kind: "genjutsu", mode: "motion-transfer" });
    expect(modelForReference({ preferredModel: "removed-model" }).id).toBe("genjutsu-motion");
  });
  it.each(["seedance-v2", "grok-imagine-15", "veo3-fast"])("routes %s to its native character video engine", preferredModel => {
    expect(modelForReference({ preferredModel })).toMatchObject({ kind: "engine", engine: preferredModel });
  });
  it("replaces the template Cameo with the selected character's mention", () => {
    expect(cameoReferencePrompt({ prompt: "@cameo walks with @Other. Keep @cameo consistent." }, "Lime Star!"))
      .toBe("@LimeStar walks with @Other. Keep @LimeStar consistent.");
    expect(cameoReferencePrompt({}, "Lime")).toBe("");
  });
  it("has attributed, editable and billable references from three providers", () => {
    expect(new Set(catalog.items.map(item => item.id)).size).toBe(catalog.items.length);
    expect(new Set(catalog.items.map(item => item.preferredModel)).size).toBe(3);
    for (const item of catalog.items) {
      expect(EXPLORE_MODELS.some(model => model.id === item.preferredModel)).toBe(true);
      expect(item.videoUrl).toMatch(/^https:\/\//);
      expect(item.sourceUrl).toMatch(/^https:\/\//);
      expect(item.prompt).toContain("@cameo");
      expect(referenceEstimate(item)).toBeGreaterThan(0);
      const seconds = engineSeconds(modelForReference(item), item.duration);
      expect(seconds).toBeGreaterThanOrEqual(Math.ceil(item.duration));
    }
  });
  it("prices each clip with its own model instead of the selected dialog", () => {
    const clip = { duration: 10 };
    expect(referenceEstimate({ ...clip, preferredModel: "grok-imagine-15" }))
      .not.toBe(referenceEstimate({ ...clip, preferredModel: "seedance-v2" }));
  });
});
