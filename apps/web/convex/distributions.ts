import { v } from "convex/values";
import { mutation, query, internalAction } from "./_generated/server";

// Per-call read bounds for listByOwnerWallet's fan-out (mirrors the
// SPEND_LEDGER_MAX_ROWS pattern in convex/usage.ts): every read must be bounded
// so a wallet with many agents / a long payout history can never blow Convex's
// per-query read limit.
const MERGE_LIMIT = 100;             // newest distributions read per mint, and returned overall
const MAX_AGENTS_PER_WALLET = 200;   // agents fanned out over per owning wallet

const splitValidator = v.object({
  wallet: v.string(),
  role: v.string(),
  shares: v.optional(v.number()),
  usdc: v.number(),
  txSignature: v.optional(v.string()),
  status: v.string(),
});

/** Idempotency probe — one distribution per submission (v1 / single-tranche). */
export const getBySubmission = query({
  args: { submissionId: v.string() },
  handler: async (ctx, { submissionId }) => {
    return await ctx.db
      .query("distributions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submissionId))
      .first();
  },
});

/** Per-tranche idempotency probe for the v2 on-chain claim path — one
 *  distribution per `${submissionId}:${cumulativeNetUsdc}` tranche, so a
 *  multi-tranche payout is NOT collapsed by the bare-submissionId guard. */
export const getByTranche = query({
  args: { trancheKey: v.string() },
  handler: async (ctx, { trancheKey }) => {
    return await ctx.db
      .query("distributions")
      .withIndex("by_tranche", (q) => q.eq("trancheKey", trancheKey))
      .first();
  },
});

/** Earnings distributions for an agent — newest first (powers the wallet/profile UI). */
// RESIDUAL (leaky read, left ungated): returns one agent's distribution ledger
// (payout splits + wallets) scoped by a single public mintAddress. No live app caller
// today. Not gated in this pass because a browser reader (if reintroduced) couldn't
// supply INTERNAL_CRON_SECRET; the correct fix is a SIWS-gated Next endpoint that
// proves the caller owns the mint. Flagged for follow-up. (Per-mint + bounded, so it
// cannot enumerate the whole ledger the way submissions.listAllAdmin can.)
export const listByMint = query({
  args: { mintAddress: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, limit }) => {
    return await ctx.db
      .query("distributions")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(limit ?? 50);
  },
});

/** Earnings across every agent a wallet owns — powers the Billing page's
 *  Earnings section. `listByMint` above is scoped to one agent; this fans out
 *  over every mint owned by ANY of `ownerWallets` (via `influencers.by_creator`)
 *  and merges the distribution rows, newest first, capped at 100.
 *
 *  Takes a WALLET SET, not a single wallet — mirrors `influencers.listByCreators`.
 *  An agent is keyed to whichever wallet it was MINTED under, which for a
 *  Privy/Google user is frequently NOT the currently-active embedded wallet
 *  (see `app/wallet/page.tsx`'s `creatorWallets` union of
 *  `profile.walletAddresses` + the active address). Scoping this query to a
 *  single active wallet would silently blank Earnings to empty for exactly
 *  those users even though real payouts exist. */
export const listByOwnerWallet = query({
  args: { ownerWallets: v.array(v.string()) },
  handler: async (ctx, { ownerWallets }) => {
    const wallets = [...new Set(ownerWallets.filter(Boolean))];
    const owned = await Promise.all(
      wallets.map((w) =>
        ctx.db
          .query("influencers")
          .withIndex("by_creator", (q) => q.eq("creatorWallet", w))
          .take(MAX_AGENTS_PER_WALLET),
      ),
    );
    const mints = [...new Set(owned.flat().map((a) => a.mintAddress))];
    // BOUNDED per mint. Collecting each agent's LIFETIME distribution ledger only
    // to slice 100 off the end in JS is the unbounded-read failure mode this repo
    // guards against elsewhere (see SPEND_LEDGER_MAX_ROWS in convex/usage.ts): a
    // prolific wallet blows Convex's per-query read limit and the whole Billing
    // page errors. Taking the newest MERGE_LIMIT per mint is exact for the final
    // 100 rows — a mint can contribute at most MERGE_LIMIT of them.
    const rows = await Promise.all(
      mints.map((m) =>
        ctx.db
          .query("distributions")
          .withIndex("by_mint", (q) => q.eq("mintAddress", m))
          .order("desc")
          .take(MERGE_LIMIT),
      ),
    );
    return rows
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MERGE_LIMIT);
  },
});

/** Record a computed distribution. Idempotent on `trancheKey` when present
 *  (v2 on-chain claim: one row per claim tranche), else on `submissionId`
 *  (v1 / single-tranche: one row per submission). */
export const record = mutation({
  args: {
    mintAddress: v.string(),
    campaignId: v.optional(v.string()),
    submissionId: v.optional(v.string()),
    trancheKey: v.optional(v.string()),
    totalPayoutUsdc: v.number(),
    investorUsdc: v.number(),
    builderUsdc: v.number(),
    protocolUsdc: v.number(),
    splits: v.array(splitValidator),
    status: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: writes the earnings-distribution ledger that monthlyEarnings/
    // APR derive from. Ungated, anyone could fabricate payout rows. Server-only.
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const { authSecret: _authSecret, ...row } = args;
    // Per-tranche dedup takes precedence: a multi-tranche v2 payout MUST record a
    // distinct row per tranche, so we key on trancheKey when the caller supplies
    // it (a bare-submissionId guard would collapse tranches 2..n into a no-op).
    if (row.trancheKey) {
      const existing = await ctx.db
        .query("distributions")
        .withIndex("by_tranche", (q) => q.eq("trancheKey", row.trancheKey))
        .first();
      if (existing) return existing._id; // this exact tranche already recorded — no-op
    } else if (row.submissionId) {
      const existing = await ctx.db
        .query("distributions")
        .withIndex("by_submission", (q) => q.eq("submissionId", row.submissionId))
        .first();
      if (existing) return existing._id; // already distributed — no-op
    }
    return await ctx.db.insert("distributions", { ...row, createdAt: Date.now() });
  },
});

/**
 * Triggered (scheduled) by `campaigns.markVerified` once the oracle approves a
 * submission and the campaign escrow has released USDC to the agent wallet.
 * Calls the Next route that computes the 50/45/5 split, transfers USDC to each
 * investor wallet (or records `pending` on devnet), and writes the ledger.
 * Convex mutations can't `fetch`, so the HTTP hop lives in this action.
 */
export const dispatch = internalAction({
  args: {
    mintAddress: v.string(),
    payoutUsdc: v.number(),
    campaignId: v.optional(v.string()),
    submissionId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    // Surface HTTP + network failures (do NOT swallow, E2E hunt #11 / bug-hunt):
    // a non-2xx was previously dropped silently, so a v1 payout that failed to
    // credit was lost forever. Throwing marks this scheduled run failed; the v1
    // re-drive keeper (crons.runV1Distributions) re-attempts on its next tick.
    // distribute-earnings is idempotent on submissionId, so re-driving an
    // already-credited row is a no-op.
    const res = await fetch(`${baseUrl}/api/agents/distribute-earnings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      // Include the response body (bug-hunt) so the failure is diagnosable, not
      // just a bare status; still THROW so the keeper re-drives it (main).
      const detail = await res.text().catch(() => "");
      const msg = `distribute-earnings ${res.status} submission=${args.submissionId ?? "?"}${detail ? `: ${detail.slice(0, 500)}` : ""}`;
      console.error(`[distributions.dispatch] ${msg} — will retry via keeper`);
      throw new Error(msg);
    }
    return null;
  },
});
