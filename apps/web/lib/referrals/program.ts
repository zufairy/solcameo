import { RETAIL_MARKUP } from "@/lib/pricing/retail";

/**
 * The referral program's rules, in one place for the page, the calculator and the settlement hook.
 * Referrers earn a share of Solcameo's MARGIN on each payment a referred wallet settles, in USDC, only while they hold SOLCAMEO.
 * The share is deliberately generous: 50% of the margin to start, 60% and then 80% for bigger holders. It applies to referrals only.
 */
export const REFERRAL_TIERS = [
  { tier: 1, name: "Starter", minUsd: 5, rate: 0.50 },
  { tier: 2, name: "Builder", minUsd: 50, rate: 0.60 },
  { tier: 3, name: "Partner", minUsd: 500, rate: 0.80 },
] as const;

/** Solcameo's margin as a share of what a user pays: the markup on the provider cost (15/115, about 13%). */
export const MARGIN_SHARE = (RETAIL_MARKUP - 1) / RETAIL_MARKUP;
/** Attribution lasts a year from the referred wallet's first sign-in. */
export const REFERRAL_MONTHS = 12;
/** Earnings are paid automatically in USDC, on-chain, once this much has built up. */
export const PAYOUT_MIN_USDC = 5;
/** The biggest share on offer, and how much more it earns than the first tier. */
export const TOP_RATE = REFERRAL_TIERS[REFERRAL_TIERS.length - 1].rate;
export const TOP_VS_FIRST = TOP_RATE / REFERRAL_TIERS[0].rate;

export type ReferralTier = (typeof REFERRAL_TIERS)[number];

/** The tier a holding in dollars unlocks, or null below the first. */
export function tierFor(valueUsd: number): ReferralTier | null {
  let found: ReferralTier | null = null;
  for (const t of REFERRAL_TIERS) if (valueUsd >= t.minUsd) found = t;
  return found;
}

/** What a referrer earns from `spendUsd` of referred spend at `rate`. */
export const referralShare = (spendUsd: number, rate: number) => spendUsd * MARGIN_SHARE * rate;
