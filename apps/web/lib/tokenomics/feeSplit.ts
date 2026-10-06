import { REVENUE_SPLIT } from "./platformToken";

/**
 * Split claimed trading fees (lamports): 40% operations and 30% treasury are sent out in the same transaction as the
 * claim; the remaining 30% stays in the platform wallet as the SOLCAMEO buyback budget. Treasury absorbs rounding so the
 * parts always add up to the claim.
 */
export function splitClaimedFees(lamports: bigint): { buyback: bigint; ops: bigint; treasury: bigint } {
  if (lamports < 0n) throw new Error("negative_fees");
  const ops = (lamports * BigInt(REVENUE_SPLIT.opsBps)) / 10_000n;
  const buyback = (lamports * BigInt(REVENUE_SPLIT.buybackBps)) / 10_000n;
  return { ops, buyback, treasury: lamports - ops - buyback };
}
