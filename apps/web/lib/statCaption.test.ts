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
