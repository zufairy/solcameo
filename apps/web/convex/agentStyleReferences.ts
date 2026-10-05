import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Learn tab (influencer) — example videos the agent studies for style.
// Same public-keyed access pattern (and the same rationale/tradeoff comment) as
// agentSkillFiles.ts: browser-called mutations keyed by mintAddress/sessionId,
// analysis writes gated by INTERNAL_CRON_SECRET from the Next route.

export const listByKey = query({
  args: { mintKey: v.string() },
  handler: async (ctx, { mintKey }) => {
    return await ctx.db
      .query("agentStyleReferences")
      .withIndex("by_mintKey", (q) => q.eq("mintKey", mintKey))
      .order("desc")
      .take(50);
  },
});

/** Selected (in-use) references only — the render pipeline reads these. */
export const listSelected = query({
  args: { mintKey: v.string() },
  handler: async (ctx, { mintKey }) => {
    const rows = await ctx.db
      .query("agentStyleReferences")
      .withIndex("by_mintKey", (q) => q.eq("mintKey", mintKey))
      .order("desc")
      .take(50);
    return rows.filter((r) => r.selected && r.status === "ready");
  },
});

export const create = mutation({
  args: {
    mintKey: v.string(),
    videoUrl: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentStyleReferences", {
      mintKey: args.mintKey,
      videoUrl: args.videoUrl,
      title: args.title,
      status: "analyzing",
      selected: true, // fresh examples are in-use by default; operator can untick
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/** Realtime save of the operator's use-as-reference toggle. */
export const setSelected = mutation({
  args: { id: v.id("agentStyleReferences"), selected: v.boolean() },
  handler: async (ctx, { id, selected }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await ctx.db.patch(id, { selected, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("agentStyleReferences") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    await ctx.db.delete(id);
  },
});

/** Analysis result write — Next's /api/agents/learn-video only (secret-gated). */
export const patchAnalysis = mutation({
  args: {
    id: v.id("agentStyleReferences"),
    authSecret: v.string(),
    status: v.union(v.literal("analyzing"), v.literal("ready"), v.literal("failed")),
    transcript: v.optional(v.string()),
    styleProfile: v.optional(v.string()),
    frameUrls: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, authSecret, ...rest }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.get(id);
    if (!row) throw new Error("not found");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch);
  },
});
