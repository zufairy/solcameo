import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { consumeSignature } from "./lib/payments";

/**
 * Videos made from Explore's describe box without an influencer. The user pays USDC from their own wallet, and
 * one payment buys exactly one video: this table ties the payment signature to the render it paid for, so a
 * payment can never start two renders, and a render that failed can be run again on the same payment.
 */
function assertSecret(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}

/**
 * Claim a verified payment. `fresh` is a payment never seen before; `existing` is one already attached to a render
 * (carrying its task so the caller can check whether that render failed and may be retried).
 */
export const claim = mutation({
  args: { authSecret: v.string(), account: v.string(), txSignature: v.string(), amountUsd: v.number() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const run = await ctx.db.query("describeVideoRuns").withIndex("by_signature", (q) => q.eq("txSignature", a.txSignature)).first();
    if (run) {
      if (run.account !== a.account) throw new Error("payment_used");
      return { kind: "existing" as const, taskId: run.taskId ?? null, requestId: run.requestId ?? null };
    }
    // The shared ledger also stops this signature being spent on anything else (studio images, escrow, ...).
    await consumeSignature(ctx, { txSignature: a.txSignature, purpose: "describe_video", ref: a.account, amount: a.amountUsd });
    await ctx.db.insert("describeVideoRuns", { account: a.account, txSignature: a.txSignature, amountUsd: a.amountUsd, createdAt: Date.now() });
    return { kind: "fresh" as const, taskId: null, requestId: null };
  },
});

/** Point a paid run at the render it started (or restarted after a failure). */
export const attach = mutation({
  args: { authSecret: v.string(), txSignature: v.string(), taskId: v.id("agentTasks") },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const run = await ctx.db.query("describeVideoRuns").withIndex("by_signature", (q) => q.eq("txSignature", a.txSignature)).first();
    if (!run) throw new Error("run_not_found");
    await ctx.db.patch(run._id, { taskId: a.taskId });
    return { ok: true as const };
  },
});

/** Point a paid run at the provider job it started (motion transfer). */
export const attachRequest = mutation({
  args: { authSecret: v.string(), txSignature: v.string(), requestId: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const run = await ctx.db.query("describeVideoRuns").withIndex("by_signature", (q) => q.eq("txSignature", a.txSignature)).first();
    if (!run) throw new Error("run_not_found");
    await ctx.db.patch(run._id, { requestId: a.requestId });
    return { ok: true as const };
  },
});

/** Whether this account paid for the provider job, so only the payer can read its result. */
export const ownsRequest = query({
  args: { authSecret: v.string(), account: v.string(), requestId: v.string() },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    const run = await ctx.db.query("describeVideoRuns").withIndex("by_request", (q) => q.eq("requestId", a.requestId)).first();
    return !!run && run.account === a.account;
  },
});

/** Paid runs that never produced a render (the server could not start it), for support to retry or refund. */
export const unfulfilled = query({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    assertSecret(authSecret);
    const recent = await ctx.db.query("describeVideoRuns").order("desc").take(100);
    return recent.filter((r) => !r.taskId && !r.requestId).map((r) => ({ account: r.account, txSignature: r.txSignature, amountUsd: r.amountUsd, createdAt: r.createdAt }));
  },
});
