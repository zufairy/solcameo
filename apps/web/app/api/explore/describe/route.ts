import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { publicPortrait, requireWalletPayment, roundUsd, walletFail } from "@/lib/server/walletPaidGeneration";
import { normalizeImageForKie } from "@/lib/server/imageForKie";
import { kickoffVideoRender } from "@/lib/server/kickoffVideoRender";
import { getVideoEngine, selectableVideoEngines, videoCostForLength, videoLengthOptions } from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { aspectFor, type VideoAspect } from "@/lib/builder/videoAspects";
import { requireAuth } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u);

/**
 * Explore "Describe your video" for anyone the user does not own an agent for: no influencer at all (they upload a
 * reference image), or any public influencer ("cameo": that influencer's portrait is the reference). The prompt is
 * rendered exactly as typed (no persona, no storyboard, no overlays) and the user pays Solcameo directly from their own
 * wallet: the first call answers 402 with the exact price, the client sends the USDC, and the second call carries the
 * transfer signature. One payment buys one video; a render that failed can be started again on the same payment.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return walletFail("Invalid body", 400);

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 2000) return walletFail("Describe the video in up to 2,000 characters.", 400);
  // The picture: a public influencer's portrait (read here, never trusted from the client), else the user's own upload.
  let reference: string | null = null;
  let who = "";
  if (typeof body.cameoMint === "string" && body.cameoMint) {
    const portrait = await publicPortrait(body.cameoMint);
    if (!portrait) return walletFail("That influencer has no portrait to use yet.", 400);
    reference = portrait.imageUrl; who = portrait.name;
  } else if (https(body.referenceImageUrl)) reference = body.referenceImageUrl;
  if (!reference) return walletFail("Add a reference image: a face, product or scene to build the video from.", 400);
  const engine = selectableVideoEngines().find((e) => e.id === body.videoEngine);
  if (!engine) return walletFail("Pick a video engine.", 400);
  const spec = KIE_VIDEO_PRICING[engine.id];
  const quality = (spec ? (spec.qualities.includes(body.quality as VideoQuality) ? body.quality : spec.defaultQuality) : undefined) as VideoQuality | undefined;
  const lengths = videoLengthOptions(engine.id);
  const seconds = lengths.includes(Number(body.seconds)) ? Number(body.seconds) : lengths[0];
  const aspect = aspectFor(engine.id, (typeof body.aspect === "string" ? body.aspect : "9:16") as VideoAspect);
  // The server prices it: provider cost plus the Solcameo fee, no storyboard image.
  const owed = roundUsd(videoCostForLength(getVideoEngine(engine.id), seconds, quality));

  const paid = await requireWalletPayment(req, { owed, signature: body.paymentSignature, payer: body.payer });
  if ("error" in paid) return paid.error;
  const { convex, secret, account, signature, payer, claim } = paid;
  // The same payment again: hand back its render, unless that render failed, in which case run it again for free.
  if (claim.kind === "existing" && claim.taskId) {
    const status = (await convex.query(api.agentTasks.generationStatus, { ids: [claim.taskId as Id<"agentTasks">] }).catch(() => null)) as Record<string, { status: string }> | null;
    if (status?.[claim.taskId]?.status !== "failed") return NextResponse.json({ taskId: claim.taskId, duplicate: true });
  }

  try {
    // The provider can only fetch public .png/.jpg links, so the picture is re-hosted when it needs it.
    const avatarUrl = await normalizeImageForKie(reference);
    if (!avatarUrl) throw new Error("reference image could not be prepared");
    const sessionId = `describe:${account}`;
    const taskId = (await convex.mutation(api.agentTasks.create, {
      authSecret: secret, sessionId, type: "create_video", title: `${who ? `${who}: ` : "Video: "}${prompt.slice(0, 60)}`, triggeredBy: "explore",
      input: JSON.stringify({ topic: prompt, userPaid: true, payerWallet: payer, ...(typeof body.cameoMint === "string" && body.cameoMint ? { cameoMint: body.cameoMint } : {}) }),
    })) as Id<"agentTasks">;
    // The user already paid, so the task is marked prepaid: it bills nothing further and a failure voids nothing on an agent tab.
    await convex.mutation(api.agentTasks.markPrepaid, { authSecret: secret, id: taskId, usdc: owed, runId: `describe:${signature}` });
    await convex.mutation(api.agentTasks.start, { authSecret: secret, id: taskId });
    await convex.mutation(api.describeVideo.attach, { authSecret: secret, txSignature: signature, taskId });
    await kickoffVideoRender({
      convex, origin: req.nextUrl.origin, taskId, mintAddress: "", sessionId, kieModel: engine.kieModel,
      renderArgs: {
        agentName: "the presenter", agentNiche: "general", noPersona: true, skipStoryboard: true,
        avatarUrl, referenceImageUrls: [], topic: prompt, hook: "", scriptText: prompt,
        durationSeconds: seconds, aspectRatio: aspect, ...(quality ? { resolution: quality } : {}), videoModel: engine.kieModel,
        renderCostUsdc: owed, overlays: {}, memories: [], knowledge: [], skills: [],
      },
      renderKey: `describe:${signature}:${Date.now()}`,
    });
    return NextResponse.json({ taskId, costUsd: owed });
  } catch (e) {
    // Paid but not started: the run stays unattached so support can retry or refund it (describeVideo.unfulfilled).
    console.error("[explore/describe] paid render did not start", signature, e instanceof Error ? e.message : e);
    return walletFail("Your payment went through but the video could not start. Try again with the same payment, or contact support.", 502, { code: "start_failed", paymentSignature: signature });
  }
}
