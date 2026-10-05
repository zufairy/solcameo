import { describe, it, expect } from "vitest";
import { getMenuItems } from "./menu";

describe("getMenuItems", () => {
  it("launchpad navigation keeps core items first", () => {
    expect(
      getMenuItems(false)
        .slice(0, 3)
        .map((i) => [i.label, i.href]),
    ).toEqual([
      ["Home", "/"],
      ["Market", "/market"],
      ["My Agents", "/control"],
    ]);
  });
  it("keeps influencer workspaces and hides removed creator and account menus", () => {
    const routes = getMenuItems(false).map((i) => i.href);
    for (const route of ["/control", "/agents", "/explore", "/analytics"])
      expect(routes).toContain(route);
    for (const route of [
      "/ai-influencer",
      "/generations",
      "/stage",
      "/intelligence",
      "/builder",
      "/clipping",
      "/recreate",
      "/carousel",
      "/swarm",
      "/documentary",
      "/arena",
      "/profile",
      "/wallet",
      "/billing",
    ])
      expect(routes).not.toContain(route);
    expect(
      getMenuItems(false).some((i) => (i.group as string) === "Create"),
    ).toBe(false);
    expect(new Set(routes).size).toBe(routes.length);
    expect(getMenuItems(false)).toEqual(getMenuItems(true));
  });
  it("active matching: Market is active on /market and /market/abc but not on /marketing", () => {
    const market = getMenuItems(false)[1];
    expect(market.match("/market")).toBe(true);
    expect(market.match("/market/abc")).toBe(true);
    expect(market.match("/marketing")).toBe(false);
    expect(getMenuItems(false)[0].match("/")).toBe(true);
    expect(getMenuItems(false)[0].match("/market")).toBe(false);
  });
  it("legacy menu keeps the three Solstar items first", () => {
    const labels = getMenuItems(true).map((i) => i.label);
    expect(labels.slice(0, 3)).toEqual(["Home", "Market", "My Agents"]);
    expect(labels.length).toBeGreaterThan(3);
  });
});
