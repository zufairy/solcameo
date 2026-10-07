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
/** The call text for a confirmed trade; amounts are in dollars when a live SOL price is given. */
export function tradeCallText(trade: CalloutTrade, usdRate?: number | null) {
  const amount = usdRate && usdRate > 0
    ? `$${(trade.amountSol * usdRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${trade.amountSol.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`;
  return `${trade.side === "buy" ? "Bought" : "Sold"} $${trade.ticker.toUpperCase()} for ${amount}. Position P&L: ${formatTradeSol(trade.pnlSol, usdRate)}.`;
}
