/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");

it("counts completed renders and posted clips across linked wallets without counting unfinished clips or other owners", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { supabaseId: "owner", walletAddress: "primary" });
    await ctx.db.insert("users", { supabaseId: "empty" });
    for (const walletAddress of ["primary", "older"]) {
      await ctx.db.insert("walletLinks", { userId, walletAddress, createdAt: 1 });
    }
    for (const wallet of ["primary", "older", "other"]) {
      await ctx.db.insert("influencers", {
        mintAddress: wallet, creatorWallet: wallet, name: wallet, handle: wallet,
        avatarUrl: "", niche: "", language: "en", archetype: "", description: "",
        personality: { warmth: 0, humor: 0, authority: 0, boldness: 0 },
        tvl: 0, monthlyEarnings: 0, sharePrice: 0, totalShares: 0, availableShares: 0,
      });
      const jobId = await ctx.db.insert("clipJobs", {
        mintAddress: wallet, sourceUrl: "https://example.com/source", sourceType: "url",
        status: "completed", createdAt: 1, updatedAt: 1,
      });
      for (const variant of [
        { status: "ready", clipUrl: "https://example.com/render" },
        { status: "posted" },
        { status: "failed", clipUrl: "https://example.com/render" },
        { status: "ready", clipUrl: "https://example.com/render", postedAt: 2 },
        { status: "rendering" },
        { status: "failed" },
      ]) {
        await ctx.db.insert("clips", {
          jobId, mintAddress: wallet, title: "clip", reason: "", startSeconds: 0,
          endSeconds: 10, viralScore: 0, captionText: "", createdAt: 1, updatedAt: 1,
          ...variant,
        });
      }
    }
  });
  const rows = await t.query(internal.admin.listUsersData, {});
  expect(rows.find(r => r.walletAddress === "primary")).toMatchObject({ clipsProduced: 8, clipsPosted: 4 });
  expect(rows.find(r => !r.walletAddress)).toMatchObject({ clipsProduced: 0, clipsPosted: 0 });
});
