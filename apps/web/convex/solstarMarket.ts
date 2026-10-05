import { terminalStats } from "./lib/terminalStats";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  PAPER_VIRTUAL_SOL,
  PAPER_VIRTUAL_TOKENS,
} from "../lib/solstar/economics";
import {
  changeSinceLaunchBps,
  marketCapLamports,
  priceLamportsPerToken,
} from "../lib/solstar/market";

const networkV = v.union(
  v.literal("paper"),
  v.literal("devnet"),
  v.literal("mainnet"),
);
const sortV = v.union(
  v.literal("new"),
  v.literal("volume"),
  v.literal("mcap"),
  v.literal("change"),
);
const MAX_LIST = 100;
const MAX_SEARCH = 64;

interface Row {
  characterId: Id<"ssCharacters">;
  name: string;
  ticker: string;
  category: string;
  imageUrl: string;
  state: string;
  dbcPool?: string;
  network: string;
  priceLamports: string;
  marketCapLamports: string;
  changeBps: string;
  volume24hLamports: string;
  trades24h: number;
  followers: number;
  followersCountCapped: boolean;
  historyComplete: boolean;
  createdAt: number;
  videosPosted: number;
  videosCountCapped: boolean;
  holders: number | null;
  changes: number[] | null;
  sparkline: number[];
  athLamports: string | null;
  xUrl?: string;
  websiteUrl?: string;
}

/** Derived market stats for approved characters. Reactive, so the UI updates live after trades. */
export const listMarket = query({
  args: {
    sort: sortV,
    liveOnly: v.optional(v.boolean()),
    search: v.optional(v.string()),
    category: v.optional(v.string()),
    network: v.optional(networkV),
  },
  handler: async (ctx, args): Promise<Row[]> => {
    const network = args.network ?? "paper";
    const needle = args.search?.trim().toLowerCase();
    if (args.search !== undefined && args.search.length > MAX_SEARCH) return [];
    const launchPrice = priceLamportsPerToken({
      solReserve: PAPER_VIRTUAL_SOL,
      tokenReserve: PAPER_VIRTUAL_TOKENS,
    });
    const tokens = await ctx.db
      .query("ssTokens")
      .withIndex("by_network", (q) => q.eq("network", network))
      .take(MAX_LIST);

    const rows: Array<Row & { volume: bigint; mcap: bigint; change: bigint }> =
      [];
    for (const token of tokens) {
      if (args.liveOnly && (token.network === "paper" || !token.mint || !token.dbcPool || !token.dbcConfig || !["live", "graduated", "migrated"].includes(token.state))) continue;
      const character = await ctx.db.get(token.characterId);
      if (!character || character.status !== "approved") continue;
      if (args.category && character.category !== args.category) continue;
      if (
        needle &&
        !(
          character.name.toLowerCase().includes(needle) ||
          token.ticker.toLowerCase().includes(needle)
        )
      )
        continue;

      const episode = await ctx.db
        .query("ssEpisodes")
        .withIndex("by_token", (q) => q.eq("tokenId", token._id))
        .order("desc")
        .first();
      const stats =
        token.network === "paper" ? await terminalStats(ctx, token._id) : null;
      const episodes = await ctx.db
        .query("ssEpisodes")
        .withIndex("by_token", (q) => q.eq("tokenId", token._id))
        .take(1001);
      const following = await ctx.db
        .query("ssFollows")
        .withIndex("by_character", (q) => q.eq("characterId", character._id))
        .take(1001);
      const followers = Math.min(following.length, 1000);
      // Full stats come from the bounded ledger replay. Incomplete history is marked
      // explicitly; the UI shows unavailable rather than claiming zero activity.
      const volume = stats
        ? BigInt(stats.buyVolume) + BigInt(stats.sellVolume)
        : 0n;
      const trades24h = stats ? stats.buys + stats.sells : 0;

      const pool = {
        solReserve: token.solReserve,
        tokenReserve: token.tokenReserve,
      };
      const price = priceLamportsPerToken(pool);
      const mcap = marketCapLamports(pool, PAPER_VIRTUAL_TOKENS);
      const change = changeSinceLaunchBps(launchPrice, price);
      rows.push({
        characterId: character._id,
        name: character.name,
        ticker: token.ticker,
        category: character.category,
        imageUrl: episode?.posterUrl ?? character.referenceImageUrl,
        state: token.state,
        ...(token.dbcPool ? { dbcPool: token.dbcPool } : {}),
        network: token.network,
        priceLamports: price.toString(),
        marketCapLamports: mcap.toString(),
        changeBps: change.toString(),
        volume24hLamports: volume.toString(),
        trades24h,
        followers,
        followersCountCapped: following.length > 1000,
        historyComplete: stats !== null,
        createdAt: token.createdAt,
        ...(character.xUrl ? { xUrl: character.xUrl } : {}),
        ...(character.websiteUrl ? { websiteUrl: character.websiteUrl } : {}),
        videosPosted: Math.min(episodes.length, 1000),
        videosCountCapped: episodes.length > 1000,
        holders: stats?.holders.length ?? null,
        changes: stats?.changes ?? null,
        sparkline: stats?.points.slice(-32).map((p) => p.price) ?? [],
        athLamports: stats ? Math.round(stats.ath).toString() : null,
        volume,
        mcap,
        change,
      });
    }

    const cmp = (a: bigint, b: bigint): number => (a < b ? 1 : a > b ? -1 : 0);
    rows.sort((a, b) => {
      const primary =
        args.sort === "volume"
          ? cmp(a.volume, b.volume)
          : args.sort === "mcap"
            ? cmp(a.mcap, b.mcap)
            : args.sort === "change"
              ? cmp(a.change, b.change)
              : 0;
      return primary !== 0 ? primary : b.createdAt - a.createdAt;
    });
    return rows
      .slice(0, MAX_LIST)
      .map(({ volume: _v, mcap: _m, change: _c, ...pub }) => pub);
  },
});

/** Resolves character ids without confusing them with influencer handles or SPL mints. */
export const characterForRoute = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const characterId = ctx.db.normalizeId("ssCharacters", id);
    if (!characterId) return null;
    const character = await ctx.db.get(characterId);
    if (!character || character.status !== "approved") return null;
    const token = await ctx.db
      .query("ssTokens")
      .withIndex("by_character", (q) => q.eq("characterId", characterId))
      .first();
    if (!token) return null;
    return {
      characterId,
      name: character.name,
      bio: character.bio,
      imageUrl: character.referenceImageUrl,
    };
  },
});

export const terminal = query({
  args: { characterId: v.id("ssCharacters") },
  handler: async (ctx, { characterId }) => {
    const character = await ctx.db.get(characterId);
    if (!character || character.status !== "approved") return null;
    const token = await ctx.db
      .query("ssTokens")
      .withIndex("by_character", (q) => q.eq("characterId", characterId))
      .first();
    if (!token) return null;
    const stats =
      token.network === "paper" ? await terminalStats(ctx, token._id) : null;
    const trades = await ctx.db
      .query("ssTrades")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .order("desc")
      .take(100);
    const episodes = await ctx.db
      .query("ssEpisodes")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .order("desc")
      .take(100);
    const budget = await ctx.db
      .query("ssBudgets")
      .withIndex("by_token", (q) => q.eq("tokenId", token._id))
      .first();
    return {
      character,
      token: {
        ...token,
        solReserve: token.solReserve.toString(),
        tokenReserve: token.tokenReserve.toString(),
      },
      stats,
      trades: trades.map((t) => ({
        ...t,
        amountIn: t.amountIn.toString(),
        amountOut: t.amountOut.toString(),
        fee: t.fee.toString(),
      })),
      episodes,
      budget: {
        funded: (budget?.fundedLamports ?? 0n).toString(),
        spent: (budget?.spentLamports ?? 0n).toString(),
      },
    };
  },
});
