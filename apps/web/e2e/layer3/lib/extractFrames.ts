/**
 * Layer 3 helper — extract sampled frames + an audio track from a rendered clip
 * MP4 using the bundled ffmpeg-static binary (same dep the clip pipeline uses).
 *
 * DESIGN-LEVEL skeleton: bounded by N frames at low resolution so a downstream
 * vision call stays cost-capped. Intentionally NOT wired into the default e2e
 * run — only the gated `vision` project (RUN_VISION=1) imports it.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
// ffmpeg-static default-exports the absolute path to the bundled binary.
import ffmpegPath from "ffmpeg-static";

export interface ExtractOptions {
  /** Local path to the source MP4. */
  input: string;
  /** Output working dir for frames + audio. */
  outDir: string;
  /** Max frames to sample (cap cost). Default 8. */
  maxFrames?: number;
  /** Sampling fps. Default 1 (one frame/sec). */
  fps?: number;
  /** Audio window seconds for the SFX/transcript check. Default 8. */
  audioSeconds?: number;
}

export interface ExtractResult {
  /** Absolute paths to the sampled JPEG frames, in order. */
  framePaths: string[];
  /** Absolute path to the extracted mono 16kHz WAV. */
  audioPath: string;
  /** Each frame as a base64 data URL (ready for a multimodal call). */
  frameDataUrls: string[];
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static binary not resolved"));
    const proc = spawn(ffmpegPath, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });
}

export async function extractFrames(opts: ExtractOptions): Promise<ExtractResult> {
  const { input, outDir } = opts;
  const maxFrames = opts.maxFrames ?? 8;
  const fps = opts.fps ?? 1;
  const audioSeconds = opts.audioSeconds ?? 8;

  await mkdir(outDir, { recursive: true });

  // Frames: ~`fps` fps, scaled to 512px wide, capped at `maxFrames`.
  await run([
    "-y", "-i", input,
    "-vf", `fps=${fps},scale=512:-1`,
    "-frames:v", String(maxFrames),
    path.join(outDir, "frame_%03d.jpg"),
  ]);

  // Audio: mono 16kHz WAV for transcript + an astats/loudness SFX heuristic.
  const audioPath = path.join(outDir, "audio.wav");
  await run([
    "-y", "-i", input,
    "-t", String(audioSeconds),
    "-ac", "1", "-ar", "16000",
    audioPath,
  ]);

  const files = (await readdir(outDir))
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort();
  const framePaths = files.map((f) => path.join(outDir, f));
  const frameDataUrls = await Promise.all(
    framePaths.map(async (p) => {
      const buf = await readFile(p);
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    }),
  );

  return { framePaths, audioPath, frameDataUrls };
}
