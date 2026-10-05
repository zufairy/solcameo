import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isWeb3Campaign, CLIPPING_FR_ORIGIN } from "../lib/stage/web3Campaign";

/**
 * Secret-gated cleanup tool for the DELETED Web3 board.
 *
 * The /stage "Web3" tab has been removed, so its campaigns are no longer shown
 * anywhere. This module hard-deletes those orphaned rows (and cascade-removes
 * their submissions). It exposes:
 *   - previewWeb3Deletion  — DRY RUN: what WOULD be deleted vs skipped (read-only)
 *   - executeWeb3Deletion  — actually delete (guarded)
 *
 * Both are PUBLIC functions gated by an INTERNAL_CRON_SECRET arg (same idiom as
 * mintFee.* / campaigns.updateCampaignPda) so the runner script
 * (scripts/delete-web3-campaigns.mjs) can call them over ConvexHttpClient.
 *
 * Selection is PRECISE (lib/stage/web3Campaign.isWeb3Campaign): a Web3 campaign is
 * one that is NOT a Clipping FR mirror AND whose category is neither "ugc" nor
 * "clipping". A UGC / Clipping / Clipping FR campaign can NEVER be selected.
 *
 * Money guard: a row that has already spent USDC (`spentUsdc > 0`) or funded an
 * on-chain treasury (`pdaAddress` set) is SKIPPED unless `force: true` — so a run
 * can never accidentally strand on-chain money.
 */

// Bounded scan cap — the campaigns table is small (far under this), and a bounded
// take keeps the query well inside Convex's per-query read limit as it grows.
const SCAN_LIMIT = 5000;

function assertSecret(authSecret: string): void {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

export type Web3CampaignPreview = {
  _id: Id<"campaigns">;
  title: string;
  category?: string;
  origin?: string;
  budget: number;
  spentUsdc: number;
  pdaAddress?: string;
  submissionsCount: number;
};

function toPreview(c: Doc<"campaigns">): Web3CampaignPreview {
  return {
    _id: c._id,
    title: c.title,
    category: c.category,
    origin: c.origin,
    budget: c.budget,
    spentUsdc: c.spentUsdc ?? 0,
    pdaAddress: c.pdaAddress,
    submissionsCount: c.submissionsCount,
  };
}

/** A row carries on-chain money if it has spent USDC or funded an escrow vault. */
function isFunded(c: Doc<"campaigns">): boolean {
  return (c.spentUsdc ?? 0) > 0 || !!c.pdaAddress;
}

/** Split all Web3-board campaigns into unfunded (deletable by default) vs funded
 *  (only deletable with force). Pure — shared by preview so both use the same
 *  selection rule as execute. */
function partitionWeb3Campaigns(
  campaigns: Doc<"campaigns">[],
): { deletable: Doc<"campaigns">[]; funded: Doc<"campaigns">[] } {
  const deletable: Doc<"campaigns">[] = [];
  const funded: Doc<"campaigns">[] = [];
  for (const c of campaigns) {
    if (!isWeb3Campaign(c)) continue; // never touch ugc / clipping / clipping_fr
    if (isFunded(c)) funded.push(c);
    else deletable.push(c);
  }
  return { deletable, funded };
}

/**
 * DRY RUN. Returns the Web3-board campaigns that WOULD be deleted (unfunded) and
 * those that would be SKIPPED as funded (unless the caller passes force to
 * executeWeb3Deletion). Read-only — deletes nothing.
 */
export const previewWeb3Deletion = query({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    assertSecret(authSecret);
    const all = await ctx.db.query("campaigns").take(SCAN_LIMIT);
    const { deletable, funded } = partitionWeb3Campaigns(all);
    return {
      toDelete: deletable.map(toPreview),
      skipped: funded.map(toPreview),
      total: deletable.length + funded.length,
      scanned: all.length,
    };
  },
});

/**
 * Hard-delete the Web3-board campaigns and cascade-delete their submissions.
 * By default skips funded rows (spentUsdc > 0 or pdaAddress set); pass force:true
 * to include them too. Every row is re-checked with an explicit per-row guard
 * (belt-and-suspenders) so a UGC / Clipping / Clipping FR campaign can never be
 * deleted even if the selection ever regresses.
 */
export const executeWeb3Deletion = mutation({
  args: { authSecret: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { authSecret, force }) => {
    assertSecret(authSecret);
    const all = await ctx.db.query("campaigns").take(SCAN_LIMIT);

    const deleted: Web3CampaignPreview[] = [];
    const skipped: Web3CampaignPreview[] = [];
    let removedSubmissions = 0;

    for (const c of all) {
      if (!isWeb3Campaign(c)) continue;

      // Explicit per-row guard (defense in depth): NEVER delete a UGC, Clipping,
      // or Clipping FR campaign. isWeb3Campaign already excludes these; this is a
      // hard stop against any future regression in the selection.
      const category = (c.category ?? "").toLowerCase();
      if (c.origin === CLIPPING_FR_ORIGIN || category === "ugc" || category === "clipping") {
        continue;
      }

      // Money guard: skip funded rows unless forced.
      if (isFunded(c) && !force) {
        skipped.push(toPreview(c));
        continue;
      }

      // Cascade: remove the campaign's submissions first so none are orphaned.
      const subs = await ctx.db
        .query("submissions")
        .withIndex("by_campaign", (q) => q.eq("campaignId", c._id))
        .collect();
      for (const s of subs) await ctx.db.delete(s._id);
      removedSubmissions += subs.length;

      const preview = toPreview(c);
      await ctx.db.delete(c._id);
      deleted.push(preview);
    }

    return {
      deleted,
      skipped,
      deletedCount: deleted.length,
      skippedCount: skipped.length,
      removedSubmissions,
    };
  },
});
