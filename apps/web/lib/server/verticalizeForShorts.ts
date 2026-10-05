/**
 * YouTube only classifies a video as a Short when it's vertical/square (≤1:1
 * width:height) AND ≤3min — a 16:9 landscape render can NEVER surface in the
 * Shorts feed no matter what metadata upload-post.com sends (confirmed: their
 * API has no "post as short" flag). So a landscape auto-post that should land
 * as a Short needs an actual vertical re-encode sent to YouTube specifically,
 * while other platforms keep the original landscape file.
 *
 * Fail closed for YouTube: if we cannot prove the file is Short-eligible, never
 * upload the original landscape/long-form file under a misleading #Shorts tag.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { streamFetchToFile } from "@/lib/server/downloader";
import { renderClipFromFile } from "@/lib/server/clipRender";

const ffmpegPath = resolveFfmpegPath();
export const MAX_SHORTS_DURATION_SECONDS = 179.5; // leave margin for encoder rounding

export class ShortsPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShortsPreparationError";
  }
}

export function shortsEligibility(width: number, height: number, durationSeconds: number): "ready" | "verticalize" | "invalid" | "too_long" {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(durationSeconds) || width <= 0 || height <= 0 || durationSeconds <= 0) return "invalid";
  if (durationSeconds > MAX_SHORTS_DURATION_SECONDS) return "too_long";
  return width <= height ? "ready" : "verticalize";
}

function probeVideo(bin: string, path: string): Promise<{ width: number; height: number; durationSeconds: number }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-hide_banner", "-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const dims = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(err);
      const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      resolve({
        width: dims ? Number(dims[1]) : 0,
        height: dims ? Number(dims[2]) : 0,
        durationSeconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
      });
    });
    proc.on("error", () => resolve({ width: 0, height: 0, durationSeconds: 0 }));
  });
}

/** Return a YouTube-Short-eligible URL, or throw before any upload can happen. */
export async function prepareYouTubeShort(videoUrl: string): Promise<string> {
  if (!ffmpegPath) throw new ShortsPreparationError("Cannot prepare a YouTube Short because FFmpeg is unavailable. The video was not posted to YouTube.");
  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(join(tmpdir(), "vello-shorts-"));
    const srcPath = join(workDir, "src.mp4");
    // Stream rather than buffering the entire clip in Node's heap. This also
    // handles larger pre-rendered clips without risking a server OOM.
    // Some valid R2 video URLs are extensionless and served as octet-stream;
    // let FFmpeg verify the downloaded bytes rather than trusting MIME alone.
    await streamFetchToFile(videoUrl, srcPath, { maxBytes: 2 * 1024 * 1024 * 1024, timeoutMs: 90_000 });

    const { width, height, durationSeconds } = await probeVideo(ffmpegPath, srcPath);
    const eligibility = shortsEligibility(width, height, durationSeconds);
    if (eligibility === "invalid") throw new ShortsPreparationError("Could not verify the video's dimensions and duration for YouTube Shorts. The video was not posted to YouTube.");
    if (eligibility === "too_long") throw new ShortsPreparationError(`This clip is ${Math.ceil(durationSeconds)} seconds long. YouTube Shorts must be under 3 minutes; trim it before posting.`);
    if (eligibility === "ready") return videoUrl;

    const { clipUrl } = await renderClipFromFile(
      srcPath,
      { startSeconds: 0, endSeconds: durationSeconds, ops: [{ op: "blur_frame", style: "static" }], width: 1080, height: 1920 },
      { maxMs: 180_000 },
    );
    if (!clipUrl || clipUrl === videoUrl) throw new ShortsPreparationError("The landscape clip could not be converted to vertical for YouTube Shorts. The original was not posted to YouTube.");
    return clipUrl;
  } catch (error) {
    if (error instanceof ShortsPreparationError) throw error;
    throw new ShortsPreparationError(`Could not prepare this video as a YouTube Short: ${error instanceof Error ? error.message : "unknown video error"}`);
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
