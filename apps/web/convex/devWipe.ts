import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { v } from "convex/values";

/**
 * ONE-OFF DEVNET RESET — wipes every agent and all of its derived data so the
 * /agents marketplace starts empty. Devnet only; this does NOT burn the on-chain
 * NFTs (they're valueless and the page only renders what's in these tables).
 *
 * Intentionally LEFT INTACT: users, walletLinks, campaigns, builder* workspaces,
 * traderPriceCache (shared), processedSignatures (replay protection), and the
 * retired-aiWorkers B2B tables (clients/knowledge/etc.).
 *
 * Run with:  npx convex run devWipe:wipeAllAgents
 *
 * Deletes in bounded batches and reschedules itself so it never exceeds a single
 * mutation's transaction limits, regardless of how many agents exist.
 */

// Every agent-keyed table, cleared in full. Order doesn't matter (no FK enforcement).
const AGENT_TABLES = [
  "influencers",
  "nftDrafts",
  "agentAccount",
  "shareLedger",
  "usageLedger",
  "feeSettlements",
  "investments",
  "distributions",
  "agentKnowledge",
  "agentTasks",
  "agentMemory",
  "agentSkillFiles",
  "scheduledContent",
  "videoRenderJobs",
  "clipJobs",
  "clips",
  "submissions",
  "traderStrategies",
  "traderSignals",
  "traderDeposits",
  "perpPositions",
  "traderBets",
  "traderTrades",
  "workerProfiles",
  "workerHires",
  "workerActivity",
] as const;

const BATCH = 200;

export const wipeAllAgents = internalMutation({
  args: { deleted: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ done: boolean; deleted: number }> => {
    let deleted = args.deleted ?? 0;

    for (const table of AGENT_TABLES) {
      const rows = await ctx.db.query(table as TableNames).take(BATCH);
      if (rows.length === 0) continue;

      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      deleted += rows.length;

      // Filled a full batch on this table — there may be more. Reschedule and
      // stop here so we stay well within transaction limits.
      if (rows.length === BATCH) {
        await ctx.scheduler.runAfter(0, internal.devWipe.wipeAllAgents, {
          deleted,
        });
        return { done: false, deleted };
      }
    }

    console.log(`[devWipe] complete — deleted ${deleted} agent rows`);
    return { done: true, deleted };
  },
});
