import Stripe from "stripe";
import { SUBSCRIPTION_TIERS as BASE_TIERS } from "@/lib/shared/creditPricing";

let client: Stripe | null = null;

/** Lazy singleton — mirrors the KIE_KEY/CONVEX_URL pattern used elsewhere in
 *  lib/server/*: read the env var at call time (not module load), so a route
 *  that never touches billing never throws on a missing key in dev. */
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  client = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  return client;
}

// Re-exported for existing callers (checkout/webhook routes) — the actual
// numbers live in lib/shared/creditPricing.ts, which client components
// (the /pricing page, TopUpModal) import directly instead of this file, since
// this file pulls in the Node-only `stripe` package.
export { CREDIT_PACKS, type CreditPackId } from "@/lib/shared/creditPricing";

/** Paid subscription tiers plus their Stripe price ids. The Free plan has no
 * checkout; Starter, Creator, and Growth match the live pricing page. */
export const SUBSCRIPTION_TIERS = {
  starter: { ...BASE_TIERS.starter, stripePriceId: process.env.STRIPE_PRICE_STARTER ?? "" },
  creator: { ...BASE_TIERS.creator, stripePriceId: process.env.STRIPE_PRICE_CREATOR ?? "" },
  growth: { ...BASE_TIERS.growth, stripePriceId: process.env.STRIPE_PRICE_GROWTH ?? "" },
} as const;

export type SubscriptionTierId = keyof typeof SUBSCRIPTION_TIERS;

/** Should a `checkout.session.completed` event grant credits?
 *
 *  NO for a SUBSCRIPTION session: Stripe fires BOTH `checkout.session.completed`
 *  and `invoice.paid` for the first billing period, under different event ids —
 *  the `stripeEventId` dedupe in userCredits.credit cannot see they are the same
 *  money, so crediting here double-granted the first month. `invoice.paid` owns
 *  every subscription grant, first period included.
 *
 *  NO unless `payment_status === "paid"`: an async payment method (or a
 *  `mode:"setup"` session) completes UNPAID, and crediting that hands out free
 *  credits for money Stripe has not collected.
 *
 *  Pure + exported so the money decision is unit-testable without standing up
 *  Stripe signature verification. */
export function shouldCreditCheckoutSession(session: {
  mode?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
}): boolean {
  const isSubscription = session.mode === "subscription" || session.metadata?.kind === "subscription";
  if (isSubscription) return false;
  return session.payment_status === "paid";
}
