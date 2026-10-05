import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, rm, copyFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { streamFetchToFile } from "@/lib/server/downloader";
import { identifyFacesAcrossFrames } from "@/lib/server/faceIdentity";

const ffmpegPath = resolveFfmpegPath();

// Exact-pathname allowlist of local /public test assets (e.g. the Face Detect
// Playground's default sample) — read straight off disk instead of round-
// tripping through streamFetchToFile, whose SSRF guard correctly rejects any
// private/loopback host (including the app's own localhost origin in dev).
const LOCAL_PUBLIC_TEST_ASSETS = new Set<string>(["/face-detect-sample.mp4"]);

// Detection is now local (CenterFace, ~3-4ms/frame) so this bound exists only
// to cap ffmpeg extraction + request time, not API cost.
const MAX_TIMESTAMPS = 40;

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * Whole-video face IDENTITY timeline for the Face Detect Playground's Dual
 * mode — extracts one frame per requested timestamp, then runs
 * lib/server/faceIdentity.ts (local CenterFace + appearance fingerprint, no
 * external API) across all of them so the SAME two guests get consistently
 * split even across a single-camera cut interview (see that file's header
 * for why position-only clustering can't do this).
 *
 * Body: { videoUrl: string, timestamps: number[] } →
 *   { ok, points: [{ t, faces: [{ person, cx, cy, w }], thumb? }] }.
 */
export async function POST(req: NextRequest) {
  if (!ffmpegPath) return NextResponse.json({ ok: false, error: "ffmpeg unavailable" }, { status: 500 });

  let body: { videoUrl?: string; timestamps?: number[] };
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
  const timestamps = Array.isArray(body.timestamps)
    ? body.timestamps.filter((t) => typeof t === "number" && Number.isFinite(t) && t >= 0).slice(0, MAX_TIMESTAMPS)
    : [];
  if (timestamps.length === 0) return NextResponse.json({ ok: false, error: "timestamps required" }, { status: 400 });

  const workDir = await mkdtemp(join(tmpdir(), "vello-faceid-"));
  try {
    const srcPath = join(workDir, "src.mp4");
    if (LOCAL_PUBLIC_TEST_ASSETS.has(requestedPathname)) {
      await copyFile(join(process.cwd(), "public", requestedPathname), srcPath);
    } else {
      await streamFetchToFile(videoUrl, srcPath, { maxBytes: 300 * 1024 * 1024, timeoutMs: 60_000 });
    }

    // One frame per timestamp (no 3-frame burst — many timestamps ACROSS the
    // whole video is what gives identity tracking its signal, not repeated
    // sampling of one instant).
    const framePaths: (string | null)[] = [];
    for (const t of timestamps) {
      const fp = join(workDir, `f${framePaths.length}.jpg`);
      try {
        await runFfmpeg(["-y", "-ss", String(t), "-i", srcPath, "-frames:v", "1", "-vf", "scale=384:-2", fp]);
        framePaths.push(fp);
      } catch {
        framePaths.push(null); // past clip end or unreadable — skip, keep positions aligned
      }
    }
    const validIdx = framePaths.reduce<number[]>((acc, p, i) => { if (p) acc.push(i); return acc; }, []);
    const validPaths = validIdx.map((i) => framePaths[i] as string);
    if (validPaths.length === 0) throw new Error("could not extract any frame from this video");

    // Throws only if EVERY frame failed detection (a real, systemic problem —
    // e.g. the model file is missing) rather than degrading silently to "no
    // faces found anywhere", which would be indistinguishable from the truth.
    const identified = await identifyFacesAcrossFrames(validPaths);

    const points = await Promise.all(timestamps.map(async (t, i) => {
      const vi = validIdx.indexOf(i);
      const faces = vi >= 0 ? identified[vi]?.faces ?? [] : [];
      let thumb: string | undefined;
      if (vi >= 0) {
        try {
          const buf = await readFile(framePaths[i] as string);
          thumb = `data:image/jpeg;base64,${buf.toString("base64")}`;
        } catch { /* no thumbnail — Dual just shows nothing for the frozen cell */ }
      }
      return { t, faces, thumb };
    }));

    return NextResponse.json({ ok: true, points });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "detection failed" }, { status: 500 });
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
