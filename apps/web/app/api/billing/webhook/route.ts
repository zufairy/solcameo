import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getStripe, shouldCreditCheckoutSession } from "@/lib/server/stripeClient";
import type Stripe from "stripe";

export const runtime = "nodejs"; // Stripe signature verification needs the raw body + Node crypto.

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[billing/webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const convex = new ConvexHttpClient(CONVEX_URL);
  const authSecret = process.env.INTERNAL_CRON_SECRET ?? "";

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const ownerWallet = session.metadata?.ownerWallet;
      const credits = Number(session.metadata?.credits ?? 0);
      // Skips subscription sessions (invoice.paid owns those grants — crediting
      // both double-granted the first month) and any session Stripe has not
      // actually collected on. See shouldCreditCheckoutSession.
      if (ownerWallet && credits > 0 && shouldCreditCheckoutSession(session)) {
        await convex.mutation(api.userCredits.creditFromWebhook, {
          ownerWallet, deltaCredits: credits, kind: "purchase", stripeEventId: event.id, authSecret,
        });
      }
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      // Subscription metadata (set via `subscription_data.metadata` at checkout)
      // is snapshotted onto the invoice under `parent.subscription_details` in the
      // pinned API version — the older top-level `invoice.subscription_details`
      // shape no longer exists (it didn't even typecheck) and `invoice.metadata`
      // is the INVOICE's own metadata, which we never set. Reading only those
      // meant a subscription grant silently found no ownerWallet and credited
      // NOTHING — which now matters doubly, since invoice.paid is the ONE path
      // that grants subscription credits. Legacy shape kept as a fallback.
      const legacy = (invoice as unknown as { subscription_details?: { metadata?: Record<string, string> | null } }).subscription_details;
      const subMeta = invoice.parent?.subscription_details?.metadata ?? legacy?.metadata ?? null;
      if (subMeta?.addon === "tiktok" && subMeta.mintAddress && subMeta.ownerWallet) {
        // One paid month per invoice. Idempotent on the event id, so Stripe retries are safe.
        await convex.mutation(api.agentAddons.activateFromWebhook, { mintAddress: subMeta.mintAddress, addon: "tiktok", ownerWallet: subMeta.ownerWallet, days: 31, stripeEventId: event.id, authSecret });
        return NextResponse.json({ received: true });
      }
      const ownerWallet = subMeta?.ownerWallet ?? invoice.metadata?.ownerWallet;
      const credits = Number(subMeta?.credits ?? invoice.metadata?.credits ?? 0);
      if (ownerWallet && credits > 0) {
        await convex.mutation(api.userCredits.creditFromWebhook, {
          ownerWallet, deltaCredits: credits, kind: "subscription_grant", stripeEventId: event.id, authSecret,
        });
      }
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[billing/webhook]", err);
    // Non-2xx tells Stripe to retry — safe, since userCredits.credit is
    // idempotent on stripeEventId.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
