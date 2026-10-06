/**
 * The one place the coin trading-fee policy lives. Every coin charges a flat 1.5% on each trade, and that fee is
 * split by these percentages of the gross fee. Meteora's 20% is fixed by the protocol; the rest is ours.
 *
 *   Meteora   20%  taken on-chain first
 *   Creator   40%  50% of what remains, set on-chain as creatorTradingFeePercentage
 *   Platform  30%  Solcameo operations
 *   Content   10%  the character's next videos
 *
 * Platform + content (40%) is the partner share the chain holds in one wallet, split off-chain in this ratio.
 */
export const TRADING_FEE_BPS = 150;
export const FEE_SPLIT_PERCENT = { meteora: 20, creator: 40, platform: 30, content: 10 } as const;

const rest = 100 - FEE_SPLIT_PERCENT.meteora;
/** On-chain creator share of the fee left after Meteora's cut (an integer, as the program requires). */
export const CREATOR_TRADING_FEE_PERCENTAGE = Math.round((FEE_SPLIT_PERCENT.creator / rest) * 100);
/** Share of the partner wallet's proceeds that funds content; the remainder is platform operations. */
export const CONTENT_PERCENT_OF_PARTNER = Math.round((FEE_SPLIT_PERCENT.content / (FEE_SPLIT_PERCENT.content + FEE_SPLIT_PERCENT.platform)) * 100);

/** Fractions of the gross fee, for charts and the live page. */
export const FEE_SPLIT = {
  creator: FEE_SPLIT_PERCENT.creator / 100, content: FEE_SPLIT_PERCENT.content / 100,
  platform: FEE_SPLIT_PERCENT.platform / 100, meteora: FEE_SPLIT_PERCENT.meteora / 100,
} as const;
export const TRADING_FEE_PERCENT_LABEL = `${TRADING_FEE_BPS / 100}%`;
