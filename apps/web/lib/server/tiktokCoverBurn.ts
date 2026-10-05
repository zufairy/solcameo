// TikTok has no custom-cover-IMAGE field in its (upload-post) API — only
// `cover_timestamp`, which picks a frame BY TIME from the video itself. So a
// custom cover image can only reach TikTok by literally becoming the first
// frame(s) of the file TikTok receives: this module prepends the operator's
// cover image as a short still "clip" onto the front of the video, re-encodes,
// and returns a new URL — TikTok's own frame-based cover then naturally lands
// on it (the caller passes a small `cover_timestamp` that's guaranteed to fall
// inside the still). Every other platform posts the ORIGINAL, untouched clip
// (they get a real custom-cover field instead — see lib/builder/coverImageConfig.ts).
//
// Modeled directly on lib/server/ctaAppend.ts (same probe/concat/upload shape,
// this repo's established pattern for "join a short extra clip onto a produced
// video" — this file trades "append a video" for "prepend a still image").

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { streamFetchToFile } from "@/lib/server/downloader";
import { putVideo } from "@/lib/server/videoStorage";

const ffmpegPath = resolveFfmpegPath();
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// Wall-clock ceiling for the encode — a ~1s still + one clip is a fast job;
// this only backstops a pathological input.
const FFMPEG_WALL_MS = 200_000;

// How long the cover image stays on screen as its own "clip", in seconds.
// Long enough that the explicit cover_timestamp below (and TikTok's own
// 1000ms default, if a caller omits it) both land solidly inside the still.
const STILL_DURATION_SEC = 1.2;

// Timestamp (ms) the caller should send TikTok as `cover_timestamp` — the
// middle of the still, so it's never grazing either edge of the segment.
export const TIKTOK_COVER_TIMESTAMP_MS = Math.round((STILL_DURATION_SEC / 2) * 1000);

interface Probe { hasAudio: boolean; durationSec: number; width: number; height: number }

/** Probe a file with `ffmpeg -i` (no ffprobe dependency — mirrors ctaAppend.ts). */
function probeVideo(bin: string, path: string): Promise<Probe> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-hide_banner", "-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 20000) e = e.slice(-20000); });
    const done = () => {
      const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(e);
      const dm = e.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const durationSec = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + parseFloat(dm[3]) : 0;
      const vm = e.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
      resolve({
        hasAudio,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        width: vm ? parseInt(vm[1], 10) : 0,
        height: vm ? parseInt(vm[2], 10) : 0,
      });
    };
    proc.on("error", () => resolve({ hasAudio: false, durationSec: 0, width: 0, height: 0 }));
    proc.on("close", done);
  });
}

/** Run ffmpeg, SIGKILL on wall-clock overrun, reject on non-zero exit. */
function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 8000) e = e.slice(-8000); });
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); fn(); };
    const wall = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      settle(() => reject(new Error(`ffmpeg killed: exceeded ${FFMPEG_WALL_MS}ms. ${e.slice(-400)}`)));
    }, FFMPEG_WALL_MS);
    proc.on("error", (err) => settle(() => reject(err)));
    proc.on("close", (c) => settle(() => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${e.slice(-400)}`)))));
  });
}

/** Clamp to an even, sane pixel dimension (libx264/yuv420p rejects odd sizes). */
const evenDim = (n: number, def: number) => {
  const v = Math.min(2160, Math.max(120, Math.round(n > 0 ? n : def)));
  return v % 2 === 0 ? v : v - 1;
};

/**
 * Prepend `coverImagePath` (looped as a STILL_DURATION_SEC still) onto the
 * front of `mainPath`, into `outPath`. The still is scaled/padded to the
 * MAIN video's canvas (letterbox — the whole image is kept, never cropped)
 * and given silent audio so the join stays aligned; the main track's audio
 * (or synthesized silence, if it has none) plays after it.
 */
export async function prependCoverImage(bin: string, mainPath: string, coverImagePath: string, outPath: string): Promise<void> {
  const mainProbe = await probeVideo(bin, mainPath);
  const W = evenDim(mainProbe.width, 1080);
  const H = evenDim(mainProbe.height, 1920);
  const mainDur = mainProbe.durationSec > 0 ? mainProbe.durationSec : 4;

  const inputs: string[] = [
    "-loop", "1", "-t", STILL_DURATION_SEC.toFixed(3), "-i", coverImagePath,
    "-i", mainPath,
    "-f", "lavfi", "-t", STILL_DURATION_SEC.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
  ];
  let nextIdx = 3;
  const vparts: string[] = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=30,setsar=1,format=yuv420p[v0]`,
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=30,setsar=1,format=yuv420p[v1]`,
  ];
  const aparts: string[] = [`[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0]`];
  if (mainProbe.hasAudio) {
    aparts.push(`[1:a]aresample=async=1:first_pts=0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1]`);
  } else {
    inputs.push("-f", "lavfi", "-t", mainDur.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    aparts.push(`[${nextIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1]`);
    nextIdx++;
  }

  const filter = `${vparts.join(";")};${aparts.join(";")};[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`;
  await runFfmpeg(bin, [
    "-y", ...inputs,
    "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath,
  ]);
}

/**
 * Download `mainUrl` + `coverImageUrl`, prepend the image as a still onto the
 * front, upload the result, and return the new URL. Fail-safe: on ANY error
 * (bad url, ffmpeg failure, storage) returns the ORIGINAL `mainUrl` — a post
 * never gets blocked by a cover-burn problem; the caller (run-task) treats an
 * unchanged return as "skip the TikTok-specific variant, post normally."
 */
export async function getTiktokCoverVideoUrl(mainUrl: string, coverImageUrl: string): Promise<string> {
  if (!mainUrl || !coverImageUrl || !ffmpegPath || !CONVEX_URL) return mainUrl;
  const workDir = await mkdtemp(join(tmpdir(), "vello-tiktok-cover-"));
  try {
    const mainPath = join(workDir, "main.mp4");
    const coverPath = join(workDir, "cover.img"); // extension-less-in-effect — ffmpeg probes actual image content, not the name
    const outPath = join(workDir, "out.mp4");
    await Promise.all([streamFetchToFile(mainUrl, mainPath), streamFetchToFile(coverImageUrl, coverPath)]);
    await prependCoverImage(ffmpegPath, mainPath, coverPath, outPath);
    const out = await readFile(outPath);
    const { url: newUrl } = await putVideo(out, { keyPrefix: "tiktok-cover", convexUrl: CONVEX_URL });
    return newUrl || mainUrl;
  } catch (e) {
    console.warn("[getTiktokCoverVideoUrl] cover burn failed (posting the original clip instead):", e instanceof Error ? e.message : e);
    return mainUrl;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
