/** Platform fee on every deposit into an agent wallet: 3%, taken in the same transaction as the deposit. */
export const FUNDING_FEE_BPS = 300;

/**
 * Split a deposit (token base units) into the platform fee and what the agent receives. The fee rounds down, so the
 * two parts always add up to the deposit and the agent never receives less than 97%.
 */
export function splitFundingAmount(total: bigint, bps: number = FUNDING_FEE_BPS): { fee: bigint; net: bigint } {
  if (total <= 0n) throw new Error("amount_must_be_positive");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("invalid_fee_bps");
  const fee = (total * BigInt(bps)) / 10_000n;
  return { fee, net: total - fee };
}

/** Same split for a human amount (USDC dollars or SOL), for previews. */
export function previewFundingSplit(amount: number, bps: number = FUNDING_FEE_BPS): { fee: number; net: number } {
  if (!(amount > 0)) return { fee: 0, net: 0 };
  const fee = (amount * bps) / 10_000;
  return { fee, net: amount - fee };
}
