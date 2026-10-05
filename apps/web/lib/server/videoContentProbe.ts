/**
 * Video content probing for Auto Hook.
 *
 * The operator's Auto-Hook brief (`hookText.prompt`) is "what kind of hook?" — but a
 * hook that ignores the actual video produces generic lines. To burn a hook that
 * MATCHES what the video is about, we give the hook generator a "content basis":
 * the real signal of what the video is saying/showing.
 *
 * Priority (best → cheapest → most likely):
 *  1. Generated videos already carry the spoken script (`scriptText`) — the exact
 *     words the agent says. This IS the content, at zero extra cost.
 *  2. Uploaded main-content videos have no script → probe the actual video:
 *       a. Transcript (spoken words) via /api/video/transcribe-clip.
 *       b. If there's no transcript (silent / music-only), describe representative
 *          frames with a KIE vision model, so the hook still understands the visuals.
 *  3. Nothing usable → the generator falls back to prompt + topic + niche alone.
 *
 * Every call is strictly best-effort and time-boxed — a slow probe never blocks the
 * burn; it degrades to the text-only path. Frames are downscaled JPEGs, never the raw
 * file, kept in-process only. Results are cached in-process keyed by content hash so
 * a long-lived invoker analyses a given video once.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { streamFetchToFile } from "@/lib/server/downloader";
import { callGeminiVision } from "@/lib/server/kie-claude";

const execFileP = promisify(execFile);

const CONTENT_CACHE = new Map<string, string>();
const CONTENT_CACHE_MAX = 2000;

// BUG FIX: this used to fold `seed` through a 32-bit int hash. In an UNBOUNDED,
// never-evicted, in-process cache serving every concurrent agent's clip jobs, a
// collision between two DIFFERENT video URLs served one agent's transcript/vision
// content basis as another agent's — the video's hook text (and anything derived
// from it) came from the wrong source video. Map keys can be arbitrary strings,
// so hashing bought nothing here; keying on the raw seed is simpler and exact.
function cacheKey(seed: string): string {
  return seed;
}

function internalHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
  };
}

function sliceTail(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

/**
 * Build the content basis for hook generation.
 *   - Generated videos → their script (free, exact).
 *   - Uploaded videos → transcript, else vision frames.
 */
export async function hookContentBasis(
  opts: { scriptText?: string; videoUrl?: string },
  origin: string,
): Promise<string> {
  const script = (opts.scriptText ?? "").trim();
  if (script) return sliceTail(script, 1600);
  if (opts.videoUrl) {
    try {
      return await probeVideoContent(opts.videoUrl, origin);
    } catch {
      return "";
    }
  }
  return "";
}

async function probeVideoContent(url: string, origin: string): Promise<string> {
  const key = cacheKey(`probe:${url}`);
  const hit = CONTENT_CACHE.get(key);
  if (hit !== undefined) return hit;

  let basis = "";
  // a) Spoken words first — the single strongest "what the video is about" signal.
  try {
    basis = await transcribeBasis(url, origin, 14_000);
  } catch {
    basis = "";
  }
  // b) No speech (silent / music) → understand the frames with KIE vision.
  if (!basis.trim()) {
    try {
      basis = await visionBasis(url);
    } catch {
      basis = "";
    }
  }
  // Evict the oldest half once at cap (Map iterates in insertion order) — bounds
  // memory on a process that's been probing videos for many agents for days.
  if (CONTENT_CACHE.size >= CONTENT_CACHE_MAX) {
    let toDrop = Math.floor(CONTENT_CACHE_MAX / 2);
    for (const k of CONTENT_CACHE.keys()) {
      if (toDrop-- <= 0) break;
      CONTENT_CACHE.delete(k);
    }
  }
  CONTENT_CACHE.set(key, basis);
  return basis;
}

async function transcribeBasis(url: string, origin: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${origin}/api/video/transcribe-clip`, {
      method: "POST",
      headers: internalHeaders(),
      signal: ctrl.signal,
      body: JSON.stringify({ sourceUrl: url }),
    });
    if (!r.ok) return "";
    const d = (await r.json().catch(() => ({}))) as {
      segments?: { text?: string }[];
    };
    const text = (Array.isArray(d.segments) ? d.segments.map((s) => String(s?.text ?? "")).join(" ") : "").trim();
    return sliceTail(text, 1400);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Syncs a single frame out of the video into a downscaled JPEG data URL. */
async function sampleFrame(ffmpeg: string, src: string, atSec: number, size: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFileP(
      ffmpeg,
      ["-y", "-ss", String(atSec), "-i", src, "-frames:v", "1", "-vf", `scale=${size}`, "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
      { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
    )
      .then(({ stdout }) => {
        const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as unknown as string);
        if (!buf.length) return resolve(null);
        resolve(`data:image/jpeg;base64,${buf.toString("base64")}`);
      })
      .catch(() => resolve(null));
  });
}

/** Parse `Duration: HH:MM:SS.xx` out of `ffmpeg -i` stderr. */
function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function visionBasis(url: string): Promise<string> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return "";
  const dir = await mkdtemp(join(tmpdir(), "vello-probe-"));
  const src = join(dir, "in.mp4");
  const frames: string[] = [];
  try {
    await streamFetchToFile(url, src);
    // Best-effort duration for representative sampling; default to early frames otherwise.
    let duration: number | null = null;
    try {
      const { stderr } = await execFileP(ffmpeg, ["-i", src, "-f", "null", "-"], { maxBuffer: 1024 * 1024 });
      duration = parseDuration(String(stderr));
    } catch {
      duration = null;
    }
    const t1 = duration ? Math.min(Math.max(duration * 0.3, 0), Math.max(duration - 0.2, 0)) : 0.3;
    const t2 = duration ? Math.min(Math.max(duration * 0.65, 0.5), Math.max(duration - 0.2, 0.5)) : 1.6;
    const f1 = await sampleFrame(ffmpeg, src, t1, "640: -2");
    const f2 = await sampleFrame(ffmpeg, src, t2, "640: -2");
    if (f1) frames.push(f1);
    if (f2) frames.push(f2);
    if (!frames.length) return "";

    // 20s vision budget so a slow model never wedges the burn.
    const summary = await Promise.race([
      callGeminiVision({
        system:
          "You describe the CONTENT of a short video from 2 frames. Reply in one or two plain sentences (under 60 words): what is the main subject, what is happening, where, and the vibe. No markdown, no leading words.",
        user: "Look at these frames from one video. What is happening and what is it about?",
        images: frames,
        maxTokens: 140,
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 20_000)),
    ]);
    return sliceTail(summary, 700);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}