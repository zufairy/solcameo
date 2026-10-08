import { describe, it, expect } from "vitest";
import { getMenuItems } from "./menu";

describe("getMenuItems", () => {
  it("launchpad navigation keeps core items first", () => {
    expect(
      getMenuItems(false)
        .slice(0, 4)
        .map((i) => [i.label, i.href]),
    ).toEqual([
      ["Home", "/"],
      ["Market", "/market"],
      ["Create Videos", "/create-videos"],
      ["My Influencers", "/control"],
    ]);
  });
  it("hides My Influencers and Create Videos until the user is signed in", () => {
    const out = getMenuItems(false, false).map((i) => i.href);
    expect(out).not.toContain("/control");
    expect(out).not.toContain("/create-videos");
    for (const route of ["/", "/market", "/agents", "/explore"]) expect(out).toContain(route);
    const inn = getMenuItems(false, true).map((i) => i.href);
    expect(inn).toContain("/control");
    expect(inn).toContain("/create-videos");
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
    const market = getMenuItems(false).find((i) => i.href === "/market")!;
    expect(market.match("/market")).toBe(true);
    expect(market.match("/market/abc")).toBe(true);
    expect(market.match("/marketing")).toBe(false);
    expect(getMenuItems(false)[0].match("/")).toBe(true);
    expect(getMenuItems(false)[0].match("/market")).toBe(false);
  });
  it("legacy menu keeps Home, My Agents and Video Feed first", () => {
    const labels = getMenuItems(true).map((i) => i.label);
    expect(labels.slice(0, 5)).toEqual(["Home", "Market", "Create Videos", "My Influencers", "Video Feed"]);
    expect(labels.length).toBeGreaterThan(3);
  });
});
