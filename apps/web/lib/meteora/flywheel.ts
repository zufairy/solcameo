/** Policy v1: Meteora 20%, creator 40%, content 20%, platform 20% of gross fees. */
export const FLYWHEEL_POLICY = {
  version: "sustainable-v1",
  creatorPercent: 50,
  partnerLpPercent: 50,
  contentPercentOfPartner: 50,
} as const;
/** Only split confirmed, collected partner proceeds. Rounding residue stays in ops. */
export function splitCollectedPartner(lamports: bigint) {
  if (lamports < 0n || lamports > 1n << 62n) throw new Error("invalid_amount");
  const content = lamports / 2n;
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
    protocol: total * 0.2,
    creator: total * (sustainable ? 0.4 : 0.8),
    content: sustainable ? total * 0.2 : 0,
    platform: sustainable ? total * 0.2 : 0,
  };
}
