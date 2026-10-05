import { describe, expect, it } from "vitest";
import { dropDeadMedia, isDeadMediaUrl } from "./deadMediaHosts";

describe("isDeadMediaUrl", () => {
  it("flags the restricted Supabase project", () => {
    expect(isDeadMediaUrl("https://slmlubxaclmoqxivcurz.supabase.co/storage/v1/object/public/vello-avatars/gifs/1.gif")).toBe(true);
  });
  it("keeps R2, other hosts, data URIs and empties", () => {
    expect(isDeadMediaUrl("https://pub-x.r2.dev/avatars/refs/a.jpg")).toBe(false);
    expect(isDeadMediaUrl("https://other.supabase.co/storage/v1/object/public/x.png")).toBe(false);
    expect(isDeadMediaUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isDeadMediaUrl("")).toBe(false);
    expect(isDeadMediaUrl(null)).toBe(false);
  });
});

describe("dropDeadMedia", () => {
  it("removes dead and empty entries, keeps order", () => {
    expect(dropDeadMedia([
      "https://slmlubxaclmoqxivcurz.supabase.co/storage/v1/object/public/vello-avatars/a.png",
      "https://pub-x.r2.dev/b.png",
      null,
      "",
      "https://pub-x.r2.dev/c.png",
    ])).toEqual(["https://pub-x.r2.dev/b.png", "https://pub-x.r2.dev/c.png"]);
  });
});
