import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

function assertSecret(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}
const DUST = 1e-9;

const swapV = v.object({
  signature: v.string(), wallet: v.string(), side: v.union(v.literal("buy"), v.literal("sell")),
  units: v.number(), sol: v.number(), priceSol: v.number(), time: v.number(),
});

/** What the sync worker needs to know to fetch only new swaps. */
export const syncState = query({
  args: { authSecret: v.string(), characterId: v.id("ssCharacters") },
  handler: async (ctx, { authSecret, characterId }) => {
    assertSecret(authSecret);
    const s = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", characterId)).unique();
    return s ? { lastTime: s.lastTime, syncedAt: s.syncedAt } : null;
  },
});

/**
 * Apply a batch of decoded swaps (oldest first) and, optionally, the latest holders and market state.
 * Idempotent per signature, so an overlapping or retried batch never double counts a position.
 */
export const ingest = mutation({
  args: {
    authSecret: v.string(), characterId: v.id("ssCharacters"), mint: v.string(), network: v.string(),
    swaps: v.array(swapV),
    market: v.optional(v.object({
      priceSol: v.number(), supplyRaw: v.string(), decimals: v.number(), slot: v.number(),
      holders: v.array(v.object({ wallet: v.string(), units: v.string(), supplyPct: v.number(), isPool: v.boolean() })),
    })),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    assertSecret(a.authSecret);
    let applied = 0, newest = 0;
    for (const sw of [...a.swaps].sort((x, y) => x.time - y.time)) {
      newest = Math.max(newest, sw.time);
      const seen = await ctx.db.query("ssChainSwaps").withIndex("by_signature", (q) => q.eq("signature", sw.signature)).first();
      if (seen) continue;
      await ctx.db.insert("ssChainSwaps", { characterId: a.characterId, ...sw });
      applied++;
      const pos = await ctx.db.query("ssChainPositions").withIndex("by_character_wallet", (q) => q.eq("characterId", a.characterId).eq("wallet", sw.wallet)).unique();
      const p = pos ?? { characterId: a.characterId, wallet: sw.wallet, boughtTokens: 0, soldTokens: 0, spentSol: 0, receivedSol: 0, openTokens: 0, costBasisSol: 0, realizedSol: 0, trades: 0, firstAt: sw.time, lastAt: sw.time };
      if (sw.side === "buy") {
        p.boughtTokens += sw.units; p.spentSol += sw.sol; p.openTokens += sw.units; p.costBasisSol += sw.sol;
      } else {
        // Sells beyond what swaps explain (tokens that arrived by transfer) only count against the tracked part.
        const tracked = Math.min(sw.units, p.openTokens), share = sw.units > 0 ? tracked / sw.units : 0;
        const avg = p.openTokens > 0 ? p.costBasisSol / p.openTokens : 0;
        p.realizedSol += sw.sol * share - avg * tracked;
        p.costBasisSol -= avg * tracked; p.openTokens -= tracked;
        p.soldTokens += sw.units; p.receivedSol += sw.sol;
      }
      if (p.openTokens < DUST) { p.openTokens = 0; p.costBasisSol = 0; }
      p.trades += 1; p.firstAt = Math.min(p.firstAt, sw.time); p.lastAt = Math.max(p.lastAt, sw.time);
      if (pos) await ctx.db.patch(pos._id, p); else await ctx.db.insert("ssChainPositions", p);
    }
    const prev = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", a.characterId)).unique();
    if (a.market) {
      // Holders are replaced as a set so a wallet that sold out disappears reactively.
      for await (const h of ctx.db.query("ssChainHolders").withIndex("by_character", (q) => q.eq("characterId", a.characterId))) await ctx.db.delete(h._id);
      for (const h of a.market.holders) await ctx.db.insert("ssChainHolders", { characterId: a.characterId, ...h });
    }
    const next = {
      characterId: a.characterId, mint: a.mint, network: a.network,
      priceSol: a.market?.priceSol ?? prev?.priceSol ?? 0, supplyRaw: a.market?.supplyRaw ?? prev?.supplyRaw ?? "0",
      decimals: a.market?.decimals ?? prev?.decimals ?? 6, slot: a.market?.slot ?? prev?.slot ?? 0,
      lastTime: Math.max(prev?.lastTime ?? 0, newest), syncedAt: a.market || !prev ? Date.now() : prev.syncedAt, error: a.error,
    };
    if (prev) await ctx.db.patch(prev._id, next); else await ctx.db.insert("ssChainState", next);
    return { applied };
  },
});

/** Everything the Open trades tab and the Top holders panel show. Reactive: Convex pushes each change to the page. */
export const openTrades = query({
  args: { characterId: v.id("ssCharacters") },
  handler: async (ctx, { characterId }) => {
    const state = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", characterId)).unique();
    const holders = await ctx.db.query("ssChainHolders").withIndex("by_character", (q) => q.eq("characterId", characterId)).take(40);
    const positions = await ctx.db.query("ssChainPositions").withIndex("by_character_wallet", (q) => q.eq("characterId", characterId)).take(400);
    return {
      state: state ? { priceSol: state.priceSol, supplyRaw: state.supplyRaw, decimals: state.decimals, slot: state.slot, syncedAt: state.syncedAt, error: state.error } : null,
      holders: holders.map(({ wallet, units, supplyPct, isPool }) => ({ wallet, units, supplyPct, isPool })),
      positions: positions.filter((p) => p.openTokens > 0 || p.trades > 0).map((p) => ({
        wallet: p.wallet, openTokens: p.openTokens, costBasisSol: p.costBasisSol, realizedSol: p.realizedSol,
        spentSol: p.spentSol, receivedSol: p.receivedSol, trades: p.trades, firstAt: p.firstAt, lastAt: p.lastAt,
      })),
    };
  },
});

export const recentSwaps = query({
  args: { characterId: v.id("ssCharacters"), limit: v.optional(v.number()) },
  handler: async (ctx, { characterId, limit }) => {
    const rows = await ctx.db.query("ssChainSwaps").withIndex("by_character_time", (q) => q.eq("characterId", characterId)).order("desc").take(Math.min(100, Math.max(1, limit ?? 50)));
    return rows.map(({ signature, wallet, side, units, sol, priceSol, time }) => ({ signature, wallet, side, units, sol, priceSol, time }));
  },
});

/** One wallet's position in one coin, with its own swap history. Reactive, so the panel updates the instant a trade lands. */
export const positionOf = query({
  args: { characterId: v.id("ssCharacters"), wallet: v.string() },
  handler: async (ctx, { characterId, wallet }) => {
    const state = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", characterId)).unique();
    if (!state) return null;
    const position = await ctx.db.query("ssChainPositions").withIndex("by_character_wallet", (q) => q.eq("characterId", characterId).eq("wallet", wallet)).unique();
    const holder = (await ctx.db.query("ssChainHolders").withIndex("by_character", (q) => q.eq("characterId", characterId)).take(40)).find((h) => h.wallet === wallet);
    const swaps = await ctx.db.query("ssChainSwaps").withIndex("by_character_wallet_time", (q) => q.eq("characterId", characterId).eq("wallet", wallet)).order("desc").take(30);
    return {
      priceSol: state.priceSol, decimals: state.decimals, syncedAt: state.syncedAt,
      heldUnits: holder?.units ?? null,
      position: position ? { openTokens: position.openTokens, costBasisSol: position.costBasisSol, realizedSol: position.realizedSol, spentSol: position.spentSol, receivedSol: position.receivedSol, trades: position.trades } : null,
      swaps: swaps.map(({ signature, side, units, sol, priceSol, time }) => ({ signature, side, units, sol, priceSol, time })),
    };
  },
});
