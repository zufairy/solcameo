import { expect, it } from "vitest";
import { statCaption, type StatCaptionData } from "./marketingCaption";

const data: StatCaptionData = {
  weekViews: 1_250_000, weekPosts: 340, weekActive: 41, monthViews: 4_800_000, totalAgents: 212, mintedToday: 6, totalPosts: 2100, totalGenerated: 2600,
  agents: [{ name: "Luna Fox", views: 420_000 }, { name: "Kai", views: 310_000 }, { name: "Nova Fit", views: 150_000 }],
  platforms: [{ id: "youtube", views: 2_000_000 }, { id: "tiktok", views: 1_900_000 }, { id: "x", views: 0 }],
  minted: [{ name: "Zed", handle: "ZED" }, { name: "Hana", handle: "HANA" }],
};
const kinds = ["network", "leaderboard", "social", "engine", "minted"];

it("leads with the real numbers and stays within X's limit, with no em dashes or hashtags", () => {
  for (const kind of kinds) for (const seed of ["a", "b", "c", "d"]) {
    const text = statCaption(kind, data, seed);
    expect(text.length).toBeLessThanOrEqual(275);
    expect(text).not.toMatch(/[—–#]/);
    expect(text).toContain("solcameo.com");
  }
  expect(statCaption("network", data, "x")).toContain("1.3M");
  expect(statCaption("leaderboard", data, "x")).toMatch(/1\. Luna Fox\s+420K views/);
  expect(statCaption("social", data, "x")).toContain("youtube leads with 2.0M");
  expect(statCaption("minted", data, "x")).toContain("$ZED, $HANA");
});
it("rotates the wording by seed and ends on a question or a dare", () => {
  const set = new Set(["a", "b", "c", "d", "e", "f"].map((s) => statCaption("network", data, s)));
  expect(set.size).toBeGreaterThan(1);
  expect(statCaption("network", data, "a")).toMatch(/\?\s*\n\nsolcameo\.com$/);
});

import { withTicker } from "./marketingCaption";
it("adds the coin's ticker and link to any caption that lacks it, within one post", () => {
  const coin = { ticker: "orgie", url: "https://solcameo.com/market/orgie" };
  expect(withTicker("new drop from orangie", coin)).toBe("new drop from orangie\n\n$ORGIE https://solcameo.com/market/orgie");
  expect(withTicker("already naming $ORGIE here", coin)).toBe("already naming $ORGIE here");
  expect(withTicker("x ".repeat(200), coin).length).toBeLessThanOrEqual(275);
  expect(withTicker("hello", null)).toBe("hello");
});

import { tokenLaunchCaption, videoLaunchCaption } from "./marketingCaption";
it("never leaves a blank gap in a coin or video caption, whatever the ticker hashes to", () => {
  for (const t of ["ALG", "MILO", "ORGIE", "ZZZZZZ", "A1", "NOVA", "KURO", "HANA"]) {
    const v = videoLaunchCaption({ name: "Along Rocket", ticker: t, bio: "an ai creator", url: "https://solcameo.com/market/x" });
    const c = tokenLaunchCaption({ name: "Along Rocket", ticker: t, bio: "an ai creator", url: "https://solcameo.com/market/x" });
    for (const text of [v, c]) { expect(text).not.toMatch(/\n\n\n/); expect(text).not.toContain("undefined"); expect(text).toContain(`$${t}`); }
  }
});
