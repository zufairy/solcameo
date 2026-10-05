import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Equity owners of an agent NFT — everyone who has bought shares, most recent
 * first. Powers the "Equity Owners" tab in the agent detail modal.
 */
export const listByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const rows = await ctx.db
      .query("investments")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();

    // Aggregate by wallet so a wallet that invested multiple times shows once
    // with its total shares + cost.
    const byWallet = new Map<string, { investorWallet: string; sharesBought: number; usdcAmount: number; investedAt: number }>();
    for (const r of rows) {
      const cur = byWallet.get(r.investorWallet);
      if (cur) {
        cur.sharesBought += r.sharesBought;
        cur.usdcAmount += r.usdcAmount;
        cur.investedAt = Math.max(cur.investedAt, r.investedAt);
      } else {
        byWallet.set(r.investorWallet, {
          investorWallet: r.investorWallet,
          sharesBought: r.sharesBought,
          usdcAmount: r.usdcAmount,
          investedAt: r.investedAt,
        });
      }
    }
    return [...byWallet.values()].sort((a, b) => b.sharesBought - a.sharesBought);
  },
});
