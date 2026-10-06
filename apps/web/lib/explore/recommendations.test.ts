import { describe, expect, it } from "vitest";
import { referenceAffinity } from "./recommendations";
import type { ReferenceVideo } from "./feed";
const clip = (title: string, category: string): ReferenceVideo => ({ id: title, title, category, description: "", duration: 8, previewUrl: "https://video", videoUrl: "https://video" });
describe("influencer reference suggestions", () => {
  it("prefers dance and performance references for a musician", () => {
    expect(referenceAffinity(clip("Dance on stage", "Performance"), "musician and singer")).toBeGreaterThan(referenceAffinity(clip("Morning workout", "Action"), "musician and singer"));
  });
  it("prefers outfit and lifestyle references for a fashion persona", () => {
    expect(referenceAffinity(clip("Street outfit walk", "Lifestyle"), "fashion model")).toBeGreaterThan(referenceAffinity(clip("Boxing practice", "Action"), "fashion model"));
  });
  it("ignores numeric personality trait names when matching a blueprint", () => {
    expect(referenceAffinity(clip("Funny prank", "Other"), JSON.stringify({ warmth: 80, humor: 20 }))).toBe(0);
  });
  it("keeps generic feed ordering when the persona is unavailable", () => {
    expect(referenceAffinity(clip("Dance", "Performance"), "")).toBe(0);
  });
});
