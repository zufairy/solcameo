// Trailing scene-jump guard for generated clips.
//
// Seedance (and occasionally other engines) sometimes ends a clip with a few
// WRONG frames — a hard cut to a different scene, a flash of a reference
// image, or an invented "outro" shot — right at the tail, after the described
// action has finished. Prompt-side rules reduce it but can't eliminate it,
// because it's the model's own filler behavior when the requested duration
// outlives the described action.
//
// This guard fixes it deterministically: ffmpeg scene-detection over ONLY the
// last couple of seconds; if a hard scene cut is found there, the clip is
// re-encoded trimmed to just before the cut and re-hosted. No cut found (the
// normal case) → null, caller keeps the original URL untouched.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath, probeRemoteVideoDurationSeconds } from "./ffmpegBin";
import { putVideo } from "./videoStorage";

const execFileP = promisify(execFile);

/** Only inspect this much of the tail — a legitimate story video cuts scenes
 *  all the time; only a cut in the FINAL moments reads as a glitch. */
const TAIL_WINDOW_SECONDS = 2.5;
/** ffmpeg `scene` score above this = a hard cut (0.4-0.5 is the usual band;
 *  higher = fewer false positives on fast in-scene motion). */
const SCENE_THRESHOLD = 0.5;
/** Never trim a clip below this length, and never trim more than the window. */
const MIN_KEEP_SECONDS = 3;

/**
 * Detect a hard scene cut in the last ~2.5s of `url`; when found, return a new
 * hosted URL of the clip trimmed to just before the cut. Returns null when no
 * tail cut is detected, on any tool failure, or when trimming would leave too
 * little video — the caller then keeps the original.
 */
export async function trimTrailingSceneJump(url: string): Promise<string | null> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg || !/^https?:\/\//i.test(url)) return null;
  try {
    // Duration via ffprobe when available; the environment may ship ffmpeg
    // WITHOUT ffprobe (ffmpeg-static does) — the fallback below decodes the
    // whole clip instead (fine: seedance clips are ≤15s) and reads the
    // duration from ffmpeg's own stderr header.
    let duration = await probeRemoteVideoDurationSeconds(url);
    const seekable = !!duration;
    if (duration && duration <= MIN_KEEP_SECONDS + 0.5) return null;

    // Pass 1 — scene-detect (tail-only seek when the duration is known;
    // full decode otherwise). showinfo logs each cut frame's pts_time.
    let stderr = "";
    try {
      const r = await execFileP(ffmpeg, [
        "-hide_banner", "-nostats",
        ...(seekable ? ["-ss", Math.max(0, (duration as number) - TAIL_WINDOW_SECONDS).toFixed(3)] : []),
        "-i", url,
        "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
        "-f", "null", "-",
      ], { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
      stderr = r.stderr ?? "";
    } catch (e) {
      // ffmpeg exits non-zero on some streams even after a full analyze —
      // the showinfo lines are still in stderr, so read them from the error.
      stderr = (e as { stderr?: string })?.stderr ?? "";
      if (!stderr) return null;
    }
    if (!duration) {
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!dm) return null;
      duration = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);
      if (!duration || duration <= MIN_KEEP_SECONDS + 0.5) return null;
    }
    const tailStart = Math.max(0, duration - TAIL_WINDOW_SECONDS);
    const rawTimes = [...stderr.matchAll(/pts_time:([0-9.]+)/g)]
      .map((m) => parseFloat(m[1]))
      .filter((t) => Number.isFinite(t) && t > 0.05); // t≈0 is the seek's own first frame, not a cut
    // Seeked run: pts restarts at 0 from the seek point. Full run: pts is
    // absolute — keep only cuts inside the tail window.
    const times = seekable
      ? rawTimes.map((t) => tailStart + t)
      : rawTimes.filter((t) => t >= tailStart);
    if (!times.length) return null;
    const cutAt = Math.min(...times);
    const keep = cutAt - 0.04; // stop just before the bad frame
    if (keep < MIN_KEEP_SECONDS || keep >= duration - 0.05) return null;

    // Pass 2 — re-encode trimmed to `keep` seconds (video re-encoded for a
    // frame-accurate cut; audio stream copied).
    const dir = await mkdtemp(join(tmpdir(), "tailguard-"));
    try {
      const out = join(dir, "trimmed.mp4");
      await execFileP(ffmpeg, [
        "-hide_banner", "-nostats", "-y",
        "-i", url, "-t", keep.toFixed(3),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        out,
      ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
      const bytes = await readFile(out);
      const { url: hosted } = await putVideo(bytes, { keyPrefix: "renders" });
      console.log(`[videoTailGuard] trimmed trailing scene jump: ${duration.toFixed(1)}s → ${keep.toFixed(1)}s (cut detected at ${cutAt.toFixed(2)}s)`);
      return hosted;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (e) {
    console.warn(`[videoTailGuard] skipped (${e instanceof Error ? e.message : e})`);
    return null;
  }
}
