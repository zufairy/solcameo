import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { getStripe, SUBSCRIPTION_TIERS, type SubscriptionTierId } from "@/lib/server/stripeClient";

/** Escapes a value for Stripe's Search Query Language — the only special
 *  character that can appear inside a `'...'` string literal there is a
 *  backslash or single quote, both of which need escaping. Wallet addresses
 *  are base58 (no quotes possible) but this stays correct regardless. */
function searchLiteral(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function tierForPriceId(priceId: string | null | undefined): SubscriptionTierId | null {
  if (!priceId) return null;
  for (const [id, t] of Object.entries(SUBSCRIPTION_TIERS)) {
    if (t.stripePriceId && t.stripePriceId === priceId) return id as SubscriptionTierId;
  }
  return null;
}

function validTier(value: string | null | undefined): SubscriptionTierId | null {
  return value && value in SUBSCRIPTION_TIERS ? value as SubscriptionTierId : null;
}

/** The caller's own active Stripe subscription, if any — looked up by the
 *  `ownerWallet` metadata every subscription checkout stamps (see
 *  billing/checkout's `subscription_data.metadata`), via Stripe's Search API
 *  rather than a local table, since Stripe is the only source of truth for
 *  subscription state (no subscriptionId is persisted anywhere else). */
export async function GET(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (auth.internal) return NextResponse.json({ error: "user auth required" }, { status: 401 });
  const siwsError = requireSiwsSession(auth);
  if (siwsError) return siwsError;
  const ownerWallet = auth.provenWallet!;

  try {
    const stripe = getStripe();
    const result = await stripe.subscriptions.search({
      query: `status:'active' AND metadata['ownerWallet']:'${searchLiteral(ownerWallet)}'`,
      limit: 1,
    });
    const sub = result.data[0];
    if (!sub) return NextResponse.json({ subscription: null });

    const item = sub.items.data[0];
    return NextResponse.json({
      subscription: {
        id: sub.id,
        status: sub.status,
        tier: validTier(sub.metadata?.tier) ?? tierForPriceId(item?.price?.id),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: item?.current_period_end ? item.current_period_end * 1000 : null,
        amount: item?.price?.unit_amount ?? null,
        currency: item?.price?.currency ?? null,
      },
    });
  } catch (err) {
    console.error("[billing/subscription]", err);
    return NextResponse.json({ error: "Could not load subscription." }, { status: 500 });
  }
}
