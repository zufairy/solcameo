import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { getStripe } from "@/lib/server/stripeClient";

/** Cancels (or un-cancels) the caller's own subscription — never trusts a
 *  client-supplied subscriptionId blindly: it's re-fetched from Stripe and
 *  its `ownerWallet` metadata (stamped at checkout) must match the caller's
 *  proven wallet before any mutation runs, same ownership check pattern as
 *  requireOwnerWithSiws elsewhere in this API. Cancels at period end (not
 *  immediately) so the caller keeps access they already paid for — standard
 *  SaaS "Cancel plan" behavior, reversible via `resume` until the period
 *  actually ends. */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (auth.internal) return NextResponse.json({ error: "user auth required" }, { status: 401 });
  const siwsError = requireSiwsSession(auth);
  if (siwsError) return siwsError;
  const ownerWallet = auth.provenWallet!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { subscriptionId, resume } = body as { subscriptionId?: string; resume?: boolean };
  if (!subscriptionId || typeof subscriptionId !== "string") {
    return NextResponse.json({ error: "subscriptionId required" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.metadata?.ownerWallet !== ownerWallet) {
      return NextResponse.json({ error: "Not your subscription." }, { status: 403 });
    }
    const updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: !resume });
    return NextResponse.json({ ok: true, cancelAtPeriodEnd: updated.cancel_at_period_end });
  } catch (err) {
    console.error("[billing/cancel]", err);
    return NextResponse.json({ error: "Could not update your subscription. Please try again." }, { status: 500 });
  }
}
