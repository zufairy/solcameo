import { v } from "convex/values";
export const calloutTradeV = v.object({
  wallet: v.string(), mint: v.string(), name: v.string(), ticker: v.string(), imageUrl: v.string(),
  signature: v.string(), side: v.union(v.literal("buy"), v.literal("sell")), amountSol: v.number(), time: v.number(),
  pnlSol: v.number(), realizedSol: v.number(), unrealizedSol: v.number(), network: v.union(v.literal("mainnet"), v.literal("devnet")),
});
