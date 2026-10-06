import { CONTENT_PERCENT_OF_PARTNER, CREATOR_TRADING_FEE_PERCENTAGE, FEE_SPLIT } from "./feePolicy";
/** Policy v1: Meteora 20%, creator 40%, platform 30%, content 10% of gross fees (see feePolicy.ts). */
export const FLYWHEEL_POLICY = {
  version: "sustainable-v1",
  creatorPercent: CREATOR_TRADING_FEE_PERCENTAGE,
  partnerLpPercent: 50,
  contentPercentOfPartner: CONTENT_PERCENT_OF_PARTNER,
} as const;
/** Only split confirmed, collected partner proceeds. Rounding residue stays in ops. */
export function splitCollectedPartner(lamports: bigint) {
  if (lamports < 0n || lamports > 1n << 62n) throw new Error("invalid_amount");
  const content = (lamports * BigInt(FLYWHEEL_POLICY.contentPercentOfPartner)) / 100n;
  return { content, ops: lamports - content };
}
export function feeExample(
  volume: number,
  feeBps: number,
  sustainable: boolean,
) {
  const total = (volume * feeBps) / 10000;
  return {
    total,
    protocol: total * FEE_SPLIT.meteora,
    creator: total * (sustainable ? FEE_SPLIT.creator : 1 - FEE_SPLIT.meteora),
    content: sustainable ? total * FEE_SPLIT.content : 0,
    platform: sustainable ? total * FEE_SPLIT.platform : 0,
  };
}
