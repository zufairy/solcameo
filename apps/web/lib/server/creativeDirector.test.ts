import { describe, expect, it } from "vitest";
import { VIDEO_FORMATS, fallbackBrief } from "./creativeDirector";

describe("creativeDirector fallback (no LLM)", () => {
  it("rotates to a format NOT used by the last video", () => {
    const b = fallbackBrief({
      niche: "food", contentPillars: ["recipes", "street food"],
      videoFormats: ["tutorial", "day_in_life"], lastFormat: "tutorial",
    });
    expect(b.format).toBe("day_in_life");
    expect(VIDEO_FORMATS).toContain(b.format);
    expect(b.topic.length).toBeGreaterThan(0);
  });

  it("falls back to the global format list when persona has none", () => {
    const b = fallbackBrief({ niche: "tech", contentPillars: [], videoFormats: [], lastFormat: "talking_head" });
    expect(b.format).not.toBe("talking_head");
    expect(VIDEO_FORMATS).toContain(b.format);
  });
});
