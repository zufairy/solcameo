import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { burnSharesForRedeem } from "./shares";

/**
 * Idempotent, keeper-recoverable share redemptions (H4).
 *
 * The old flow — shares.redeemShares (burn + escrow debit) → transfer → markRedeemPaid
 * — had NO idempotency key and NO recovery keeper: a client retry of a confirm-timeout
 * 502 burned ANOTHER tranche AND fired a SECOND real USDC transfer (double-spend). This
 * module mirrors the fee-settlement recovery pattern as a dedicated `shareRedemptions`
 * ledger:
 *
 *   begin        — create-or-return the pending row keyed by idempotencyKey; on FRESH
 *                  create it BURNS atomically (so a concurrent redemption can't reuse
 *                  the same shares), and a one-in-flight-per-holder lock blocks a new
 *                  redemption while one is unresolved. A same-key retry returns the
 *                  existing row WITHOUT re-burning.
 *   markPaid     — status-guarded finalize (transfer confirmed): stamps the payout sig
 *                  on both this row and the shareLedger burn row.
 *   markAmbiguous— records a broadcast-but-unconfirmed sig (+lvbh/attempts) so the
 *                  keeper verifies on-chain before EVER re-transferring; also the
 *                  keeper's soft-lease touch (bumps updatedAt). Never clears a sig.
 *   markFailed   — REVERSES the burn (restores shares + escrow, deletes the ledger
 *                  row). Refused once any sig was broadcast (the USDC may have moved).
 *   listStranded / getByIdem — the keeper's read side.
 *
 * All money mutations are public but INTERNAL_CRON_SECRET-gated (ConvexHttpClient
 * can't reach internal fns); reachable only through /api/market/redeem-shares and
 * /api/economy/recover-redemptions, which own auth.
 */

function requireSecret(authSecret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

/** REVERSE a redemption burn: re-credit the account (shares + escrow + liquid) and
 *  delete the shareLedger `redeem` row so walletShares reflects the restore. Only
 *  ever called when the payout provably never moved (no sig was broadcast). */
async function reverseRedeemBurn(ctx: MutationCtx, row: Doc<"shareRedemptions">): Promise<void> {
  const account = await ctx.db
    .query("agentAccount")
    .withIndex("by_mint", (q) => q.eq("mintAddress", row.mintAddress))
    .unique();
  if (account) {
    await ctx.db.patch(account._id, {
      sharesOutstanding: account.sharesOutstanding + row.sharesBurned,
      escrowUsdc: account.escrowUsdc + row.payoutUsdc,
      liquidUsdc: account.liquidUsdc + row.payoutUsdc,
      updatedAt: Date.now(),
    });
  }
  // Delete the burn ledger row (it never really executed). Guard against a missing
  // row (idempotent re-reverse) so a double markFailed can't throw.
  const ledger = await ctx.db.get(row.redeemRowId);
  if (ledger) await ctx.db.delete(row.redeemRowId);
}

/** Serialize a row for the keeper / route (avoid leaking internal `_` fields). */
function serialize(row: Doc<"shareRedemptions">) {
  return {
    redemptionId: row._id,
    mintAddress: row.mintAddress,
    holderWallet: row.holderWallet,
    idempotencyKey: row.idempotencyKey,
    sharesBurned: row.sharesBurned,
    payoutUsdc: row.payoutUsdc,
    exitFeeUsdc: row.exitFeeUsdc,
    redeemRowId: row.redeemRowId,
    status: row.status,
    txSignature: row.txSignature ?? null,
    lastValidBlockHeight: row.lastValidBlockHeight ?? null,
    attempts: row.attempts,
    error: row.error ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Create (and BURN) or return-existing a redemption, keyed by idempotencyKey.
 *   { created: true, ... }            — fresh: the burn happened, the route transfers.
 *   { created: false, redemption }    — same-key retry: DO NOT re-burn/re-broadcast.
 *   { created: false, locked: true }  — a DIFFERENT redemption for this holder is
 *                                       still in-flight; refuse to burn more (safety).
 */
export const begin = mutation({
  args: {
    mintAddress: v.string(),
    holderWallet: v.string(),
    sharesToBurn: v.number(),
    idempotencyKey: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, holderWallet, sharesToBurn, idempotencyKey, authSecret }) => {
    requireSecret(authSecret);
    if (sharesToBurn <= 0) throw new Error("sharesToBurn must be positive");
    if (!idempotencyKey) throw new Error("idempotencyKey required");

    // 1) Same-key retry → return the existing row, never re-burn. This is what makes
    //    a client retry of a confirm-timeout 502 safe.
    const existing = await ctx.db
      .query("shareRedemptions")
      .withIndex("by_idem", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { created: false as const, locked: false as const, redemption: serialize(existing) };

    // 2) ONE-IN-FLIGHT lock (per holder+mint): a DIFFERENT-key redemption while one
    //    is still pending is refused — burning more shares before the first resolves
    //    risks over-redeeming / a double payout. The keeper resolves the pending one
    //    (paid or reversed), then the lock releases.
    const pendingForHolder = (await ctx.db
      .query("shareRedemptions")
      .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress).eq("status", "pending"))
      .collect())
      .find((r) => r.holderWallet === holderWallet);
    if (pendingForHolder) return { created: false as const, locked: true as const };

    // 3) Fresh redemption — burn atomically with the row insert (same transaction),
    //    so the shares are reserved the instant this commits.
    const burn = await burnSharesForRedeem(ctx, { mintAddress, holderWallet, sharesToBurn });
    const now = Date.now();
    const redemptionId = await ctx.db.insert("shareRedemptions", {
      mintAddress,
      holderWallet,
      idempotencyKey,
      sharesBurned: burn.sharesBurned,
      payoutUsdc: burn.payout,
      exitFeeUsdc: burn.exitFee,
      redeemRowId: burn.redeemRowId,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      created: true as const,
      locked: false as const,
      redemptionId,
      redeemRowId: burn.redeemRowId,
      payout: burn.payout,
      exitFee: burn.exitFee,
      navPerShare: burn.navPerShare,
    };
  },
});

/** Finalize a confirmed payout (status-guarded, idempotent). Stamps the sig on the
 *  redemption AND its shareLedger burn row. */
export const markPaid = mutation({
  args: { redemptionId: v.id("shareRedemptions"), txSignature: v.string(), authSecret: v.string() },
  handler: async (ctx, { redemptionId, txSignature, authSecret }) => {
    requireSecret(authSecret);
    const row = await ctx.db.get(redemptionId);
    if (!row) throw new Error("redemption not found");
    if (row.status === "paid") return { ok: true as const, alreadyPaid: true as const };
    if (row.status === "failed") throw new Error("redemption already reversed (failed) — cannot mark paid");
    await ctx.db.patch(redemptionId, { status: "paid", txSignature, updatedAt: Date.now() });
    // Stamp the ledger burn row too (only if not already stamped) so the share
    // ledger reflects the on-chain payout signature.
    const ledger = await ctx.db.get(row.redeemRowId);
    if (ledger && !ledger.txSignature) await ctx.db.patch(row.redeemRowId, { txSignature });
    return { ok: true as const, alreadyPaid: false as const };
  },
});

/** Record a broadcast-but-unconfirmed payout signature (and/or a keeper soft-lease
 *  touch). Only mutates a PENDING row; by default NEVER clears an existing sig (patch
 *  only the fields provided). A no-arg-sig call just bumps attempts+updatedAt (the
 *  keeper's soft-claim before it re-transfers). `clearSig:true` REMOVES any stale sig
 *  first — used by the keeper's pre-transfer touch when it is about to broadcast a
 *  FRESH tx over a failed/expired one, so a crash-after-broadcast leaves a no-sig /
 *  attempts≥1 row (which the keeper then treats as "outcome unknown", never
 *  re-transferring) instead of re-reading the stale failed sig and double-paying. */
export const markAmbiguous = mutation({
  args: {
    redemptionId: v.id("shareRedemptions"),
    txSignature: v.optional(v.string()),
    lastValidBlockHeight: v.optional(v.number()),
    attempts: v.optional(v.number()),
    clearSig: v.optional(v.boolean()),
    authSecret: v.string(),
  },
  handler: async (ctx, { redemptionId, txSignature, lastValidBlockHeight, attempts, clearSig, authSecret }) => {
    requireSecret(authSecret);
    const row = await ctx.db.get(redemptionId);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    // Terminal rows are immutable here — never resurrect a paid/failed redemption.
    if (row.status !== "pending") return { ok: false as const, reason: row.status };
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (clearSig) { patch.txSignature = undefined; patch.lastValidBlockHeight = undefined; } // drop the stale sig
    if (txSignature) patch.txSignature = txSignature;               // an explicit sig always wins over clearSig
    if (lastValidBlockHeight !== undefined) patch.lastValidBlockHeight = lastValidBlockHeight;
    if (attempts !== undefined) patch.attempts = attempts;
    await ctx.db.patch(redemptionId, patch);
    return { ok: true as const };
  },
});

/** REVERSE a pending redemption's burn (restore shares + escrow). Refused once any
 *  payout signature was broadcast — the USDC may have moved, so reversing could let
 *  the holder keep BOTH the shares and the payout. Idempotent on an already-failed row. */
export const markFailed = mutation({
  args: { redemptionId: v.id("shareRedemptions"), reason: v.optional(v.string()), authSecret: v.string() },
  handler: async (ctx, { redemptionId, reason, authSecret }) => {
    requireSecret(authSecret);
    const row = await ctx.db.get(redemptionId);
    if (!row) return { ok: false as const, reason: "not_found" as const };
    if (row.status === "failed") return { ok: true as const, alreadyFailed: true as const };
    if (row.status === "paid") return { ok: false as const, reason: "already_paid" as const };
    // NEVER reverse a redemption whose transfer may have landed.
    if (row.txSignature) return { ok: false as const, reason: "has_broadcast_sig" as const };
    await reverseRedeemBurn(ctx, row);
    await ctx.db.patch(redemptionId, {
      status: "failed",
      error: (reason ?? "payout failed").slice(0, 300),
      updatedAt: Date.now(),
    });
    return { ok: true as const, alreadyFailed: false as const, reversed: true as const };
  },
});

/** Pending redemptions with NO activity for `graceMs` — stranded (the route
 *  resolves a live redemption within ~90s, so anything pending past the grace is
 *  either confirm-ambiguous or a died-mid-flight request). `updatedAt` doubles as
 *  the soft lease so a keeper-touched row leaves the list for another grace window. */
export const listStranded = query({
  args: { nowMs: v.number(), graceMs: v.number(), limit: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { nowMs, graceMs, limit, authSecret }) => {
    requireSecret(authSecret);
    const cutoff = nowMs - graceMs;
    const rows = await ctx.db
      .query("shareRedemptions")
      .withIndex("by_pending_at", (q) => q.eq("status", "pending").lt("updatedAt", cutoff))
      .order("asc")
      .take(limit ?? 50);
    return rows.map(serialize);
  },
});

export const getByIdem = query({
  args: { idempotencyKey: v.string(), authSecret: v.string() },
  handler: async (ctx, { idempotencyKey, authSecret }) => {
    requireSecret(authSecret);
    const row = await ctx.db
      .query("shareRedemptions")
      .withIndex("by_idem", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    return row ? serialize(row) : null;
  },
});

/** SUM of `payoutUsdc` across this mint's still-PENDING redemptions. The owner
 *  WITHDRAW path holds this back from safeWithdrawable: a pending redemption has
 *  already burned its shares (so the share-backed floor no longer covers it) yet its
 *  payout is still physically in the agent wallet until the transfer confirms — the
 *  in-flight window a naive floor would let the owner drain (F1-0 double-spend). 0
 *  for the common clipper (no redemptions). Secret-gated (INTERNAL_CRON_SECRET);
 *  reachable only from /api/agents/withdraw. Uses the existing by_mint_status index. */
export const pendingPayoutSumForMint = query({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    requireSecret(authSecret);
    const rows = await ctx.db
      .query("shareRedemptions")
      .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress).eq("status", "pending"))
      .collect();
    return rows.reduce((sum, r) => sum + r.payoutUsdc, 0);
  },
});
