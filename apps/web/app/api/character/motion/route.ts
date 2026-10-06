import { probeRemoteVideoDurationSeconds } from "@/lib/server/ffmpegBin";
import { assertPublicHttpUrl } from "@/lib/server/downloader";
import { getObjectText, putImage } from "@/lib/server/imageStorage";
import { chargeExploreRun, refundExploreRun, priceUsd, CHARGE_MESSAGES } from "@/lib/server/exploreBilling";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { GENJUTSU_ENDPOINTS, HfError, getStatus, submitVideo, type GenjutsuMode } from "@/lib/server/higgsfield";
import { putVideo, r2Configured } from "@/lib/server/videoStorage";

export const maxDuration = 120;

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u);

/** Start a Genjutsu run: reference video's motion applied to the chosen character image(s). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const a = await authorizeCharacterOwner(req, typeof body.mintAddress === "string" ? body.mintAddress : null);
  if (a.error) return a.error;

  const mode = (body.mode as string) in GENJUTSU_ENDPOINTS ? (body.mode as GenjutsuMode) : "motion-transfer";
  if (!https(body.videoUrl)) return NextResponse.json({ error: "Add a reference video first" }, { status: 400 });
  const images = (Array.isArray(body.imageUrls) ? body.imageUrls : []).filter(https).slice(0, 8);
  if (!images.length) return NextResponse.json({ error: "Add at least one character image" }, { status: 400 });
  const resolution = (["480p", "720p", "1080p"].includes(body.resolution as string) ? body.resolution : "720p") as "480p" | "720p" | "1080p";
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 4000) : "";

  let duration: number | null;
  try { await assertPublicHttpUrl(body.videoUrl); duration = await probeRemoteVideoDurationSeconds(body.videoUrl); }
  catch { return NextResponse.json({ error: "Could not read this reference video." }, { status: 400 }); }
  const price = duration ? priceUsd(duration, resolution) : null;
  if (price === null) return NextResponse.json({ error: "Use a reference video between 4 and 30 seconds with a readable duration." }, { status: 400 });
  const runId = `motion:${randomUUID()}`;
  const charge = await chargeExploreRun(a.mint, runId, price);
  if (!charge.ok) return NextResponse.json({ error: CHARGE_MESSAGES[charge.reason] ?? "Could not charge the agent wallet.", code: charge.reason, mintAddress: a.mint, required: price }, { status: charge.reason === "billing_unavailable" || charge.reason === "payment_failed" ? 503 : 402 });
  let accepted = false;
  try {
    const requestId = await submitVideo(
      mode,
      { video_url: body.videoUrl, image_urls: images, resolution, ...(prompt.trim() ? { prompt } : {}) },
      `${a.mint}:${randomUUID()}`.slice(0, 120),
    );
    accepted = true;
    await putImage(Buffer.from(JSON.stringify({ runId, requestId })), "application/json", { key: `characters/${a.mint}/motion-jobs/${requestId}.json` });
    return NextResponse.json({ requestId, costUsd: price });
  } catch (e) {
    if (!accepted) await refundExploreRun(a.mint, runId);
    if (e instanceof HfError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Generation failed to start" }, { status: 502 });
  }
}

/** Poll one run; on completion copy the video into our R2 (Higgsfield retains outputs ~7 days). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a = await authorizeCharacterOwner(req, q.get("mint"));
  if (a.error) return a.error;
  try {
    const r = await getStatus(q.get("id") ?? "");
    if (["failed", "nsfw", "canceled"].includes(r.status)) {
      const raw = await getObjectText(`characters/${a.mint}/motion-jobs/${q.get("id")}.json`);
      if (raw) await refundExploreRun(a.mint, JSON.parse(raw).runId);
    }
    if (r.status !== "completed") return NextResponse.json({ status: r.status, error: r.error }, { headers: { "Cache-Control": "no-store" } });
    if (!r.videoUrl) return NextResponse.json({ status: "failed", error: "No video came back" });
    let url = r.videoUrl;
    if (r2Configured()) {
      try {
        const res = await fetch(r.videoUrl);
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.byteLength > 0 && buf.byteLength < 300_000_000) url = (await putVideo(buf, { keyPrefix: `characters/${a.mint}/motion` })).url;
        }
      } catch { /* keep the Higgsfield URL */ }
    }
    return NextResponse.json({ status: "completed", url });
  } catch (e) {
    if (e instanceof HfError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Status check failed" }, { status: 502 });
  }
}
