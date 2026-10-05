import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { streamFetchToFile } from "@/lib/server/downloader";
import { detectFaceCenter } from "@/lib/server/faceTrack";

const ffmpegPath = resolveFfmpegPath();

// Exact-pathname allowlist of local /public test assets (e.g. the Face Detect
// Playground's default sample) — read straight off disk instead of round-
// tripping through streamFetchToFile, whose SSRF guard correctly rejects any
// private/loopback host (including the app's own localhost/127.0.0.1 origin
// in dev). Narrow allowlist by exact pathname, NOT "same origin" — a spoofed
// Host header must never grant a network-fetch bypass for arbitrary input.
const LOCAL_PUBLIC_TEST_ASSETS = new Set<string>(["/face-detect-sample.mp4"]);

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Real face detection for the Editor's Camera Settings "Zoom Punch" preview —
 * the SAME local CenterFace algorithm the actual clip render pipeline uses
 * (lib/server/faceTrack.ts → lib/server/centerface.ts, also wired in
 * lib/server/clipRender.ts), just run against a short preview clip instead of
 * a full render. No external API, no cost, no rate limit.
 *
 * Body: { videoUrl: string, startSeconds?: number } →
 *   { ok, cx, cy, kind, recommendFit, faceCount }.
 */
export async function POST(req: NextRequest) {
  if (!ffmpegPath) return NextResponse.json({ ok: false, error: "ffmpeg unavailable" }, { status: 500 });

  let body: { videoUrl?: string; startSeconds?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const videoUrl = String(body.videoUrl ?? "");
  if (!/^https?:\/\//i.test(videoUrl)) return NextResponse.json({ ok: false, error: "videoUrl required" }, { status: 400 });
  let requestedPathname = "";
  try { requestedPathname = new URL(videoUrl).pathname; } catch { /* falls through — auth still required, network fetch rejects it below */ }
  // The Face Detect Playground (/dev/face-detect) needs to work signed-out —
  // it's a local dev tool, and gating it on login was the actual bug reported
  // ("Single-crop scan error: Unauthorized" with no session). Only the ONE
  // bundled sample video skips auth: it's a fixed local file (no SSRF risk,
  // no arbitrary download, bounded cost), so there's nothing to abuse here.
  // Any OTHER url (a real user pointing this at their own footage) still
  // requires a signed-in session, same as before.
  if (!LOCAL_PUBLIC_TEST_ASSETS.has(requestedPathname)) {
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;
    if (!auth.internal) {
      const err = requireSiwsSession(auth);
      if (err) return err;
    }
  }
  // Where to START sampling — 0.5s by default (right for the Editor's actual
  // use: a short, already-trimmed 10-20s preview clip where the speaker is on
  // screen from frame 1). A raw, untrimmed long-form source (e.g. the Face
  // Detect Playground pointed at a full interview) often opens on an intro/
  // title card with no face at all — sampling only the first 4s there always
  // degrades to recommendFit regardless of whether detection "works". Letting
  // the caller shift the window fixes that without changing the real
  // pipeline's default behavior for actual clips.
  const startSeconds = typeof body.startSeconds === "number" && Number.isFinite(body.startSeconds)
    ? Math.max(0, Math.min(3600, body.startSeconds))
    : 0.5;

  const workDir = await mkdtemp(join(tmpdir(), "vello-facedetect-"));
  try {
    const srcPath = join(workDir, "src.mp4");
    if (LOCAL_PUBLIC_TEST_ASSETS.has(requestedPathname)) {
      await copyFile(join(process.cwd(), "public", requestedPathname), srcPath);
    } else {
      await streamFetchToFile(videoUrl, srcPath, { maxBytes: 300 * 1024 * 1024, timeoutMs: 60_000 });
    }

    // Preview clips here are short (a fast 10-20s pull, not the full source), so
    // fixed timestamps are enough — no transcript to word-anchor against, unlike
    // the full pipeline's sampling in clipRender.ts. 5 frames (up from 3) since
    // local detection is ~free — more samples means a sturdier agreement gate.
    const framePaths: string[] = [];
    // A second still ~120ms after each anchor — lets detectFaceCenter tell
    // WHICH face is actually talking (mouth motion) instead of defaulting to
    // whoever's biggest, on a 2+ guest preview frame. Index-aligned to
    // framePaths; a failed burst just leaves that anchor on largest-face.
    const burstPaths: (string[] | undefined)[] = [];
    const sampleOffsets = startSeconds === 0.5 ? [0.5, 1.5, 2.5, 3.5, 4.5] : [0, 1, 2, 3, 4];
    for (const offset of sampleOffsets) {
      const t = startSeconds + offset;
      const fp = join(workDir, `face${framePaths.length}.jpg`);
      try {
        await runFfmpeg(["-y", "-ss", String(t), "-i", srcPath, "-frames:v", "1", "-vf", "scale=480:-2", fp]);
        framePaths.push(fp);
        const bp = join(workDir, `face${framePaths.length}b.jpg`);
        try {
          await runFfmpeg(["-y", "-ss", (t + 0.12).toFixed(2), "-i", srcPath, "-frames:v", "1", "-vf", "scale=480:-2", bp]);
          burstPaths.push([bp]);
        } catch { burstPaths.push(undefined); }
      } catch { /* frame past clip end or unreadable — skip */ }
    }
    if (framePaths.length === 0) throw new Error("could not extract any frame from this preview");

    const subj = await detectFaceCenter(framePaths, burstPaths);
    if (!subj) return NextResponse.json({ ok: true, found: false, faceCount: 0 });
    return NextResponse.json({
      ok: true,
      // kind:"face" means a face was actually seen (even if recommendFit —
      // low-confidence position, not zero faces); kind:"subject" is the
      // zero-face fallback (centered, faceCount 0). Do NOT report found:true
      // for that — the caller uses this to decide crop vs. full-frame.
      found: subj.kind === "face",
      cx: subj.cx, cy: subj.cy, kind: subj.kind, recommendFit: subj.recommendFit === true,
      // Multi-person bounds (2+ separated faces — a podcast/interview) so "Pan
      // both" can pan between the REAL guest positions instead of a generic
      // side-to-side sweep. Absent for a single/lone face.
      xMin: subj.xMin, xMax: subj.xMax,
      // The true headcount CenterFace saw — NOT inferred from xMin/xMax (which
      // only appear once faces are separated enough to pan/fit between, and
      // would silently under-report close/overlapping faces as 1).
      faceCount: subj.faceCount,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "face detection failed" }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath!, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); if (err.length > 2000) err = err.slice(-2000); });
    const wall = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} reject(new Error("ffmpeg frame extract timed out")); }, 15_000);
    proc.on("error", (e) => { clearTimeout(wall); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(wall);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`));
    });
  });
}
