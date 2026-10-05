import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * History for the Photo Carousel Builder app (clip.carouselbuilder).
 *
 * Rows are written by the server route app/api/carousel/generate (never by the
 * browser directly) — the mutations below are secret-gated exactly like
 * clipStorage.deleteStorage, so a caller can't forge rows for an agent they
 * don't own. imageUrl is a durable public URL (persistStill → Supabase).
 */

// Newest first, bounded (the tab only shows a recent gallery).
const LIST_LIMIT = 60;

export const listByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("carouselImages")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
      .order("desc")
      .take(LIST_LIMIT);
  },
});

export const listBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("carouselImages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(LIST_LIMIT);
  },
});

export const recordGenerated = mutation({
  args: {
    sessionId: v.string(),
    mintAddress: v.optional(v.string()),
    prompt: v.string(),
    engineId: v.string(),
    engineLabel: v.string(),
    imageUrl: v.string(),
    aspectRatio: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    return await ctx.db.insert("carouselImages", {
      sessionId: args.sessionId,
      mintAddress: args.mintAddress,
      prompt: args.prompt,
      engineId: args.engineId,
      engineLabel: args.engineLabel,
      imageUrl: args.imageUrl,
      aspectRatio: args.aspectRatio,
      status: "generated",
    });
  },
});

/** Best-effort flag after a successful TikTok post (so the history shows it). */
export const markPosted = mutation({
  args: {
    id: v.id("carouselImages"),
    postUrl: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    return await ctx.db.patch(args.id, {
      status: "posted",
      postedAt: Date.now(),
      ...(args.postUrl ? { postUrl: args.postUrl } : {}),
    });
  },
});
