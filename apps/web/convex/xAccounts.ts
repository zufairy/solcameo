import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
const guard = (secret: string) => {
  if (
    !process.env.INTERNAL_CRON_SECRET ||
    secret !== process.env.INTERNAL_CRON_SECRET
  )
    throw new Error("Unauthorized");
};
export const get = query({
  args: { profile: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    return await ctx.db
      .query("xAccounts")
      .withIndex("by_profile", (q) => q.eq("profile", a.profile))
      .unique();
  },
});
export const save = mutation({
  args: { profile: v.string(), encrypted: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    const old = await ctx.db
      .query("xAccounts")
      .withIndex("by_profile", (q) => q.eq("profile", a.profile))
      .unique();
    if (old) await ctx.db.patch(old._id, { encrypted: a.encrypted });
    else
      await ctx.db.insert("xAccounts", {
        profile: a.profile,
        encrypted: a.encrypted,
      });
  },
});
export const remove = mutation({
  args: { profile: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    guard(a.authSecret);
    const old = await ctx.db
      .query("xAccounts")
      .withIndex("by_profile", (q) => q.eq("profile", a.profile))
      .unique();
    if (old) await ctx.db.delete(old._id);
  },
});
