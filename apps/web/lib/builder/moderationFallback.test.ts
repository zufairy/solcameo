import { describe, expect, it } from "vitest";
import { isModerationError, nextFallbackEngine, parseTried } from "./moderationFallback";

describe("moderation fallback", () => {
  it("recognises a content-filter rejection but not an ordinary failure", () => {
    expect(isModerationError("Generated video rejected by content moderation")).toBe(true);
    expect(isModerationError("Kie veo/extend code=400: public figure detected")).toBe(true);
    expect(isModerationError("Kie 500: internal error")).toBe(false);
    expect(isModerationError("image_input file type not supported")).toBe(false);
    expect(isModerationError(undefined)).toBe(false);
  });
  it("moves down the ladder, never repeating an engine, and skips Higgsfield engines when it is not configured", () => {
    const first = nextFallbackEngine({ current: "grok-imagine/image-to-video", tried: [], seconds: 6, hasHiggsfield: true });
    expect(first?.kieModel).toBe("hf:gxv");
    const second = nextFallbackEngine({ current: "hf:gxv", tried: ["grok-imagine/image-to-video"], seconds: 6, hasHiggsfield: true });
    expect(second?.kieModel).toBe("kwaivgi/kling-v3");
    const noHf = nextFallbackEngine({ current: "grok-imagine/image-to-video", tried: [], seconds: 6, hasHiggsfield: false });
    expect(noHf?.kieModel).toBe("kwaivgi/kling-v3");
  });
  it("runs out of engines after the whole ladder has been tried", () => {
    const tried = ["grok-imagine/image-to-video", "hf:gxv", "kwaivgi/kling-v3", "hf:sd20", "bytedance/seedance-2", "gemini-omni-video"];
    expect(nextFallbackEngine({ current: "bytedance/seedance-1.5-pro", tried, seconds: 6, hasHiggsfield: true })).toBeNull();
  });
  it("reads the tried list defensively", () => {
    expect(parseTried('["a","b"]')).toEqual(["a", "b"]);
    expect(parseTried("not json")).toEqual([]);
    expect(parseTried(undefined)).toEqual([]);
  });
});
