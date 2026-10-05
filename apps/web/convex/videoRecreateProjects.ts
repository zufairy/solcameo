import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Durable state for the standalone /recreate app's chunked Grok render — same
// clip-chain shape as videoRenderJobs.ts, scoped to ownerId (Privy user id)
// instead of an agent's mintAddress, no autoPost/economy coupling.

export const create = mutation({
  args: {
    ownerId: v.string(),
    driveToken: v.string(),
    sourceVideoUrl: v.string(),
    productImageUrl: v.optional(v.string()),
    language: v.string(),
    race: v.string(),
    engine: v.optional(v.string()),
    characterImageUrl: v.optional(v.string()),
    referenceUrl: v.optional(v.string()),
    userPrompt: v.optional(v.string()),
    refMode: v.optional(v.string()),
    appStoreUrl: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    return await ctx.db.insert("videoRecreateProjects", {
      ownerId: args.ownerId,
      driveToken: args.driveToken,
      sourceVideoUrl: args.sourceVideoUrl,
      productImageUrl: args.productImageUrl,
      language: args.language,
      race: args.race,
      engine: args.engine,
      characterImageUrl: args.characterImageUrl,
      referenceUrl: args.referenceUrl,
      userPrompt: args.userPrompt,
      refMode: args.refMode,
      appStoreUrl: args.appStoreUrl,
      phase: "understanding",
      statusMessage: "Queued — watching the source video…",
      attempts: 0,
      updatedAt: Date.now(),
    });
  },
});

export const patch = mutation({
  args: {
    id: v.id("videoRecreateProjects"),
    driveToken: v.string(),
    phase: v.optional(v.union(
      v.literal("understanding"), v.literal("planning"), v.literal("video"),
      v.literal("stitching"), v.literal("done"), v.literal("failed"),
    )),
    statusMessage: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    sourceAspect: v.optional(v.string()),
    productImageUrl: v.optional(v.string()),
    productImageUrls: v.optional(v.string()),
    productDescription: v.optional(v.string()),
    focusBrief: v.optional(v.string()),
    characterImageUrl: v.optional(v.string()),
    wanSourceUrl: v.optional(v.string()),
    screenshotUrls: v.optional(v.string()),
    scenes: v.optional(v.string()),
    beats: v.optional(v.string()),
    grokPlan: v.optional(v.string()),
    accumulatedSeconds: v.optional(v.number()),
    segmentPrompts: v.optional(v.string()),
    standalonePrompts: v.optional(v.string()),
    refImages: v.optional(v.string()),
    totalSegments: v.optional(v.number()),
    clipIndex: v.optional(v.number()),
    veoTaskId: v.optional(v.string()),
    veoSeed: v.optional(v.number()),
    stitchMode: v.optional(v.boolean()),
    stitchClips: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    videoNote: v.optional(v.string()),
    attempts: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, driveToken, ...rest }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("not found");
    if (driveToken !== row.driveToken) throw new Error("unauthorized");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch);
  },
});

/** Internal read for the render-step route (needs driveToken to check it, and
 *  the JSON-encoded chain state) — not exposed for a client to browse blindly. */
export const getForStep = query({
  args: { id: v.id("videoRecreateProjects"), driveToken: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || args.driveToken !== row.driveToken) return null;
    return row;
  },
});

/** Client-facing read (progress UI) — no secrets returned beyond what the owner
 *  themselves uploaded/requested. */
export const get = query({
  args: { id: v.id("videoRecreateProjects") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const { driveToken: _driveToken, ...pub } = row;
    return pub;
  },
});

const LIST_LIMIT = 20;

export const listByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("videoRecreateProjects")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(LIST_LIMIT);
    return rows.map(({ driveToken: _driveToken, ...pub }) => pub);
  },
});
