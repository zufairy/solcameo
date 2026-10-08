import { identityStills } from "@/lib/server/identityStill";
import { mergeCast } from "@/lib/server/mentionCast";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { HfError, submitVideo } from "@/lib/server/higgsfield";
import { resolveReference } from "@/lib/server/exploreReferences";
import { withCastKey } from "@/lib/explore/castKey";
import { CHARGE_MESSAGES, chargeExploreRun, priceUsd, refundExploreRun } from "@/lib/server/exploreBilling";

export const runtime = "nodejs";
export const maxDuration = 120;

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u);

/**
 * Explore "Generate now". The source video and the price come from our own reference table, never
 * from the client. The agent is charged (reference price plus the Solcameo fee: 15% or $1, whichever is higher, settled from
 * the agent wallet to the Solcameo treasury), then the render is submitted to Higgsfield. A render
 * that fails to start is refunded. The row it leaves behind lets the cron finish and auto-post it.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const a = await authorizeCharacterOwner(req, typeof body.mintAddress === "string" ? body.mintAddress : null);
  if (a.error) return a.error;

  const ref = typeof body.referenceId === "string" ? await resolveReference(body.referenceId, body.referencePage) : null;
  if (!ref) return NextResponse.json({ error: "This reference video is no longer available. Pick another one." }, { status: 400 });
  const rawImages = (Array.isArray(body.imageUrls) ? body.imageUrls : []).filter(https).slice(0, 8);
  if (!rawImages.length) return NextResponse.json({ error: "Add at least one character image" }, { status: 400 });
  const mode = body.mode === "object-swap" ? "object-swap" : "motion-transfer";
  const resolution = (["480p", "720p", "1080p"].includes(body.resolution as string) ? body.resolution : "720p") as "480p" | "720p" | "1080p";
  const price = priceUsd(ref.duration, resolution);
  if (price === null) return NextResponse.json({ error: "This reference must be between 4 and 30 seconds." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!url || !secret) return NextResponse.json({ error: "Generation is not configured." }, { status: 503 });
  const convex = new ConvexHttpClient(url);
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: a.mint, authSecret: secret });
  // The influencer and every tagged cameo go to the engine as clear still faces, never animated GIFs.
  const stills = await identityStills(rawImages, agent);
  // Everyone tagged with @ in the prompt is checked against the real influencer, so each one's face is in the cast.
  const cast = await mergeCast({ prompt: typeof body.prompt === "string" ? body.prompt : "", castTokens: body.castTokens, imageUrls: stills, hints: body.castHints, excludeMint: a.mint });
  const images = cast.imageUrls;
  const autoPost = body.autoPost === true && !!agent?.connectedPlatforms?.includes("x");

  const prompt = withCastKey(typeof body.prompt === "string" ? body.prompt : "", cast.castTokens, images.length, mode);
  const runId = `explore:${randomUUID()}`;
  const charge = await chargeExploreRun(a.mint, runId, price);
  if (!charge.ok) return NextResponse.json({ error: CHARGE_MESSAGES[charge.reason] ?? "Could not charge the agent wallet.", code: charge.reason, mintAddress: a.mint, required: price }, { status: charge.reason === "billing_unavailable" || charge.reason === "payment_failed" ? 503 : 402 });

  try {
    const requestId = await submitVideo(
      mode,
      { video_url: ref.videoUrl, image_urls: images, resolution, ...(prompt.trim() ? { prompt } : {}) },
      `${a.mint}:${runId}`.slice(0, 120),
    );
    await convex.mutation(api.scheduledRecreations.recordSubmitted, {
      authSecret: secret, mintAddress: a.mint, referenceId: ref.id, referenceTitle: ref.title, referencePoster: ref.thumbUrl,
      videoUrl: ref.videoUrl, imageUrls: images, prompt, mode, resolution, requestId, durationSec: ref.duration, billingRunId: runId, autoPost,
    }).catch(() => undefined);
    return NextResponse.json({ requestId, costUsd: price, autoPost });
  } catch (e) {
    await refundExploreRun(a.mint, runId);
    if (e instanceof HfError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Generation failed to start" }, { status: 502 });
  }
}
