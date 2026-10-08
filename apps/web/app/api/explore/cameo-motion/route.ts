import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { HfError, getStatus, submitVideo } from "@/lib/server/higgsfield";
import { resolveReference } from "@/lib/server/exploreReferences";
import { withCastKey } from "@/lib/explore/castKey";
import { priceUsd } from "@/lib/server/exploreBilling";
import { getUserWallet, requireAuth } from "@/lib/server/requireAuth";
import { publicPortrait, requireWalletPayment, roundUsd, walletFail } from "@/lib/server/walletPaidGeneration";
import { ConvexHttpClient } from "convex/browser";
import { identityStills } from "@/lib/server/identityStill";
import { mergeCast } from "@/lib/server/mentionCast";

export const runtime = "nodejs";
export const maxDuration = 120;

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u);

/**
 * Explore "Generate" with an influencer the user does not own. The influencer's public portrait becomes the face in the
 * reference motion, and the user pays Solcameo straight from their own wallet (same price as an owner pays, fee
 * included). First call answers 402 with the exact price; the second carries the USDC transfer signature. The reference
 * video and the price come from our own library, never from the client. One payment buys one video.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return walletFail("Invalid body", 400);
  const portrait = typeof body.cameoMint === "string" && body.cameoMint ? await publicPortrait(body.cameoMint) : null;
  const uploads = (Array.isArray(body.extraImageUrls) ? body.extraImageUrls : []).filter(https);
  // An influencer's portrait, or (with no influencer) the viewer's own uploaded pictures.
  if (body.cameoMint && !portrait) return walletFail("That influencer has no portrait to use yet.", 400);
  if (!portrait && !uploads.length) return walletFail("Add at least one picture to use in the video.", 400);
  const ref = typeof body.referenceId === "string" ? await resolveReference(body.referenceId, body.referencePage) : null;
  if (!ref) return walletFail("This reference video is no longer available. Pick another one.", 400);
  const mode = body.mode === "object-swap" ? "object-swap" : "motion-transfer";
  const resolution = (["480p", "720p", "1080p"].includes(body.resolution as string) ? body.resolution : "720p") as "480p" | "720p" | "1080p";
  const owed = priceUsd(ref.duration, resolution);
  if (owed === null) return walletFail("This reference must be between 4 and 30 seconds.", 400);
  const price = roundUsd(owed);
  // The portrait first, then any extra characters the user tagged into the scene.
  const stills = await identityStills([...(portrait ? [portrait.imageUrl] : []), ...uploads].slice(0, 8));
  // Everyone tagged with @ in the prompt is checked against the real influencer, so each one's face is in the cast.
  const cast = await mergeCast({ prompt: typeof body.prompt === "string" ? body.prompt : "", castTokens: body.castTokens, imageUrls: stills, hints: body.castHints, excludeMint: typeof body.cameoMint === "string" ? body.cameoMint : undefined });
  const images = cast.imageUrls;
  const prompt = withCastKey(typeof body.prompt === "string" ? body.prompt : "", cast.castTokens, images.length, mode);

  const paid = await requireWalletPayment(req, { owed: price, signature: body.paymentSignature, payer: body.payer, viaSwap: body.payMethod === "swap" });
  if ("error" in paid) return paid.error;
  const { convex, secret, signature, claim } = paid;
  // The same payment again: give back its job, unless it failed, in which case start it again for free.
  let rerun = false;
  if (claim.kind === "existing" && claim.requestId) {
    const previous = await getStatus(claim.requestId).catch(() => null);
    if (!previous || !["failed", "nsfw", "canceled"].includes(previous.status)) return NextResponse.json({ requestId: claim.requestId, duplicate: true });
    rerun = true;
  }
  try {
    const requestId = await submitVideo(mode, { video_url: ref.videoUrl, image_urls: images, resolution, ...(prompt.trim() ? { prompt } : {}) }, `cameo:${signature}${rerun ? `:${Date.now()}` : ""}`.slice(0, 120));
    await convex.mutation(api.describeVideo.attachRequest, { authSecret: secret, txSignature: signature, requestId });
    return NextResponse.json({ requestId, costUsd: price });
  } catch (e) {
    console.error("[explore/cameo-motion] paid render did not start", signature, e instanceof Error ? e.message : e);
    if (e instanceof HfError) return walletFail(`${e.message} Your payment is kept: try again and it will be reused.`, e.status, { code: e.code, paymentSignature: signature });
    return walletFail("Your payment went through but the video could not start. Try again with the same payment, or contact support.", 502, { code: "start_failed", paymentSignature: signature });
  }
}

/** Progress and result of a cameo render. Only the person who paid for it can read it. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const url = process.env.NEXT_PUBLIC_CONVEX_URL, secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!id || !url || !secret) return walletFail("Not found", 404);
  const account = getUserWallet(auth.user) ?? `user:${auth.user.id}`;
  const mine = await new ConvexHttpClient(url).query(api.describeVideo.ownsRequest, { authSecret: secret, account, requestId: id }).catch(() => false);
  if (!mine) return walletFail("Not found", 404);
  try {
    const r = await getStatus(id);
    if (r.status !== "completed") return NextResponse.json({ status: r.status, error: r.error }, { headers: { "Cache-Control": "no-store" } });
    if (!r.videoUrl) return NextResponse.json({ status: "failed", error: "No video came back" });
    return NextResponse.json({ status: "completed", url: r.videoUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof HfError) return walletFail(e.message, e.status, { code: e.code });
    return walletFail("Status check failed", 502);
  }
}
