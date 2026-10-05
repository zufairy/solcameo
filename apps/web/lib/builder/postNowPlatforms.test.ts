import { describe, it, expect } from "vitest";
import { effectivePostNowPlatforms } from "./postNowPlatforms";

describe("effectivePostNowPlatforms (manual Post now channel resolution)", () => {
  it("uses all connected when the agent has no configured platforms", () => {
    expect(effectivePostNowPlatforms([], ["instagram", "tiktok"])).toEqual(["instagram", "tiktok"]);
  });

  it("intersects configured with connected when they overlap", () => {
    expect(effectivePostNowPlatforms(["tiktok", "instagram"], ["instagram"])).toEqual(["instagram"]);
  });

  it("returns empty only when nothing is connected", () => {
    expect(effectivePostNowPlatforms(["tiktok"], [])).toEqual([]);
  });

  // THE BUG: operator connected a social account the agent isn't configured for
  // (e.g. agent set to TikTok, but they connected Instagram). "Post now" is a
  // manual test affordance — it must still post to what IS connected, not silently
  // disable. Should fall back to all connected when there's no overlap.
  it("falls back to all connected when configured and connected don't overlap", () => {
    expect(effectivePostNowPlatforms(["tiktok"], ["instagram"])).toEqual(["instagram"]);
  });
});
