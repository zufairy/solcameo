import { describe, it, expect } from "vitest";
import { IMAGE_ENGINES, IMAGE_ENGINE_BY_ID, DEFAULT_IMAGE_ENGINE, resolveImageEngine } from "./imageEngines";

// The dropdown and the request builder read THIS list. A slug typo here is a picker
// that offers a model the server can't call, which fails only at generation time.
describe("IMAGE_ENGINES", () => {
  it("every engine carries a KIE slug and a price", () => {
    for (const e of IMAGE_ENGINES) {
      expect(e.slug, `${e.id} has no slug`).toBeTruthy();
      // Most slugs are a bare hyphenated id (nano-banana-pro); Qwen's family uses
      // a "family/direction" path (qwen3/text-to-image) — allow both.
      expect(e.slug).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)?$/);
      expect(e.pricePerImageUsdc).toBeGreaterThan(0);
      expect(["1K", "2K", "4K"]).toContain(e.resolution);
    }
  });

  it("ids are unique and indexed", () => {
    expect(Object.keys(IMAGE_ENGINE_BY_ID).length).toBe(IMAGE_ENGINES.length);
  });

  it("carries the five engines the operator picks from", () => {
    expect(IMAGE_ENGINES.map((e) => e.id).sort()).toEqual(
      ["gpt-image-2", "nano-banana-2", "nano-banana-2-lite", "nano-banana-pro", "qwen-image-3"],
    );
  });

  // Verified against docs.kie.ai — the GPT/Qwen slugs carry their direction, which
  // is easy to lose when copying a display name.
  it("uses the documented KIE slugs", () => {
    expect(IMAGE_ENGINE_BY_ID["nano-banana-pro"].slug).toBe("nano-banana-pro");
    expect(IMAGE_ENGINE_BY_ID["nano-banana-2"].slug).toBe("nano-banana-2");
    expect(IMAGE_ENGINE_BY_ID["nano-banana-2-lite"].slug).toBe("nano-banana-2-lite");
    expect(IMAGE_ENGINE_BY_ID["gpt-image-2"].slug).toBe("gpt-image-2-text-to-image");
    expect(IMAGE_ENGINE_BY_ID["qwen-image-3"].slug).toBe("qwen3/text-to-image");
  });

  // gpt-image-2 and qwen-image-3's OWN slug is text-to-image, but createImageTask
  // reroutes to each one's separate image-to-image sibling model when a reference
  // is attached (IMAGE_TO_IMAGE_REROUTE_IDS) — so both are accurately `true` here.
  it("marks which engines accept a character reference", () => {
    expect(IMAGE_ENGINE_BY_ID["nano-banana-pro"].acceptsReferences).toBe(true);
    expect(IMAGE_ENGINE_BY_ID["gpt-image-2"].acceptsReferences).toBe(true);
    expect(IMAGE_ENGINE_BY_ID["qwen-image-3"].acceptsReferences).toBe(true);
  });
});

describe("resolveImageEngine", () => {
  it("resolves the default", () => {
    expect(resolveImageEngine(undefined).id).toBe(DEFAULT_IMAGE_ENGINE);
    expect(resolveImageEngine("").id).toBe(DEFAULT_IMAGE_ENGINE);
  });

  it("resolves a stored id", () => {
    expect(resolveImageEngine("nano-banana-2").slug).toBe("nano-banana-2");
    expect(resolveImageEngine("  gpt-image-2  ").id).toBe("gpt-image-2");
  });

  // A retired model in a saved config must not stop an agent from posting.
  it("falls back instead of throwing on an unknown id", () => {
    expect(resolveImageEngine("dall-e-2").id).toBe(DEFAULT_IMAGE_ENGINE);
  });
});
