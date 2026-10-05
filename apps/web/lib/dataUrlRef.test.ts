import { describe, it, expect } from "vitest";
import { parseDataUrlRef } from "./dataUrlRef";

describe("parseDataUrlRef", () => {
  it("splits a JPEG data URL into mimeType + base64 (the reference the avatar route needs)", () => {
    const base64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD"; // truncated JPEG header
    const ref = parseDataUrlRef(`data:image/jpeg;base64,${base64}`);
    expect(ref).toEqual({ mimeType: "image/jpeg", base64 });
  });

  it("handles PNG (canvas.toDataURL output)", () => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const ref = parseDataUrlRef(`data:image/png;base64,${base64}`);
    expect(ref).toEqual({ mimeType: "image/png", base64 });
  });

  it("preserves the exact base64 so the reference is not corrupted before hosting", () => {
    const base64 = "QUJDREVG+/abc123==";
    const ref = parseDataUrlRef(`data:image/webp;base64,${base64}`);
    expect(ref?.base64).toBe(base64);
    expect(ref?.mimeType).toBe("image/webp");
  });

  it("returns null for a non-base64 / plain http(s) URL (nothing to send as a reference)", () => {
    expect(parseDataUrlRef("https://example.com/photo.png")).toBeNull();
    expect(parseDataUrlRef("data:image/png,notbase64")).toBeNull();
  });

  it("returns null for empty / nullish input", () => {
    expect(parseDataUrlRef("")).toBeNull();
    expect(parseDataUrlRef(null)).toBeNull();
    expect(parseDataUrlRef(undefined)).toBeNull();
  });
});
