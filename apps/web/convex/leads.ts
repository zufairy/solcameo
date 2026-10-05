import { mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Landing-page lead capture — anonymous visitors, so this is a PUBLIC
 *  mutation gated by the internal secret (same pattern as
 *  influencers.setShowBible): only Vello's own Next API routes hold the
 *  secret, so random clients can't spam the table directly. */
export const capture = mutation({
  args: {
    authSecret: v.string(),
    source: v.union(v.literal("hero_video_link"), v.literal("cta_website"), v.literal("hero_website")),
    url: v.string(),
    businessName: v.optional(v.string()),
    summary: v.optional(v.string()),
    angles: v.optional(v.array(v.string())),
    userAgent: v.optional(v.string()),
    referer: v.optional(v.string()),
  },
  handler: async (ctx, { authSecret, source, url, businessName, summary, angles, userAgent, referer }) => {
    const secret = process.env.INTERNAL_CRON_SECRET ?? "";
    if (!secret || authSecret !== secret) throw new Error("Unauthorized");
    const now = Date.now();
    // Same url + source within the last hour → update that row instead of
    // stacking duplicates (the modal re-analyzes, the hero re-submits, etc.).
    const recent = await ctx.db
      .query("leads")
      .withIndex("by_url", (q) => q.eq("url", url))
      .order("desc")
      .first();
    if (recent && recent.source === source && now - recent.createdAt < 60 * 60 * 1000) {
      await ctx.db.patch(recent._id, {
        ...(businessName ? { businessName } : {}),
        ...(summary ? { summary } : {}),
        ...(angles?.length ? { angles } : {}),
      });
      return recent._id;
    }
    return ctx.db.insert("leads", {
      source, url,
      ...(businessName ? { businessName } : {}),
      ...(summary ? { summary } : {}),
      ...(angles?.length ? { angles } : {}),
      ...(userAgent ? { userAgent } : {}),
      ...(referer ? { referer } : {}),
      createdAt: now,
    });
  },
});

/** Newest-first lead rows for the admin Leads page (read via admin.listLeads). */
export const listData = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("leads").withIndex("by_created").order("desc").take(500);
  },
});
