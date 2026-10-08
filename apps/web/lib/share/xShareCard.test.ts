import { describe, expect, it } from "vitest";
import {
  SHARE_TIERS, X_POST_LIMIT, nextTierFor, browserXIntentFor, compactNumber, fallbackPostText, finalizePostText, marketLinkFor, pickVariant, platformNames, sanitizePostText, tierFor,
} from "./xShareCard";

const stats = { name: "Zippy", views: 128_400, videos: 42, posted: 30, bestViews: 51_000, platforms: ["tiktok", "x", "twitter"] };
const mint = "11111111111111111111111111111111";

describe("pickVariant", () => {
  it("is deterministic for the same inputs", () => {
    expect(pickVariant("mintA", 100, 1)).toEqual(pickVariant("mintA", 100, 1));
  });
  it("reshuffles across nonces", () => {
    const seeds = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(pickVariant("mintA", 100, i))));
    expect(seeds.size).toBe(12);
    const layouts = new Set(Array.from({ length: 40 }, (_, i) => pickVariant("mintA", 100, i).layout));
    expect(layouts.size).toBe(3);
  });
  it("changes the design when the agent identity or connected socials change", () => {
    expect(pickVariant("mintA", 100, 1, "Nova|X").seed).not.toBe(pickVariant("mintA", 100, 1, "Nova|TikTok").seed);
    expect(pickVariant("mintA", 100, 1, "Nova|X").seed).not.toBe(pickVariant("mintA", 100, 1, "Zippy|X").seed);
  });
});

describe("tierFor / compactNumber", () => {
  it("maps views to membership tiers, topping out at the invite-only 1B club", () => {
    expect(tierFor(0).label).toBe("MEMBER");
    expect(tierFor(500_000).label).toBe("SILVER");
    expect(tierFor(2_000_000).label).toBe("GOLD");
    expect(tierFor(20_000_000).label).toBe("PLATINUM");
    expect(tierFor(1_200_000_000).label).toBe("SOLCAMEO BLACK");
  });
  it("gives every tier its own material, card face and accent — not a colour swap", () => {
    expect(SHARE_TIERS.map((t) => t.material)).toEqual(["graphite", "silver", "gold", "platinum", "black"]);
    expect(new Set(SHARE_TIERS.map((t) => t.accent)).size).toBe(SHARE_TIERS.length);
    expect(new Set(SHARE_TIERS.map((t) => t.card.stops.join())).size).toBe(SHARE_TIERS.length);
    expect(pickVariant("mintA", 999, 1).tier.material).toBe("graphite");
    expect(pickVariant("mintA", 1_000_000_000, 1).tier.material).toBe("black");
  });
  it("shows honest progress to the next tier, and none past SOLCAMEO BLACK", () => {
    expect(nextTierFor(0)).toMatchObject({ tier: { label: "SILVER" }, progress: 0 });
    expect(nextTierFor(550_000)?.tier.label).toBe("GOLD");
    expect(nextTierFor(550_000)?.progress).toBeCloseTo(0.5, 5);
    expect(nextTierFor(1_200_000_000)).toBeNull();
    expect(new Set(SHARE_TIERS.map((t) => t.tagline)).size).toBe(SHARE_TIERS.length);
  });
  it("keeps the member number stable per agent across reshuffles", () => {
    expect(pickVariant("mintA", 100, 1).memberId).toBe(pickVariant("mintA", 9_999, 7).memberId);
    expect(pickVariant("mintA", 100, 1).memberId).toMatch(/^\d{6}$/);
  });
  it("formats compactly", () => {
    expect(compactNumber(999)).toBe("999");
    expect(compactNumber(1000)).toBe("1K");
    expect(compactNumber(128_400)).toBe("128K");
    expect(compactNumber(1_250_000)).toBe("1.3M");
  });
});

describe("post copy", () => {
  it("strips em and en dashes", () => {
    const out = sanitizePostText("Zippy hit 10K views — wild – right?");
    expect(out).not.toMatch(/[—–]/);
    expect(out).toBe("Zippy hit 10K views, wild, right?");
  });
  it("ends with this agent's marketplace link and stays within X's limit", () => {
    const long = finalizePostText("word ".repeat(120), mint);
    expect(long.length).toBeLessThanOrEqual(X_POST_LIMIT);
    expect(long.endsWith(marketLinkFor(mint))).toBe(true);
    const oldLink = "https://solcameo.com/market/OldAgent";
    const updated = finalizePostText(`hi ${oldLink}`, mint);
    expect(updated.match(/solcameo\.com/g)).toHaveLength(1);
    expect(updated.endsWith(marketLinkFor(mint))).toBe(true);
  });
  it("opens a user-reviewed X composer with this agent's final marketplace link", () => {
    const url = new URL(browserXIntentFor("Rainier Clips reached 10K", mint));
    expect(url.origin).toBe("https://twitter.com");
    expect(url.pathname).toBe("/intent/tweet");
    expect(url.searchParams.get("text")).toBe(finalizePostText("Rainier Clips reached 10K", mint));
  });
  it("fallback copy is dash-free, linked and mentions the agent", () => {
    for (let s = 0; s < 6; s++) {
      const text = fallbackPostText(stats, s, mint);
      expect(text).toContain("Zippy");
      expect(text).not.toMatch(/[—–]/);
      expect(text.length).toBeLessThanOrEqual(X_POST_LIMIT);
      expect(text.endsWith(marketLinkFor(mint))).toBe(true);
    }
  });
  it("does not claim a fresh agent has already published", () => {
    const fresh = { ...stats, views: 0, videos: 0, posted: 0, bestViews: 0, platforms: [] };
    for (let seed = 0; seed < 2; seed++) {
      const text = fallbackPostText(fresh, seed, mint);
      expect(text).toContain("0");
      expect(text).not.toMatch(/has posted|posts on its own|just crossed/i);
      expect(text).not.toMatch(/[—–]/);
    }
  });
  it("collapses x/twitter", () => {
    expect(platformNames(["x", "twitter", "tiktok"])).toEqual(["X", "TikTok"]);
  });
});
