import { describe, expect, it } from "vitest";
import { socialProfileUrl } from "./socialProfileUrl";

describe("socialProfileUrl", () => {
  it("uses durable channel and page IDs when a public ID URL exists", () => {
    expect(socialProfileUrl("youtube", { id: "UCabcdefghijklmnopqrstuv", handle: "renamed" }))
      .toBe("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv");
    expect(socialProfileUrl("facebook", { id: "1234567", handle: "renamed" }))
      .toBe("https://www.facebook.com/1234567");
  });

  it("uses the connected account handle when its platform ID is opaque", () => {
    expect(socialProfileUrl("tiktok", { id: "-opaque-open-id", handle: "@actual.account" }))
      .toBe("https://www.tiktok.com/@actual.account");
    expect(socialProfileUrl("instagram", { id: "1234567", handle: "actual.account" }))
      .toBe("https://www.instagram.com/actual.account/");
  });

  it("never invents a URL from an unrelated Vello handle or display name", () => {
    expect(socialProfileUrl("tiktok", { id: "-opaque-open-id", displayName: "Vello Agent" })).toBeNull();
    expect(socialProfileUrl("instagram", {})).toBeNull();
  });
});
