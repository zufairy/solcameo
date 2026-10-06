import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { consumeSignature } from "./lib/payments";

/** Free portraits / shirt edits every wallet gets before the per-image price applies. */
export const FREE_IMAGES = 3;

function assertSecret(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}

async function account(ctx: MutationCtx, wallet: string) {
  const row = await ctx.db.query("studioGenAccounts").withIndex("by_account", q => q.eq("account", wallet)).unique();
  if (row) return row;
  const id = await ctx.db.insert("studioGenAccounts", { account: wallet, freeUsed: 0, credits: 0, updatedAt: Date.now() });
  return (await ctx.db.get(id))!;
}

export const quota = query({
  args: { authSecret: v.string(), account: v.string() },
  handler: async (ctx, { authSecret, account: wallet }) => {
    assertSecret(authSecret);
    const row = await ctx.db.query("studioGenAccounts").withIndex("by_account", q => q.eq("account", wallet)).unique();
    return { freeTotal: FREE_IMAGES, freeLeft: Math.max(0, FREE_IMAGES - (row?.freeUsed ?? 0)), credits: row?.credits ?? 0 };
  },
});

/**
 * Cover one image per runId. Order: free allowance (only when `useFree`), then refunded credits, then an
 * on-chain payment. Idempotent per runId. When some images still need paying and no verified signature is
 * supplied nothing is written and `needPaid` says how many images the caller must pay for.
 */
export const reserve = mutation({
  args: {
    authSecret: v.string(), account: v.string(), runIds: v.array(v.string()), useFree: v.boolean(),
    txSignature: v.optional(v.string()), amountUsd: v.number(),
    /** First attempt of a run: an existing row means the id is being replayed, not retried on another engine. */
    fresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertSecret(args.authSecret);
    const existing = await Promise.all(args.runIds.map(id => ctx.db.query("studioGenLedger").withIndex("by_run", q => q.eq("runId", id)).first()));
    if (args.fresh && existing.some(Boolean)) throw new Error("Run already billed");
    if (existing.every(Boolean)) {
      if (existing.some(r => r!.account !== args.account)) throw new Error("Run belongs to another account");
      return { ok: true as const, free: 0, credit: 0, paid: 0, duplicate: true };
    }
    if (existing.some(Boolean)) throw new Error("Partially billed run");
    const acct = await account(ctx, args.account);
    let freeLeft = args.useFree ? Math.max(0, FREE_IMAGES - acct.freeUsed) : 0;
    let credits = acct.credits;
    const plan = args.runIds.map(() => {
      if (freeLeft > 0) { freeLeft--; return "free" as const; }
      if (credits > 0) { credits--; return "credit" as const; }
      return "paid" as const;
    });
    const needPaid = plan.filter(p => p === "paid").length;
    if (needPaid > 0 && !args.txSignature) return { ok: false as const, needPaid };
    if (needPaid > 0) await consumeSignature(ctx, { txSignature: args.txSignature!, purpose: "studio_gen", ref: args.account, amount: needPaid * args.amountUsd });
    const free = plan.filter(p => p === "free").length, credit = plan.filter(p => p === "credit").length;
    await ctx.db.patch(acct._id, { freeUsed: acct.freeUsed + free, credits: acct.credits - credit, updatedAt: Date.now() });
    for (const [i, source] of plan.entries()) {
      await ctx.db.insert("studioGenLedger", {
        account: args.account, runId: args.runIds[i], source, txSignature: source === "paid" ? args.txSignature : undefined,
        amountUsd: source === "paid" ? args.amountUsd : 0, refunded: false, createdAt: Date.now(),
      });
    }
    return { ok: true as const, free, credit, paid: needPaid, duplicate: false };
  },
});

/** Give a failed image back: free images return to the allowance, paid ones become a credit. */
export const refund = mutation({
  args: { authSecret: v.string(), runId: v.string() },
  handler: async (ctx, { authSecret, runId }) => {
    assertSecret(authSecret);
    const row = await ctx.db.query("studioGenLedger").withIndex("by_run", q => q.eq("runId", runId)).first();
    if (!row || row.refunded) return { refunded: false };
    const acct = await account(ctx, row.account);
    await ctx.db.patch(row._id, { refunded: true });
    await ctx.db.patch(acct._id, row.source === "free"
      ? { freeUsed: Math.max(0, acct.freeUsed - 1), updatedAt: Date.now() }
      : { credits: acct.credits + 1, updatedAt: Date.now() });
    return { refunded: true };
  },
});
