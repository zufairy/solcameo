import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { deriveTerminal } from "../../lib/solstar/terminal";
/** `limit` bounds how many ledger rows are replayed; a longer history reports null (unavailable) instead of a wrong total. */
export async function terminalStats(ctx: QueryCtx, tokenId: Id<"ssTokens">, limit = 5000) {
  const trades = await ctx.db
    .query("ssTrades")
    .withIndex("by_token", (q) => q.eq("tokenId", tokenId))
    .order("asc")
    .take(limit + 1);
  // Never present truncated history as exact market statistics.
  if (trades.length > limit) return null;
  return deriveTerminal(trades, Date.now());
}
