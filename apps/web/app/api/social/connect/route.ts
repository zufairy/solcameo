import { NextRequest, NextResponse } from "next/server";
import { generateConnectUrl, getApiKey, LimitReachedError, NotConfiguredError, RateLimitError, resolveUsername } from "@/lib/server/uploadPost";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// Returns a hosted upload-post connect URL the user opens to link a social account.
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!getApiKey()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "Social posting isn't configured yet (UPLOAD_POST_API_KEY missing)." },
      { status: 503 },
    );
  }

  let body: { username?: string; platforms?: string[]; redirectUrl?: string; logoImage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const mintAddress = (body.username ?? "").trim();
  const username = resolveUsername(mintAddress);
  if (!username) {
    return NextResponse.json({ ok: false, error: "username is required" }, { status: 400 });
  }

  // Ownership: body.username is the agent's public mintAddress, so verify the
  // caller owns this agent before issuing a connect URL for its profile. This gate
  // must fail CLOSED — if Convex isn't configured we cannot resolve the owner, so
  // deny rather than skip the check. No-ops for legacy/pre-mint agents (unset
  // creatorWallet); a query error (bad secret) throws and denies (it propagates
  // before the generateConnectUrl side-effect below).
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent ?? undefined);
    if (err) return err;
  }

  // TikTok is a paid add-on. The hosted connect link is not platform specific, so the
  // gate applies whenever the client asks to connect TikTok.
  if (body.platforms?.includes("tiktok") && !auth.internal) {
    const active = await convex.query(api.agentAddons.isActiveServer, { mintAddress, addon: "tiktok", authSecret: secret });
    if (!active) return NextResponse.json({ ok: false, error: "TikTok posting needs the $10/month add-on. Activate it first.", needsActivation: true }, { status: 402 });
  }

  try {
    const url = await generateConnectUrl(username, {
      // Generate one reusable hosted connect URL for the profile. Filtering by
      // a single platform creates a different Upload-Post JWT for every click,
      // which quickly trips their connect-link rate limit and strands the UI in
      // a cooldown loop.
      redirectUrl: body.redirectUrl,
      logoImage: body.logoImage,
      title: "Connect your socials to Vello",
      description: "Link an account so your AI agent can post on your behalf.",
    });
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return NextResponse.json({ ok: false, configured: false, error: err.message }, { status: 503 });
    }
    if (err instanceof LimitReachedError) {
      // Plan cap hit — a clear, actionable message + flag, not a raw 502.
      return NextResponse.json({ ok: false, limitReached: true, error: err.message }, { status: 409 });
    }
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { ok: false, rateLimited: true, retryAfterSeconds: err.retryAfterSeconds, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to start connect flow" },
      { status: 502 },
    );
  }
}
