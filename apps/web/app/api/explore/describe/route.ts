import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getUserWallet, requireAuth, walletBelongsToUser } from "@/lib/server/requireAuth";
import { studioTreasury } from "@/lib/server/studioGenBilling";
import { normalizeImageForKie } from "@/lib/server/imageForKie";
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
import { getUsdcMint } from "@/lib/solana/network";
import { kickoffVideoRender } from "@/lib/server/kickoffVideoRender";
import { getVideoEngine, selectableVideoEngines, videoCostForLength, videoLengthOptions } from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { aspectFor, type VideoAspect } from "@/lib/builder/videoAspects";

export const runtime = "nodejs";
export const maxDuration = 60;

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u);
const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Explore "Describe your video" with no influencer. The prompt is rendered exactly as typed (no persona, no
 * storyboard, no overlays) from a reference image the user supplies, and the user pays for it directly:
 * the first call answers 402 with the exact price and the Solcameo wallet to pay, the client sends that USDC from the
 * user's wallet, and the second call carries the transfer signature. One payment buys one video; a render that failed
 * can be started again on the same payment.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Invalid body", 400);

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 2000) return fail("Describe the video in up to 2,000 characters.", 400);
  if (!https(body.referenceImageUrl)) return fail("Add a reference image: a face, product or scene to build the video from.", 400);
  const engine = selectableVideoEngines().find((e) => e.id === body.videoEngine);
  if (!engine) return fail("Pick a video engine.", 400);
  const spec = KIE_VIDEO_PRICING[engine.id];
  const quality = (spec ? (spec.qualities.includes(body.quality as VideoQuality) ? body.quality : spec.defaultQuality) : undefined) as VideoQuality | undefined;
  const lengths = videoLengthOptions(engine.id);
  const seconds = lengths.includes(Number(body.seconds)) ? Number(body.seconds) : lengths[0];
  const aspect = aspectFor(engine.id, (typeof body.aspect === "string" ? body.aspect : "9:16") as VideoAspect);
  // The server prices it: provider cost plus the Solcameo fee, no storyboard image.
  const owed = round(videoCostForLength(getVideoEngine(engine.id), seconds, quality));
  const treasury = studioTreasury();
  if (!treasury) return fail("Payments are not configured yet. Please try again later.", 503);

  const signature = typeof body.paymentSignature === "string" ? body.paymentSignature.trim() : "";
  if (!signature) return fail(`Pay $${owed.toFixed(2)} USDC from your wallet to generate.`, 402, { code: "payment_required", owedUsd: owed, treasury });
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) return fail("Invalid payment signature", 400);
  const payer = typeof body.payer === "string" ? body.payer : "";
  if (!walletBelongsToUser(auth.user, payer)) return fail("Pay from a wallet linked to your account.", 403);

  const url = process.env.NEXT_PUBLIC_CONVEX_URL, secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!url || !secret) return fail("Generation is not configured.", 503);
  const convex = new ConvexHttpClient(url);
  const account = getUserWallet(auth.user) ?? `user:${auth.user.id}`;

  // The transfer must really have reached the Solcameo wallet, from this user, for at least the price.
  let verified = false;
  for (let attempt = 0; attempt < 4 && !verified; attempt++) {
    try { await verifyUsdcDeposit({ txSignature: signature, escrowOwner: treasury, usdcMint: process.env.NEXT_PUBLIC_USDC_MINT || getUsdcMint(), minAmountUsdc: owed, expectedSender: payer }); verified = true; }
    catch (e) {
      if (attempt === 3) return fail(e instanceof Error && /funded|credited/.test(e.message) ? "That payment does not match this video." : "We could not confirm your payment yet. Try again in a moment.", 402, { code: "payment_unconfirmed" });
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  let claim;
  try { claim = await convex.mutation(api.describeVideo.claim, { authSecret: secret, account, txSignature: signature, amountUsd: owed }); }
  catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/payment_used|already processed/i.test(message)) return fail("That payment was already used for another video.", 409, { code: "payment_used" });
    return fail("Billing is temporarily unavailable. Please try again.", 503, { code: "billing_unavailable" });
  }
  // The same payment again: hand back its render, unless that render failed, in which case run it again for free.
  if (claim.kind === "existing" && claim.taskId) {
    const status = (await convex.query(api.agentTasks.generationStatus, { ids: [claim.taskId] }).catch(() => null)) as Record<string, { status: string }> | null;
    if (status?.[claim.taskId]?.status !== "failed") return NextResponse.json({ taskId: claim.taskId, duplicate: true });
  }

  try {
    // The provider can only fetch public .png/.jpg links, so the picture is re-hosted when it needs it.
    const avatarUrl = await normalizeImageForKie(body.referenceImageUrl);
    if (!avatarUrl) throw new Error("reference image could not be prepared");
    const sessionId = `describe:${account}`;
    const taskId = (await convex.mutation(api.agentTasks.create, {
      authSecret: secret, sessionId, type: "create_video", title: `Video: ${prompt.slice(0, 60)}`, triggeredBy: "explore",
      input: JSON.stringify({ topic: prompt, userPaid: true, payerWallet: payer }),
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
    return fail("Your payment went through but the video could not start. Try again with the same payment, or contact support.", 502, { code: "start_failed", paymentSignature: signature });
  }
}
