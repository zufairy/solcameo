import { describe, expect, it } from "vitest";
import { normalizeFeed } from "./feed";
describe("public reference normalization", () => {
  it("keeps original motion distinct from the finished preview", () => {
    const result = normalizeFeed({ cursor: 2, total: 100, items: [{ id: "dance", title: "Dance routine", original_video: { url: "https://example.com/source.mp4", duration: 8 }, variants: [{ type: "edit", media: { url: "https://example.com/preview.mp4" } }] }] });
    expect(result.items[0]).toMatchObject({ videoUrl: "https://example.com/source.mp4", previewUrl: "https://example.com/source.mp4", demoUrl: "https://example.com/preview.mp4", category: "Dance" });
    expect(result.next).toBe(2);
  });
  it("resolves an explicitly original variant without using an edit or generation", () => {
    const result = normalizeFeed({ items: [{ id: "variant", variants: [{ type: "edit", media: { url: "https://example.com/edit.mp4", duration: 8 } }, { type: "original", media: { url: "https://example.com/input.mp4", duration: 8, thumbnail_url: "https://example.com/original.webp" } }] }] });
    expect(result.items[0]).toMatchObject({ videoUrl: "https://example.com/input.mp4", previewUrl: "https://example.com/input.mp4", thumbUrl: "https://example.com/original.webp" });
    expect(normalizeFeed({ items: [{ id: "edited-only", variants: [{ type: "edit", media: { url: "https://example.com/edit.mp4", duration: 8 } }] }] }).items).toEqual([]);
  });
  it("rejects invalid media and videos shorter than the provider minimum", () => {
    expect(normalizeFeed({ items: [{ id: "short", original_video: { url: "https://example.com/a.mp4", duration: 3 } }, { id: "unsafe", original_video: { url: "javascript:alert(1)", duration: 8 } }] }).items).toEqual([]);
    expect(normalizeFeed(null).items).toEqual([]);
    expect(normalizeFeed({ items: "invalid" }).items).toEqual([]);
  });
  it("falls back to the original and ends pagination when cursor is missing", () => {
    const result = normalizeFeed({ items: [{ id: "walk", title: "Walking", original_video: { url: "https://example.com/a.mp4", duration: 4 } }] });
    expect(result.items[0].previewUrl).toBe(result.items[0].videoUrl);
    expect(result.next).toBeNull();
  });
});

describe("category tabs", () => {
  it("lists the new tabs and matches topics from the text", async () => {
    const { CATEGORIES, inCategory, topicsOf, TRENDING_TOP } = await import("./feed");
    expect(CATEGORIES).toEqual(expect.arrayContaining(["Trending", "Movie", "Crypto"]));
    expect(topicsOf({ title: "Cinematic trailer", description: "A hero in a film scene" })).toContain("Movie");
    expect(topicsOf({ title: "Bitcoin trader", description: "pumping the chart" })).toContain("Crypto");
    expect(inCategory({ title: "Studio dance", category: "Dance" }, "Dance")).toBe(true);
    expect(inCategory({ title: "x", category: "Other" }, "Trending", TRENDING_TOP - 1)).toBe(true);
    expect(inCategory({ title: "x", category: "Other" }, "Trending", TRENDING_TOP)).toBe(false);
  });
});
