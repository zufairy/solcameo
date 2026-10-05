// Cheap, cached video frames for the share card's "real recent clips" panels.
// Resource-conscious by design — a card must show REAL videos without turning
// every render into a transcode job:
//   - ONE ffmpeg call per clip, input-seeked a beat in, reading at most a
//     couple of seconds and emitting a handful of tiny frames (the card
//     pixelates them anyway, so 240×360 is plenty)
//   - a short wall-clock budget + an in-process cache keyed by (url, count),
//     so the same clip across many renders only ever costs one ffmpeg call
//   - any failure (dead URL, corrupt frame, no ffmpeg) resolves to null —
//     the caller drops that clip and falls back gracefully, never fails

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolveFfmpegPath, runWithDiscardCorruptFallback } from "@/lib/server/ffmpegBin";

/** A real remote source (the live feature) or a path relative to /public
 *  (the /dev/x-cards lab's bundled sample clips). */
function resolveSource(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return join(process.cwd(), "public", input.replace(/^\/+/, ""));
}

const FRAME_TIMEOUT_MS = 8_000;
const SEEK_SECONDS = 1; // skips a common black/fade first frame
export const CLIP_FRAME_W = 240;
export const CLIP_FRAME_H = 360;

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); if (err.length > 2000) err = err.slice(-2000); });
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already gone */ } }, FRAME_TIMEOUT_MS);
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg frame-grab ${code}: ${err.slice(-400)}`));
    });
  });
}

const cache = new Map<string, Promise<Buffer[] | null>>();
const CACHE_MAX = 60;

/** Up to `count` JPEG frames (CLIP_FRAME_W×CLIP_FRAME_H) sampled at 3 fps from
 *  one second into `videoUrl`, or null on any failure. Cached per process. */
export function videoFrames(videoUrl: string, count = 1): Promise<Buffer[] | null> {
  const key = `${count}|${videoUrl}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const p = (async () => {
    const ffmpeg = resolveFfmpegPath();
    if (!ffmpeg) return null;
    const workDir = await mkdtemp(join(tmpdir(), "vello-frames-"));
    try {
      const vf = `${count > 1 ? "fps=3," : ""}scale=${CLIP_FRAME_W}:${CLIP_FRAME_H}:force_original_aspect_ratio=increase,crop=${CLIP_FRAME_W}:${CLIP_FRAME_H}`;
      await runWithDiscardCorruptFallback(
        (args) => runFfmpeg(ffmpeg, args),
        [
          "-y", "-ss", String(SEEK_SECONDS), ...(count > 1 ? ["-t", String(Math.ceil(count / 3) + 1)] : []),
          "-i", resolveSource(videoUrl), "-an",
          "-vf", vf, "-frames:v", String(count), "-q:v", "5",
          join(workDir, "f%02d.jpg"),
        ],
      );
      const files = (await readdir(workDir)).filter((f) => f.endsWith(".jpg")).sort();
      const frames = (await Promise.all(files.map((f) => readFile(join(workDir, f))))).filter((b) => b.length > 200);
      return frames.length ? frames : null;
    } catch (e) {
      console.warn(`[videoFrames] grab failed for ${videoUrl.slice(0, 80)}:`, e instanceof Error ? e.message : e);
      return null;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  })();
  p.then((r) => { if (!r) cache.delete(key); }, () => cache.delete(key)); // never pin a transient failure
  cache.set(key, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return p;
}
