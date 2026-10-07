import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

function assertSecret(secret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
}
const DUST = 1e-9;

const swapV = v.object({
  signature: v.string(), wallet: v.string(), side: v.union(v.literal("buy"), v.literal("sell")),
  units: v.number(), sol: v.number(), priceSol: v.number(), time: v.number(),
  feeSol: v.optional(v.number()), networkFeeSol: v.optional(v.number()),
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
      creator: v.optional(v.string()), creatorSharePct: v.optional(v.number()),
      feesSol: v.optional(v.number()), claimableSol: v.optional(v.number()), migrated: v.optional(v.boolean()),
      historyComplete: v.optional(v.boolean()), launchCapSol: v.optional(v.number()), curveProgress: v.optional(v.number()),
      volume24hSol: v.optional(v.number()), trades24h: v.optional(v.number()),
      reserveSol: v.optional(v.number()), targetSol: v.optional(v.number()),
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
      creator: a.market?.creator ?? prev?.creator, creatorSharePct: a.market?.creatorSharePct ?? prev?.creatorSharePct,
      feesSol: a.market?.feesSol ?? prev?.feesSol, claimableSol: a.market?.claimableSol ?? prev?.claimableSol, migrated: a.market?.migrated ?? prev?.migrated,
      historyComplete: a.market?.historyComplete ?? prev?.historyComplete,
      launchCapSol: a.market?.launchCapSol ?? prev?.launchCapSol, curveProgress: a.market?.curveProgress ?? prev?.curveProgress,
      volume24hSol: a.market?.volume24hSol ?? prev?.volume24hSol, trades24h: a.market?.trades24h ?? prev?.trades24h,
      reserveSol: a.market?.reserveSol ?? prev?.reserveSol, targetSol: a.market?.targetSol ?? prev?.targetSol,
      // Fee data exists for every swap from the first ingest when the whole history was read, else from now on.
      feeTrackedSince: prev ? prev.feeTrackedSince : a.market?.historyComplete === false ? Date.now() : 0,
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

/**
 * One coin as the leaderboard ranks it: price, creator economics, swaps and largest holders, in one reactive read.
 * Per coin (not all coins at once) so a single read stays well inside Convex's per-query document limit; the route
 * fans out across coins. Replaces a per-request scan of the chain; the market sync keeps these tables current.
 */
export const leaderboardCoin = query({
  args: { characterId: v.id("ssCharacters") },
  handler: async (ctx, { characterId }) => {
    const token = await ctx.db.query("ssTokens").withIndex("by_character", (q) => q.eq("characterId", characterId)).first();
    const character = await ctx.db.get(characterId);
    if (!token || !token.mint || !token.dbcPool || !character || character.status !== "approved") return null;
    const state = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", characterId)).unique();
    const newest = await ctx.db.query("ssChainSwaps").withIndex("by_character_time", (q) => q.eq("characterId", characterId)).order("desc").take(4001);
    const holders = await ctx.db.query("ssChainHolders").withIndex("by_character", (q) => q.eq("characterId", characterId)).take(40);
    return {
      characterId: characterId as string, name: character.name, ticker: token.ticker, imageUrl: character.referenceImageUrl, mint: token.mint, dbcPool: token.dbcPool,
      state: state ? {
        priceSol: state.priceSol, decimals: state.decimals, syncedAt: state.syncedAt, error: state.error, creator: state.creator, creatorSharePct: state.creatorSharePct,
        feesSol: state.feesSol, claimableSol: state.claimableSol, migrated: state.migrated, feeTrackedSince: state.feeTrackedSince, historyComplete: state.historyComplete,
      } : null,
      swapsTruncated: newest.length > 4000,
      swaps: newest.slice(0, 4000).reverse().map((s) => ({ signature: s.signature, wallet: s.wallet, side: s.side, units: s.units, sol: s.sol, time: s.time, feeSol: s.feeSol, networkFeeSol: s.networkFeeSol })),
      holders: holders.map((h) => ({ wallet: h.wallet, units: h.units, isPool: h.isPool })),
    };
  },
});

/**
 * What a listing row shows for one coin (market cap, change since launch, 24h volume, curve fill), straight from the
 * synced tables. Reactive, so the numbers move the moment the sync lands and no row waits on an RPC call.
 */
export const poolSnapshot = query({
  args: { characterId: v.id("ssCharacters") },
  handler: async (ctx, { characterId }) => {
    const state = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", characterId)).unique();
    if (!state) return null;
    const since = Date.now() - 86_400_000;
    const recent = await ctx.db.query("ssChainSwaps").withIndex("by_character_time", (q) => q.eq("characterId", characterId).gte("time", since)).take(2000);
    const capSol = state.priceSol * (Number(state.supplyRaw) / 10 ** state.decimals);
    return {
      available: true as const, capSol, migrated: !!state.migrated, progress: state.migrated ? 1 : state.curveProgress ?? 0,
      changeSinceLaunchPct: state.launchCapSol && state.launchCapSol > 0 ? (capSol / state.launchCapSol - 1) * 100 : null,
      appVolume24hLamports: String(Math.round(recent.reduce((n, s) => n + s.sol, 0) * 1e9)),
      syncedAt: state.syncedAt,
    };
  },
});

/**
 * The tokenomics page's live pulse, reactive: how much trading is happening, what fee that makes, how the fee splits,
 * and the latest swaps across every coin. Reads the per-coin rollups the market sync keeps, never raw history.
 */
export const pulse = query({
  args: { network: v.union(v.literal("mainnet"), v.literal("devnet")) },
  handler: async (ctx, { network }) => {
    const tokens = await ctx.db.query("ssTokens").withIndex("by_network", (q) => q.eq("network", network)).take(60);
    let volume24hSol = 0, trades24h = 0, marketCapSol = 0, coins = 0, graduated = 0, syncedAt = 0;
    const tape: { signature: string; side: "buy" | "sell"; sol: number; wallet: string; time: number; ticker: string; characterId: string }[] = [];
    for (const token of tokens) {
      if (!token.mint || !token.dbcPool || !["live", "graduated", "migrated"].includes(token.state)) continue;
      const state = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", token.characterId)).unique();
      if (!state) continue;
      coins++; if (state.migrated) graduated++;
      volume24hSol += state.volume24hSol ?? 0; trades24h += state.trades24h ?? 0;
      marketCapSol += state.priceSol * (Number(state.supplyRaw) / 10 ** state.decimals);
      syncedAt = Math.max(syncedAt, state.syncedAt);
      const recent = await ctx.db.query("ssChainSwaps").withIndex("by_character_time", (q) => q.eq("characterId", token.characterId)).order("desc").take(8);
      for (const s of recent) tape.push({ signature: s.signature, side: s.side, sol: s.sol, wallet: `${s.wallet.slice(0, 4)}…${s.wallet.slice(-4)}`, time: s.time, ticker: token.ticker, characterId: token.characterId as string });
    }
    tape.sort((a, b) => b.time - a.time);
    return { coins, graduated, volume24hSol, trades24h, marketCapSol, syncedAt, tape: tape.slice(0, 14) };
  },
});

/**
 * A coin's price history for its chart, straight from the synced swaps: one point per swap, as market cap in SOL at that
 * moment, oldest first. Lets the chart paint from Convex the instant the page opens instead of waiting on a chain read.
 */
export const chartPoints = query({
  args: { characterId: v.id("ssCharacters"), limit: v.optional(v.number()) },
  handler: async (ctx, { characterId, limit }) => {
    const state = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", characterId)).unique();
    if (!state) return [];
    const supply = Number(state.supplyRaw) / 10 ** state.decimals;
    const rows = await ctx.db.query("ssChainSwaps").withIndex("by_character_time", (q) => q.eq("characterId", characterId)).order("desc").take(Math.min(1500, Math.max(1, limit ?? 800)));
    return rows.reverse().map((s) => ({ time: s.time, price: s.priceSol * supply, volume: s.sol, side: s.side }));
  },
});

/**
 * Every live coin's pool numbers for the market list in one reactive read: market cap, change since launch, 24h volume,
 * curve fill and a short price history for the sparkline. Same shape the list used to fetch from the chain, so the page
 * paints from Convex instantly and updates the moment the market sync lands a trade.
 */
export const marketPools = query({
  args: { network: v.union(v.literal("mainnet"), v.literal("devnet")) },
  handler: async (ctx, { network }) => {
    const tokens = await ctx.db.query("ssTokens").withIndex("by_network", (q) => q.eq("network", network)).take(80);
    const out: Record<string, {
      available: true; capSol: number; progress: number; migrated: boolean; changeSinceLaunchPct: number | null; appVolume24hLamports: string; supplyTokens: number;
      reserveSol: number; targetSol: number; points: { time: number; price: number; volume: number }[];
    }> = {};
    for (const token of tokens) {
      if (!token.mint || !token.dbcPool || !["live", "graduated", "migrated"].includes(token.state)) continue;
      const state = await ctx.db.query("ssChainState").withIndex("by_character", (q) => q.eq("characterId", token.characterId)).unique();
      if (!state) continue;
      const supply = Number(state.supplyRaw) / 10 ** state.decimals;
      const capSol = state.priceSol * supply;
      const swaps = (await ctx.db.query("ssChainSwaps").withIndex("by_character_time", (q) => q.eq("characterId", token.characterId)).order("desc").take(40)).reverse();
      out[token.characterId as string] = {
        available: true, capSol, supplyTokens: supply, migrated: !!state.migrated, progress: state.migrated ? 1 : state.curveProgress ?? 0,
        reserveSol: state.reserveSol ?? 0, targetSol: state.targetSol ?? 0,
        changeSinceLaunchPct: state.launchCapSol && state.launchCapSol > 0 ? (capSol / state.launchCapSol - 1) * 100 : null,
        appVolume24hLamports: String(Math.round((state.volume24hSol ?? 0) * 1e9)),
        points: swaps.map((s) => ({ time: s.time, price: s.priceSol * supply, volume: s.sol })),
      };
    }
    return out;
  },
});
