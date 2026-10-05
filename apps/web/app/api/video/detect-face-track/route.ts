import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, rm, copyFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { streamFetchToFile } from "@/lib/server/downloader";
import { detectFaces, type FaceBox } from "@/lib/server/centerface";
import { analyzeSpeakers, readMonoPcm, toSamplePoints } from "@/lib/server/speakerTrack";

const ffmpegPath = resolveFfmpegPath();

// See app/api/video/detect-face/route.ts for why this is read straight off
// disk rather than going through the SSRF-guarded network fetch.
const LOCAL_PUBLIC_TEST_ASSETS = new Set<string>(["/face-detect-sample.mp4"]);

// Frames per second to sample — dense enough that shot boundaries land close
// to the real cut instead of lagging a fifth-of-a-second behind it, without
// literally decoding every source frame (25-60fps), which would multiply
// JPEG-encode + CenterFace cost for no visible gain past this point. Local
// CenterFace is ~3-4ms/frame, so this stays cheap even doubled.
const SAMPLE_FPS = 10;
// Frame width the mouth-motion signal is measured at. CenterFace boxes are
// resolution-independent, but mouthMotion diffs raw pixels — too small a
// frame and a talking mouth is a handful of pixels, indistinguishable from
// noise (validated: scale=384 keeps the visual speech signal near chance;
// 640 is where it separates cleanly, see scripts/eval-speaker-track.ts).
const SAMPLE_WIDTH = 640;

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Dense whole-window face tracking for the Face Detect Playground's single-
 * crop modes (Auto/Zoom/Pan/Fit) — ONE ffmpeg call extracts every sampled
 * frame across [0, durationS] at SAMPLE_FPS, then CenterFace runs on each.
 *
 * This replaces looping N separate /api/video/detect-face calls (one ffmpeg
 * PROCESS SPAWN + one HTTP round-trip per sample): process-spawn overhead
 * dominated that approach, capping useful density at ~4-30 sparse points
 * over 20s. Batching into a single extraction removes that per-sample
 * overhead entirely, so the same or lower total cost now covers every
 * SAMPLE_FPS-th frame (100 points over 20s at the default 5fps) for
 * genuinely smooth, precise tracking instead of interpolating across large
 * gaps.
 *
 * No multi-frame agreement/jitter gating here (unlike lib/server/faceTrack.ts,
 * which needs it because it only ever sees 3-5 sparse frames per clip) —
 * at 5fps the density itself is the smoothing; each point is just "what did
 * CenterFace see in THIS frame", left to the client's per-frame interpolation
 * plus its own debounce/dip hysteresis for the confident↔letterbox decision.
 *
 * Multiple faces on screen → lib/server/speakerTrack.ts picks the point's
 * cx/cy from whoever is ACTUALLY TALKING (mouth-motion evidence gated by the
 * audio track), not just the largest/nearest face — a podcast two-shot used
 * to crop on whichever guest sat closer to camera even while the other one
 * spoke. `pair` (Dual mode's second pane) is the speaker + whoever spoke most
 * recently, same speaker-aware source.
 *
 * Body: { videoUrl: string, durationS: number } →
 *   { ok, points: [{ t, found, cx, cy, recommendFit, faceCount, pair? }] }.
 */
export async function POST(req: NextRequest) {
  if (!ffmpegPath) return NextResponse.json({ ok: false, error: "ffmpeg unavailable" }, { status: 500 });

  let body: { videoUrl?: string; durationS?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const videoUrl = String(body.videoUrl ?? "");
  if (!/^https?:\/\//i.test(videoUrl)) return NextResponse.json({ ok: false, error: "videoUrl required" }, { status: 400 });
  let requestedPathname = "";
  try { requestedPathname = new URL(videoUrl).pathname; } catch { /* falls through — auth still required, network fetch rejects it below */ }
  // See detect-face/route.ts's matching comment — /dev/face-detect needs to
  // work signed-out; only the bundled sample video (fixed local file, no
  // abuse surface) skips auth. Any other url still requires a session.
  if (!LOCAL_PUBLIC_TEST_ASSETS.has(requestedPathname)) {
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;
    if (!auth.internal) {
      const err = requireSiwsSession(auth);
      if (err) return err;
    }
  }
  const durationS = typeof body.durationS === "number" && Number.isFinite(body.durationS)
    ? Math.max(0.5, Math.min(120, body.durationS))
    : 20;

  const workDir = await mkdtemp(join(tmpdir(), "vello-facetrack-"));
  try {
    const srcPath = join(workDir, "src.mp4");
    if (LOCAL_PUBLIC_TEST_ASSETS.has(requestedPathname)) {
      await copyFile(join(process.cwd(), "public", requestedPathname), srcPath);
    } else {
      await streamFetchToFile(videoUrl, srcPath, { maxBytes: 300 * 1024 * 1024, timeoutMs: 60_000 });
    }

    // ONE ffmpeg process for the whole window — the fps filter picks evenly-
    // spaced frames regardless of the source's own frame rate.
    await runFfmpeg([
      "-y", "-i", srcPath, "-t", String(durationS),
      "-vf", `fps=${SAMPLE_FPS},scale=${SAMPLE_WIDTH}:-2`,
      join(workDir, "f%05d.jpg"),
    ]);
    const files = (await readdir(workDir)).filter((f) => f.startsWith("f") && f.endsWith(".jpg")).sort();
    if (files.length === 0) throw new Error("could not extract any frame from this video");

    const detected = await Promise.all(files.map(async (f, i) => {
      const t = i / SAMPLE_FPS;
      try {
        return { t, path: join(workDir, f), faces: await detectFaces(join(workDir, f)) };
      } catch {
        return { t, path: join(workDir, f), faces: [] as FaceBox[] };
      }
    }));

    // Active-speaker pass — WHO is talking, not just who's biggest in frame
    // (a podcast crop that always sits on the nearer/bigger guest even while
    // the other one talks). Best-effort: a silent/no-audio source still gets
    // the largest-face fallback inside analyzeSpeakers.
    const pcm = await readMonoPcm(runFfmpeg, srcPath, join(workDir, "audio.f32"), durationS).catch(() => null);
    const speakerFrames = await analyzeSpeakers(detected, pcm, SAMPLE_FPS);
    // Shared with the cloud clip-render pipeline (lib/server/clipRender.ts) —
    // see speakerTrack.ts's toSamplePoints doc for why this is ONE function.
    const points = toSamplePoints(speakerFrames);

    return NextResponse.json({ ok: true, points });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "face tracking failed" }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath!, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); if (err.length > 2000) err = err.slice(-2000); });
    const wall = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} reject(new Error("ffmpeg extract timed out")); }, 60_000);
    proc.on("error", (e) => { clearTimeout(wall); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(wall);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`));
    });
  });
}
