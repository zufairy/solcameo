import { SUBSCRIPTION_TIERS, getStripe } from "./stripeClient";

/**
 * Is this owner wallet's account on a PAID subscription right now? Stripe is
 * the only source of truth for subscription state (no subscriptionId is
 * persisted anywhere else — see billing/subscription/route.ts, which this
 * mirrors). Used to gate paid-only features server-side (e.g. removing the
 * Vello watermark) so the decision can never be forged from the client the
 * way a plain stored boolean can.
 *
 * FAILS CLOSED: any Stripe error, missing STRIPE_SECRET_KEY, or empty wallet
 * is treated as "not paid" — a feature gate that silently opens on an outage
 * is worse than one that briefly denies a real subscriber (who can just
 * retry), especially for something brand/revenue-relevant like the watermark.
 *
 * Cached in-process for a few minutes per wallet: this gate runs on every
 * clip-config save AND is intended to run on the actual render path too,
 * where a batch can cut a dozen clips back to back — a live Stripe Search API
 * call per clip would add real latency for no benefit (a subscription
 * doesn't change mid-batch).
 */
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { value: boolean; at: number }>();

function searchLiteral(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function hasActiveSubscription(ownerWallet: string | undefined | null): Promise<boolean> {
  const wallet = ownerWallet?.trim();
  if (!wallet) return false;
  const hit = cache.get(wallet);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let value = false;
  try {
    const stripe = getStripe();
    const result = await stripe.subscriptions.search({
      query: `status:'active' AND metadata['ownerWallet']:'${searchLiteral(wallet)}'`,
      limit: 1,
    });
    value = result.data.length > 0;
  } catch (e) {
    console.warn("[subscriptionStatus] check failed, treating as free plan:", e instanceof Error ? e.message : e);
    value = false;
  }
  cache.set(wallet, { value, at: Date.now() });
  return value;
}

/** Test-only: clears the in-process cache between test cases. */
export function _resetSubscriptionStatusCache(): void {
  cache.clear();
  agentLimitCache.clear();
}

const agentLimitCache = new Map<string, { limit: number; at: number }>();
const PLAN_AGENT_LIMITS = { starter: 1, creator: 3, growth: 5 } as const;

/** Match the active-agent allowances on the pricing page; zero means free. */
export async function subscriptionAgentLimit(ownerWallet: string): Promise<number> {
  const hit = agentLimitCache.get(ownerWallet);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.limit;
  let limit = 0;
  try {
    const result = await getStripe().subscriptions.search({
      query: `status:'active' AND metadata['ownerWallet']:'${searchLiteral(ownerWallet)}'`, limit: 10,
    });
    for (const sub of result.data) {
      for (const [tier, config] of Object.entries(SUBSCRIPTION_TIERS)) {
        if (sub.metadata?.tier === tier || (config.stripePriceId && sub.items.data.some(item => item.price.id === config.stripePriceId))) {
          limit = Math.max(limit, PLAN_AGENT_LIMITS[tier as keyof typeof PLAN_AGENT_LIMITS]);
        }
      }
      // Legacy subscriptions with no recognized tier retain one active slot.
      limit = Math.max(limit, 1);
    }
  } catch {
    return 0; // Fail closed and allow an immediate retry after a transient error.
  }
  agentLimitCache.set(ownerWallet, { limit, at: Date.now() });
  return limit;
}
