import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// SECRET GATE for the write mutations. These were fully public — anyone with
// the Convex URL could insert junk runs / overwrite slot state (verified live).
// Every real caller is server-side (generate/retry routes + slot workers), so
// they simply pass INTERNAL_CRON_SECRET.
function requireSecret(authSecret: string): void {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

const slotShape = v.object({
  type: v.string(),
  label: v.string(),
  engine: v.string(),
  status: v.string(),
  concept: v.optional(v.string()),
  script: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
  imageUrls: v.optional(v.array(v.string())),
  error: v.optional(v.string()),
});

// Create one UGC-sample demo run with its slots pending. Called server-side
// by app/api/admin/ugc-sample/generate/route.ts; secret-gated (the route holds
// INTERNAL_CRON_SECRET) so the public Convex API can't forge runs.
export const create = mutation({
  args: {
    websiteUrl: v.string(),
    clientName: v.optional(v.string()),
    language: v.optional(v.string()),
    clientType: v.optional(v.string()),
    websiteText: v.optional(v.string()),
    photoUrl: v.string(),
    productSummary: v.optional(v.string()),
    screenshotUrl: v.optional(v.string()),
    productImageUrl: v.optional(v.string()),
    productImageUrls: v.optional(v.array(v.string())),
    slots: v.array(slotShape),
    authSecret: v.string(),
  },
  handler: async (ctx, { authSecret, ...args }) => {
    requireSecret(authSecret);
    return await ctx.db.insert("ugcSampleRuns", { ...args, createdAt: Date.now() });
  },
});

// Patch ONE slot of a run (by array index) as its background render advances —
// merge-by-field so a status flip never wipes the concept/script already there.
export const updateSlot = mutation({
  args: {
    runId: v.id("ugcSampleRuns"),
    index: v.number(),
    status: v.optional(v.string()),
    script: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    imageUrls: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { runId, index, authSecret, ...patch }) => {
    requireSecret(authSecret);
    const run = await ctx.db.get(runId);
    if (!run) return;
    const slots = [...run.slots];
    const slot = slots[Math.floor(index)];
    if (!slot) return;
    slots[Math.floor(index)] = {
      ...slot,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.script !== undefined ? { script: patch.script } : {}),
      ...(patch.videoUrl !== undefined ? { videoUrl: patch.videoUrl } : {}),
      ...(patch.imageUrls !== undefined ? { imageUrls: patch.imageUrls } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
    };
    await ctx.db.patch(runId, { slots });
  },
});

// One run, live — the page subscribes to this while its 3 cards render.
export const get = query({
  args: { runId: v.id("ugcSampleRuns") },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

// Most recent runs, newest first — powers the page's history list.
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db.query("ugcSampleRuns").order("desc").take(Math.min(100, Math.max(1, limit ?? 20)));
  },
});

/** Delete one run (admin cleanup — e.g. probe/junk rows). Secret-gated. */
export const remove = mutation({
  args: { runId: v.id("ugcSampleRuns"), authSecret: v.string() },
  handler: async (ctx, { runId, authSecret }) => {
    requireSecret(authSecret);
    await ctx.db.delete(runId);
  },
});
