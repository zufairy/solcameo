import { query } from "./_generated/server";
import { v } from "convex/values";

const TOLERANCE = 1e-6; // float comparison slack

/** Recompute the spine invariants from the ledgers and report drift.
 *  Convex-internal consistency only (on-chain mirror reconciliation is Phase 2).
 *  Spec §4.3 invariants 1 & (the share/tab bookkeeping behind) 2. */
export const checkAccount = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const issues: string[] = [];

    const account = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    if (!account) return { ok: false, issues: ["no agentAccount for mint"] };

    const shareRows = await ctx.db
      .query("shareLedger")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const ledgerShares = shareRows.reduce((s, r) => s + r.shares, 0);
    if (Math.abs(ledgerShares - account.sharesOutstanding) > TOLERANCE) {
      issues.push(
        `shares drift: account ${account.sharesOutstanding} vs ledger ${ledgerShares}`,
      );
    }

    const usageRows = await ctx.db
      .query("usageLedger")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const unsettled = usageRows
      .filter((u) => !u.settledBatchId)
      .reduce((s, u) => s + u.costUsdc, 0);
    if (Math.abs(unsettled - account.unsettledTabUsdc) > TOLERANCE) {
      issues.push(
        `tab drift: account ${account.unsettledTabUsdc} vs unsettled usage ${unsettled}`,
      );
    }

    if (account.escrowUsdc < -TOLERANCE) issues.push(`escrow negative: ${account.escrowUsdc}`);

    return { ok: issues.length === 0, issues };
  },
});
