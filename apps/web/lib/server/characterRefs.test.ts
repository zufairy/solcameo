import { describe, expect, it } from "vitest";
import { resolveCharacterRefs } from "./characterRefs";

describe("resolveCharacterRefs", () => {
  it("prefers static images over a GIF avatar and caps at 3", () => {
    const r = resolveCharacterRefs(
      "https://x/gifs/a.gif",
      ["https://x/1.png", "https://x/2.jpg", "https://x/3.webp", "https://x/4.png"],
    );
    expect(r.refs).toEqual(["https://x/1.png", "https://x/2.jpg", "https://x/3.webp"]);
    expect(r.note).toBeUndefined();
  });

  it("dedupes and keeps the primary static avatar first", () => {
    const r = resolveCharacterRefs("https://x/1.png", ["https://x/1.png", "https://x/2.png"]);
    expect(r.refs).toEqual(["https://x/1.png", "https://x/2.png"]);
  });

  it("GIF-only → returns the gif with a static-avatar note", () => {
    const r = resolveCharacterRefs("https://x/a.gif", ["https://x/b.gif"]);
    expect(r.refs).toEqual(["https://x/a.gif"]);
    expect(r.note).toMatch(/static avatar/i);
  });

  it("no usable image → empty refs + note", () => {
    const r = resolveCharacterRefs("", []);
    expect(r.refs).toEqual([]);
    expect(r.note).toMatch(/identity may drift/i);
  });
});

describe("resolveCharacterRefs — dead hosts", () => {
  it("skips URLs on the restricted Supabase project so Kie never receives them", () => {
    const dead = "https://slmlubxaclmoqxivcurz.supabase.co/storage/v1/object/public/vello-avatars/refs/a.png";
    const r = resolveCharacterRefs(dead, [dead, "https://pub-x.r2.dev/b.png"]);
    expect(r.refs).toEqual(["https://pub-x.r2.dev/b.png"]);
  });
  it("reports no reference when every candidate is dead", () => {
    const r = resolveCharacterRefs("https://slmlubxaclmoqxivcurz.supabase.co/storage/v1/object/public/vello-avatars/gifs/a.gif");
    expect(r.refs).toEqual([]);
    expect(r.note).toMatch(/no reference image/);
  });
});
