export type CalloutTrade = {
  wallet: string; mint: string; name: string; ticker: string; imageUrl: string;
  signature: string; side: "buy" | "sell"; amountSol: number; time: number;
  pnlSol: number; realizedSol: number; unrealizedSol: number;
  network: "mainnet" | "devnet";
};
/** Signed profit/loss; in dollars when a live SOL price is given, otherwise in SOL. */
export function formatTradeSol(value?: number, usdRate?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "−";
  if (usdRate && usdRate > 0) return `${sign}$${Math.abs(value * usdRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${sign}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`;
}
export function tradeCallText(trade: CalloutTrade) {
  return `${trade.side === "buy" ? "Bought" : "Sold"} $${trade.ticker.toUpperCase()} for ${trade.amountSol.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL. Position P&L: ${formatTradeSol(trade.pnlSol)}.`;
}
