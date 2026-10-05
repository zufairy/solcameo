import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { resolveUsername } from "@/lib/server/uploadPost";
import { unseal, xToken, saveX, xDb } from "@/lib/server/xApi";
export async function GET(req: NextRequest) {
  let message =
    "X connected. You can close this window and return to your agent.";
  let status = 200;
  let returnTo: string | undefined;
  try {
    const session = unseal<{
      state: string;
      verifier: string;
      mintAddress: string;
      owner: string;
      returnTo?: string;
      expires: number;
    }>(req.cookies.get("x_oauth")?.value ?? "");
    returnTo = session.returnTo;
    if (
      session.expires < Date.now() ||
      req.nextUrl.searchParams.get("state") !== session.state
    )
      throw new Error("X connection expired. Start again from agent settings.");
    const code = req.nextUrl.searchParams.get("code");
    if (!code || req.nextUrl.searchParams.has("error"))
      throw new Error("X authorization was cancelled.");
    const agent = await xDb().query(api.influencers.getByMintServer, {
      mintAddress: session.mintAddress,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    if (!agent || agent.creatorWallet !== session.owner)
      throw new Error("Agent ownership changed. Start again.");
    const t = await xToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.X_REDIRECT_URI!,
      code_verifier: session.verifier,
    });
    if (!t.refresh_token || !String(t.scope).split(" ").includes("tweet.write"))
      throw new Error("X must authorize posting and offline access.");
    const res = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: { Authorization: `Bearer ${t.access_token}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    const user = (await res.json()).data;
    if (!res.ok || !user?.id)
      throw new Error("Unable to verify the connected X account.");
    await saveX(resolveUsername(session.mintAddress), {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expiresAt: Date.now() + t.expires_in * 1000,
      automatedPostingConsentAt: Date.now(),
      id: user.id,
      handle: user.username,
      displayName: user.name,
      ...(user.profile_image_url ? { image: user.profile_image_url } : {}),
    });
  } catch (e) {
    message = e instanceof Error ? e.message : "X connection failed";
    status = 400;
  }
  // Full-page flow: send the user back to where they started with the outcome.
  const back =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? new URL(returnTo, req.nextUrl.origin)
      : null;
  if (back) {
    back.searchParams.set("x_connect", status === 200 ? "ok" : "error");
    if (status !== 200) back.searchParams.set("x_message", message.slice(0, 200));
  }
  const response = back
    ? NextResponse.redirect(back, { headers: { "Cache-Control": "no-store" } })
    : new NextResponse(message, {
        status,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
  response.cookies.delete({ name: "x_oauth", path: "/api/social/x" });
  return response;
}
