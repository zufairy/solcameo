import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { deriveTerminal } from "../../lib/solstar/terminal";
export async function terminalStats(ctx: QueryCtx, tokenId: Id<"ssTokens">) {
  const trades = await ctx.db
    .query("ssTrades")
    .withIndex("by_token", (q) => q.eq("tokenId", tokenId))
    .order("asc")
    .take(5001);
  // Never present truncated history as exact market statistics.
  if (trades.length > 5000) return null;
  return deriveTerminal(trades, Date.now());
}
