import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Standalone Photo Carousel app (/carousel) — rows are written by the server
 * routes app/api/carousel-app/{ideate,generate} (never by the browser directly),
 * same secret-gated pattern as carouselImages.ts. Keyed by ownerId (Privy user
 * id), not mintAddress — this tool has no agent/mint dependency.
 */

const LIST_LIMIT = 30;

export const listByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("carouselProjects")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(LIST_LIMIT);
  },
});

export const get = query({
  args: { id: v.id("carouselProjects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

const slideValidator = v.object({
  prompt: v.string(),
  imageUrl: v.optional(v.string()),
  status: v.union(v.literal("pending"), v.literal("generated"), v.literal("failed")),
  error: v.optional(v.string()),
});

export const create = mutation({
  args: {
    ownerId: v.string(),
    prompt: v.string(),
    style: v.string(),
    websiteUrl: v.optional(v.string()),
    referenceImageUrl: v.optional(v.string()),
    title: v.string(),
    hook: v.string(),
    slides: v.array(slideValidator),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    return await ctx.db.insert("carouselProjects", {
      ownerId: args.ownerId,
      prompt: args.prompt,
      style: args.style,
      websiteUrl: args.websiteUrl,
      referenceImageUrl: args.referenceImageUrl,
      title: args.title,
      hook: args.hook,
      slides: args.slides,
      status: "generating",
    });
  },
});

export const patchSlide = mutation({
  args: {
    id: v.id("carouselProjects"),
    index: v.number(),
    imageUrl: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("generated"), v.literal("failed")),
    error: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const slides = row.slides.map((s, i) =>
      i === args.index ? { ...s, imageUrl: args.imageUrl, status: args.status, error: args.error } : s,
    );
    return await ctx.db.patch(args.id, { slides });
  },
});

export const finish = mutation({
  args: {
    id: v.id("carouselProjects"),
    caption: v.optional(v.string()),
    status: v.union(v.literal("ready"), v.literal("failed")),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    return await ctx.db.patch(args.id, { caption: args.caption, status: args.status });
  },
});
