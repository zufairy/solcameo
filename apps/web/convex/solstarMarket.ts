import { terminalStats } from "./lib/terminalStats";
import { v } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { marketSlug, tickerFromSegment } from "../lib/solstar/marketSlug";
import { assertSecret } from "./lib/solstarAuth";
import { countSources } from "./lib/marketSummary";
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

    // Convex aborts a query that reads more than ~16k documents, and this one runs on every page (the ticker).
    // Counting followers and episodes per token used to read up to 2,002 documents each, so a few popular coins
    // were enough to break every page. Share a fixed read budget across the listed coins instead.
    // Episode documents are large (prompts, URLs), so they get a much smaller count cap than the tiny follow rows.
    const countCap = Math.max(20, Math.min(1000, Math.floor(8000 / Math.max(1, tokens.length) / 2)));
    const episodeCap = Math.min(countCap, 10);
    // The simulated paper ledger replays every trade per coin; share a fixed budget of replayed rows across the list.
    const statsLimit = Math.max(50, Math.floor(8000 / Math.max(1, tokens.length)));
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

      // Live coins read two counters from the summary row (kept current by the writers) instead of scanning episodes and
      // follows; coins without a row yet (or paper coins) fall back to the bounded scans below.
      const summary = token.network === "paper" ? null : await ctx.db.query("ssMarketSummary").withIndex("by_token", (q) => q.eq("tokenId", token._id)).unique();
      const stats =
        token.network === "paper" ? await terminalStats(ctx, token._id, statsLimit) : null;
      let posterUrl: string | undefined, episodeCount: number, followers: number, followersCapped: boolean;
      if (summary) {
        posterUrl = summary.posterUrl;
        episodeCount = summary.episodes;
        followers = summary.followers;
        followersCapped = false;
      } else {
        const episode = await ctx.db.query("ssEpisodes").withIndex("by_token", (q) => q.eq("tokenId", token._id)).order("desc").first();
        const episodes = await ctx.db.query("ssEpisodes").withIndex("by_token", (q) => q.eq("tokenId", token._id)).take(episodeCap + 1);
        const following = await ctx.db.query("ssFollows").withIndex("by_character", (q) => q.eq("characterId", character._id)).take(countCap + 1);
        posterUrl = episode?.posterUrl;
        episodeCount = episodes.length;
        followers = Math.min(following.length, countCap);
        followersCapped = following.length > countCap;
      }
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
      // A coin created straight on-chain (e.g. the platform token) has no simulated reserves. The price math throws on a
      // non-positive reserve, and one such row used to fail this whole query for every caller, so those report zeros.
      const hasReserves = pool.tokenReserve > 0n && pool.solReserve >= 0n;
      const price = hasReserves ? priceLamportsPerToken(pool) : 0n;
      const mcap = hasReserves ? marketCapLamports(pool, PAPER_VIRTUAL_TOKENS) : 0n;
      const change = hasReserves ? changeSinceLaunchBps(launchPrice, price) : 0n;
      rows.push({
        characterId: character._id,
        name: character.name,
        ticker: token.ticker,
        category: character.category,
        imageUrl: posterUrl || character.referenceImageUrl,
        state: token.state,
        ...(token.dbcPool ? { dbcPool: token.dbcPool } : {}),
        network: token.network,
        priceLamports: price.toString(),
        marketCapLamports: mcap.toString(),
        changeBps: change.toString(),
        volume24hLamports: volume.toString(),
        trades24h,
        followers,
        followersCountCapped: followersCapped,
        historyComplete: stats !== null,
        createdAt: token.createdAt,
        ...(character.xUrl ? { xUrl: character.xUrl } : {}),
        ...(character.websiteUrl ? { websiteUrl: character.websiteUrl } : {}),
        videosPosted: Math.min(episodeCount, episodeCap),
        videosCountCapped: episodeCount > episodeCap,
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

/** Minimal public pool references for the live coins, so price polling never has to read the heavy terminal view. */
export const poolRefs = query({
  args: { network: networkV },
  handler: async (ctx, { network }) => {
    const tokens = await ctx.db.query("ssTokens").withIndex("by_network", (q) => q.eq("network", network)).take(MAX_LIST);
    return tokens
      .filter((t) => t.mint && t.dbcPool && t.dbcConfig && ["live", "graduated", "migrated"].includes(t.state))
      .map((t) => ({ characterId: t.characterId, network: t.network, mint: t.mint as string, dbcPool: t.dbcPool as string, dbcConfig: t.dbcConfig as string }));
  },
});

/**
 * The coin that owns a ticker. Tickers are only unique per network, so prefer the live mainnet coin, then devnet, then
 * paper; the oldest wins a tie, so the answer never changes when someone later reuses the ticker.
 */
async function tokenForTicker(ctx: QueryCtx, ticker: string) {
  for (const network of ["mainnet", "devnet", "paper"] as const) {
    const token = await ctx.db.query("ssTokens").withIndex("by_network_ticker", (q) => q.eq("network", network).eq("ticker", ticker)).first();
    if (token) return token;
  }
  return null;
}

/**
 * Resolves a URL segment to a coin: a character id, or a ticker slug ("buttons" for $BUTTONS). `slug` is the canonical
 * ticker URL, or null when it cannot be used: the ticker belongs to another coin.
 */
export const characterForRoute = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const byId = ctx.db.normalizeId("ssCharacters", id);
    const ticker = byId ? null : tickerFromSegment(id);
    if (!byId && !ticker) return null;
    // A coin wins over an agent with the same handle: the ticker URL always opens the market page with the chart.
    let token = ticker ? await tokenForTicker(ctx, ticker) : null;
    const characterId = byId ?? token?.characterId;
    if (!characterId) return null;
    const character = await ctx.db.get(characterId);
    if (!character || character.status !== "approved") return null;
    token ??= await ctx.db.query("ssTokens").withIndex("by_character", (q) => q.eq("characterId", characterId)).first();
    if (!token) return null;
    const slug = marketSlug(token.ticker);
    const owner = slug.length >= 2 ? await tokenForTicker(ctx, slug.toUpperCase()) : null;
    return {
      characterId,
      name: character.name,
      bio: character.bio,
      imageUrl: character.referenceImageUrl,
      ticker: token.ticker,
      slug: owner?._id === token._id ? slug : null,
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

/** Live coins with their on-chain addresses: the input for the public /tokenomics page, which reads the
 *  pools straight from Solana RPC. Only approved characters with a launched pool are returned. */
export const tokenomicsTargets = query({
  args: { network: networkV },
  handler: async (ctx, { network }) => {
    const tokens = await ctx.db.query("ssTokens").withIndex("by_network", (q) => q.eq("network", network)).take(300);
    const out: { characterId: string; name: string; ticker: string; mint: string; dbcPool: string; dbcConfig: string; state: string }[] = [];
    for (const t of tokens) {
      if (!t.mint || !t.dbcPool || !t.dbcConfig || !["live", "graduated", "migrated"].includes(t.state)) continue;
      const c = await ctx.db.get(t.characterId);
      if (!c || c.status !== "approved") continue;
      out.push({ characterId: c._id, name: c.name, ticker: t.ticker, mint: t.mint, dbcPool: t.dbcPool, dbcConfig: t.dbcConfig, state: t.state });
    }
    return out;
  },
});

/**
 * Repair or create the counters, a few coins per call (Convex caps reads per mutation). Recounts from the source rows,
 * so it is safe to repeat. Call with `skip: 0`, then again with the returned `next` until it is null.
 */
export const rebuildMarketSummary = mutation({
  args: { authSecret: v.string(), network: networkV, skip: v.optional(v.number()) },
  handler: async (ctx, { authSecret, network, skip }) => {
    assertSecret(authSecret);
    const PAGE = 8;
    const start = skip ?? 0;
    const tokens = await ctx.db.query("ssTokens").withIndex("by_network", (q) => q.eq("network", network)).take(start + PAGE + 1);
    const page = tokens.slice(start, start + PAGE);
    for (const token of page) {
      const counts = await countSources(ctx, token._id, token.characterId);
      const doc = { tokenId: token._id, characterId: token.characterId, ...counts, updatedAt: Date.now() };
      const existing = await ctx.db.query("ssMarketSummary").withIndex("by_token", (q) => q.eq("tokenId", token._id)).unique();
      if (existing) await ctx.db.replace(existing._id, doc); else await ctx.db.insert("ssMarketSummary", doc);
    }
    return { rebuilt: page.length, next: tokens.length > start + PAGE ? start + PAGE : null };
  },
});
