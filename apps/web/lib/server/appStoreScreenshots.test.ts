import { describe, it, expect } from "vitest";
import { isAppStoreUrl } from "./appStoreScreenshots";

describe("isAppStoreUrl", () => {
  it("matches Apple App Store and Google Play links", () => {
    expect(isAppStoreUrl("https://apps.apple.com/us/app/vello/id1234567890")).toBe(true);
    expect(isAppStoreUrl("https://itunes.apple.com/app/id1234567890")).toBe(true);
    expect(isAppStoreUrl("https://play.google.com/store/apps/details?id=com.vello.app")).toBe(true);
  });

  it("rejects ordinary websites", () => {
    expect(isAppStoreUrl("https://vello.gg")).toBe(false);
    expect(isAppStoreUrl("https://example.com/apps.apple")).toBe(false);
  });
});
