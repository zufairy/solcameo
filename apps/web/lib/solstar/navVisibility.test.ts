import { describe, it, expect } from "vitest";
import { shouldUseShell } from "./navVisibility";

describe("shouldUseShell", () => {
  it("uses the shell on app routes (legacy=false)", () => {
    for (const p of ["/", "/market", "/market/abc", "/agents", "/control", "/billing", "/wallet", "/marketing", "/pricingfoo", "/hiring-x", "/node-x"]) {
      expect(shouldUseShell(p, false), p).toBe(true);
    }
  });
  it("opts out on routes with their own chrome, for both flag values", () => {
    for (const p of ["/create", "/ai-influencer", "/builder", "/builder/x", "/login", "/pricing", "/docs", "/docs/build", "/blog", "/blog/x", "/vs/klap", "/hiring", "/1b-club", "/node", "/landing", "/landing2"]) {
      for (const legacy of [true, false]) expect(shouldUseShell(p, legacy), `${p} ${legacy}`).toBe(false);
    }
  });
  it("legacy landing opts out while influencer onboarding always owns its header", () => {
    expect(shouldUseShell("/", true)).toBe(false);
    expect(shouldUseShell("/ai-influencer", true)).toBe(false);
    expect(shouldUseShell("/", false)).toBe(true);
    expect(shouldUseShell("/ai-influencer", false)).toBe(false);
  });
});
