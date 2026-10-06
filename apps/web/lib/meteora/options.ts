import { z } from "zod";
import { TRADING_FEE_BPS } from "./feePolicy";
export const dbcOptionsSchema = z
  .object({
    economy: z.enum(["creator-only", "sustainable-v1"]).default("creator-only"),
    shape: z.enum(["classic", "steady", "rocket", "whale"]).default("classic"),
    initialCapSol: z.number().min(0.1).max(1000).default(30),
    graduationCapSol: z.number().min(1).max(10000).default(250),
    /** Every coin charges the flat TRADING_FEE_BPS. Older tiers still parse so stored launches load, but are not offered. */
    feeBps: z
      .union([z.literal(25), z.literal(100), z.literal(150), z.literal(200)])
      .default(TRADING_FEE_BPS as 150),
    /** On-chain: Meteora fee scheduler. Fees start high and decay to `feeBps`, so snipers pay for speed. */
    antiSniper: z.boolean().default(true),
    antiSniperLevel: z.enum(["light", "standard", "strict"]).default("standard"),
    /** On-chain: Meteora volatility fee on the bonding curve and the graduated pool. */
    dynamicFee: z.boolean().default(false),
    /** Off-chain: after launch, switch the agent's heartbeat on so it makes and posts content by itself. */
    autopilot: z.boolean().default(true),
    autopilotCadence: z.enum(["every_4h", "every_12h", "daily"]).default("every_12h"),
  })
  .refine(
    (v) => v.graduationCapSol >= v.initialCapSol * 2,
    "Graduation cap must be at least twice the opening cap.",
  );
export type DbcOptions = z.infer<typeof dbcOptionsSchema>;
export const DEFAULT_DBC = dbcOptionsSchema.parse({
  economy: "sustainable-v1",
});

/** Launch-time fee schedule per strength. Periods divide the duration evenly (seconds) as the SDK requires. */
export const ANTI_SNIPER_LEVELS = {
  light: { startingFeeBps: 1500, numberOfPeriod: 6, totalDuration: 60 },
  standard: { startingFeeBps: 3000, numberOfPeriod: 18, totalDuration: 180 },
  strict: { startingFeeBps: 5000, numberOfPeriod: 30, totalDuration: 300 },
} as const;
