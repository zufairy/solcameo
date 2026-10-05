/**
 * Single source of truth for credit pricing — pure data, no server SDK
 * imports, safe for CLIENT components (the marketing /pricing page, the
 * TopUpModal) as well as server routes/webhooks. lib/server/stripeClient.ts
 * re-exports these and layers Stripe price ids on top. Never import
 * lib/server/stripeClient.ts from a client component — it pulls in the
 * (Node-only) `stripe` package.
 */

/** Fixed one-time credit packs. 1 credit = $0.01. Bonus credits at higher
 *  tiers per the design spec ("small bonus at higher tiers"). */
export const CREDIT_PACKS = {
  "10": { usd: 10, credits: 1000 },
  "25": { usd: 25, credits: 2500 },
  "50": { usd: 50, credits: 5100 },   // +2% bonus
  "100": { usd: 100, credits: 10300 }, // +3% bonus
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

/** Three paid recurring tiers; Free has no Stripe checkout. The pricing page
 * reads these allowances directly so checkout and marketing cannot drift. */
export const SUBSCRIPTION_TIERS = {
  starter: { usd: 9, creditsPerMonth: 900 },
  creator: { usd: 29, creditsPerMonth: 2900 },
  growth: { usd: 59, creditsPerMonth: 6000 },
} as const;

export type SubscriptionTierId = keyof typeof SUBSCRIPTION_TIERS;
