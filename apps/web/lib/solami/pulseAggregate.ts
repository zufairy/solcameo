import { num } from "./blur";

/**
 * Rolling aggregation of Blur's decoded event stream. Pure and clock-injected so it is testable without a socket.
 * Events land in one-minute buckets; the snapshot sums the last `windowMinutes` of them. Unique wallets are counted from the
 * swap `trader`, so "unique wallets" is exact within the window (capped per bucket to bound memory).
 */
export type BlurEvent = { type?: string } & Record<string, unknown>;

const BUCKET_MS = 60_000;
const KEEP_BUCKETS = 60;
const WALLET_CAP = 30_000;
const FEED_MAX = 30;
export const BIG_SWAP_USD = 5_000;
export const BIG_LIQUIDITY_USD = 2_000;

type TokenAgg = { buyUsd: number; sellUsd: number; trades: number; lastPriceUsd: number };
type Bucket = {
  minute: number; swaps: number; buys: number; sells: number; volumeUsd: number; wallets: Set<string>;
  launches: number; pools: number; liqAddUsd: number; liqRemoveUsd: number; liqEvents: number;
  dex: Map<string, number>; tokens: Map<string, TokenAgg>;
};
export type TokenMeta = { name: string; symbol: string; logo?: string };

export type FeedLaunch = { mint: string; name: string; symbol: string; dex: string; creator: string; signature: string; at: number };
export type FeedSwap = { mint: string; side: string; usd: number; dex: string; trader: string; signature: string; at: number };
export type FeedSurge = { mint: string; multiple: number; mcapUsd: number; volumeUsd: number; trades: number; windowSecs: number; at: number };
export type FeedGraduation = { mint: string; from: string; to: string; at: number };
export type FeedLiquidity = { mint: string; kind: string; usd: number; dex: string; provider: string; signature: string; at: number };

export type PulseWindow = {
  minutes: number; swaps: number; buys: number; sells: number; volumeUsd: number; uniqueWallets: number;
  launches: number; pools: number; liquidityAddUsd: number; liquidityRemoveUsd: number; liquidityEvents: number;
  buyPressure: number; // buys / swaps, 0..1
  perMinute: { minute: number; swaps: number; volumeUsd: number; launches: number }[];
  dexes: { dex: string; volumeUsd: number }[];
  topTokens: { mint: string; name?: string; symbol?: string; logo?: string; volumeUsd: number; trades: number; buyPressure: number; priceUsd: number }[];
};

const push = <T>(list: T[], item: T) => { list.unshift(item); if (list.length > FEED_MAX) list.length = FEED_MAX; };

export function createAggregator() {
  const buckets = new Map<number, Bucket>();
  const meta = new Map<string, TokenMeta>();
  const feeds = { launches: [] as FeedLaunch[], bigSwaps: [] as FeedSwap[], surges: [] as FeedSurge[], graduations: [] as FeedGraduation[], liquidity: [] as FeedLiquidity[] };
  let latestBlockTime = 0;

  const bucketFor = (ms: number): Bucket => {
    const minute = Math.floor(ms / BUCKET_MS) * BUCKET_MS;
    let b = buckets.get(minute);
    if (!b) {
      b = { minute, swaps: 0, buys: 0, sells: 0, volumeUsd: 0, wallets: new Set(), launches: 0, pools: 0, liqAddUsd: 0, liqRemoveUsd: 0, liqEvents: 0, dex: new Map(), tokens: new Map() };
      buckets.set(minute, b);
      for (const k of buckets.keys()) if (k < minute - KEEP_BUCKETS * BUCKET_MS) buckets.delete(k);
    }
    return b;
  };

  const rememberMeta = (mint: string, name: unknown, symbol: unknown, logo?: unknown) => {
    if (!mint) return;
    if (meta.size > 6000) meta.delete(meta.keys().next().value as string);
    const prev = meta.get(mint);
    meta.set(mint, { name: String(name ?? prev?.name ?? ""), symbol: String(symbol ?? prev?.symbol ?? ""), logo: typeof logo === "string" ? logo : prev?.logo });
  };

  function ingest(e: BlurEvent, now = Date.now()) {
    const t = e.type;
    const blockTime = num(e.block_time);
    if (blockTime) latestBlockTime = Math.max(latestBlockTime, blockTime);
    // Bucket by the arrival clock: a replayed or late block must not rewrite history.
    const b = bucketFor(now);
    const at = blockTime ? blockTime * 1000 : now;
    if (t === "swap") {
      const usd = num(e.volume_usd), mint = String(e.mint ?? ""), buy = e.side === "buy";
      b.swaps++; if (buy) b.buys++; else b.sells++; b.volumeUsd += usd;
      if (typeof e.trader === "string" && b.wallets.size < WALLET_CAP) b.wallets.add(e.trader);
      const dex = String(e.dex ?? "unknown");
      b.dex.set(dex, (b.dex.get(dex) ?? 0) + usd);
      if (mint) {
        const a = b.tokens.get(mint) ?? { buyUsd: 0, sellUsd: 0, trades: 0, lastPriceUsd: 0 };
        if (buy) a.buyUsd += usd; else a.sellUsd += usd; a.trades++; a.lastPriceUsd = num(e.price_usd) || a.lastPriceUsd;
        b.tokens.set(mint, a);
      }
      if (usd >= BIG_SWAP_USD) push(feeds.bigSwaps, { mint, side: String(e.side), usd, dex, trader: String(e.trader ?? ""), signature: String(e.signature ?? ""), at });
    } else if (t === "token_create") {
      b.launches++;
      const mint = String(e.mint ?? "");
      rememberMeta(mint, e.name, e.symbol);
      push(feeds.launches, { mint, name: String(e.name ?? ""), symbol: String(e.symbol ?? ""), dex: String(e.dex ?? ""), creator: String(e.creator ?? ""), signature: String(e.signature ?? ""), at });
    } else if (t === "pool_create") {
      b.pools++;
    } else if (t === "liquidity") {
      const usd = num(e.base_usd) + num(e.quote_usd), add = e.kind === "add";
      b.liqEvents++; if (add) b.liqAddUsd += usd; else b.liqRemoveUsd += usd;
      if (usd >= BIG_LIQUIDITY_USD) push(feeds.liquidity, { mint: String(e.base_mint ?? ""), kind: String(e.kind), usd, dex: String(e.dex ?? ""), provider: String(e.provider ?? ""), signature: String(e.signature ?? ""), at });
    } else if (t === "surge") {
      push(feeds.surges, { mint: String(e.mint ?? ""), multiple: num(e.multiple), mcapUsd: num(e.mcap_at_trigger), volumeUsd: num(e.volume_window_usd), trades: num(e.trades), windowSecs: num(e.window_secs), at: num(e.trigger_time) * 1000 || now });
    } else if (t === "graduation") {
      push(feeds.graduations, { mint: String(e.mint ?? ""), from: String(e.launchpad ?? e.from ?? ""), to: String(e.dex ?? e.to ?? ""), at });
    } else if (t === "metadata") {
      // `image_url` on Blur metadata events embeds the API key in its query string, so only the public logo URL is kept.
      rememberMeta(String(e.mint ?? ""), e.name, e.symbol, e.logo_uri);
    }
  }

  function window(minutes: number, now = Date.now()): PulseWindow {
    const from = Math.floor(now / BUCKET_MS) * BUCKET_MS - (minutes - 1) * BUCKET_MS;
    const used = [...buckets.values()].filter((b) => b.minute >= from).sort((a, b) => a.minute - b.minute);
    const wallets = new Set<string>(); const dex = new Map<string, number>(); const tokens = new Map<string, TokenAgg>();
    const w: PulseWindow = { minutes, swaps: 0, buys: 0, sells: 0, volumeUsd: 0, uniqueWallets: 0, launches: 0, pools: 0, liquidityAddUsd: 0, liquidityRemoveUsd: 0, liquidityEvents: 0, buyPressure: 0.5, perMinute: [], dexes: [], topTokens: [] };
    for (const b of used) {
      w.swaps += b.swaps; w.buys += b.buys; w.sells += b.sells; w.volumeUsd += b.volumeUsd; w.launches += b.launches; w.pools += b.pools;
      w.liquidityAddUsd += b.liqAddUsd; w.liquidityRemoveUsd += b.liqRemoveUsd; w.liquidityEvents += b.liqEvents;
      b.wallets.forEach((x) => wallets.add(x));
      b.dex.forEach((v, k) => dex.set(k, (dex.get(k) ?? 0) + v));
      b.tokens.forEach((a, k) => {
        const m = tokens.get(k) ?? { buyUsd: 0, sellUsd: 0, trades: 0, lastPriceUsd: 0 };
        m.buyUsd += a.buyUsd; m.sellUsd += a.sellUsd; m.trades += a.trades; m.lastPriceUsd = a.lastPriceUsd || m.lastPriceUsd;
        tokens.set(k, m);
      });
      w.perMinute.push({ minute: b.minute, swaps: b.swaps, volumeUsd: b.volumeUsd, launches: b.launches });
    }
    w.uniqueWallets = wallets.size;
    w.buyPressure = w.swaps ? w.buys / w.swaps : 0.5;
    w.dexes = [...dex].map(([d, volumeUsd]) => ({ dex: d, volumeUsd })).sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 6);
    w.topTokens = [...tokens].map(([mint, a]) => {
      const m = meta.get(mint); const volumeUsd = a.buyUsd + a.sellUsd;
      return { mint, name: m?.name, symbol: m?.symbol, logo: m?.logo, volumeUsd, trades: a.trades, buyPressure: volumeUsd ? a.buyUsd / volumeUsd : 0.5, priceUsd: a.lastPriceUsd };
    }).sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 8);
    return w;
  }

  return {
    ingest, window,
    feeds: () => feeds,
    metaFor: (mint: string) => meta.get(mint),
    /** Seconds between "now" and the newest block seen: how stale the stream is. */
    lagSeconds: (now = Date.now()) => (latestBlockTime ? Math.max(0, now / 1000 - latestBlockTime) : null),
  };
}
export type Aggregator = ReturnType<typeof createAggregator>;
