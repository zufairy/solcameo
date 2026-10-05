import { describe, expect, it } from "vitest";
import { normalizePlatform, inferContentType, planSocialTargets } from "./socialTargeting";

describe("normalizePlatform", () => {
  it("maps twitter to the canonical x id", () => {
    expect(normalizePlatform("twitter")).toBe("x");
    expect(normalizePlatform("Twitter")).toBe("x");
  });
  it("lowercases other platform ids", () => {
    expect(normalizePlatform("TikTok")).toBe("tiktok");
    expect(normalizePlatform("Threads")).toBe("threads");
  });
});

describe("inferContentType", () => {
  it("honors an explicit valid content type", () => {
    expect(inferContentType("photo", ["https://x/y.mp4"])).toBe("photo");
  });
  it("falls back to text when there is no media", () => {
    expect(inferContentType(undefined, [])).toBe("text");
    expect(inferContentType("bogus", [])).toBe("text");
  });
  it("detects video from the first media file extension", () => {
    expect(inferContentType(undefined, ["https://cdn/v.mp4"])).toBe("video");
    expect(inferContentType(undefined, ["https://cdn/v.mov?sig=1"])).toBe("video");
  });
  it("treats non-video media as a photo post", () => {
    expect(inferContentType(undefined, ["https://cdn/p.jpg"])).toBe("photo");
  });
});

describe("planSocialTargets — Upload-Post routing (TikTok/IG/Threads)", () => {
  it("posts a video to every connected video-capable account when none requested", () => {
    const { targets, skipped } = planSocialTargets({
      requested: [],
      connected: ["tiktok", "instagram", "threads"],
      contentType: "video",
    });
    expect(targets.sort()).toEqual(["instagram", "threads", "tiktok"]);
    expect(skipped).toEqual([]);
  });

  it("skips TikTok and Instagram for a text post (they have no text endpoint)", () => {
    const { targets, skipped } = planSocialTargets({
      requested: [],
      connected: ["tiktok", "instagram", "threads"],
      contentType: "text",
    });
    expect(targets).toEqual(["threads"]);
    expect(skipped.sort()).toEqual(["instagram", "tiktok"]);
  });

  it("intersects the requested platforms with the connected ones", () => {
    const { targets, skipped } = planSocialTargets({
      requested: ["tiktok", "x"],
      connected: ["tiktok", "instagram"],
      contentType: "video",
    });
    expect(targets).toEqual(["tiktok"]);
    // x was requested but not connected → reported as skipped
    expect(skipped).toEqual(["x"]);
  });

  it("returns no targets when a requested platform cannot take the content type", () => {
    const { targets, skipped } = planSocialTargets({
      requested: ["tiktok"],
      connected: ["tiktok"],
      contentType: "text",
    });
    expect(targets).toEqual([]);
    expect(skipped).toEqual(["tiktok"]);
  });
});
