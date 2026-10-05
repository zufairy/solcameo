import { describe, it, expect } from "vitest";
import { VIDEO_FORMATS, resolveFormatId } from "./videoFormats";

describe("videoFormats registry", () => {
  it("contains the union of both vocabularies", () => {
    const ids = VIDEO_FORMATS.map((f) => f.id);
    for (const id of ["talking_head", "commercial", "tutorial", "vlog", "day_in_life", "hot_take", "b_roll_voiceover", "ugc_review"]) {
      expect(ids).toContain(id);
    }
  });

  it("maps aliases across the two systems to one id", () => {
    expect(resolveFormatId("vlog")).toBe("vlog");
    expect(resolveFormatId("day_in_life")).toBe("day_in_life");
    expect(resolveFormatId("Talking Head")).toBe("talking_head");
  });

  it("treats an unknown/custom style as a first-class custom format", () => {
    expect(resolveFormatId("claymation product tour")).toBe("custom:claymation-product-tour");
  });
});
