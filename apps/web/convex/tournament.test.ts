/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;

const influencer = (over: Record<string, unknown>) => ({
  mintAddress: "M1", creatorWallet: "W1", name: "Clipper One", handle: "clipper_one", handleLower: "clipper_one",
  avatarUrl: "https://x/a.png", niche: "podcasts", language: "English", archetype: "clipper", description: "d",
  personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 }, tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 1000, availableShares: 1000,
  agentType: "clipping", connectedPlatforms: ["tiktok"], ...over,
});

describe("tournament", () => {
  it("roster lists only clipping agents, de-duplicated by mint", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("influencers", influencer({}));
      await ctx.db.insert("influencers", influencer({ mintAddress: "M1" })); // dup mint
      await ctx.db.insert("influencers", influencer({ mintAddress: "M2", handle: "influ", handleLower: "influ", agentType: "influencer" }));
    });
    const r = await t.query(api.tournament.roster, {});
    expect(r.map((a) => a.mintAddress)).toEqual(["M1"]);
    expect(r[0].platforms).toEqual(["tiktok"]);
  });

  it("agentStats sums views/posted/generated/jobs/ledger inside the window only", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      const job = await ctx.db.insert("clipJobs", { mintAddress: "M1", sourceUrl: "https://y", sourceType: "url", status: "completed", createdAt: now - DAY, updatedAt: now - DAY });
      const oldJob = await ctx.db.insert("clipJobs", { mintAddress: "M1", sourceUrl: "https://y", sourceType: "url", status: "completed", createdAt: now - 40 * DAY, updatedAt: now - 40 * DAY });
      const clip = (o: Record<string, unknown>) => ({ jobId: job, mintAddress: "M1", title: "t", reason: "r", startSeconds: 0, endSeconds: 10, viralScore: 50, captionText: "", status: "ready", createdAt: now - DAY, updatedAt: now - DAY, ...o });
      await ctx.db.insert("clips", clip({ status: "posted", postedAt: now - DAY, viewCount: 1200, platform: "youtube" }));
      await ctx.db.insert("clips", clip({ status: "posted", postedAt: now - 2 * DAY, viewCount: 800, platform: "twitter" }));
      await ctx.db.insert("clips", clip({ status: "failed" }));
      await ctx.db.insert("clips", clip({ jobId: oldJob, status: "posted", postedAt: now - 40 * DAY, createdAt: now - 40 * DAY, viewCount: 99999 }));
      await ctx.db.insert("usageLedger", { mintAddress: "M1", service: "render", qty: 3, unitPriceUsdc: 0.4, costUsdc: 1.2, at: now - DAY });
      await ctx.db.insert("usageLedger", { mintAddress: "M1", service: "render", qty: 1, unitPriceUsdc: 0.4, costUsdc: 0.4, at: now - 40 * DAY });
    });
    const week = await t.query(api.tournament.agentStats, { mintAddress: "M1", since: now - 7 * DAY });
    expect(week).toMatchObject({ views: 2000, posted: 2, generated: 3, jobs: 1, ledgerCostUsdc: 1.2, truncated: false });
    expect(week.byPlatform).toEqual({ youtube: 1200, x: 800 });
    expect(week.lastPostedAt).toBe(now - DAY);
    const all = await t.query(api.tournament.agentStats, { mintAddress: "M1" });
    expect(all).toMatchObject({ views: 101999, posted: 3, generated: 4, jobs: 2 });
    expect(all.ledgerCostUsdc).toBeCloseTo(1.6, 6);
  });
});
