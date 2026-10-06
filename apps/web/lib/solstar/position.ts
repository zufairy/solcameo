import type { RpcTrade } from "./leaderboard";

export interface PositionTrade { signature: string; side: "buy" | "sell"; tokens: number; sol: number; priceSol: number; time: number }
export interface Position {
  /** Whole tokens still held according to the trade history. */
  tokens: number;
  /** SOL paid for the tokens still held (FIFO, network fees included). */
  costBasisSol: number;
  /** Average entry, SOL per whole token. Null when nothing is held. */
  avgEntrySol: number | null;
  /** Current pool price, SOL per whole token. */
  priceSol: number;
  valueSol: number;
  unrealizedSol: number;
  realizedSol: number;
  pnlSol: number;
  /** Total P&L over everything ever put in, in percent. Null when nothing was ever bought. */
  roiPct: number | null;
  firstBuyTime: number | null;
  trades: PositionTrade[];
  /** False when a sell has no matching buy (tokens were transferred in), so the basis cannot be trusted. */
  complete: boolean;
}

/**
 * FIFO position for one wallet and one coin. `units` in the trades and `pricePerUnit` are raw base units (the pool's
 * native scale); `decimals` converts them to whole tokens for display. Pure and deterministic.
 */
export function positionFromTrades(trades: RpcTrade[], pricePerUnit: number, decimals: number): Position {
  const scale = 10 ** decimals;
  const lots: { units: number; cost: number }[] = [];
  const seen = new Set<string>(), feeSeen = new Set<string>();
  let realized = 0, bought = 0, complete = true, first: number | null = null;
  const out: PositionTrade[] = [];
  for (const t of [...trades].sort((a, b) => a.time - b.time || (a.slot ?? 0) - (b.slot ?? 0))) {
    if (seen.has(t.signature) || !(t.units > 0) || !(t.sol >= 0)) continue;
    seen.add(t.signature);
    const fee = feeSeen.has(t.signature) ? 0 : t.networkFeeSol;
    feeSeen.add(t.signature);
    out.push({ signature: t.signature, side: t.side, tokens: t.units / scale, sol: t.sol, priceSol: t.sol / (t.units / scale), time: t.time });
    if (t.side === "buy") {
      lots.push({ units: t.units, cost: t.sol + fee });
      bought += t.sol + fee;
      first ??= t.time;
    } else {
      let remaining = t.units, cost = 0;
      while (remaining > 1e-6 && lots.length) {
        const lot = lots[0], used = Math.min(remaining, lot.units), basis = (lot.cost * used) / lot.units;
        cost += basis; lot.units -= used; lot.cost -= basis; remaining -= used;
        if (lot.units <= 1e-6) lots.shift();
      }
      if (remaining > 1e-6) complete = false;
      realized += t.sol - fee - cost;
    }
  }
  const units = lots.reduce((s, l) => s + l.units, 0);
  const costBasis = lots.reduce((s, l) => s + l.cost, 0);
  const tokens = units / scale;
  const value = units * pricePerUnit;
  const unrealized = value - costBasis;
  const pnl = realized + unrealized;
  return {
    tokens, costBasisSol: costBasis, avgEntrySol: tokens > 0 ? costBasis / tokens : null,
    priceSol: pricePerUnit * scale, valueSol: value, unrealizedSol: unrealized, realizedSol: realized, pnlSol: pnl,
    roiPct: bought > 0 ? (pnl / bought) * 100 : null, firstBuyTime: first, trades: out.reverse(), complete,
  };
}
