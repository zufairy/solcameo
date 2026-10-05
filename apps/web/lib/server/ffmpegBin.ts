import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const execFileP = promisify(execFile);

/**
 * Resolve a RUNNABLE ffmpeg binary path.
 *
 * Why not just `import ffmpegPath from "ffmpeg-static"` everywhere: the
 * package computes its path from `__dirname`, and when the dev bundler inlines
 * the module into a vendor chunk, that becomes
 * `.next/dev/server/vendor-chunks/ffmpeg` — a path with no binary behind it
 * ("spawn … ENOENT" on every render). Order of trust:
 *   1. FFMPEG_BIN env — the override ffmpeg-static itself honors; set in the
 *      prod Docker image (distro ffmpeg, drawtext-capable).
 *   2. The module-resolved path, but only if it's outside .next AND exists.
 *   3. The real node_modules binary: app-local, then the hoisted monorepo root.
 */
export function resolveFfmpegPath(): string | null {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  const fromModule = ffmpegPath as unknown as string | null;
  if (fromModule && !fromModule.includes(`${sep}.next${sep}`) && existsSync(fromModule)) return fromModule;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (const dir of [process.cwd(), join(process.cwd(), "..", "..")]) {
    const p = join(dir, "node_modules", "ffmpeg-static", exe);
    if (existsSync(p)) return p;
  }
  return fromModule;
}

/**
 * Probe a REMOTE video URL's duration via ffprobe — no download needed
 * (ffprobe reads container metadata straight over HTTP). Returns null on any
 * failure so a probe miss never blocks whatever the caller was doing (e.g.
 * computing a caption-timestamp offset for a stitched clip) — it just skips
 * the adjustment that needed it.
 */
/**
 * Extract the LAST frame of a remote video as a base64 PNG (no full download —
 * ffmpeg seeks from the end over HTTP). Returns null on any failure. Used for
 * frame-chain continuity when the video engine doesn't return a last-frame
 * itself (Seedance 1.5 Pro) — without it every chained clip re-anchored on the
 * ORIGINAL keyframe, so clip 2+ visibly restarted from the same frame.
 */
export async function extractLastFrameBase64(url: string): Promise<string | null> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg || !/^https?:\/\//i.test(url)) return null;
  try {
    const { stdout } = await execFileP(ffmpeg, [
      "-hide_banner", "-nostats",
      "-sseof", "-0.25", "-i", url,
      "-frames:v", "1", "-q:v", "2",
      "-f", "image2pipe", "-vcodec", "png", "-",
    ], { timeout: 45_000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer" as never }) as unknown as { stdout: Buffer };
    if (!stdout || stdout.length < 1024) return null;
    return Buffer.from(stdout).toString("base64");
  } catch (e) {
    console.warn(`[ffmpegBin] last-frame extract failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Container duration of a remote video, reading only its header (plus the
 *  moov atom via a Range request when it sits at the end). `headers` are sent
 *  on every HTTP request — e.g. a Drive API Bearer token. */
export async function probeRemoteVideoDurationSeconds(url: string, headers?: Record<string, string>): Promise<number | null> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return null;
  const headerArgs = headers && Object.keys(headers).length
    ? ["-headers", Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("")]
    : [];
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"));
  try {
    const { stdout } = await execFileP(ffprobe, [
      "-v", "error", ...headerArgs, "-show_entries", "format=duration", "-of", "csv=p=0", url,
    ], { timeout: 20_000 });
    const d = parseFloat(stdout.trim());
    if (Number.isFinite(d) && d > 0) return d;
  } catch { /* no ffprobe beside ffmpeg-static — fall back to ffmpeg's banner */ }
  // `ffmpeg -i <url>` with no output exits non-zero but prints the container's
  // "Duration: HH:MM:SS.xx" header after reading only the first bytes.
  try {
    await execFileP(ffmpeg, ["-hide_banner", "-nostdin", ...headerArgs, "-i", url], { timeout: 25_000 });
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "");
    const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
    if (m) {
      const d = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      if (Number.isFinite(d) && d > 0) return d;
    }
  }
  return null;
}

/* ── Mono downmix fallback ────────────────────────────────────────────────────
 * `-ac 1` asks ffmpeg to DOWNMIX to mono, which needs a known input channel
 * layout. Some sources (multitrack uploads, odd camera/recorder exports) carry
 * e.g. 32 channels with no layout, and ffmpeg aborts with
 *   "…between 32 channels and mono but there is not enough information to do it"
 * — which killed transcription for the whole clip job. On exactly that error we
 * retry taking the first channel via `pan` (layout-agnostic). Normal stereo /
 * mono sources never hit the fallback, so a hard-panned two-person interview
 * still gets both voices on the happy path. */
export const MONO_FALLBACK_FILTER = "pan=mono|c0=c0";

export function isChannelLayoutError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /channels and mono|not enough information to do it|Error reinitializing filters|Failed to configure output pad on auto_aresample/i.test(msg);
}

/** Same argv with the `-ac 1` downmix swapped for the layout-agnostic pan filter. */
export function monoFallbackArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-ac" && args[i + 1] === "1") { out.push("-af", MONO_FALLBACK_FILTER); i++; continue; }
    out.push(args[i]);
  }
  return out;
}

/** Run an ffmpeg argv; if it dies on an unknown channel layout, retry once with
 *  the first-channel fallback. Any other error propagates unchanged. */
export async function runWithMonoFallback<T>(run: (args: string[]) => Promise<T>, args: string[]): Promise<T> {
  try {
    return await run(args);
  } catch (e) {
    if (!isChannelLayoutError(e) || !args.includes("-ac")) throw e;
    console.warn("[ffmpeg] unknown channel layout — retrying mono extract with first-channel fallback");
    return await run(monoFallbackArgs(args));
  }
}

/* ── Corrupt/malformed AAC fallback ──────────────────────────────────────────
 * ffmpeg's native AAC decoder hard-aborts the WHOLE conversion on a single bad
 * frame in the source — e.g. "TNS filter order 16 is greater than maximum 12"
 * (a real, seen-in-production failure: one damaged frame anywhere in a 70-minute
 * source killed transcription for the entire clip run, credits charged and all,
 * with no way to recover short of a different source file). The frame is
 * genuinely malformed (common in some podcast/camera AAC encodes and files that
 * survived a lossy re-mux), not something we can pre-validate for — the fix is
 * to tell ffmpeg to tolerate it: skip the bad frame and keep decoding instead of
 * treating it as fatal. A few dropped milliseconds of audio is a vastly better
 * outcome than aborting a paid, multi-window clip run outright. */
const CORRUPT_AUDIO_DECODE_RE = /TNS filter order|Invalid data found when processing input|Error while decoding stream|Error splitting the input into NAL units/i;

export function isCorruptAudioDecodeError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return CORRUPT_AUDIO_DECODE_RE.test(msg);
}

/** Same argv with input-side error tolerance inserted right before the FIRST
 *  `-i` (these must be input options — placed after `-i` they'd apply to the
 *  OUTPUT and do nothing). `-err_detect ignore_err` stops treating a corrupt
 *  frame as fatal; `-fflags +discardcorrupt` drops just that frame and moves on. */
export function corruptAudioFallbackArgs(args: string[]): string[] {
  const idx = args.indexOf("-i");
  if (idx === -1) return args;
  const out = [...args];
  out.splice(idx, 0, "-err_detect", "ignore_err", "-fflags", "+discardcorrupt");
  return out;
}

/** Run an ffmpeg argv; if it dies decoding a corrupt/malformed audio frame,
 *  retry once tolerating bad frames instead of aborting on them. Any other
 *  error (or a retry that's already carrying the tolerant flags) propagates
 *  unchanged — this is specifically for the "one bad frame nukes the whole
 *  job" failure mode, not a blanket ignore-all-errors switch. */
export async function runWithDiscardCorruptFallback<T>(run: (args: string[]) => Promise<T>, args: string[]): Promise<T> {
  try {
    return await run(args);
  } catch (e) {
    if (!isCorruptAudioDecodeError(e) || args.includes("-err_detect")) throw e;
    console.warn("[ffmpeg] corrupt/malformed audio frame in source — retrying with err_detect ignore_err + discardcorrupt");
    return await run(corruptAudioFallbackArgs(args));
  }
}
