import { periodStart, rankTraders, type EarnerRank, type LeaderboardPeriod, type LeaderboardResponse, type RpcTrade } from "./leaderboard";

/** One live coin as the market sync stores it in Convex (see convex/solstarChain.ts leaderboardInput). */
export interface ChainCoin {
  characterId: string; name: string; ticker: string; imageUrl: string; mint: string; dbcPool: string;
  state: {
    priceSol: number; decimals: number; syncedAt: number; error?: string; creator?: string; creatorSharePct?: number;
    feesSol?: number; claimableSol?: number; migrated?: boolean; feeTrackedSince?: number; historyComplete?: boolean;
  } | null;
  swapsTruncated: boolean;
  swaps: { signature: string; wallet: string; side: "buy" | "sell"; units: number; sol: number; time: number; feeSol?: number; networkFeeSol?: number }[];
  holders: { wallet: string; units: string; isPool: boolean }[];
}

const STALE_MS = 30 * 60_000;

/**
 * The leaderboard from the synced Convex tables: no chain reads at all, so it answers instantly and cannot be
 * rate limited. Cost basis is FIFO over every recorded swap; a wallet whose live balance (from the holders snapshot)
 * disagrees with its swaps is marked unverified, exactly as the old per-wallet balance check did.
 */
export function leaderboardFromChain(coins: ChainCoin[], opts: { period: LeaderboardPeriod; realizedOnly: boolean; now?: number; marketUrl: (characterId: string) => string }): Pick<LeaderboardResponse, "traders" | "earners" | "complete" | "errors"> {
  const now = opts.now ?? Date.now();
  const since = periodStart(opts.period, now);
  const prices = new Map<string, number>(), trades: RpcTrade[] = [], earners: EarnerRank[] = [], errors: string[] = [];
  const meta = new Map<string, { ticker: string; name: string; imageUrl: string; marketUrl: string }>();
  const unknown = new Set<string>();
  const complete = true;

  for (const coin of coins) {
    const marketUrl = opts.marketUrl(coin.characterId);
    meta.set(coin.mint, { ticker: coin.ticker, name: coin.name, imageUrl: coin.imageUrl, marketUrl });
    const state = coin.state;
    // One coin that is not ready must not blank everyone else: only wallets that traded it lose their verified status.
    if (!state) { for (const s of coin.swaps) unknown.add(s.wallet); errors.push(`${coin.name}: market data is still syncing`); continue; }
    if (state.historyComplete === false || coin.swapsTruncated) { for (const s of coin.swaps) unknown.add(s.wallet); errors.push(`${coin.name}: trade history is incomplete`); }
    if (now - state.syncedAt > STALE_MS) errors.push(`${coin.name}: market data is delayed`);
    const scale = 10 ** state.decimals;
    prices.set(coin.mint, state.priceSol / scale); // the ranking prices a raw base unit
    const balances = new Map<string, number>();
    for (const s of coin.swaps) {
      const units = Math.round(s.units * scale);
      trades.push({ signature: s.signature, wallet: s.wallet, mint: coin.mint, side: s.side, units, sol: s.sol, networkFeeSol: s.networkFeeSol ?? 0, time: s.time });
      balances.set(s.wallet, (balances.get(s.wallet) ?? 0) + (s.side === "buy" ? units : -units));
    }
    for (const h of coin.holders) {
      if (h.isPool) continue;
      const expected = balances.get(h.wallet);
      if (expected !== undefined && Math.abs(Number(h.units) - expected) > Math.max(1, Math.abs(expected) * 0.001)) unknown.add(h.wallet);
    }
    if (!opts.realizedOnly && state.creator) {
      const share = (state.creatorSharePct ?? 0) / 100;
      let feesSol: number | null = state.feesSol ?? null;
      if (opts.period !== "all") {
        const tracked = (state.feeTrackedSince ?? Infinity) <= since && !state.migrated && coin.swaps.every((s) => s.feeSol !== undefined || s.time < since);
        feesSol = tracked ? coin.swaps.filter((s) => s.time >= since).reduce((n, s) => n + (s.feeSol ?? 0) * share, 0) : null;
        if (feesSol === null) errors.push(`${coin.name}: period creator-fee history unavailable`);
      }
      earners.push({ wallet: state.creator, name: coin.name, ticker: coin.ticker, imageUrl: coin.imageUrl, characterId: coin.characterId, marketUrl, feesSol, claimableSol: state.claimableSol ?? null });
    }
  }

  const traders = rankTraders(trades, prices, since, complete, opts.realizedOnly)
    .map((t) => (unknown.has(t.wallet) ? { ...t, pnlSol: null, complete: false } : t))
    .sort((a, b) => (b.pnlSol ?? -Infinity) - (a.pnlSol ?? -Infinity));
  for (const t of traders) t.coins = t.coins?.map((c) => ({ ...c, ...meta.get(c.mint) }));
  if (traders.some((t) => unknown.has(t.wallet))) errors.push("Some wallet balances changed outside tracked swaps; their cost basis cannot be verified");
  earners.sort((a, b) => (b.feesSol ?? -Infinity) - (a.feesSol ?? -Infinity));
  return { traders, earners, complete: errors.length === 0, errors };
}
