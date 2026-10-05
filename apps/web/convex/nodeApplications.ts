import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

const EXPERIENCE = new Set(["none", "1-5", "6-20", "20+"]);
const PURPOSE = new Set(["business", "agents", "both"]);
export const NODE_STATUSES = ["new", "contacted", "approved", "declined"] as const;

/** Public /node page sign-up for the Vello Operators Call. Anonymous visitors,
 *  so — like leads.capture — it is gated by the internal secret and only called
 *  from Vello's own /api/node/apply route. One row per email: re-applying
 *  refreshes the existing row (keeping its admin status) instead of stacking duplicates. */
export const submit = mutation({
  args: {
    authSecret: v.string(),
    fullName: v.string(),
    email: v.string(),
    phone: v.string(),
    country: v.string(),
    purpose: v.string(),
    businessName: v.optional(v.string()),
    telegram: v.optional(v.string()),
    experience: v.string(),
    referer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const secret = process.env.INTERNAL_CRON_SECRET ?? "";
    if (!secret || args.authSecret !== secret) throw new Error("Unauthorized");
    const fullName = args.fullName.trim().slice(0, 120);
    const email = args.email.trim().slice(0, 160);
    const phone = args.phone.trim().slice(0, 32);
    const country = args.country.trim().slice(0, 80);
    if (!fullName) throw new Error("Please enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email.");
    if (!/^\+?[0-9][0-9 ()\-.]{5,30}$/.test(phone) || phone.replace(/\D/g, "").length < 7) throw new Error("Please enter a valid phone number.");
    if (!country) throw new Error("Please choose your country.");
    if (!PURPOSE.has(args.purpose)) throw new Error("Please tell us what you want to use a node for.");
    const clip = (s: string | undefined, n: number) => (s ? s.trim().slice(0, n) || undefined : undefined);
    const fields = {
      fullName, email, emailLower: email.toLowerCase(), phone, country,
      purpose: args.purpose,
      businessName: args.purpose === "agents" ? undefined : clip(args.businessName, 120),
      telegram: clip(args.telegram, 80),
      experience: EXPERIENCE.has(args.experience) ? args.experience : "none",
      referer: clip(args.referer, 300),
    };
    const existing = await ctx.db.query("nodeApplications").withIndex("by_email", (q) => q.eq("emailLower", fields.emailLower)).first();
    if (existing) { await ctx.db.patch(existing._id, fields); return existing._id; }
    return ctx.db.insert("nodeApplications", { ...fields, status: "new", createdAt: Date.now() });
  },
});

/** Anonymous, PII-free counters for the /node page social proof. */
export const publicStats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("nodeApplications").withIndex("by_created").order("desc").take(2000);
    const week = Date.now() - 7 * 86_400_000;
    return { total: rows.length, week: rows.filter((r) => r.createdAt >= week).length };
  },
});

/** Newest-first rows for the admin Nodes page (read via admin.listNodeApplications). */
export const listData = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("nodeApplications").withIndex("by_created").order("desc").take(2000),
});

export const setStatusData = internalMutation({
  args: { id: v.id("nodeApplications"), status: v.string() },
  handler: async (ctx, { id, status }) => {
    if (!(NODE_STATUSES as readonly string[]).includes(status)) throw new Error("Invalid status");
    await ctx.db.patch(id, { status });
    return { ok: true };
  },
});
