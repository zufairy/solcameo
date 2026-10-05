import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { resolveCampaignSources } from "@/lib/server/campaignSources";
import { isRestrictedCampaign } from "@/lib/restrictedCampaigns";
import { isAccountAllowedForRestricted } from "@/lib/server/restrictedCampaignsAuth";

/**
 * Resolve a Stage clipping campaign (Supabase `content_rewards`) into the
 * downloadable video URLs the in-app clipper canvas can seed a Source node from.
 *
 * This is the FRONT half of the orphaned content-reward pipeline: the handoff
 * agent ("Create with AI" → /builder?reward=<id>) calls this to learn what to
 * clip, seeds a Source node carrying the reward's `contentRewardId`, and the
 * cloud run then sets that id on the clip job so the existing Supabase
 * auto-submit branch fires.
 *
 * Returns ONLY PUBLIC campaign content (anon-Supabase reward fields + public
 * Drive folder listings) — no secrets leak — so it's gated as a simple authed
 * request: a valid internal-secret caller (cron/backfill) OR any logged-in user
 * (a valid Privy Bearer). NO wallet signature (SIWS) is required — there's
 * nothing ownable to scope here, and forcing an Ed25519 signature just to resolve
 * a picked campaign source popped a needless "please sign" prompt in the builder.
 *
 * Shape: { contentRewardId: string, title: string, videos: [{ url, name }] }.
 * `videos` may be empty (e.g. Drive folder with no GOOGLE_DRIVE_API_KEY) — the
 * caller still opens the canvas with an empty Source the user can fill.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(req: NextRequest, rewardId: string): Promise<NextResponse> {
  // Authenticate (a valid Privy Bearer OR the internal secret) but DON'T force a
  // wallet signature: this route returns only PUBLIC campaign content (the reward's
  // own brief + public Drive folder listings — no secrets, nothing ownable), so a
  // SIWS gate here just popped a needless Ed25519 prompt when picking a campaign
  // source. Genuine owner/money gates (save-state, set-pda) keep their SIWS check.
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  if (!rewardId) {
    return NextResponse.json({ error: "rewardId required" }, { status: 400 });
  }

  // RESTRICTED campaigns: only the single allowed account may resolve their
  // clippable sources. Internal (cron/backfill) callers stay allowed. Gate by
  // UUID BEFORE the (expensive) Drive listing so an unauthorized caller does no
  // work and — critically — never receives the video URLs.
  if (!auth.internal && isRestrictedCampaign({ contentRewardId: rewardId })) {
    const allowed = await isAccountAllowedForRestricted({
      email: auth.user?.email,
      wallet: auth.user?.walletAddress,
      wallets: auth.user?.walletAddresses,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const result = await resolveCampaignSources(rewardId);
  if (!result) {
    return NextResponse.json({ error: "content reward not found" }, { status: 404 });
  }

  // Defense-in-depth: also gate a row that matches a restricted campaign by TITLE
  // (e.g. re-created under a fresh UUID) — the title is only known post-resolve.
  if (
    !auth.internal &&
    isRestrictedCampaign({ contentRewardId: rewardId, title: result.title })
  ) {
    const allowed = await isAccountAllowedForRestricted({
      email: auth.user?.email,
      wallet: auth.user?.walletAddress,
      wallets: auth.user?.walletAddresses,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  const rewardId = (req.nextUrl.searchParams.get("rewardId") ?? "").trim();
  return handle(req, rewardId);
}

export async function POST(req: NextRequest) {
  let rewardId = (req.nextUrl.searchParams.get("rewardId") ?? "").trim();
  if (!rewardId) {
    try {
      const body = (await req.json()) as { rewardId?: string };
      rewardId = String(body.rewardId ?? "").trim();
    } catch {
      /* no body — fall through to the missing-id error */
    }
  }
  return handle(req, rewardId);
}
