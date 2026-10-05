import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  requireInternalOrUserAuth,
  requireOwnerWithSiws,
} from "@/lib/server/requireAuth";
import { api } from "@/convex/_generated/api";
import { xConfigured, xDb, seal, pkce, X_SCOPES } from "@/lib/server/xApi";
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (auth.internal)
    return NextResponse.json(
      { ok: false, error: "User sign-in required" },
      { status: 401 },
    );
  if (!xConfigured())
    return NextResponse.json(
      {
        ok: false,
        error:
          "X connection is not configured. Add X OAuth credentials in the server settings.",
      },
      { status: 503 },
    );
  const body = await req.json().catch(() => null);
  if (body?.allowAutomatedPosting !== true)
    return NextResponse.json(
      { ok: false, error: "Consent to agent posting is required." },
      { status: 400 },
    );
  const mintAddress =
    typeof body?.username === "string" ? body.username.trim() : "";
  if (!mintAddress)
    return NextResponse.json(
      { ok: false, error: "Agent required" },
      { status: 400 },
    );
  const agent = await xDb().query(api.influencers.getByMintServer, {
    mintAddress,
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
  });
  if (!agent?.creatorWallet)
    return NextResponse.json(
      { ok: false, error: "Create an owned agent before connecting X." },
      { status: 403 },
    );
  const err = requireOwnerWithSiws(auth, agent);
  if (err) return err;
  // Return to the same-origin page that started the flow; never an arbitrary URL.
  let returnTo = "/";
  try {
    const target = new URL(String(body?.redirectUrl ?? ""), req.nextUrl.origin);
    if (target.origin === req.nextUrl.origin)
      returnTo = `${target.pathname}${target.search}`;
  } catch {
    /* keep default */
  }
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: process.env.X_REDIRECT_URI!,
    scope: X_SCOPES,
    state,
    code_challenge: pkce(verifier),
    code_challenge_method: "S256",
  }).toString();
  const res = NextResponse.json({ ok: true, url: url.toString() });
  res.cookies.set(
    "x_oauth",
    seal({
      state,
      verifier,
      mintAddress,
      owner: agent.creatorWallet,
      returnTo,
      expires: Date.now() + 600000,
    }),
    {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      maxAge: 600,
      path: "/api/social/x",
    },
  );
  return res;
}
