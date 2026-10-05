import { mutation, internalMutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

async function getRow(ctx: QueryCtx | MutationCtx, ownerWallet: string) {
  return ctx.db.query("userCredits").withIndex("by_owner", (q) => q.eq("ownerWallet", ownerWallet)).unique();
}

/** Resolve an agent's owning wallet (the operator who can spend credits on its
 *  behalf) — undefined for an agent with no owner (investor-funded) or that
 *  doesn't exist. Shared by every credits call site keyed off a mintAddress
 *  instead of a wallet directly. */
export async function getOwnerWalletForMint(ctx: QueryCtx | MutationCtx, mintAddress: string): Promise<string | undefined> {
  const owner = await ctx.db
    .query("influencers")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
    .first();
  return owner?.creatorWallet;
}

/** Free signup offer: 300 credits ≈ 3 rendered videos (1 credit = $0.01, a
 *  typical single-video run lands around $1). Granted once per USER — the
 *  caller (users.linkWalletInternal) gates on users.signupCreditsGrantedAt, so
 *  linking a second wallet never re-grants. */
export const SIGNUP_GRANT_CREDITS = 300;

/** Grant the free signup credits to a wallet's balance. Plain helper (not a
 *  mutation) so users.ts can call it inside its own transaction. Does NOT
 *  touch totalPurchasedCredits — free credits are not revenue. */
export async function grantSignupCredits(ctx: MutationCtx, ownerWallet: string): Promise<void> {
  const now = Date.now();
  let row = await getRow(ctx, ownerWallet);
  if (!row) {
    const id = await ctx.db.insert("userCredits", {
      ownerWallet, balanceCredits: 0, totalPurchasedCredits: 0, totalSpentCredits: 0, updatedAt: now,
    });
    row = (await ctx.db.get(id))!;
  }
  const newBalance = row.balanceCredits + SIGNUP_GRANT_CREDITS;
  await ctx.db.patch(row._id, { balanceCredits: newBalance, updatedAt: now });
  await ctx.db.insert("creditLedger", {
    ownerWallet,
    kind: "signup_grant",
    deltaCredits: SIGNUP_GRANT_CREDITS,
    balanceAfter: newBalance,
    createdAt: now,
  });
}

/** Auto-create a zero-balance row for a wallet that doesn't have one yet. Idempotent. */
export const ensure = internalMutation({
  args: { ownerWallet: v.string() },
  handler: async (ctx, { ownerWallet }) => {
    const existing = await getRow(ctx, ownerWallet);
    if (existing) return existing._id;
    const now = Date.now();
    return ctx.db.insert("userCredits", {
      ownerWallet, balanceCredits: 0, totalPurchasedCredits: 0, totalSpentCredits: 0, updatedAt: now,
    });
  },
});

export const getBalance = query({
  args: { ownerWallet: v.string() },
  handler: async (ctx, { ownerWallet }) => {
    const row = await getRow(ctx, ownerWallet);
    if (!row) return null;
    return {
      balanceCredits: row.balanceCredits,
      totalPurchasedCredits: row.totalPurchasedCredits,
      totalSpentCredits: row.totalSpentCredits,
    };
  },
});

/** Credit balance of the wallet that OWNS this agent, keyed by mint — 0 when the
 *  agent has no owning wallet (investor-funded) or the owner has never bought
 *  credits. The upstream funding gates (clip-precheck, clipJobs.process,
 *  autoClip) call this and fold it into `effectiveSpendableUsdc`, so they gate on
 *  the same combined balance `recordUsage` actually spends from. Returns a bare
 *  number (no wallet echoed back) — same public-read posture as
 *  agentAccount.getWithNav, which those gates already read. */
export const balanceForMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }): Promise<number> => {
    const ownerWallet = await getOwnerWalletForMint(ctx, mintAddress);
    if (!ownerWallet) return 0;
    const row = await getRow(ctx, ownerWallet);
    return row?.balanceCredits ?? 0;
  },
});

export const listLedger = query({
  args: { ownerWallet: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ownerWallet, limit }) => {
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_owner", (q) => q.eq("ownerWallet", ownerWallet))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 100, 1), 500));
    return rows;
  },
});

/** Add credits (purchase, subscription grant, crypto deposit, or a REFUND of a
 *  credit-funded run that delivered nothing). Idempotent on
 *  stripeEventId/txSignature — a webhook replay must not double-credit. */
export const credit = internalMutation({
  args: {
    ownerWallet: v.string(),
    deltaCredits: v.number(),
    kind: v.union(v.literal("purchase"), v.literal("subscription_grant"), v.literal("crypto_deposit"), v.literal("admin_adjustment"), v.literal("refund")),
    stripeEventId: v.optional(v.string()),
    txSignature: v.optional(v.string()),
    relatedMintAddress: v.optional(v.string()),
  },
  handler: async (ctx, { ownerWallet, deltaCredits, kind, stripeEventId, txSignature, relatedMintAddress }) => {
    if (!(deltaCredits > 0)) throw new Error("deltaCredits must be positive");
    if (stripeEventId) {
      const dup = await ctx.db.query("creditLedger").withIndex("by_stripe_event", (q) => q.eq("stripeEventId", stripeEventId)).first();
      if (dup) return { balanceCredits: dup.balanceAfter, duplicate: true as const };
    }
    if (txSignature) {
      const dup = await ctx.db.query("creditLedger").withIndex("by_tx_signature", (q) => q.eq("txSignature", txSignature)).first();
      if (dup) return { balanceCredits: dup.balanceAfter, duplicate: true as const };
    }
    let row = await getRow(ctx, ownerWallet);
    const now = Date.now();
    if (!row) {
      const id = await ctx.db.insert("userCredits", { ownerWallet, balanceCredits: 0, totalPurchasedCredits: 0, totalSpentCredits: 0, updatedAt: now });
      row = (await ctx.db.get(id))!;
    }
    const newBalance = row.balanceCredits + deltaCredits;
    await ctx.db.patch(row._id, {
      balanceCredits: newBalance,
      // A REFUND is not a purchase — it REVERSES a prior spend, so it must not
      // inflate lifetime-purchased (which drives revenue reporting). Unwind
      // lifetime-spent instead, clamped at 0.
      ...(kind === "refund"
        ? { totalSpentCredits: Math.max(0, row.totalSpentCredits - deltaCredits) }
        : { totalPurchasedCredits: row.totalPurchasedCredits + deltaCredits }),
      updatedAt: now,
    });
    await ctx.db.insert("creditLedger", {
      ownerWallet, kind, deltaCredits, balanceAfter: newBalance,
      ...(stripeEventId ? { stripeEventId } : {}),
      ...(txSignature ? { txSignature } : {}),
      ...(relatedMintAddress ? { relatedMintAddress } : {}),
      createdAt: now,
    });
    return { balanceCredits: newBalance, duplicate: false as const };
  },
});

/** Public, secret-gated entry point for server-to-server callers (Stripe
 *  webhook, future crypto-deposit watcher) that can't reach internalMutations
 *  directly — mirrors agentTasks.recordMemory's authSecret gate. */
export const creditFromWebhook = mutation({
  args: {
    ownerWallet: v.string(),
    deltaCredits: v.number(),
    kind: v.union(v.literal("purchase"), v.literal("subscription_grant"), v.literal("crypto_deposit")),
    stripeEventId: v.optional(v.string()),
    txSignature: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { authSecret, ...args }): Promise<{ balanceCredits: number; duplicate: boolean }> => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    return ctx.runMutation(internal.userCredits.credit, args);
  },
});

/** Deduct credits for a generation cost. Returns ok:false (never throws) when
 *  the balance can't cover it — callers fall back to the agentAccount path. */
export const debit = internalMutation({
  args: {
    ownerWallet: v.string(),
    deltaCredits: v.number(),
    relatedMintAddress: v.optional(v.string()),
    relatedUsageLedgerId: v.optional(v.id("usageLedger")),
  },
  handler: async (ctx, { ownerWallet, deltaCredits, relatedMintAddress, relatedUsageLedgerId }) => {
    if (!(deltaCredits > 0)) throw new Error("deltaCredits must be positive");
    const row = await getRow(ctx, ownerWallet);
    if (!row || row.balanceCredits < deltaCredits) {
      return { ok: false as const, balanceCredits: row?.balanceCredits ?? 0 };
    }
    const now = Date.now();
    const newBalance = row.balanceCredits - deltaCredits;
    await ctx.db.patch(row._id, {
      balanceCredits: newBalance,
      totalSpentCredits: row.totalSpentCredits + deltaCredits,
      updatedAt: now,
    });
    await ctx.db.insert("creditLedger", {
      ownerWallet, kind: "spend", deltaCredits: -deltaCredits, balanceAfter: newBalance,
      ...(relatedMintAddress ? { relatedMintAddress } : {}),
      ...(relatedUsageLedgerId ? { relatedUsageLedgerId } : {}),
      createdAt: now,
    });
    return { ok: true as const, balanceCredits: newBalance };
  },
});
