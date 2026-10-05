import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DAY_MS = 86_400_000;
const addonV = v.literal("tiktok");

/** Whether the add-on is currently paid for. Public: it exposes only a boolean and an end date. */
export const status = query({
  args: { mintAddress: v.string(), addon: addonV },
  handler: async (ctx, { mintAddress, addon }) => {
    const row = await ctx.db.query("agentAddons").withIndex("by_mint_addon", (q) => q.eq("mintAddress", mintAddress).eq("addon", addon)).first();
    const activeUntil = row?.activeUntil ?? 0;
    return { active: activeUntil > Date.now(), activeUntil };
  },
});

/** Called by the Stripe webhook after a paid invoice. Idempotent on the Stripe event id. */
export const activateFromWebhook = mutation({
  args: { mintAddress: v.string(), addon: addonV, ownerWallet: v.string(), days: v.number(), stripeEventId: v.string(), authSecret: v.string() },
  handler: async (ctx, a) => {
    if (!process.env.INTERNAL_CRON_SECRET || a.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    if (!(a.days > 0 && a.days <= 62)) throw new Error("invalid_days");
    const now = Date.now();
    const row = await ctx.db.query("agentAddons").withIndex("by_mint_addon", (q) => q.eq("mintAddress", a.mintAddress).eq("addon", a.addon)).first();
    if (row?.lastStripeEventId === a.stripeEventId) return { duplicate: true as const, activeUntil: row.activeUntil };
    const activeUntil = Math.max(now, row?.activeUntil ?? 0) + a.days * DAY_MS;
    if (row) await ctx.db.patch(row._id, { activeUntil, ownerWallet: a.ownerWallet, lastStripeEventId: a.stripeEventId, updatedAt: now });
    else await ctx.db.insert("agentAddons", { mintAddress: a.mintAddress, addon: a.addon, ownerWallet: a.ownerWallet, activeUntil, lastStripeEventId: a.stripeEventId, updatedAt: now });
    return { duplicate: false as const, activeUntil };
  },
});

/** Server-side gate for the connect route. */
export const isActiveServer = query({
  args: { mintAddress: v.string(), addon: addonV, authSecret: v.string() },
  handler: async (ctx, a) => {
    if (!process.env.INTERNAL_CRON_SECRET || a.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const row = await ctx.db.query("agentAddons").withIndex("by_mint_addon", (q) => q.eq("mintAddress", a.mintAddress).eq("addon", a.addon)).first();
    return (row?.activeUntil ?? 0) > Date.now();
  },
});
