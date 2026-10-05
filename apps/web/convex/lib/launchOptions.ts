import { v } from "convex/values";
export const launchOptionsValidator = v.object({
  pair: v.union(v.literal("SOL"), v.literal("USDC"), v.literal("CUSTOM")), customMint: v.string(),
  rewards: v.union(v.literal("creator"), v.literal("holders")), aiBps: v.number(), operationsWallet: v.string(), postingBudgetUsdc: v.number(),
});
