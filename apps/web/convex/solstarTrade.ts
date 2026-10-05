// convex/solstarTrade.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertSecret } from "./lib/solstarAuth";
import { applyFeeSplit } from "./solstarBudget";
import { recordFeedEvent } from "./solstarFeed";
import { formatSol } from "../lib/solstar/format";
import { shortWallet } from "../lib/solstar/feed";
import { MAX_AMOUNT, PAPER_START_LAMPORTS, quoteBuy, quoteSell } from "../lib/solstar/economics";

async function position(ctx: QueryCtx, wallet: string, tokenId: Id<"ssTokens">) {
  const rows = await ctx.db.query("ssTrades").withIndex("by_wallet_token", (q) => q.eq("wallet", wallet).eq("tokenId", tokenId)).collect();
  let tokens = 0n;
  let lamports = PAPER_START_LAMPORTS;
  for (const t of rows) {
    if (t.side === "buy") { lamports -= t.amountIn; tokens += t.amountOut; }
    else { tokens -= t.amountIn; lamports += t.amountOut; }
  }
  return { tokens, lamports };
}

export const positionOf = query({
  args: { wallet: v.string(), tokenId: v.id("ssTokens") },
  handler: async (ctx, a) => {
    const p = await position(ctx, a.wallet, a.tokenId);
    return { tokens: p.tokens.toString(), lamports: p.lamports.toString() };
  },
});

export const paperTrade = mutation({
  args: {
    tokenId: v.id("ssTokens"), wallet: v.string(), side: v.union(v.literal("buy"), v.literal("sell")),
    amount: v.int64(), minOut: v.int64(), quoteExpiresAt: v.number(), idempotencyKey: v.string(), authSecret: v.string(),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    if (a.wallet.length < 32 || a.wallet.length > 44) throw new Error("invalid_wallet");
    if (a.amount <= 0n || a.amount > MAX_AMOUNT) throw new Error("invalid_amount");
    if (a.idempotencyKey.length < 1 || a.idempotencyKey.length > 128) throw new Error("invalid_key");
    const prior = await ctx.db.query("ssTrades").withIndex("by_idem", (q) => q.eq("idempotencyKey", a.idempotencyKey)).first();
    if (prior) {
      if (prior.tokenId !== a.tokenId || prior.wallet !== a.wallet || prior.side !== a.side || prior.amountIn !== a.amount) {
        throw new Error("idempotency_conflict");
      }
      return { ok: true as const, reused: true, amountOut: prior.amountOut.toString(), fee: prior.fee.toString() };
    }
    if (Date.now() > a.quoteExpiresAt) throw new Error("quote_expired");
    const token = await ctx.db.get(a.tokenId);
    if (!token || token.network !== "paper" || token.state !== "paper") throw new Error("not_paper_token");
    const pool = { solReserve: token.solReserve, tokenReserve: token.tokenReserve };
    const pos = await position(ctx, a.wallet, a.tokenId);
    if (a.side === "buy" && a.amount > pos.lamports) throw new Error("insufficient_balance");
    if (a.side === "sell" && a.amount > pos.tokens) throw new Error("insufficient_position");
    let q;
    try { q = a.side === "buy" ? quoteBuy(pool, a.amount) : quoteSell(pool, a.amount); }
    catch { throw new Error("invalid_amount"); }
    if (q.amountOut < a.minOut) throw new Error("slippage_exceeded");
    await ctx.db.patch(token._id, { solReserve: q.next.solReserve, tokenReserve: q.next.tokenReserve });
    await ctx.db.insert("ssTrades", {
      tokenId: a.tokenId, network: "paper", wallet: a.wallet, side: a.side,
      amountIn: q.amountIn, amountOut: q.amountOut, fee: q.fee, idempotencyKey: a.idempotencyKey, createdAt: Date.now(),
    });
    await applyFeeSplit(ctx, { tokenId: a.tokenId, network: "paper", split: q.feeSplit, idempotencyKey: a.idempotencyKey, source: "paper_simulated" });
    const sol = a.side === "buy" ? q.amountIn : q.amountOut;
    await recordFeedEvent(ctx, {
      eventType: "trade", wallet: a.wallet, tokenId: a.tokenId, characterId: token.characterId, side: a.side,
      amountLamports: sol.toString(), network: "paper",
      body: `${shortWallet(a.wallet)} ${a.side === "buy" ? "bought" : "sold"} ${formatSol(sol.toString())} SOL of $${token.ticker} (simulated)`,
    });
    return { ok: true as const, reused: false, amountOut: q.amountOut.toString(), fee: q.fee.toString() };
  },
});
