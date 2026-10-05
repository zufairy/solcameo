import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "./ffmpegBin";

const run = promisify(execFile);

/**
 * Animated GIF -> looping H.264 MP4 (even dimensions, yuv420p) so X, Instagram and TikTok accept it as
 * a video that plays like the GIF. `overlay` is an optional full-frame transparent PNG composited on every frame.
 */
export async function gifToMp4(gif: Buffer, opts: { loops?: number; overlay?: Buffer } = {}): Promise<Buffer> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error("ffmpeg is not available on this server");
  const dir = await mkdtemp(join(tmpdir(), "vello-gif-"));
  try {
    const input = join(dir, "in.gif"), badge = join(dir, "overlay.png"), output = join(dir, "out.mp4");
    await writeFile(input, gif);
    if (opts.overlay) await writeFile(badge, opts.overlay);
    const loops = Math.max(1, opts.loops ?? 3);
    const args = ["-y", "-v", "error", "-stream_loop", String(loops - 1), "-i", input, ...(opts.overlay ? ["-i", badge] : []),
      "-filter_complex", `${opts.overlay ? "[0:v][1:v]overlay=0:0,fps=30" : "fps=30"},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", "-an", output];
    await run(ffmpeg, args, { timeout: 120_000 });
    return await readFile(output);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
