import { describe, it, expect } from "vitest";
import { __test } from "./kie-video-pipeline";

const { isImageRefError, capPromptForModel } = __test;

// Regression guard for the "video generation failed / does not generate in kie"
// hire-flow bug: Kie rejects the WHOLE createTask (code 500, no taskId) when a
// reference image isn't fetchable/recognizable — the real message observed live
// is "image_input file type not supported". The storyboard + per-engine render
// steps key their "retry WITHOUT the poisoning reference" fallback off this
// detector, so it MUST match Kie's real rejection strings.
describe("isImageRefError", () => {
  it("matches Kie's real reference-image rejections", () => {
    for (const msg of [
      "Kie jobs.createTask nano-banana-pro: image_input file type not supported",
      "image not found",
      "Invalid image url",
      "failed to download image",
      "unsupported image format",
      // Grok image-to-video rejects a bad-MIME reference during polling with this:
      "Kie video(grok-imagine/image-to-video 1/1) failed: Unsupported MIME type: text/plain",
      "Unsupported MIME type: text/plain",
    ]) {
      expect(isImageRefError(msg)).toBe(true);
    }
  });

  it("does NOT match unrelated failures (so we don't drop refs needlessly)", () => {
    for (const msg of [
      "Kie veo(veo3_fast) timed out after 180s",
      "prominent public figure detected",
      "storyboard chat returned no JSON",
      "concat HTTP 500",
    ]) {
      expect(isImageRefError(msg)).toBe(false);
    }
  });
});

// Grok Imagine rejects prompts > 5000 chars ("The text length cannot exceed the
// maximum limit") at createTask, which failed EVERY Grok clip → no video. The cap
// now guards EVERY video jobs model (an over-long prompt degrades the others even
// when it doesn't hard-fail); only the nano-banana storyboard image model is
// exempt (its multi-panel prompt is legitimately long).
describe("capPromptForModel", () => {
  const long = "cinematic detailed coffee scene ".repeat(300); // ~9600 chars

  // No KIE_API_KEY in the test env, so the LLM condense attempt always throws
  // and falls back to the deterministic tail-protecting truncation — assertions
  // below exercise that guaranteed path, same as before this was made async.
  it("caps an over-long grok prompt under Kie's 5000-char limit", async () => {
    const out = await capPromptForModel("grok-imagine/image-to-video", { prompt: long, mode: "normal" });
    expect((out.prompt as string).length).toBeLessThanOrEqual(4800);
    expect(out.mode).toBe("normal"); // other fields preserved
  });

  it("caps the grok extend model too", async () => {
    const out = await capPromptForModel("grok-imagine/extend", { prompt: long });
    expect((out.prompt as string).length).toBeLessThanOrEqual(4800);
  });

  it("caps other video models too, but never the storyboard image model", async () => {
    expect(((await capPromptForModel("seedance-v2", { prompt: long })).prompt as string).length).toBeLessThanOrEqual(4800);
    expect(((await capPromptForModel("gemini-omni-video", { prompt: long })).prompt as string).length).toBeLessThanOrEqual(4800);
    expect((await capPromptForModel("nano-banana-pro", { prompt: long })).prompt).toBe(long);
  });

  it("leaves short prompts untouched", async () => {
    const short = { prompt: "a short prompt" };
    expect((await capPromptForModel("grok-imagine/image-to-video", short)).prompt).toBe("a short prompt");
  });

  it("protects the TAIL (trailing stability/no-repeat rules) instead of discarding it", async () => {
    const tailRule = "CRITICAL: keep the character stable, no morphing, no repeating earlier footage.";
    const prompt = "cinematic detailed coffee scene ".repeat(250) + tailRule;
    const out = await capPromptForModel("kling-v3", { prompt });
    expect((out.prompt as string)).toContain(tailRule);
  });
});
