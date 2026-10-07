import { NextResponse } from "next/server";
import { platformToken } from "@/lib/server/referrals";
import { MARGIN_SHARE, PAYOUT_MIN_USDC, REFERRAL_MONTHS, REFERRAL_TIERS } from "@/lib/referrals/program";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Public: the program's rules and SOLCAMEO's live price, so the page can show what a tier costs to unlock. */
export async function GET() {
  const token = await platformToken();
  return NextResponse.json({
    tiers: REFERRAL_TIERS, marginShare: MARGIN_SHARE, months: REFERRAL_MONTHS, payoutMinUsdc: PAYOUT_MIN_USDC,
    token: token ? { mint: token.mint, characterId: token.characterId, priceUsd: token.priceUsd } : null,
  }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
}
