/**
 * Fee maths for one Meteora Dynamic Bonding Curve pool, kept pure so it can be tested without an RPC.
 * Inputs are the raw u64 lamport values read from the pool account (as BN-like or numeric strings).
 *
 * On-chain meaning:
 *   metrics.totalProtocolQuoteFee  Meteora's cut of every trade fee (always taken first)
 *   metrics.totalTradingQuoteFee   what is left for the launch partner and the creator, summed since launch
 *   config.creatorTradingFeePercentage  creator's percentage of that remainder (the rest is the partner's)
 *   pool.creatorQuoteFee / partnerQuoteFee  accrued but NOT yet claimed by each side
 * So claimed = earned − still-unclaimed.
 */
import { CONTENT_PERCENT_OF_PARTNER, FEE_SPLIT } from "../meteora/feePolicy";
export type RawLamports = unknown;
const sol = (v: RawLamports) => Number(String(v ?? 0)) / 1e9;

export interface FeeBreakdown {
  feesSol: number; protocolSol: number;
  creatorEarnedSol: number; creatorClaimedSol: number; creatorUnclaimedSol: number;
  platformEarnedSol: number; platformClaimedSol: number; platformUnclaimedSol: number;
}

export function feeBreakdown(args: { totalTradingQuoteFee: RawLamports; totalProtocolQuoteFee: RawLamports; creatorTradingFeePercentage: unknown; creatorQuoteFee: RawLamports; partnerQuoteFee: RawLamports }): FeeBreakdown {
  const remainder = sol(args.totalTradingQuoteFee), protocolSol = sol(args.totalProtocolQuoteFee);
  const creatorShare = Math.min(1, Math.max(0, Number(args.creatorTradingFeePercentage ?? 0) / 100));
  const creatorEarnedSol = remainder * creatorShare, platformEarnedSol = remainder - creatorEarnedSol;
  const creatorUnclaimedSol = Math.min(creatorEarnedSol, sol(args.creatorQuoteFee));
  const platformUnclaimedSol = Math.min(platformEarnedSol, sol(args.partnerQuoteFee));
  return {
    feesSol: remainder + protocolSol, protocolSol,
    creatorEarnedSol, creatorUnclaimedSol, creatorClaimedSol: creatorEarnedSol - creatorUnclaimedSol,
    platformEarnedSol, platformUnclaimedSol, platformClaimedSol: platformEarnedSol - platformUnclaimedSol,
  };
}

/** The published policy as fractions of every trading fee: Meteora 20%, creator 40%, platform 30%, content 10%. */
export const POLICY_SPLIT = FEE_SPLIT;
export type SplitKey = keyof typeof POLICY_SPLIT;

/**
 * Four-way split for display. Meteora and the creator are read on-chain; the partner's remainder is divided
 * content/platform by the policy ratio (the chain only knows one partner wallet). Falls back to the policy
 * when no fee has been collected yet, so the explainer is never empty.
 */
export function splitShares(totals: { creatorEarnedSol: number; platformEarnedSol: number; protocolSol: number }): { shares: Record<SplitKey, number>; live: boolean } {
  const total = totals.creatorEarnedSol + totals.platformEarnedSol + totals.protocolSol;
  if (!(total > 0)) return { shares: { ...POLICY_SPLIT }, live: false };
  const partner = totals.platformEarnedSol / total;
  return { live: true, shares: { creator: totals.creatorEarnedSol / total, content: partner * (CONTENT_PERCENT_OF_PARTNER / 100), platform: partner * (1 - CONTENT_PERCENT_OF_PARTNER / 100), meteora: totals.protocolSol / total } };
}
