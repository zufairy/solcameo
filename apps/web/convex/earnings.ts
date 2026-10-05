import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { navPerShare, founderSharesForEarnings } from "../lib/economy/nav";

/** Credit agent earnings into escrow (raising NAV for holders) and mint the
 *  builder's 15%-of-earnings founder shares at the post-credit NAV. Investor
 *  principal is never diluted — founder shares are created only against the new
 *  earnings. Spec §5.3.
 *  SECURITY: public mutation; before mainnet move behind a verified entry point
 *  (spec §11) so only trusted server callers can credit earnings. */
export const creditEarnings = mutation({
  args: { mintAddress: v.string(), amountUsdc: v.number(), builderWallet: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, amountUsdc, builderWallet, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    if (amountUsdc <= 0) throw new Error("amountUsdc must be positive");
    const account = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).unique();
    if (!account) throw new Error("no agentAccount for mint");

    const escrowAfter = account.escrowUsdc + amountUsdc;
    const navAfterEscrow = navPerShare({ ...account, escrowUsdc: escrowAfter });
    // Underwater agent (escrowAfter <= unsettled tab => navAfterEscrow == 0):
    // founderSharesForEarnings THROWS on nav <= 0 — its documented contract says an
    // underwater agent "must be handled explicitly by the caller." Handle it HERE —
    // still credit escrow + record the payout (and, in creditAndRecord, the dedup row),
    // just DEFER the founder-share mint — instead of letting the RangeError abort the
    // whole mutation and roll back the credit. A thrown credit writes NO dedup row, so the
    // 10-min v1 re-drive keeper re-hits the SAME throw forever until a human tops up the
    // agent's escrow (H10 — does not self-heal). The `founderShares > 0` guard below then
    // skips the shareLedger mint on its own.
    const founderShares =
      navAfterEscrow > 0 ? founderSharesForEarnings({ amount: amountUsdc, navAfterEscrow }) : 0;
    if (navAfterEscrow <= 0) {
      console.warn(
        `[earnings] underwater credit for mint ${mintAddress}: escrow after +${amountUsdc} still <= unsettled tab (nav=0) — crediting escrow, deferring founder-share mint`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(account._id, {
      escrowUsdc: escrowAfter,
      liquidUsdc: account.liquidUsdc + amountUsdc,
      sharesOutstanding: account.sharesOutstanding + founderShares,
      // Track the cumulative off-chain credit so reconcile RE-ADDS it and never
      // erases this NAV on a chain read (H5) — this credit has no on-chain USDC.
      offchainCreditedUsdc: (account.offchainCreditedUsdc ?? 0) + amountUsdc,
      updatedAt: now,
    });
    if (founderShares > 0) {
      await ctx.db.insert("shareLedger", {
        mintAddress, wallet: builderWallet, kind: "founder",
        shares: founderShares, navPerShare: navAfterEscrow, usdcAmount: 0, at: now,
      });
    }
    return { founderShares, navAfterEscrow, escrowUsdc: escrowAfter };
  },
});

/** ATOMIC credit + dedup marker (E2E hunt #9/10/14). Folds the escrow credit,
 *  founder-share mint, AND the distributions dedup/ledger row into ONE Convex
 *  mutation (mutations are single-transaction atomic), so the money move and the
 *  dedup marker either both commit or both roll back. Previously creditEarnings
 *  committed the vault credit and distributions.record wrote the dedup marker in
 *  a SEPARATE transaction — a crash between them left the credit with no marker,
 *  and the claim keeper's retry double-credited NAV. The idempotency check runs
 *  BEFORE any credit, so a duplicate tranche (or submission) is a true no-op.
 *  SECRET-GATED: server-only (the distribute-earnings route forwards the secret). */
export const creditAndRecord = mutation({
  args: {
    mintAddress: v.string(),
    amountUsdc: v.number(),
    builderWallet: v.string(),
    campaignId: v.optional(v.string()),
    submissionId: v.optional(v.string()),
    trancheKey: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (
    ctx,
    { mintAddress, amountUsdc, builderWallet, campaignId, submissionId, trancheKey, authSecret },
  ) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    if (amountUsdc <= 0) throw new Error("amountUsdc must be positive");

    // Idempotency FIRST, in the same transaction as the credit: a duplicate
    // tranche (v2 multi-tick claim) or submission (v1) short-circuits BEFORE any
    // vault mutation, so a retry can never double-credit. Per-tranche takes
    // precedence so a multi-tranche payout is not collapsed by the submission guard.
    if (trancheKey) {
      const existing = await ctx.db
        .query("distributions")
        .withIndex("by_tranche", (q) => q.eq("trancheKey", trancheKey))
        .first();
      if (existing) return { alreadyDistributed: true as const, distributionId: existing._id };
    } else if (submissionId) {
      const existing = await ctx.db
        .query("distributions")
        .withIndex("by_submission", (q) => q.eq("submissionId", submissionId))
        .first();
      if (existing) return { alreadyDistributed: true as const, distributionId: existing._id };
    }

    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) throw new Error("no agentAccount for mint");

    const escrowAfter = account.escrowUsdc + amountUsdc;
    const navAfterEscrow = navPerShare({ ...account, escrowUsdc: escrowAfter });
    // Underwater agent (escrowAfter <= unsettled tab => navAfterEscrow == 0):
    // founderSharesForEarnings THROWS on nav <= 0 — its documented contract says an
    // underwater agent "must be handled explicitly by the caller." Handle it HERE —
    // still credit escrow + record the payout (and, in creditAndRecord, the dedup row),
    // just DEFER the founder-share mint — instead of letting the RangeError abort the
    // whole mutation and roll back the credit. A thrown credit writes NO dedup row, so the
    // 10-min v1 re-drive keeper re-hits the SAME throw forever until a human tops up the
    // agent's escrow (H10 — does not self-heal). The `founderShares > 0` guard below then
    // skips the shareLedger mint on its own.
    const founderShares =
      navAfterEscrow > 0 ? founderSharesForEarnings({ amount: amountUsdc, navAfterEscrow }) : 0;
    if (navAfterEscrow <= 0) {
      console.warn(
        `[earnings] underwater credit for mint ${mintAddress}: escrow after +${amountUsdc} still <= unsettled tab (nav=0) — crediting escrow, deferring founder-share mint`,
      );
    }

    const now = Date.now();
    await ctx.db.patch(account._id, {
      escrowUsdc: escrowAfter,
      liquidUsdc: account.liquidUsdc + amountUsdc,
      sharesOutstanding: account.sharesOutstanding + founderShares,
      // Track the cumulative off-chain credit so reconcile RE-ADDS it and never
      // erases this NAV on a chain read (H5) — this credit has no on-chain USDC.
      offchainCreditedUsdc: (account.offchainCreditedUsdc ?? 0) + amountUsdc,
      updatedAt: now,
    });
    if (founderShares > 0) {
      await ctx.db.insert("shareLedger", {
        mintAddress,
        wallet: builderWallet,
        kind: "founder",
        shares: founderShares,
        navPerShare: navAfterEscrow,
        usdcAmount: 0,
        at: now,
      });
    }
    // Dedup marker + ledger row in the SAME transaction as the credit above.
    const distributionId = await ctx.db.insert("distributions", {
      mintAddress,
      campaignId,
      submissionId,
      trancheKey,
      totalPayoutUsdc: amountUsdc,
      // Under the vault model the full amount raises NAV for investors; the
      // builder's reward is founder shares (not USDC), so builderUsdc=0.
      investorUsdc: amountUsdc,
      builderUsdc: 0,
      protocolUsdc: 0,
      splits: [],
      status: "credited",
      createdAt: now,
    });
    return {
      alreadyDistributed: false as const,
      distributionId,
      founderShares,
      navAfterEscrow,
      escrowUsdc: escrowAfter,
    };
  },
});
