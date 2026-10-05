import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Standalone Documentary app (/documentary) — rows are written by the server
 * route app/api/documentary/generate (never by the browser directly), same
 * secret-gated pattern as carouselProjects.ts. Keyed by ownerId (Privy user
 * id) — no agent/mint dependency.
 */

const LIST_LIMIT = 30;

export const listByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documentaryProjects")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(LIST_LIMIT);
  },
});

export const get = query({
  args: { id: v.id("documentaryProjects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    prompt: v.string(),
    productUrl: v.optional(v.string()),
    voiceId: v.string(),
    musicMood: v.string(),
    durationSec: v.optional(v.number()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    return await ctx.db.insert("documentaryProjects", {
      ownerId: args.ownerId,
      prompt: args.prompt,
      productUrl: args.productUrl,
      voiceId: args.voiceId,
      musicMood: args.musicMood,
      durationSec: args.durationSec,
      statusMessage: "Starting…",
      status: "generating",
    });
  },
});

export const patch = mutation({
  args: {
    id: v.id("documentaryProjects"),
    title: v.optional(v.string()),
    script: v.optional(v.string()),
    scenes: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    statusMessage: v.optional(v.string()),
    status: v.optional(v.union(v.literal("generating"), v.literal("ready"), v.literal("failed"))),
    error: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, authSecret, ...rest }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    const clean = Object.fromEntries(Object.entries(rest).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
    return { ok: true };
  },
});
