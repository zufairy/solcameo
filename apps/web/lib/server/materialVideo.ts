import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "./ffmpegBin";
import { materialFrames } from "./postMaterialRender";
import type { MaterialData } from "./postMaterialRender";

function run(ffmpeg: string, args: string[], feed?: (stdin: NodeJS.WritableStream) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (c) => { err = (err + c).slice(-2000); });
    proc.stdin.on("error", () => { /* surfaced through the exit code */ });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.trim().slice(-300)}`))));
    (feed ? feed(proc.stdin) : Promise.resolve()).then(() => proc.stdin.end(), (e) => { proc.kill(); reject(e); });
  });
}

/**
 * Animated card -> looping H.264 MP4. Frames are rendered a few at a time and piped
 * straight into ffmpeg, so memory stays flat (no GIF encode, no 150 MB frame buffer)
 * and it finishes in a fraction of the time. The clip repeats `loops` times so X plays
 * it like a GIF.
 */
export async function renderMaterialMp4(d: MaterialData, loops = 3): Promise<Buffer> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error("ffmpeg is not available on this server");
  const { width, height, count, delayMs, rgb } = await materialFrames(d);
  const dir = await mkdtemp(join(tmpdir(), "vello-card-"));
  try {
    const once = join(dir, "once.mp4"), out = join(dir, "out.mp4");
    await run(ffmpeg, ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-framerate", String(1000 / delayMs), "-i", "pipe:0",
      "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", "-an", once],
    async (stdin) => {
      for (let i = 0; i < count; i += 4) {
        const batch = await Promise.all(Array.from({ length: Math.min(4, count - i) }, (_, k) => rgb(i + k)));
        for (const frame of batch) if (!stdin.write(frame)) await new Promise<void>((r) => stdin.once("drain", () => r()));
      }
    });
    await run(ffmpeg, ["-y", "-v", "error", "-stream_loop", String(Math.max(0, loops - 1)), "-i", once, "-c", "copy", "-movflags", "+faststart", out]);
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
