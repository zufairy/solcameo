import { NextRequest, NextResponse } from "next/server";
import { deleteProfile, isConfigured, NotConfiguredError, resolveUsername } from "@/lib/server/uploadPost";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// Resets this agent's social connections by deleting its upload-post profile
// (removes ALL connected accounts at once — upload-post has no single-account
// disconnect API). The profile is re-provisioned lazily on the next status view.
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "Social posting isn't configured yet (UPLOAD_POST_API_KEY missing)." },
      { status: 503 },
    );
  }

  let body: { username?: string };
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
  // caller owns this agent before deleting its profile (destructive — removes ALL
  // connected accounts). This gate must fail CLOSED — if Convex isn't configured we
  // cannot resolve the owner, so deny rather than skip the check. No-ops for
  // legacy/pre-mint agents (unset creatorWallet); a query error (bad secret) throws
  // and denies (it propagates before the deleteProfile side-effect below).
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
    const res = await deleteProfile(username);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error ?? "Reset failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return NextResponse.json({ ok: false, configured: false, error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Reset failed" },
      { status: 502 },
    );
  }
}
