import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const clipShape = v.object({
  templateId: v.string(),
  templateLabel: v.string(),
  ok: v.boolean(),
  clipUrl: v.optional(v.string()),
  title: v.optional(v.string()),
  captionText: v.optional(v.string()),
  viralScore: v.optional(v.number()),
  startSeconds: v.optional(v.number()),
  endSeconds: v.optional(v.number()),
  error: v.optional(v.string()),
});

// Record one finished admin-samples generate run (all 3 clip slots, success or
// error each). Called server-side by app/api/admin/samples/generate/route.ts
// once its own auth check (checkInternalSecret / admin accessToken) has passed
// — this mutation trusts the caller, same trust boundary as that route's other
// Convex writes.
export const record = mutation({
  args: { sourceUrl: v.string(), clips: v.array(clipShape) },
  handler: async (ctx, { sourceUrl, clips }) => {
    return await ctx.db.insert("sampleRuns", { sourceUrl, clips, createdAt: Date.now() });
  },
});

// Most recent runs, newest first — powers the samples page's history list AND
// (deduped to one entry per link) its "reuse a past link" selector.
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("sampleRuns").order("desc").take(Math.min(100, Math.max(1, limit ?? 30)));
    return rows;
  },
});
