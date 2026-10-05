// Local disk cache of /dev/jev source videos, keyed by the URL we cut from.
// A search → cut → re-cut loop on one video downloads it once; an upload through
// /api/media/upload-jev drops its bytes here as they stream to R2, so the first
// cut after an upload skips the download entirely.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { streamFetchToFile } from "@/lib/server/downloader";

const SRC_DIR = join(tmpdir(), "vello-jev-src");
// Long videos are hundreds of MB each — keep only the newest few.
const SRC_KEEP = 4;

export const sourceCachePath = (url: string) => join(SRC_DIR, `${createHash("sha1").update(url).digest("hex")}.mp4`);

async function prune(): Promise<void> {
  const files = await readdir(SRC_DIR).catch(() => [] as string[]);
  const aged = await Promise.all(files.map(async (f) => ({ f, t: (await stat(join(SRC_DIR, f)).catch(() => null))?.mtimeMs ?? 0 })));
  for (const { f } of aged.sort((a, b) => b.t - a.t).slice(SRC_KEEP)) await rm(join(SRC_DIR, f), { force: true }).catch(() => {});
}

/** Move a finished local file into the cache under `url`. false when the cache
 *  dir is unusable (other volume / perms) — the file is then left where it was. */
export async function adoptIntoSourceCache(file: string, url: string): Promise<boolean> {
  try {
    await mkdir(SRC_DIR, { recursive: true });
    await rename(file, sourceCachePath(url));
  } catch {
    return false;
  }
  await prune();
  return true;
}

/** Local path of `url`, downloading it (into `workDir`, then the cache) on a miss. */
export async function cachedSource(url: string, workDir: string): Promise<{ path: string; hit: boolean }> {
  const path = sourceCachePath(url);
  if (await stat(path).then((s) => s.size > 0, () => false)) return { path, hit: true };
  const part = join(workDir, "src.mp4");
  await streamFetchToFile(url, part, { timeoutMs: 240_000, requireVideo: true });
  return { path: (await adoptIntoSourceCache(part, url)) ? path : part, hit: false };
}

export type VideoProbe = { width: number; height: number; durationSeconds: number };

/** Display size (rotation applied, as ffmpeg's autorotate will output it) and
 *  duration, parsed from `ffmpeg -i` — the runtime image ships ffmpeg but no
 *  ffprobe. null when there's no video stream. */
export function probeVideo(ffmpegBin: string, file: string): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegBin, ["-hide_banner", "-nostdin", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    p.on("error", () => resolve(null));
    p.on("close", () => {
      const v = /Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(err);
      if (!v) return resolve(null);
      let width = Number(v[1]);
      let height = Number(v[2]);
      const rot = /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(err);
      if (rot && Math.abs(Number(rot[1] ?? rot[2])) % 180 === 90) [width, height] = [height, width];
      const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const durationSeconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
      resolve({ width, height, durationSeconds });
    });
  });
}
