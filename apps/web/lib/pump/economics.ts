import { z } from "zod";
export const PLATFORM_BPS = 1000;
export const launchOptionsSchema = z.object({
  pair: z.enum(["SOL", "USDC", "CUSTOM"]).default("SOL"),
  customMint: z.string().max(44).default(""),
  rewards: z.enum(["creator", "holders"]).default("creator"),
  aiBps: z.number().int().min(0).max(9000).default(3500),
  operationsWallet: z.string().max(44).default(""),
  postingBudgetUsdc: z.number().min(0).max(1000).refine(n => Number.isInteger(n * 100), "Use cents").default(0),
});
export type LaunchOptions = z.infer<typeof launchOptionsSchema>;
export const DEFAULT_LAUNCH: LaunchOptions = launchOptionsSchema.parse({});
/** Splits CREATOR rewards, never trade principal or Pump's protocol/LP fees. */
export function rewardSplit(options: LaunchOptions) {
  return options.rewards === "holders" ? { platform: 0, ai: 0, creator: 0, holders: 10000 } : { platform: PLATFORM_BPS, ai: options.aiBps, creator: 10000 - PLATFORM_BPS - options.aiBps, holders: 0 };
}
export function revenueExample(options: LaunchOptions, earned = 100) {
  const split = rewardSplit(options);
  return Object.fromEntries(Object.entries(split).map(([key, bps]) => [key, earned * bps / 10000]));
}
