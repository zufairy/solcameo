import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import {
  getStripe,
  CREDIT_PACKS,
  type CreditPackId,
  SUBSCRIPTION_TIERS,
  type SubscriptionTierId,
} from "@/lib/server/stripeClient";

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
  const { pack, tier, addon, mintAddress, returnPath } = body as { pack?: string; tier?: string; addon?: string; mintAddress?: string; returnPath?: string };
  if (addon !== undefined) return addonCheckout(req, ownerWallet, addon, mintAddress, returnPath);
  if (!pack && !tier) {
    return NextResponse.json({ error: "pack or tier required" }, { status: 400 });
  }
  if (pack && !(pack in CREDIT_PACKS)) {
    return NextResponse.json({ error: `pack must be one of: ${Object.keys(CREDIT_PACKS).join(", ")}` }, { status: 400 });
  }
  if (tier && !(tier in SUBSCRIPTION_TIERS)) {
    return NextResponse.json({ error: `tier must be one of: ${Object.keys(SUBSCRIPTION_TIERS).join(", ")}` }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;

  try {
    const stripe = getStripe();
    let session;
    if (tier) {
      const t = SUBSCRIPTION_TIERS[tier as SubscriptionTierId];
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [t.stripePriceId
          ? { price: t.stripePriceId, quantity: 1 }
          : {
              price_data: {
                currency: "usd",
                unit_amount: t.usd * 100,
                recurring: { interval: "month" },
                product_data: { name: `Vello ${tier[0].toUpperCase()}${tier.slice(1)}` },
              },
              quantity: 1,
            }],
        subscription_data: { metadata: { ownerWallet, credits: String(t.creditsPerMonth), tier } },
        metadata: { ownerWallet, credits: String(t.creditsPerMonth), tier, kind: "subscription" },
        success_url: `${appUrl}/billing?checkout=success`,
        cancel_url: `${appUrl}/billing?checkout=cancelled`,
      });
    } else {
      const { usd, credits } = CREDIT_PACKS[pack as CreditPackId];
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: usd * 100,
            product_data: { name: `${credits.toLocaleString()} Vello credits` },
          },
          quantity: 1,
        }],
        metadata: { ownerWallet, credits: String(credits), kind: "purchase" },
        success_url: `${appUrl}/billing?checkout=success`,
        cancel_url: `${appUrl}/billing?checkout=cancelled`,
      });
    }
    if (!session.url) return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Log the Stripe detail SERVER-SIDE only. Stripe's messages name price ids,
    // account state and API internals — never echo them to the browser.
    console.error("[billing/checkout]", err);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
}

/** TikTok posting add-on: $10 USD per month for one agent. Entitlement is granted by the invoice.paid webhook. */
async function addonCheckout(req: NextRequest, ownerWallet: string, addon: string, mintAddress: string | undefined, returnPath: string | undefined) {
  if (addon !== "tiktok") return NextResponse.json({ error: "unknown addon" }, { status: 400 });
  if (!mintAddress || mintAddress.length > 64) return NextResponse.json({ error: "mintAddress required" }, { status: 400 });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;
  // Same-origin relative return path only, so the success redirect can never leave the app.
  const back = typeof returnPath === "string" && returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/builder";
  const sep = back.includes("?") ? "&" : "?";
  try {
    const stripe = getStripe();
    const meta = { ownerWallet, addon: "tiktok", mintAddress, kind: "addon" };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price_data: { currency: "usd", unit_amount: 1000, recurring: { interval: "month" }, product_data: { name: "TikTok posting for one agent (monthly)" } }, quantity: 1 }],
      subscription_data: { metadata: meta },
      metadata: meta,
      success_url: `${appUrl}${back}${sep}tiktok=activated`,
      cancel_url: `${appUrl}${back}${sep}tiktok=cancelled`,
    });
    if (!session.url) return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout addon]", err);
    return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
  }
}
