import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * SERIES MODE episode log — the memory the episode planner reads and writes.
 *
 * Kept deliberately small: the planner only needs the premise (to avoid reruns),
 * how the episode ended and what it left open (to decide whether to continue). The
 * video itself lives on the task/render job; this table is the SHOW's continuity.
 */

/** Recent episodes, newest first. The planner reads a bounded window — the whole
 *  history is neither needed nor affordable to score against on every render. */
export const recent = query({
  args: { mintAddress: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, limit }) => {
    const rows = await ctx.db
      .query("seriesEpisodes")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    return rows
      .sort((a, b) => b.number - a.number)
      .slice(0, Math.max(1, Math.min(50, limit ?? 12)));
  },
});

/**
 * Append an episode. Secret-gated like every other server-written row.
 *
 * The number is assigned HERE rather than by the caller: two renders finishing
 * close together would otherwise both compute "last + 1" and collide, leaving two
 * EP7s and no EP8.
 */
export const record = mutation({
  args: {
    mintAddress: v.string(),
    premise: v.string(),
    intent: v.string(),
    ending: v.optional(v.string()),
    openThreads: v.optional(v.array(v.string())),
    cliffhanger: v.optional(v.boolean()),
    cast: v.optional(v.array(v.string())),
    taskId: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { authSecret, ...row }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    const existing = await ctx.db
      .query("seriesEpisodes")
      .withIndex("by_mint", (q) => q.eq("mintAddress", row.mintAddress))
      .collect();
    const number = existing.reduce((max, e) => Math.max(max, e.number), 0) + 1;
    const id = await ctx.db.insert("seriesEpisodes", { ...row, number, createdAt: Date.now() });
    return { id, number };
  },
});

/**
 * Attach the finished video to an episode. The row is written when the episode is
 * PLANNED (so a crash mid-render still counts it as made, and the next episode
 * can't re-pick the same premise); the URL arrives later.
 */
export const attachVideo = mutation({
  args: { mintAddress: v.string(), number: v.number(), videoUrl: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, number, videoUrl, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    const row = await ctx.db
      .query("seriesEpisodes")
      .withIndex("by_mint_number", (q) => q.eq("mintAddress", mintAddress).eq("number", number))
      .first();
    if (!row) return { ok: false as const };
    await ctx.db.patch(row._id, { videoUrl });
    return { ok: true as const };
  },
});
