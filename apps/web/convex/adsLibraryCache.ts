import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Ads Library (/recreate/library) — one cached row per key ("topads").
// Reads are public (trending-ads showcase data); writes are gated by
// INTERNAL_CRON_SECRET (only the Next scrape route refreshes the cache).

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    return await ctx.db
      .query("adsLibraryCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
  },
});

export const put = mutation({
  args: { key: v.string(), payload: v.string(), authSecret: v.string() },
  handler: async (ctx, { key, payload, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const existing = await ctx.db
      .query("adsLibraryCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { payload, fetchedAt: Date.now() });
    } else {
      await ctx.db.insert("adsLibraryCache", { key, payload, fetchedAt: Date.now() });
    }
  },
});
