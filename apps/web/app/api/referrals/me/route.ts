import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireProvenWallet } from "@/lib/server/solstarRoute";
import { holdingOf, platformToken } from "@/lib/server/referrals";
import { PAYOUT_MIN_USDC, REFERRAL_TIERS } from "@/lib/referrals/program";

export const runtime = "nodejs";
export const maxDuration = 20;

/** The signed-in wallet's referral code, earnings and SOLCAMEO holding (read on-chain), with the tier it unlocks. */
export async function GET(req: NextRequest) {
  const who = await requireProvenWallet(req);
  if ("res" in who) return who.res;
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  try {
    await convex.mutation(api.referrals.ensureCode, { wallet: who.wallet, authSecret: secret });
    const [mine, holding, token] = await Promise.all([convex.query(api.referrals.mine, { wallet: who.wallet, authSecret: secret }), holdingOf(who.wallet), platformToken()]);
    const next = REFERRAL_TIERS.find((t) => holding.valueUsd < t.minUsd) ?? null;
    return NextResponse.json({
      wallet: who.wallet, ...mine,
      holding: { tokens: holding.tokens, valueUsd: holding.valueUsd, priceKnown: holding.priceKnown, tier: holding.tier },
      nextTier: next, token: token ? { mint: token.mint, characterId: token.characterId, priceUsd: token.priceUsd } : null,
      payoutMinUsdc: PAYOUT_MIN_USDC,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 120) : "unavailable" }, { status: 502 });
  }
}
