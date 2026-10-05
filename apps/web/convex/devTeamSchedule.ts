import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/** Internal /dev/team-schedule checklist — no auth (low-stakes ops tool, not
 *  user data). The 4-week program's steps are hardcoded in the page; this
 *  only tracks which (staff, week, day, step) cells are ticked. */

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("devTeamTaskChecks").collect();
  },
});

export const toggleCheck = mutation({
  args: {
    staffId: v.string(),
    weekIdx: v.number(),
    dayIdx: v.number(),
    stepIdx: v.number(),
    checked: v.boolean(),
  },
  handler: async (ctx, { staffId, weekIdx, dayIdx, stepIdx, checked }) => {
    const existing = await ctx.db
      .query("devTeamTaskChecks")
      .withIndex("by_cell", (q) => q.eq("staffId", staffId).eq("weekIdx", weekIdx).eq("dayIdx", dayIdx).eq("stepIdx", stepIdx))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { checked, updatedAt: now });
    } else {
      await ctx.db.insert("devTeamTaskChecks", { staffId, weekIdx, dayIdx, stepIdx, checked, updatedAt: now });
    }
    return { ok: true };
  },
});
