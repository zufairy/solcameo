import { NextRequest, NextResponse } from "next/server";
import { getProfile, isConfigured, UPLOAD_POST_PLATFORMS, resolveUsername } from "@/lib/server/uploadPost";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// Returns which social platforms THIS agent's profile has connected. Each agent
// has its own upload-post profile (resolveUsername), so connections are isolated
// per agent. Also auto-provisions the white-label profile on first view so the
// user never needs an upload-post login.
export async function GET(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  const platforms = UPLOAD_POST_PLATFORMS.map((p) => ({ id: p.id, label: p.label }));

  if (!isConfigured()) {
    return NextResponse.json({ ok: true, configured: false, connected: {}, platforms });
  }

  const mintAddress = (req.nextUrl.searchParams.get("username") ?? "").trim();
  const username = resolveUsername(mintAddress);
  if (!username) {
    return NextResponse.json({ ok: false, error: "username is required" }, { status: 400 });
  }

  // Ownership: the username query param is the agent's public mintAddress, so
  // verify the caller owns this agent before exposing/provisioning its profile.
  // This gate must fail CLOSED — if Convex isn't configured we cannot resolve the
  // owner, so deny rather than skip the check. No-ops for legacy/pre-mint agents
  // (unset creatorWallet); a query error (bad secret) throws and denies (it
  // propagates before the getProfile/ensureProfile side-effects below).
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  try {
    // READ-ONLY status. Do NOT auto-create the profile here — that silently burned
    // an upload-post profile slot for EVERY agent whose Posting tab was opened, even
    // ones that never connected a social (the root cause of slot exhaustion). The
    // profile is created lazily on the actual CONNECT (generateConnectUrl →
    // ensureProfile), so a never-connected agent costs zero slots.
    const prof = await getProfile(username);
    // Cache the connected platform ids on the agent row so the public /agents
    // marketplace can show a connected-accounts overlay per card WITHOUT calling
    // this owner-gated route per agent. Best-effort — never fail the status read.
    const connectedIds = Object.entries(prof.connected)
      .filter(([, v]) => v != null)
      .map(([id]) => id);
    const accounts = Object.fromEntries(Object.entries(prof.connected)
      .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1] != null)
      .map(([id, account]) => [id, {
        ...(account.id ? { id: account.id } : {}),
        ...(account.handle ? { handle: account.handle } : {}),
        ...(account.displayName ? { displayName: account.displayName } : {}),
      }]));
    void convex
      .mutation(api.influencers.setConnectedPlatforms, { mintAddress, platforms: connectedIds, accounts, authSecret: secret })
      .catch(() => { /* cache write is best-effort; the status read must still succeed */ });
    return NextResponse.json({ ok: true, configured: true, exists: prof.exists, connected: prof.connected, platforms });
  } catch (err) {
    return NextResponse.json(
      { ok: false, configured: true, error: err instanceof Error ? err.message : "status failed", platforms },
      { status: 502 },
    );
  }
}
