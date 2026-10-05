import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { GRACE_MS } from "../lib/economy/constants";

/**
 * Owner withdrawals of an agent's spendable on-chain USDC to the owner wallet.
 *
 * This is the idempotency + recovery backbone that the shares-redeem path LACKS
 * (redeem-shares has no key and no keeper → a client retry double-sends). Every
 * mutation here is SECRET-GATED (INTERNAL_CRON_SECRET): the only caller is the
 * server route /api/agents/withdraw (owner-gated via SIWS) and the recovery
 * keeper /api/economy/recover-withdrawals — both hold the internal secret.
 *
 * DOUBLE-SPEND MODEL (money-out safety):
 *   1. `begin` is the chokepoint. A row is created ONCE per idempotencyKey; a
 *      replay with the same key returns the existing row (`existing:true`) and
 *      the route then NEVER re-broadcasts (the keeper owns any in-flight/ambiguous
 *      transfer). A DIFFERENT key while a row for this mint is still `pending`
 *      throws "withdrawal already in flight" (one-in-flight-per-mint lock) so two
 *      concurrent requests can't both read the same balance and drain twice.
 *   2. The route calls `begin` BEFORE `transferUsdc`, and only broadcasts when
 *      begin says the row is freshly-created (`existing:false`).
 *   3. `markPaid` guards on status (only a `pending` row may become `paid`), so a
 *      confirmed withdrawal is never double-stamped / double-paid.
 */

function assertSecret(authSecret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

/**
 * Create-or-return the pending withdrawal row (replay-safe) with a
 * single-in-flight-per-mint lock.
 *
 *  - A row already exists for this idempotencyKey → return it verbatim
 *    (`existing:true`). The route must NOT broadcast; the keeper owns it.
 *  - Otherwise, if ANY OTHER row for this mint is still `pending` → throw. Two
 *    different keys can't both drain the same wallet at once.
 *  - Otherwise insert a fresh `pending` row (`existing:false`) — the route may
 *    now perform exactly one transfer.
 */
export const begin = mutation({
  args: {
    mintAddress: v.string(),
    ownerWallet: v.string(),
    amountUsdc: v.number(),
    idempotencyKey: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, ownerWallet, amountUsdc, idempotencyKey, authSecret }) => {
    assertSecret(authSecret);
    if (!(amountUsdc > 0)) throw new Error("amountUsdc must be positive");
    if (!idempotencyKey) throw new Error("idempotencyKey required");

    // Replay: same key → return the existing row unchanged (never re-insert).
    const existing = await ctx.db
      .query("agentWithdrawals")
      .withIndex("by_idem", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      return {
        id: existing._id,
        status: existing.status,
        txSignature: existing.txSignature ?? null,
        existing: true as const,
      };
    }

    // One-in-flight-per-mint lock: a different key can't start while another
    // withdrawal for this mint is still pending (prevents concurrent double-drain).
    const inFlight = await ctx.db
      .query("agentWithdrawals")
      .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress).eq("status", "pending"))
      .first();
    if (inFlight) throw new Error("withdrawal already in flight for this agent");

    // Cross-table money-out lock (F1-0, belt-and-suspenders): a share redemption
    // burns its shares atomically in shareRedemptions.begin but its USDC payout is
    // still physically in this wallet until the transfer confirms. Refuse to START a
    // withdrawal while ANY redemption for this mint is still `pending`, else the owner
    // could drain the redeemer's earmarked payout in the burn→confirm window (the
    // withdraw route's safeWithdrawable floor also holds it back; this closes the
    // TOCTOU gap at the money-out chokepoint). Placed AFTER the same-key replay check
    // so an already-created withdrawal is never stranded by a redemption that starts
    // later. Uses shareRedemptions' by_mint_status index; no-op for the common
    // clipper (no redemptions).
    const pendingRedemption = await ctx.db
      .query("shareRedemptions")
      .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress).eq("status", "pending"))
      .first();
    if (pendingRedemption) throw new Error("a share redemption is settling for this agent; retry shortly");

    const now = Date.now();
    const id = await ctx.db.insert("agentWithdrawals", {
      mintAddress,
      ownerWallet,
      amountUsdc,
      idempotencyKey,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { id, status: "pending" as const, txSignature: null, existing: false as const };
  },
});

/** Stamp the confirmed on-chain signature and mark the row paid. Double-pay
 *  guard: ONLY a `pending` row may become paid — a second markPaid on an
 *  already-`paid` row throws (mirrors shares.markRedeemPaid). Note the guard is
 *  on STATUS, not on txSignature: the confirm-ambiguous path legitimately stores
 *  a txSignature while the row is still `pending`, and the keeper later promotes
 *  that same row to `paid`. */
export const markPaid = mutation({
  args: { id: v.id("agentWithdrawals"), txSignature: v.string(), authSecret: v.string() },
  handler: async (ctx, { id, txSignature, authSecret }) => {
    assertSecret(authSecret);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("withdrawal not found");
    if (row.status === "paid") throw new Error("withdrawal already marked paid");
    if (row.status === "failed") throw new Error("cannot pay a failed withdrawal");
    await ctx.db.patch(id, { status: "paid", txSignature, updatedAt: Date.now() });
  },
});

/** Record a confirm-AMBIGUOUS transfer: a signature was broadcast but confirmation
 *  failed (the USDC MAY have moved). Keep status `pending` and store the sig +
 *  blockhash expiry + attempt count so the recovery keeper can verify on-chain
 *  before ever re-transferring. Never touches a paid/failed row. */
export const markAmbiguous = mutation({
  args: {
    id: v.id("agentWithdrawals"),
    txSignature: v.string(),
    lastValidBlockHeight: v.optional(v.number()),
    attempts: v.optional(v.number()),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, txSignature, lastValidBlockHeight, attempts, authSecret }) => {
    assertSecret(authSecret);
    const row = await ctx.db.get(id);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (row.status !== "pending") return { ok: false as const, reason: row.status };
    await ctx.db.patch(id, {
      txSignature,
      ...(lastValidBlockHeight !== undefined ? { lastValidBlockHeight } : {}),
      ...(attempts !== undefined ? { attempts } : {}),
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Increment the keeper's attempt counter on a still-`pending` row (a deferred
 *  ambiguous pass, or a pre-broadcast re-drive that failed again) so a genuinely
 *  stuck row eventually crosses the strand-alert threshold. Never touches a
 *  paid/failed row. */
export const bumpAttempts = mutation({
  args: { id: v.id("agentWithdrawals"), attempts: v.number(), authSecret: v.string() },
  handler: async (ctx, { id, attempts, authSecret }) => {
    assertSecret(authSecret);
    const row = await ctx.db.get(id);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (row.status !== "pending") return { ok: false as const, reason: row.status };
    await ctx.db.patch(id, { attempts, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/** Mark a row `failed` — only valid from `pending` (a PRE-broadcast transfer
 *  failure where no signature was ever produced, so no USDC moved). Frees the
 *  per-mint lock so the owner may retry with a NEW key. Never fails a paid row. */
export const markFailed = mutation({
  args: { id: v.id("agentWithdrawals"), authSecret: v.string() },
  handler: async (ctx, { id, authSecret }) => {
    assertSecret(authSecret);
    const row = await ctx.db.get(id);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (row.status === "paid") throw new Error("cannot fail a paid withdrawal");
    if (row.status === "failed") return { ok: true as const }; // idempotent
    await ctx.db.patch(id, { status: "failed", updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/** RECOVERY KEEPER read side. Lists `pending` withdrawals older than the grace
 *  window (gives the in-band route time to finish first). A row WITH a txSignature
 *  is a confirm-ambiguous transfer the keeper must verify on-chain; a row WITHOUT
 *  one is a crash orphan the keeper only ALERTS on (it can't prove no USDC moved,
 *  so it never blindly re-transfers). */
export const listStranded = query({
  args: { nowMs: v.number(), limit: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { nowMs, limit, authSecret }) => {
    assertSecret(authSecret);
    const cutoff = nowMs - GRACE_MS;
    const take = Math.max(1, Math.min(limit ?? 50, 200));
    const rows = await ctx.db
      .query("agentWithdrawals")
      .withIndex("by_pending_at", (q) => q.eq("status", "pending").lt("createdAt", cutoff))
      .order("asc")
      .take(take);
    return rows.map((r) => ({
      id: r._id,
      mintAddress: r.mintAddress,
      ownerWallet: r.ownerWallet,
      amountUsdc: r.amountUsdc,
      idempotencyKey: r.idempotencyKey,
      txSignature: r.txSignature ?? null,
      lastValidBlockHeight: r.lastValidBlockHeight ?? null,
      attempts: r.attempts,
      createdAt: r.createdAt,
    }));
  },
});

/** Fetch a withdrawal row by its idempotency key (keeper / diagnostics). */
export const getByIdem = query({
  args: { idempotencyKey: v.string(), authSecret: v.string() },
  handler: async (ctx, { idempotencyKey, authSecret }) => {
    assertSecret(authSecret);
    return await ctx.db
      .query("agentWithdrawals")
      .withIndex("by_idem", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
  },
});
