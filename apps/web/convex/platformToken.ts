import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { EPOCH_MS, epochStart, marginOf, splitRevenue } from "../lib/tokenomics/platformToken";

const SETTLEMENT_CAP = 8000; // stay well under Convex's per-function read limit; a busier week is flagged `truncated`

function guard(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}

/**
 * Freeze one closed week: sum the generation spend that really settled on-chain to the treasury in that window, take the
 * Solcameo margin, and split it per the published policy. Idempotent: an epoch is planned once and never rewritten.
 */
export const planEpoch = mutation({
  args: { authSecret: v.string(), epochStart: v.optional(v.number()) },
  handler: async (ctx, { authSecret, epochStart: wanted }) => {
    guard(authSecret);
    const now = Date.now();
    const start = epochStart(wanted ?? now - EPOCH_MS); // default: the week that just ended
    const end = start + EPOCH_MS;
    if (end > now) throw new Error("epoch_not_closed");
    const existing = await ctx.db.query("platformTokenEpochs").withIndex("by_epoch", (q) => q.eq("epochStart", start)).unique();
    if (existing) return { created: false as const, epochId: existing._id };
    const rows = await ctx.db.query("feeSettlements").withIndex("by_paid_at", (q) => q.eq("paid", true).gte("at", start).lt("at", end)).take(SETTLEMENT_CAP + 1);
    const truncated = rows.length > SETTLEMENT_CAP;
    const settledMicro = rows.slice(0, SETTLEMENT_CAP).reduce((s, r) => s + Math.round(r.amountUsdc * 1e6), 0);
    const plan = splitRevenue(marginOf(BigInt(settledMicro)));
    const epochId = await ctx.db.insert("platformTokenEpochs", {
      epochStart: start, epochEnd: end, settledMicro,
      revenueMicro: Number(plan.revenue), buybackMicro: Number(plan.buyback), opsMicro: Number(plan.ops), treasuryMicro: Number(plan.treasury),
      truncated, status: "planned", createdAt: now,
    });
    return { created: true as const, epochId };
  },
});

export const markBurned = mutation({
  args: { authSecret: v.string(), epochStart: v.number(), burnTokens: v.string(), burnSig: v.string() },
  handler: async (ctx, { authSecret, epochStart: start, burnTokens, burnSig }) => {
    guard(authSecret);
    const row = await ctx.db.query("platformTokenEpochs").withIndex("by_epoch", (q) => q.eq("epochStart", start)).unique();
    if (!row) throw new Error("epoch_not_found");
    if (row.status === "burned") return { updated: false as const };
    await ctx.db.patch(row._id, { status: "burned", burnTokens, burnSig });
    return { updated: true as const };
  },
});

/** Public: the recent epochs shown on /tokenomics. Amounts only, no per-agent data. */
export const listEpochs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("platformTokenEpochs").withIndex("by_epoch").order("desc").take(Math.min(Math.max(limit ?? 8, 1), 26));
    return rows.map(({ _id, _creationTime, ...r }) => ({ id: _id as string, ...r }));
  },
});
