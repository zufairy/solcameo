export type CalloutTrade = {
  wallet: string; mint: string; name: string; ticker: string; imageUrl: string;
  signature: string; side: "buy" | "sell"; amountSol: number; time: number;
  pnlSol: number; realizedSol: number; unrealizedSol: number;
  network: "mainnet" | "devnet";
};
export function formatTradeSol(value?: number) {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`;
}
export function tradeCallText(trade: CalloutTrade) {
  return `${trade.side === "buy" ? "Bought" : "Sold"} $${trade.ticker.toUpperCase()} for ${trade.amountSol.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL. Position P&L: ${formatTradeSol(trade.pnlSol)}.`;
}
