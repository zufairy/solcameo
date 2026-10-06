export type LeaderboardPeriod = "all" | "24h" | "7d" | "30d";
export const LEADERBOARD_PERIODS: Record<LeaderboardPeriod, string> = { all: "All time", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
export function periodStart(period: LeaderboardPeriod, now = Date.now()) {
  return period === "all" ? 0 : now - (period === "24h" ? 1 : period === "7d" ? 7 : 30) * 86400000;
}
export type RpcTrade = { signature: string; wallet: string; mint: string; side: "buy" | "sell"; units: number; sol: number; networkFeeSol: number; time: number; slot?: number };
export type TraderRank = { wallet: string; profileName?: string; profileImage?: string; pnlSol: number | null; realizedSol: number; closedTrades?: number; unrealizedSol: number; trades: number; complete: boolean };
/** FIFO cost basis across the full available history. Periods include realised
 * profits booked during the period + open lots bought during the period.
 * Prices mark unsold tokens to the current pool price; these are not cash earnings. */
export function rankTraders(trades: RpcTrade[], prices: Map<string, number>, since: number, historyComplete: boolean, realizedOnly = false): TraderRank[] {
  const wallets = new Map<string, { lots: Map<string, { units: number; cost: number; time: number }[]>; realized: number; closedTrades: number; trades: number; complete: boolean }>();
  const seen = new Set<string>();
  const chargedFees = new Set<string>();
  for (const t of [...trades].sort((a, b) => a.time - b.time || (a.slot ?? 0) - (b.slot ?? 0))) {
    const key = `${t.signature}:${t.mint}:${t.wallet}`;
    if (seen.has(key) || !(t.units > 0) || !(t.sol >= 0)) continue;
    seen.add(key);
    const feeKey = `${t.signature}:${t.wallet}`;
    const networkFee = chargedFees.has(feeKey) ? 0 : t.networkFeeSol;
    chargedFees.add(feeKey);
    let w = wallets.get(t.wallet);
    if (!w) { w = { lots: new Map(), realized: 0, closedTrades: 0, trades: 0, complete: historyComplete }; wallets.set(t.wallet, w); }
    if (t.time >= since) w.trades++;
    const lots = w.lots.get(t.mint) ?? [];
    w.lots.set(t.mint, lots);
    if (t.side === "buy") lots.push({ units: t.units, cost: t.sol + networkFee, time: t.time });
    else {
      let remaining = t.units, cost = 0;
      while (remaining > 1e-6 && lots.length) {
        const lot = lots[0], used = Math.min(remaining, lot.units), basis = lot.cost * used / lot.units;
        cost += basis; lot.units -= used; lot.cost -= basis; remaining -= used;
        if (lot.units <= 1e-6) lots.shift();
      }
      if (remaining > 1e-6) w.complete = false; // transfer-in or missing purchase: cost basis unknown
      if (t.time >= since) { w.realized += t.sol - networkFee - cost; w.closedTrades++; }
    }
  }
  return [...wallets].map(([wallet, w]) => {
    let unrealized = 0;
    for (const [mint, lots] of w.lots) for (const lot of lots) {
      if (realizedOnly || lot.time < since) continue;
      const price = prices.get(mint);
      if (price == null || !Number.isFinite(price)) w.complete = false;
      else unrealized += lot.units * price - lot.cost;
    }
    return { wallet, pnlSol: w.complete ? (realizedOnly ? w.realized : w.realized + unrealized) : null, realizedSol: w.realized, closedTrades: w.closedTrades, unrealizedSol: unrealized, trades: w.trades, complete: w.complete };
  }).filter(w => realizedOnly ? (w.closedTrades ?? 0) > 0 : w.trades > 0).sort((a, b) => (b.pnlSol ?? -Infinity) - (a.pnlSol ?? -Infinity));
}
export type EarnerRank = { marketUrl?: string; creatorName?: string; creatorImage?: string; wallet: string; name: string; ticker: string; imageUrl: string; characterId: string; feesSol: number | null; claimableSol: number | null };
export type ViewRank = { marketUrl?: string; mint: string; name: string; ticker: string; imageUrl?: string; views: number };
export type LeaderboardResponse = { views?: ViewRank[]; traders: TraderRank[]; earners: EarnerRank[]; checkedAt: number; complete: boolean; errors: string[]; network: "devnet" | "mainnet" };
