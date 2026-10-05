import { managedYoutubeConfigured, runManagedYoutube } from "./managedYoutube";
export const SOCIAL_NEEDS_YTDLP =
  "Social-URL import requires yt-dlp on the server (set YTDLP_PATH). Paste a direct video link or use a brand campaign asset for now.";

/**
 * A downloaded source written to a TEMP FILE on disk (NOT buffered in RAM).
 * `path` is a file inside a caller-owned temp dir; the caller probes duration,
 * streams it to storage, then deletes the dir. Streaming to disk (vs returning a
 * Buffer) is what lets a multi-GB source through without OOMing the shared
 * process — a 2GB Buffer + its concat copies would blow V8's old-space limit.
 */
export interface FetchedSource { path: string; mime: string; }
/** Live download progress (from yt-dlp's `[download]` lines). */
export interface DownloadProgress { pct: number; downloadedBytes: number; totalBytes: number; speed?: string; stage?: string }
/** Per-fetch options callers pass. yt-dlp honors all; Drive honors mode/section
 *  via HTTP Range (segment/audio WITH a section fetch only the [start,end] bytes
 *  where Range is supported, else falls back to full); plain direct fetch ignores
 *  mode/section (no range support assumed for an arbitrary URL). */
export interface FetchOpts {
  onProgress?: (p: DownloadProgress) => void;
  /** Never use the residential proxy (health probe: "can the server pull YouTube on its own?"). */
  directOnly?: boolean;
  /** "audio" = tiny transcription pull; "segment" = one clip window; "full" = whole video. */
  mode?: "full" | "audio" | "segment";
  section?: { start: number; end: number };
  /** Cap the video height (px) — lower = far fewer bytes, so a LONG source pulls in
   *  time. The 9:16 crop only uses a center slice, so 720 stays sharp enough.
   *  Default 1080. (yt-dlp video pulls only; ignored for audio / direct fetch.) */
  maxHeight?: number;
  /** Override the yt-dlp retry loop's total wall-clock budget (default
   *  YTDLP_RETRY_BUDGET_MS, 3min) — for a caller with its OWN outer deadline
   *  (e.g. a synchronous route close to its maxDuration) that needs this ONE
   *  call to respect however much time is ACTUALLY left, not always get the
   *  full default allowance regardless of how late in the route it starts.
   *  Ignored for the direct/Drive downloaders (no retry loop to bound). */
  retryBudgetMs?: number;
}
/** What the downloader actually receives — caller opts plus the temp dir it must
 *  write its output file into (the caller, e.g. downloadAndStore, owns cleanup). */
export type FetchArgs = FetchOpts & { workDir: string };
export interface Downloader {
  kind: "direct" | "social";
  /** Download the source to a temp file inside opts.workDir. The Next route probes duration + streams it to storage. */
  fetchSource(url: string, opts: FetchArgs): Promise<FetchedSource>;
}

const PROGRESS_UNIT: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };

/**
 * Parse one yt-dlp `[download]` progress line (emitted with `--newline`):
 *   `[download]   1.5% of ~  42.34MiB at  512.00KiB/s ETA 01:20`
 *   `[download] 100% of   42.34MiB in 00:42`
 * Returns null for non-progress lines.
 */
export function parseYtdlpProgress(line: string): DownloadProgress | null {
  const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(B|KiB|MiB|GiB)(?:\s+at\s+([\d.]+\s*\w+\/s))?/);
  if (!m) return null;
  const pct = parseFloat(m[1]);
  const totalBytes = Math.round(parseFloat(m[2]) * (PROGRESS_UNIT[m[3]] ?? 1));
  return {
    pct,
    totalBytes,
    downloadedBytes: Math.round((totalBytes * pct) / 100),
    speed: m[4]?.replace(/\s+/g, "") || undefined,
  };
}

/**
 * Hard size cap. Sources stream to a temp file (never fully buffered in RAM), so
 * the limit is now ephemeral DISK not heap — 2GB safely covers ~2GB Drive videos
 * while still rejecting a runaway/lying multi-GB source before it exhausts disk.
 * (Was 500MB when the path buffered the whole file in RAM.)
 */
// Env-tunable so an operator can raise it for the whole-source cut pull: campaign
// sources are EXEMPT from the duration cap (clipJobs.ts) and a multi-hour Drive
// original (Drive never transcodes) routinely exceeds 2GB. The clip-batch pull
// streams to disk (RAM-safe), so the limit is ephemeral disk, not heap. Default
// unchanged (2GB) — set CLIP_MAX_DOWNLOAD_BYTES higher on the Railway box for big sources.
const MAX_DOWNLOAD_BYTES = Number(globalThis.process?.env?.CLIP_MAX_DOWNLOAD_BYTES) || 2 * 1024 * 1024 * 1024; // 2147483648
/**
 * Tighter cap for the RAM-buffering `safeFetchToBuffer` path (small assets:
 * overlay/concat/transcribe inputs). Those callers hold the whole Buffer in
 * heap, so they must stay at the old 500MB ceiling — only the disk-streaming
 * video download path (Drive/direct/yt-dlp) gets the 2GB MAX_DOWNLOAD_BYTES.
 */
const MAX_RAM_FETCH_BYTES = 500 * 1024 * 1024;
/** Wall-clock + idle-stall ceilings for network/child fetches. */
const FETCH_TIMEOUT_MS = 5 * 60_000;      // matches route maxDuration=300
const YTDLP_WALL_MS = 5 * 60_000;
const YTDLP_IDLE_MS = 90_000;             // no stdout/stderr chunk for 90s => stalled
// Wall clock for a DIRECT (no-proxy) attempt. A bot-walled direct pull fails in
// seconds; a healthy one streams at datacenter speed, so 3 min is generous
// while still leaving the shared retry budget for the proxy fallback.
const YTDLP_DIRECT_WALL_MS = 3 * 60_000;
// TOTAL wall-clock across every retry attempt in ONE fetchSource call (not
// per-attempt). Before this cap, MAX_ATTEMPTS(3) x YTDLP_WALL_MS(300s) meant a
// single stubborn download could legitimately run up to 900s — and after the
// player-client retry cycling was added, admin/samples's 3-rung resolution
// ladder multiplied that to a 2700s worst case. Both blow WAY past every
// caller's maxDuration=300 route budget; the platform gateway kills the
// request mid-flight and returns its own raw "upstream error" text instead of
// our JSON error shape, which is what broke the client's `res.json()` parse.
// 3 minutes total leaves real margin under a 300s route while still allowing
// every attempt a fair shot (attempts just get progressively less time as the
// budget depletes, same shape as clip-batch-start's pullBudget()).
const YTDLP_RETRY_BUDGET_MS = 3 * 60_000;
/** Ceiling for a whole-source audio extract (stream-through or disk). Runs on the
 *  ASYNC download path (off the request thread) so it can outlast a single request
 *  for a multi-GB/multi-hour Drive pull, but is still bounded so a stalled stream
 *  can't pin the process. Env-tunable. */
const AUDIO_EXTRACT_WALL_MS = Number(globalThis.process?.env?.CLIP_AUDIO_EXTRACT_WALL_MS) || 25 * 60_000;

/** Reject hostnames that resolve to private/loopback/link-local/metadata ranges (SSRF guard). */
function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;            // IPv6 loopback/unspecified
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // fc00::/7 unique-local
  if (v.startsWith("fe80")) return true;                  // IPv6 link-local
  // IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) — strip the prefix and re-test as v4.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ip4 = mapped ? mapped[1] : v;
  const m = ip4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true;                  // 127.0.0.0/8 loopback
  if (a === 10) return true;                    // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;      // 192.168.0.0/16
  if (a === 169 && b === 254) return true;      // 169.254.0.0/16 link-local incl. 169.254.169.254 metadata
  if (a === 0) return true;                     // 0.0.0.0/8
  return false;
}

/** Resolve a URL's host to all A/AAAA records and reject if ANY is private/loopback/link-local; reject non-http(s). */
export async function assertPublicHttpUrl(target: string): Promise<void> {
  let u: URL;
  try { u = new URL(target); } catch { throw new Error("Invalid download URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Blocked URL scheme: ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const { isIP } = await import("node:net");
  if (isIP(host)) { if (isBlockedIp(host)) throw new Error("Blocked private/loopback address"); return; }
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(host, { all: true });
  if (!records.length) throw new Error("Could not resolve download host");
  for (const r of records) if (isBlockedIp(r.address)) throw new Error("Download host resolves to a blocked private/loopback address");
}

/** The shared RAM-buffer size cap (export so other ingestion sites use the SAME ceiling). */
export const MAX_FETCH_BYTES = MAX_RAM_FETCH_BYTES;

/**
 * SSRF-safe fetch → Buffer for ANY content type (audio, image, video, bytes).
 * Validates the host (+ every redirect hop) against the private/loopback/metadata
 * block-list, follows redirects MANUALLY, and enforces a byte cap (declared
 * Content-Length AND a streaming counter) so an attacker URL can't reach internal
 * services or OOM the process. Use this in place of any raw `fetch(userUrl)` that
 * buffers the body. Throws on a blocked host, oversize, or non-2xx.
 */
export async function safeFetchToBuffer(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ buffer: Buffer; mime: string }> {
  const maxBytes = opts.maxBytes ?? MAX_RAM_FETCH_BYTES;
  const ctrl = new AbortController();
  // A caller can pass a tighter timeout than the full route budget so one slow
  // download (e.g. a fat gameplay-bg mp4) can't eat the whole 300s and 502 the route.
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let current = url;
    let res: Response;
    for (let hop = 0; ; hop++) {
      if (hop > 5) throw new Error("Too many redirects");
      await assertPublicHttpUrl(current);
      res = await fetch(current, { redirect: "manual", signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = new URL(loc, current).toString();
        continue;
      }
      break;
    }
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
    const mime = res.headers.get("content-type") ?? "";
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Resource too large (${declared} bytes > ${maxBytes} cap).`);
    }
    if (!res.body) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > maxBytes) throw new Error(`Resource exceeded ${maxBytes}-byte cap.`);
      return { buffer, mime };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { ctrl.abort(); throw new Error(`Resource exceeded ${maxBytes}-byte cap during download.`); }
      chunks.push(Buffer.from(value));
    }
    return { buffer: Buffer.concat(chunks), mime };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SSRF-safe fetch that STREAMS the body straight to a temp file (never buffers
 * the whole thing in RAM) while enforcing the byte cap on both the declared
 * Content-Length and a live streaming counter. This is the multi-GB-safe path:
 * peak heap stays at one chunk, so a 2GB video can't OOM the process. Validates
 * the host + every redirect hop. Throws (and unlinks the partial file) on a
 * blocked host, oversize, or non-2xx.
 */
export async function streamFetchToFile(
  url: string,
  destPath: string,
  opts: { maxBytes?: number; timeoutMs?: number; requireVideo?: boolean } = {},
): Promise<{ mime: string }> {
  const maxBytes = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  const { createWriteStream } = await import("node:fs");
  const { unlink } = await import("node:fs/promises");
  try {
    let current = url;
    let res: Response;
    for (let hop = 0; ; hop++) {
      if (hop > 5) throw new Error("Too many redirects");
      await assertPublicHttpUrl(current);
      res = await fetch(current, { redirect: "manual", signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = new URL(loc, current).toString();
        continue;
      }
      break;
    }
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const mime = res.headers.get("content-type") ?? "video/mp4";
    if (opts.requireVideo && !/^video\//i.test(mime) && !VIDEO_EXT.test(url)) {
      throw new Error(`Not a video (content-type ${mime}). Use a direct .mp4/.mov link.`);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Source too large (${declared} bytes > ${maxBytes} cap).`);
    }
    const ws = createWriteStream(destPath);
    try {
      if (!res.body) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) throw new Error(`Source exceeded ${maxBytes}-byte cap.`);
        await new Promise<void>((resolve, reject) => ws.write(buf, (e) => (e ? reject(e) : resolve())));
      } else {
        let total = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            ctrl.abort();
            throw new Error(`Source exceeded ${maxBytes}-byte cap during download.`);
          }
          // Respect backpressure so a fast network can't outrun the disk + grow heap.
          if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", r));
        }
      }
      await new Promise<void>((resolve, reject) => ws.end((e?: Error | null) => (e ? reject(e) : resolve())));
    } catch (e) {
      ws.destroy();
      await unlink(destPath).catch(() => {});
      throw e;
    }
    return { mime };
  } finally {
    clearTimeout(timer);
  }
}

const SOCIAL_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com)$/i;
const DRIVE_HOSTS = /(^|\.)(drive|docs)\.google\.com$|^drive\.usercontent\.google\.com$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|#|$)/i;

/** Keyframe/VBR slack added on each side of a [start,end] seconds window before
 *  converting to bytes — covers bitrate variance + keeps a keyframe before the
 *  cut so ffmpeg `-ss … -c copy` lands cleanly. */
const DRIVE_RANGE_PAD_SECONDS = 30;
/** Bytes from the FRONT of the file always included with a window — the mp4
 *  `moov`/header atom (for faststart files) lives here and ffmpeg needs it to
 *  seek. (Non-faststart `moov`-at-end files won't be seekable from a mid-window
 *  partial → those fall back to a full download; see PART 4 limitation #2.) */
const DRIVE_HEADER_BYTES = 5 * 1024 * 1024;

/**
 * Map a [start,end]-seconds window to a padded Drive byte range using the file's
 * total size + duration (avg-bitrate estimate). Returns null when size OR
 * duration can't be determined — the honest fallback (caller does a full
 * download). `relStart` is where the wanted clip begins INSIDE the fetched
 * partial (so ffmpeg seeks within the partial, never the whole file).
 */
async function planDriveByteWindow(
  url: string,
  section: { start: number; end: number },
): Promise<{ byteStart: number; byteEnd: number; relStart: number } | null> {
  const drive = await import("./driveDownload");
  // Drive's metadata usually includes both size and duration. One cheap API
  // call avoids a multi-MB Range probe for every preview of a new file.
  const metadata = await drive.getDriveVideoMetadata(url);
  const size = metadata?.sizeBytes ?? await drive.getDriveFileSize(url);
  if (!size || !Number.isFinite(size) || size <= 0) return null;

  // We must know the total DURATION to convert seconds→bytes. Drive metadata has
  // no duration, so probe a small head range (container header) with ffmpeg.
  const duration = metadata?.durationSeconds ?? await probeDriveDurationFromHead(url, size);
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null;

  const bytesPerSec = size / duration;
  const padStart = Math.max(0, section.start - DRIVE_RANGE_PAD_SECONDS);
  const padEnd = Math.min(duration, section.end + DRIVE_RANGE_PAD_SECONDS);
  // Include the header bytes (moov atom for faststart mp4) so ffmpeg can seek.
  const byteStart = Math.max(0, Math.min(Math.floor(padStart * bytesPerSec), size - 1));
  const byteEnd = Math.min(size - 1, Math.ceil(padEnd * bytesPerSec));
  // relStart: seconds from the start of the BYTE window to the wanted clip start.
  // We fetch from byte 0 (header) through byteEnd so the partial begins at t=0,
  // making relStart simply section.start.
  const fetchByteEnd = Math.max(byteStart, byteEnd, DRIVE_HEADER_BYTES - 1);
  // For a clip late in a very large source the [0..fetchByteEnd] span approaches
  // the whole file; if it would exceed the download cap the ranged fetch throws
  // AND the caller's full-download fallback throws again (a misleading 500). Bail
  // to null so the caller makes a single honest full-download attempt instead.
  if (fetchByteEnd + 1 > MAX_DOWNLOAD_BYTES) return null;
  return { byteStart: 0, byteEnd: fetchByteEnd, relStart: section.start };
}

/** Fetch the first few MB of a Drive file (Range) to a temp file and ffmpeg-probe
 *  its duration. Returns 0 when Range isn't honored or the header lacks duration. */
async function probeDriveDurationFromHead(url: string, size: number): Promise<number> {
  const { join } = await import("node:path");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const drive = await import("./driveDownload");
  const dir = await mkdtemp(join(tmpdir(), "vello-dhead-"));
  const headPath = join(dir, "head");
  try {
    const headEnd = Math.min(size - 1, DRIVE_HEADER_BYTES - 1);
    const r = await drive.downloadDriveByteRange(url, headPath, { byteStart: 0, byteEnd: headEnd }, MAX_DOWNLOAD_BYTES);
    if (!r.ranged) return 0; // Range not honored — caller falls back to full download.
    const { resolveFfmpegPath } = await import("./ffmpegBin");
    const ff = resolveFfmpegPath();
    if (!ff) return 0;
    const { probeDuration } = await import("./ytDownload");
    return await probeDuration(ff, headPath);
  } catch {
    return 0;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** ffmpeg stream-copy a [relStart, relStart+len] window (optionally audio-only)
 *  out of an on-disk partial into destPath. -c copy reads only the spanned bytes
 *  (no re-encode). Rejects on a non-zero exit so the caller can fall back. */
async function ffmpegCut(
  ff: string,
  srcPath: string,
  destPath: string,
  relStart: number,
  lengthSec: number,
  audioOnly: boolean,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  const args = [
    "-y",
    "-ss", relStart.toFixed(3),
    "-i", srcPath,
    "-t", lengthSec.toFixed(3),
    ...(audioOnly ? ["-vn"] : []),
    "-c", "copy",
    destPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ff, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg cut exited ${code}: ${err.slice(-300)}`))));
  });
}

/**
 * Decide how a Drive fetch should be served from (mode, section):
 *  - "rangeWindow": one clip window (segment, or audio-only window) → HTTP Range.
 *  - "audioExtract": the WHOLE source as audio-only (no section) → download the
 *    file once and strip video to a tiny artifact. This is the path the cloud
 *    pipeline's first step uses (mode:"audio", no section); it MUST NOT fall
 *    through to a full *video* download (the campaign-clip 290s-timeout bug — a
 *    multi-GB Drive video was pulled + re-encoded whole).
 *  - "full": the legacy whole-video pull.
 */
export function planDriveFetch(mode: "full" | "audio" | "segment", hasSection: boolean): "rangeWindow" | "audioExtract" | "full" {
  if ((mode === "segment" || mode === "audio") && hasSection) return "rangeWindow";
  if (mode === "audio") return "audioExtract";
  return "full";
}

/** ffmpeg argv that strips video and downmixes to mono 16kHz (the format STT
 *  wants) → a tiny artifact regardless of source size. `input` is "pipe:0" for a
 *  stream-through extract (the video never lands on disk) or a file path for the
 *  disk-fallback extract. */
export function buildAudioExtractArgs(input: string, outPath: string): string[] {
  // -f mp3 so the muxer is fixed regardless of the output path's extension (the
  // workDir artifact has no extension) and the input format is auto-probed (works
  // for a "pipe:0" stream and a file path alike).
  return ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", outPath];
}

/** Spawn ffmpeg to extract audio. `stdin` (a web ReadableStream) → stream-through
 *  extract ("pipe:0", no disk); omit it for a file-path extract. Rejects on a
 *  non-zero exit (e.g. a moov-at-END mp4 can't be decoded from a pipe → caller
 *  falls back to the disk path). Bounded by a generous wall-clock SIGKILL so a
 *  stalled/over-long pull can't pin the process forever. */
export async function runAudioExtract(
  ffmpegBin: string,
  input: string,
  outPath: string,
  stdin?: ReadableStream<Uint8Array>,
): Promise<void> {
  // A piped stream can't be replayed — its failure falls through to the
  // caller's disk path, which gets the channel-layout retry below.
  if (stdin) return runAudioExtractOnce(ffmpegBin, buildAudioExtractArgs(input, outPath), outPath, stdin);
  const { runWithMonoFallback } = await import("./ffmpegBin");
  return runWithMonoFallback((args) => runAudioExtractOnce(ffmpegBin, args, outPath), buildAudioExtractArgs(input, outPath));
}

async function runAudioExtractOnce(
  ffmpegBin: string,
  args: string[],
  outPath: string,
  stdin?: ReadableStream<Uint8Array>,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  const proc = spawn(ffmpegBin, args, {
    stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"],
  });
  let err = "";
  proc.stderr?.on("data", (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
  // A broken pipe (ffmpeg exits early on a moov-at-end stream) must not crash the
  // process — swallow EPIPE on stdin; the non-zero close drives the rejection.
  proc.stdin?.on("error", () => {});

  let settled = false;
  const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); fn(); };
  const wall = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* gone */ } settle(() => { /* close handler rejects */ }); }, AUDIO_EXTRACT_WALL_MS);

  const closed = new Promise<void>((resolve, reject) => {
    proc.on("error", (e) => settle(() => reject(e)));
    proc.on("close", (code) => settle(() => (code === 0 ? resolve() : reject(new Error(`ffmpeg audio-extract exited ${code}: ${err.slice(-300)}`)))));
  });

  if (stdin && proc.stdin) {
    // Pump the web stream into ffmpeg stdin with backpressure. If ffmpeg dies the
    // write throws/EPIPEs — caught so `closed` surfaces the real ffmpeg error.
    const pump = (async () => {
      const reader = stdin.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!proc.stdin!.write(Buffer.from(value))) {
            await new Promise<void>((r) => proc.stdin!.once("drain", r));
          }
        }
      } finally {
        try { proc.stdin!.end(); } catch { /* already closed */ }
        reader.releaseLock?.();
      }
    })().catch(() => { /* ffmpeg-side failure is reported by `closed` */ });
    await Promise.all([closed, pump]);
    await assertExtractedAudio(outPath, err);
    return;
  }
  await closed;
  await assertExtractedAudio(outPath, err);
}

/** ffmpeg can exit 0 yet write an EMPTY/near-empty file when it couldn't actually
 *  decode the input — most notably a moov-at-END .mov/.mp4 read from a NON-SEEKABLE
 *  pipe (the moov index is needed up-front but lives at the end; you can't seek back
 *  in a stream). Treat a trivially-small output as a FAILURE so the caller falls back
 *  to the seekable disk path. A real mono-16k mp3 is many KB even for a few seconds,
 *  so 1KB is a safe floor; and an empty/garbage artifact otherwise reaches the
 *  transcriber as an undecodable "src.mp4: Invalid data found when processing input". */
async function assertExtractedAudio(outPath: string, ffmpegStderr: string): Promise<void> {
  const { stat } = await import("node:fs/promises");
  let size = -1;
  try { size = (await stat(outPath)).size; } catch { /* never created */ }
  if (size < 1024) {
    throw new Error(`audio-extract produced no/empty output (${size < 0 ? "missing" : size + "B"}) — input not decodable from this path (e.g. a moov-at-end .mov over a pipe). ${ffmpegStderr.slice(-200)}`);
  }
}

/** Google Drive (service account for private, public-link fallback). Streams the
 *  file to disk inside the caller's workDir — never buffers in RAM. Honors
 *  mode/section via HTTP Range (mode:"segment"/"audio" with a section fetch only
 *  the [start,end] bytes where Drive supports Range; otherwise falls back to the
 *  unchanged full download). mode:"full" and no-section pulls are byte-identical
 *  to the previous behavior. */
const driveDownloader: Downloader = {
  kind: "direct",
  async fetchSource(url: string, opts: FetchArgs): Promise<FetchedSource> {
    const { mode = "full", section, workDir, onProgress } = opts;
    const { join } = await import("node:path");
    const drive = await import("./driveDownload");
    const destPath = join(workDir, "src");

    const plan = planDriveFetch(mode, !!section);
    if (plan === "rangeWindow" && section) {
      onProgress?.({ pct: 5, downloadedBytes: 0, totalBytes: 0, stage: "Checking Google Drive video metadata" });
      const { resolveFfmpegPath } = await import("./ffmpegBin");
      const ff = resolveFfmpegPath();
      const plan = ff ? await planDriveByteWindow(url, section) : null;
      if (ff && plan) {
        onProgress?.({ pct: 15, downloadedBytes: 0, totalBytes: 0, stage: "Fetching the selected video window" });
        const partialPath = join(workDir, "partial");
        const result = await drive.downloadFromDriveToFile(url, partialPath, MAX_DOWNLOAD_BYTES, {
          range: { byteStart: plan.byteStart, byteEnd: plan.byteEnd },
          onProgress: (progress) => onProgress?.({
            ...progress,
            pct: 15 + 65 * Math.min(1, progress.downloadedBytes / Math.max(1, progress.totalBytes || plan.byteEnd - plan.byteStart + 1)),
            stage: "Downloading first 10 seconds from Google Drive",
          }),
        });
        // Whether or not Range was honored, the source bytes are now on disk at
        // partialPath (ranged → partial window; not ranged → full file). ffmpeg
        // cuts the wanted window out of it, stripping video for audio mode.
        const audioOnly = mode === "audio";
        const lengthSec = Math.max(0.1, section.end - section.start);
        try {
          await ffmpegCut(ff, partialPath, destPath, plan.relStart, lengthSec, audioOnly);
          const { unlink } = await import("node:fs/promises");
          await unlink(partialPath).catch(() => {});
          return { path: destPath, mime: audioOnly ? "audio/mp4" : (result.mime || "video/mp4") };
        } catch (e) {
          // ffmpeg couldn't cut from the partial (e.g. moov-at-end + a mid-file
          // window) — fall back to a full download below.
          console.warn(`[drive] ffmpeg cut from partial failed (${e instanceof Error ? e.message : e}) — full download fallback`);
          const { unlink } = await import("node:fs/promises");
          await unlink(partialPath).catch(() => {});
        }
      }
      // Range/plan/ffmpeg unavailable — full download, then cut the window so the
      // returned artifact is still just the requested clip (audio-only for audio).
      onProgress?.({ pct: 12, downloadedBytes: 0, totalBytes: 0, stage: "Opening Google Drive video" });
      const { mime } = await drive.downloadFromDriveToFile(url, destPath, MAX_DOWNLOAD_BYTES, {
        onProgress: (progress) => onProgress?.({
          ...progress,
          pct: progress.totalBytes > 0 ? 15 + 65 * Math.min(1, progress.downloadedBytes / progress.totalBytes) : 15,
          stage: "Downloading Google Drive video for preview",
        }),
      });
      if (ff) {
        const fullPath = join(workDir, "full");
        const { rename, unlink } = await import("node:fs/promises");
        await rename(destPath, fullPath).catch(() => {});
        try {
          await ffmpegCut(ff, fullPath, destPath, section.start, Math.max(0.1, section.end - section.start), mode === "audio");
          await unlink(fullPath).catch(() => {});
          return { path: destPath, mime: mode === "audio" ? "audio/mp4" : (mime || "video/mp4") };
        } catch {
          // Couldn't cut — return the full file as-is (rename back).
          await rename(fullPath, destPath).catch(() => {});
        }
      }
      return { path: destPath, mime: mime || "video/mp4" };
    }

    // WHOLE-SOURCE AUDIO (mode:"audio", no section) — the cloud pipeline's first
    // step. Produce a TINY audio-only artifact instead of pulling+re-encoding the
    // whole video (the campaign-clip 290s-timeout bug). Drive can't serve an
    // audio-only stream, so we still transfer the file once — but we strip video
    // on the fly so nothing large lands on disk and the upload stays tiny.
    if (plan === "audioExtract") {
      const { resolveFfmpegPath } = await import("./ffmpegBin");
      const ff = resolveFfmpegPath();
      const audioPath = join(workDir, "audio.mp3");
      if (ff) {
        // 1) STREAM-THROUGH: pipe the Drive bytes straight into ffmpeg → audio
        //    only, no full video on disk. Handles >2GB sources (faststart mp4s).
        try {
          const { body } = await drive.openDriveStream(url);
          await runAudioExtract(ff, "pipe:0", audioPath, body);
          return { path: audioPath, mime: "audio/mpeg" };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // A Drive AUTH/QUOTA 4xx won't be fixed by re-pulling to disk — it just hits
          // Drive AGAIN and re-trips the 24h quota. Only a moov-at-end DECODE failure
          // (ffmpeg can't seek a piped mp4) benefits from the disk fallback, so rethrow
          // access errors instead of doubling the Drive hit for the same file.
          if (drive.isDriveAccessBlock(msg)) throw e;
          console.warn(`[drive] stream audio-extract failed (${msg}) — disk-fallback extract`);
        }
        // 2) DISK FALLBACK: a moov-at-END mp4 can't be decoded from a pipe. Pull
        //    the full file to disk (≤2GB cap) then extract audio from it. A >2GB
        //    moov-at-end source can't be served either way → a clear "too large".
        const fullPath = join(workDir, "full");
        const { unlink } = await import("node:fs/promises");
        await drive.downloadFromDriveToFile(url, fullPath, MAX_DOWNLOAD_BYTES);
        await runAudioExtract(ff, fullPath, audioPath);
        await unlink(fullPath).catch(() => {});
        return { path: audioPath, mime: "audio/mpeg" };
      }
      // No ffmpeg → can't extract here; fall through to the full download (the
      // transcribe route extracts audio itself, so the job still works).
    }

    // mode:"full" (or audio with no ffmpeg) → full stream to disk (byte-identical
    // to the previous full behavior: no opts.range, no ffmpeg cut).
    const { mime } = await drive.downloadFromDriveToFile(url, destPath, MAX_DOWNLOAD_BYTES, {
      onProgress: (progress) => onProgress?.({
        ...progress,
        pct: progress.totalBytes > 0 ? Math.min(100, progress.downloadedBytes / progress.totalBytes * 100) : 0,
        stage: "Downloading from Google Drive",
      }),
    });
    return { path: destPath, mime };
  },
};

const directFetch: Downloader = {
  kind: "direct",
  async fetchSource(url: string, opts: FetchArgs): Promise<FetchedSource> {
    const { join } = await import("node:path");
    const destPath = join(opts.workDir, "src");
    const { mime } = await streamFetchToFile(url, destPath, {
      maxBytes: MAX_DOWNLOAD_BYTES,
      requireVideo: true,
    });
    return { path: destPath, mime };
  },
};

/**
 * yt-dlp argv for one capped-resolution mp4. Prefers <=1080p mp4 video+audio,
 * merges to mp4, skips playlists, and caps file size so a giant source can't
 * exhaust memory when the route buffers it. The output template lets yt-dlp pick
 * the extension; the caller scans the dir for the produced file.
 */
export type YtdlpMode = "full" | "audio" | "segment";

/** YouTube player-client fallback chain. yt-dlp tries these in order and uses the
 *  first that isn't bot-walled through our proxy — resilient to YouTube tightening
 *  any single client. All download without a JS/nsig runtime.
 *
 *  NB: the `tv` (TVHTML5) client is DELIBERATELY EXCLUDED — YouTube now serves
 *  DRM-protected formats to it on ALL videos (an ongoing experiment), which yt-dlp
 *  rejects with "This video is DRM protected". `android_vr` + `web_safari` + `ios`
 *  still return clean, downloadable formats. See yt-dlp#12563 / #13001.
 *  Override wholesale with YTDLP_PLAYER_CLIENT (comma-separated). */
export const DEFAULT_YT_PLAYER_CLIENTS = "android_vr,web_safari,ios";
/** Client chain when a PO-token provider is wired: the web-family clients are
 *  the ones the provider mints GVS tokens for (android_vr never gets one), and
 *  `tv` needs no token at all — a clean, token-backed order for a bare
 *  datacenter IP. */
export const POT_YT_PLAYER_CLIENTS = "web_safari,mweb,tv";

/** yt-dlp extractor-args pointing at a bgutil-ytdlp-pot-provider HTTP server. */
export function potProviderExtractorArg(baseUrl: string): string {
  return `youtubepot-bgutilhttp:base_url=${baseUrl.replace(/\/+$/, "")}`;
}

/** One yt-dlp invocation slot in the retry plan. */
export interface YtdlpAttempt {
  useProxy: boolean;
  /** Route this attempt through the free Cloudflare WARP egress (scripts/warp.sh)
   *  instead of the paid residential proxy. `rotate` = switch to a fresh WARP
   *  identity (new exit IP) first. */
  warp?: boolean;
  rotate?: boolean;
}

/**
 * Attempt plan. The residential proxy is BILLED per GB, so it is the FALLBACK:
 * direct clients go first (cookies + PO token make a datacenter IP pass for
 * many videos); the proxy is only the final fallback. Never skip direct based
 * on stale process memory: a proxy can later exhaust its paid quota while a
 * different direct player client still downloads the video successfully.
 * `directFirst=false` remains an explicit operator escape hatch for proxy-only.
 */
export function planYtdlpAttempts(o: {
  hasProxy: boolean; proxyKnownNeeded: boolean; directFirst?: boolean;
  /** Free WARP egress is running (YTDLP_WARP_PROXY). */
  hasWarp?: boolean;
  /** The server's own IP was bot-walled recently — don't make users wait on it. */
  directWalled?: boolean;
}): YtdlpAttempt[] {
  const directFirst = o.directFirst ?? true;
  if (o.hasWarp) {
    // Free routes first: one direct pull (skipped while our IP is known-walled),
    // then WARP, then WARP on a FRESH identity if YouTube walled that exit, and
    // only then the paid proxy.
    const plan: YtdlpAttempt[] = [];
    if (!o.directWalled && directFirst) plan.push({ useProxy: false });
    plan.push({ useProxy: false, warp: true }, { useProxy: false, warp: true, rotate: true });
    if (o.hasProxy) plan.push({ useProxy: true });
    return plan;
  }
  if (!o.hasProxy) return [{ useProxy: false }, { useProxy: false }];
  if (!directFirst) return [{ useProxy: true }, { useProxy: true }, { useProxy: true }];
  // Two direct attempts intentionally select different player clients. The
  // proxy is paid and may be quota-exhausted, so it must not replace either.
  return [{ useProxy: false }, { useProxy: false }, { useProxy: true }];
}

/* ── Walled-direct memory ───────────────────────────────────────────────────
 * On a datacenter host YouTube's bot wall is sticky per IP: once our own IP
 * fails, the next pulls skip straight to WARP for a while instead of burning
 * ~7s per download on a direct attempt that can't pass. */
const DIRECT_WALLED_MS = 30 * 60_000;
let directWalledUntil = 0;
export function markDirectWalled() { directWalledUntil = Date.now() + DIRECT_WALLED_MS; }
export function directWalled(): boolean { return Date.now() < directWalledUntil; }

/* ── WARP identity rotation ───────────────────────────────────────────────── */
const WARP_ROTATE_COOLDOWN_MS = 5 * 60_000;
let lastWarpRotate = 0;
let warpRotating: Promise<void> | null = null;
/** Switch WARP to a fresh free identity (new exit IP) via scripts/warp.sh, then
 *  wait for wireproxy to come back. Coalesced + rate-limited: Cloudflare throttles
 *  registrations, and concurrent downloads must not each rotate. Never throws. */
export async function rotateWarp(): Promise<void> {
  if (warpRotating) return warpRotating;
  if (Date.now() - lastWarpRotate < WARP_ROTATE_COOLDOWN_MS) return;
  const script = process.env.WARP_SCRIPT?.trim();
  const proxy = process.env.YTDLP_WARP_PROXY?.trim();
  if (!script || !proxy) return;
  lastWarpRotate = Date.now();
  warpRotating = (async () => {
    try {
      const { execFile } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        execFile("sh", [script, "rotate"], { timeout: 30_000, env: process.env }, (err, out) => {
          console.warn(`[downloader] WARP rotate: ${err ? `failed (${err.message.slice(0, 120)})` : String(out).trim()}`);
          resolve();
        });
      });
      // Wait (≤10s) for the supervised wireproxy to accept connections again.
      const { port, hostname } = new URL(proxy);
      const net = await import("node:net");
      for (let i = 0; i < 20; i++) {
        const up = await new Promise<boolean>((resolve) => {
          const sock = net.connect(Number(port), hostname, () => { sock.destroy(); resolve(true); });
          sock.on("error", () => resolve(false));
        });
        if (up) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      warpRotating = null;
    }
  })();
  return warpRotating;
}

/* ── Exhausted-proxy memory ─────────────────────────────────────────────────── */
const PROXY_EXHAUSTED_MS = 30 * 60_000;
let proxyExhaustedUntil = 0;
export function markProxyExhausted() {
  proxyExhaustedUntil = Date.now() + PROXY_EXHAUSTED_MS;
  console.warn("[downloader] YTDLP_PROXY is out of traffic — skipping it for 30 min (direct pulls only)");
}
export function proxyExhausted(): boolean { return Date.now() < proxyExhaustedUntil; }

/** The one useful line out of a yt-dlp failure (for job logs / health probe). */
export function summarizeYtdlpError(msg: string): string {
  const m = msg.match(/ERROR:\s*(?:\[[^\]]+\]\s*)?(?:[\w-]{6,}:\s*)?([^\n]+)/);
  return (m?.[1] ?? msg).replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Stable key for a source: the YouTube video id when it is one, else the URL. */
export function youtubeVideoKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (host.endsWith("youtube.com")) {
      id = u.searchParams.get("v") ?? "";
      if (!id) { const m = u.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/); if (m) id = m[2]; }
    }
    return id ? `yt:${id}` : url;
  } catch { return url; }
}

/** yt-dlp treats `--max-filesize` as a SKIP, not a failure: it logs this line,
 *  leaves only a `.part`, and exits 0. Without catching it the caller only sees
 *  "produced no output file". */
export function isMaxFilesizeAbort(output: string): boolean {
  return /File is larger than max-filesize/i.test(output);
}

/** In audio mode yt-dlp's selector ends in `/b` for sources with no audio-only
 *  stream; the produced file is then a progressive VIDEO container that must be
 *  stripped to audio before it is stored/transcribed. Audio containers pass. */
export function ytdlpAudioNeedsExtract(filename: string): boolean {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  return !["m4a", "mp3", "opus", "ogg", "oga", "weba", "aac", "wav", "flac"].includes(ext);
}

export function buildYtdlpArgs(
  url: string,
  outPath: string,
  opts: {
    ffmpegLocation?: string;
    cookiesPath?: string;
    proxy?: string;
    mode?: YtdlpMode;
    section?: { start: number; end: number };
    playerClient?: string;
    poToken?: string;
    maxHeight?: number;
    /** bgutil-ytdlp-pot-provider HTTP server (e.g. http://127.0.0.1:4416). */
    potProviderUrl?: string;
    /** Extra yt-dlp plugin directory (the bgutil plugin zip lives there). */
    pluginDirs?: string;
    /** External JS runtime for yt-dlp's n-challenge solver ("node" in our
     *  image). Web clients return only itag 18 (360p) without it. */
    jsRuntime?: string;
  } = {},
): string[] {
  const mode = opts.mode ?? "full";
  const defaultClients = opts.potProviderUrl ? POT_YT_PLAYER_CLIENTS : DEFAULT_YT_PLAYER_CLIENTS;
  const common = [
    "--no-playlist",
    // Emit one progress line per update (newline-terminated, not a \r bar) so the
    // caller can parse live byte progress off stdout.
    "--newline",
    "--no-warnings",
    // ── Speed + resilience ────────────────────────────────────────────────────
    // YouTube throttles a single media connection to a trickle (~50-100 KB/s) which
    // is THE cause of a download that crawls / looks "stuck at 1%". Requesting the
    // stream in bounded HTTP chunks defeats that per-connection throttle (each chunk
    // is a fresh ranged request at full speed) — the standard yt-dlp fix.
    "--http-chunk-size", "10M",
    // Pull DASH fragments in parallel — big win for fragmented (segment) pulls; a
    // no-op for single-file audio. Bounded so we don't hammer one proxy exit IP.
    "--concurrent-fragments", "4",
    // Let yt-dlp itself shrug off transient blips before our outer per-IP retry.
    "--retries", "3",
    "--fragment-retries", "10",
    // Fail a DEAD socket fast (a hung proxy connection) so our retry gets a fresh
    // exit IP instead of the idle watchdog SIGKILLing a stalled process minutes later.
    "--socket-timeout", "30",
    // YouTube serves media URLs per "player client". The default web client's URLs
    // 403 through our residential proxy (and need a JS runtime for the nsig sig).
    // Pass a CHAIN of clients that download cleanly + need no JS runtime: yt-dlp
    // tries them in order and uses the first that isn't bot-walled, so if YouTube
    // tightens one client the pull still succeeds on the next. (Ignored for
    // non-YouTube extractors.) Override the whole chain via YTDLP_PLAYER_CLIENT.
    // YTDLP_PO_TOKEN can add an official PO token for clients that need one.
    "--extractor-args",
    `youtube:player_client=${opts.playerClient || defaultClients}${opts.poToken ? `;po_token=${opts.poToken}` : ""}`,
    // PO-token provider (bgutil): yt-dlp asks this local server for a fresh
    // BotGuard token per request, which is what lets a bare datacenter IP
    // download without the residential proxy. The plugin that speaks to it is
    // a zip in `pluginDirs` (the standalone binary won't find it otherwise).
    ...(opts.potProviderUrl ? ["--extractor-args", potProviderExtractorArg(opts.potProviderUrl)] : []),
    ...(opts.pluginDirs ? ["--plugin-dirs", opts.pluginDirs] : []),
    // yt-dlp ≥ 2025.11 solves YouTube's "n" challenge in an external JS
    // runtime; without one, web clients silently drop every DASH format and
    // the pull degrades to itag 18 (360p) or fails with "page needs reload".
    ...(opts.jsRuntime ? ["--js-runtimes", opts.jsRuntime] : []),
    // ffmpeg is needed to mux the separate bestvideo+bestaudio streams. Point
    // yt-dlp at the bundled ffmpeg-static binary so merges work even when the
    // host has no system ffmpeg on PATH.
    ...(opts.ffmpegLocation ? ["--ffmpeg-location", opts.ffmpegLocation] : []),
    // YouTube bot-checks datacenter IPs ("Sign in to confirm you're not a
    // bot") — a browser cookie export and/or a proxy gets past it (see
    // YTDLP_COOKIES / YTDLP_PROXY below).
    ...(opts.cookiesPath ? ["--cookies", opts.cookiesPath] : []),
    ...(opts.proxy ? ["--proxy", opts.proxy] : []),
  ];

  if (mode === "audio") {
    // Audio-first: this audio is used ONLY for transcription → moment selection, so
    // fetch the SMALLEST audio-only stream, not the best. YouTube's low-bitrate m4a
    // (~48-70 kbps, itag 139/599) is ample for speech-to-text and roughly HALVES the
    // bytes vs bestaudio — a 1-hour source drops from ~55 MB to ~20 MB, so it lands
    // in seconds instead of stalling through the proxy. Prefer small m4a, then any
    // worst audio, then fall back to best so a source with no tiny format still works.
    // No video, no merge. The size cap is the SAME shared ceiling as full/segment
    // (2GB default) — NOT a tighter 200M. The trailing `/b` exists for sources
    // that expose NO audio-only stream at all (SABR-gated YouTube videos serve
    // only progressive itag 18); on those the fallback is a 360p VIDEO file
    // (~240 MB/hour), and a 200M cap made yt-dlp abort at ~80% WITH EXIT 0 and
    // no output ("yt-dlp produced no output file" — the Semangkuk clip runs).
    // fetchSource strips that fallback down to mono mp3 (ytdlpAudioNeedsExtract).
    return [...common, "-f", "wa[ext=m4a]/ba[ext=m4a][abr<=70]/wa/ba/b", "--max-filesize", ytdlpMaxFilesize(), "-o", outPath, url];
  }

  // Video height cap. 1080p keeps the 9:16 center-slice crisp; callers drop it to
  // 720 (or lower) for a LONG source where download bytes/speed dominate — half the
  // bytes, still sharp enough for the slice. Default 1080.
  // Default cap is 1440p (YTDLP_MAX_HEIGHT overrides): a 9:16 crop of a 16:9
  // source keeps only ~56% of the width, so a 1440p source crops to a much
  // sharper vertical clip than 1080p. Above-1080 tiers are usually VP9/AV1
  // (webm), so that tier accepts any codec (remuxed to mp4) — but ONLY when
  // yt-dlp's size estimate fits 70% of the download cap, so a long podcast
  // falls back to the 1080p mp4 ladder instead of blowing the cap.
  const envCap = Number(globalThis.process?.env?.YTDLP_MAX_HEIGHT);
  const h = Math.max(240, Math.round(opts.maxHeight ?? (Number.isFinite(envCap) && envCap > 0 ? envCap : 1440)));
  const budgetM = Math.max(50, Math.floor((MAX_DOWNLOAD_BYTES * 0.7) / (1024 * 1024)));
  // HD tier codec order: H.264 → VP9 → anything; SDR only (a vp9.2 HDR stream
  // renders washed-out in our 8-bit H.264 clips without tone-mapping).
  const hd = `[height<=${h}][height>1080][dynamic_range=SDR][filesize_approx<${budgetM}M]`;
  const hdTier = h > 1080
    ? `bv*${hd}[vcodec^=avc1]+ba[ext=m4a]/bv*${hd}[vcodec^=vp09]+ba[ext=m4a]/bv*${hd}[vcodec^=vp9]+ba[ext=m4a]/bv*${hd}+ba[ext=m4a]/`
    : "";
  const h1080 = Math.min(h, 1080);
  // ≤1080 rung: prefer H.264 (plays in every browser incl. older Safari, fastest
  // to decode) over the AV1-in-mp4 yt-dlp would otherwise rank first.
  const videoFmt = ["-f", `${hdTier}bv*[height<=${h1080}][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h1080}][ext=mp4]+ba[ext=m4a]/b[height<=${h1080}][ext=mp4]/b[ext=mp4]/b`, "--merge-output-format", "mp4"];

  if (mode === "segment" && opts.section) {
    // Download ONLY the chosen clip window (audio-first: we already know which
    // moments to cut). --force-keyframes-at-cuts makes the segment start EXACTLY
    // at section.start so the segment-relative word offset stays caption-synced.
    return [
      ...common,
      "--download-sections", `*${opts.section.start.toFixed(2)}-${opts.section.end.toFixed(2)}`,
      "--force-keyframes-at-cuts",
      ...videoFmt,
      "--max-filesize", ytdlpMaxFilesize(),
      "-o", outPath, url,
    ];
  }

  // Full download (direct .mp4 / Drive fallback, or a whole social video).
  return [...common, ...videoFmt, "--max-filesize", ytdlpMaxFilesize(), "-o", outPath, url];
}

/**
 * yt-dlp's own --max-filesize was hardcoded to "500M" — the RAM-buffer path's
 * cap (MAX_RAM_FETCH_BYTES above), NOT this disk-streaming path's. A full pull
 * of anything over ~45min at 1080p exceeds 500MB and yt-dlp aborts with a
 * filesize error — which is exactly what surfaced as "yt-dlp error" once full
 * downloads started running for longer social sources. Use the SAME 2GB
 * (CLIP_MAX_DOWNLOAD_BYTES-overridable) ceiling every other disk-streaming
 * downloader in this file already honors, so yt-dlp stops being the tightest
 * link in the chain.
 */
function ytdlpMaxFilesize(): string {
  return `${Math.max(1, Math.round(MAX_DOWNLOAD_BYTES / (1024 * 1024)))}M`;
}

/**
 * Inject a DataImpulse-style sticky-session tag (`__sessid-<id>`) into the proxy
 * username so EVERY request in one yt-dlp invocation — the info extraction, the
 * video stream, the audio stream (f140), and yt-dlp's ffmpeg merge child — exits
 * through the SAME residential IP.
 *
 * WHY this matters for the multi-stream full/segment pull: googlevideo media URLs
 * are IP-LOCKED to the exit IP that resolved them. Through a ROTATING residential
 * proxy the audio stream is fetched via a DIFFERENT exit IP than the one its URL
 * was locked to → the fragment 403s/drops → the `.part` is never written → yt-dlp's
 * final rename throws `ENOENT: Unable to rename … src.f140.m4a`. Pinning one IP for
 * the whole invocation eliminates that.
 *
 * Mirrors `scraperService.stickyProxy` (same `__sessid-` username format the
 * TikTok scraper + metadata probe already use over this proxy). DUPLICATED rather
 * than imported: downloader.ts is deliberately kept edge-runtime-loadable with only
 * lazy node deps, whereas scraperService statically imports the Node-only
 * uploadPost stack — importing it here would drag that graph into the edge tests.
 *
 * Returns the base unchanged when it carries no `user:pass` to tag, or undefined
 * when no proxy is configured. `base` is taken as an argument (not read from env)
 * so it stays a pure, unit-testable function.
 */
export function stickyProxy(base: string | undefined, sessionId: string): string | undefined {
  const b = base?.trim();
  if (!b) return undefined;
  const m = b.match(/^(https?:\/\/)([^:@/]+):([^@]+)@(.+)$/);
  if (!m) return b; // no credentials to tag — use as-is (behaves as the raw rotating proxy)
  const [, scheme, user, pass, hostport] = m;
  return `${scheme}${user}__sessid-${sessionId}:${pass}@${hostport}`;
}

// Monotonic per-process counter. A FRESH session id is minted per fetchSource
// invocation — and because the retry loop (ytDownload.ts downloadToLocal/
// downloadAndStore) re-invokes fetchSource, every RETRY lands on a NEW residential
// IP. That is the SAFER retry policy here: a retry fires because the prior attempt
// failed, and the most common post-fix failure is a rate-limited/blocked/dead exit
// IP — reusing the same IP would just fail again. There is nothing to gain from
// pinning the same IP across retries either, because yt-dlp re-extracts FRESH
// IP-locked URLs on every process spawn (the URLs are never carried between
// attempts). Within a SINGLE invocation the id is fixed, so all streams share one
// IP (the actual fix). No Math.random — deterministic counter + coarse timestamp.
let ytdlpProxySessionSeq = 0;
function nextProxySessionId(): string {
  return `${Date.now().toString(36)}${(++ytdlpProxySessionSeq).toString(36)}`;
}

/** Resolve the yt-dlp binary: explicit YTDLP_PATH → project-local ./bin (placed
 *  by the postinstall script) → `yt-dlp` on PATH. */
export async function resolveYtdlpBin(): Promise<string> {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  try {
    const { join } = await import("node:path");
    const { access } = await import("node:fs/promises");
    const local = join(process.cwd(), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    await access(local);
    return local;
  } catch {
    return "yt-dlp";
  }
}

/**
 * Downloads YouTube/TikTok/Instagram/X/Facebook videos via yt-dlp. The binary is
 * resolved by resolveYtdlpBin (YTDLP_PATH → ./bin → PATH). Node-only deps are
 * imported lazily so this module stays loadable under the edge-runtime used by
 * unit tests. If the binary is absent, rejects with SOCIAL_NEEDS_YTDLP rather
 * than a cryptic ENOENT.
 */
const socialDownloader: Downloader = {
  kind: "social",
  async fetchSource(url: string, opts: FetchArgs): Promise<FetchedSource> {
    const { onProgress, mode = "full", section, workDir, maxHeight } = opts;
    const { spawn } = await import("node:child_process");
    const { readdir, rename } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const bin = await resolveYtdlpBin();
    // Bundled ffmpeg so yt-dlp can merge video+audio without a system ffmpeg.
    const ffmpegLocation = (await import("./ffmpegBin")).resolveFfmpegPath() ?? undefined;
    // yt-dlp writes directly into the caller's workDir (which the caller cleans
    // up) so the produced file survives for the disk-streaming upload — no extra
    // temp dir, no RAM readFile.
    const dir = workDir;
    const outTemplate = join(dir, "src.%(ext)s");
    // Server-IP unblocking, both optional:
    //  - YTDLP_COOKIES: a Netscape cookies.txt export (raw text or base64) from
    //    a browser signed into YouTube — written to a temp file per download.
    //  - YTDLP_PROXY: forwarded to yt-dlp --proxy (e.g. a residential proxy).
    let cookiesPath: string | undefined;
    const cookiesEnv = process.env.YTDLP_COOKIES?.trim();
    if (cookiesEnv) {
      const { writeFile } = await import("node:fs/promises");
      const raw = cookiesEnv.startsWith("# ") || cookiesEnv.startsWith("#\t") || cookiesEnv.includes("\n")
        ? cookiesEnv
        : Buffer.from(cookiesEnv, "base64").toString("utf8");
      cookiesPath = join(dir, "cookies.txt");
      await writeFile(cookiesPath, raw, "utf8");
    }
    // Wrap the residential proxy in a STICKY session so the whole (possibly
    // multi-stream) pull — video f<N> + audio f140 + yt-dlp's ffmpeg merge child —
    // exits through ONE IP. Without this, a ROTATING proxy sends the audio stream
    // through a different exit IP than the one its IP-locked googlevideo URL was
    // resolved on → the fragment drops → the `.part` is never written → the final
    // rename throws ENOENT (`Unable to rename … src.f140.m4a`). Fresh session per
    // invocation ⇒ a retry escapes a poisoned IP (see nextProxySessionId). The
    // audio-only mode is single-stream so it never hit the bug, but running it
    // sticky too is harmless and keeps one code path.
    const clientChainOverride = process.env.YTDLP_PLAYER_CLIENT?.trim() || undefined;
    const poToken = process.env.YTDLP_PO_TOKEN?.trim() || undefined;
    // A proxy that answered "out of traffic" is skipped for a while — retrying
    // it only added seconds to every failure while its quota was exhausted.
    const hasProxy = Boolean(process.env.YTDLP_PROXY?.trim()) && !opts.directOnly && !proxyExhausted();
    // Free unblockers (see Dockerfile: bgutil provider on :4416 + plugin zip).
    const potProviderUrl = process.env.YTDLP_POT_PROVIDER_URL?.trim() || undefined;
    const pluginDirs = process.env.YTDLP_PLUGIN_DIRS?.trim() || undefined;
    // Default to node: it is always present where this app runs (Next server).
    // YTDLP_JS_RUNTIME=none disables (falls back to yt-dlp's built-ins).
    const jsRuntimeEnv = process.env.YTDLP_JS_RUNTIME?.trim();
    const jsRuntime = jsRuntimeEnv === "none" ? undefined : (jsRuntimeEnv || "node");
    const directFirst = process.env.YTDLP_DIRECT_FIRST?.trim() !== "0";
    const videoKey = youtubeVideoKey(url);
    // Retry-across-CLIENTS, not just fresh IPs — verified by hand against a real
    // 403'ing video (docs.kie.ai debugging session, Aug 2026): yt-dlp's comma
    // chain (e.g. "android_vr,web_safari,ios") only affects which formats get
    // LISTED during extraction. Once it picks the best-matching format, that
    // format's actual byte-fetch does NOT automatically fall through to a
    // different client in the chain if it 403s — the whole chain 403'd
    // identically across 3 fresh proxy sessions for that video. Forcing
    // `player_client=android` ALONE (isolated, not mixed into the chain)
    // succeeded immediately on the SAME video/proxy — but `android` alone
    // then failed bot-check on a DIFFERENT (otherwise-easy) video that the
    // default chain handles fine. Neither client is universally better; which
    // one YouTube currently trusts varies per video. So each RETRY now tries a
    // genuinely different client set (not just a new IP on the same doomed
    // set), cycling through this list — only when the operator hasn't pinned
    // YTDLP_PLAYER_CLIENT explicitly (an explicit override always wins).
    // With a PO-token provider the token-backed web clients go FIRST (they
    // return full DASH ladders on a bare datacenter IP); `tv` needs no token
    // and is the second-safest; `android` last (works but progressive-only).
    const CLIENT_RETRY_CHAIN = potProviderUrl
      ? [POT_YT_PLAYER_CLIENTS, "tv", "android"]
      : [DEFAULT_YT_PLAYER_CLIENTS, "android", "tv_embedded,web_creator"];
    const clientForAttempt = (attempt: number): string | undefined =>
      clientChainOverride ?? CLIENT_RETRY_CHAIN[(attempt - 1) % CLIENT_RETRY_CHAIN.length];
    // Tail of the most recent attempt's stderr — for the exit-0-no-file diagnostic.
    let lastYtdlpTail = "";
    // ONE yt-dlp invocation against a specific sticky proxy exit IP + player client.
    const runAttempt = (proxy: string | undefined, clientChain: string | undefined, wallMs: number) => new Promise<void>((resolve, reject) => {
        // Pipe stdout too — yt-dlp writes its `[download]` progress lines there.
        // ffmpeg (spawned by yt-dlp for --download-sections) does NOT read
        // yt-dlp's --proxy. The googlevideo media URL is IP-locked to the proxy's
        // exit IP, so an un-proxied ffmpeg fetch 403s. Forward the SAME sticky
        // proxy via env so the ffmpeg child uses the SAME exit IP. (Harmless for
        // native full/audio downloads, which already honor --proxy.)
        const proc = spawn(
          bin,
          buildYtdlpArgs(url, outTemplate, { ffmpegLocation: ffmpegLocation ?? undefined, cookiesPath, proxy, mode, section, playerClient: clientChain, poToken, maxHeight, potProviderUrl, pluginDirs, jsRuntime }),
          {
            stdio: ["ignore", "pipe", "pipe"],
            ...(proxy ? { env: { ...process.env, http_proxy: proxy, https_proxy: proxy, HTTP_PROXY: proxy, HTTPS_PROXY: proxy } } : {}),
          },
        );
        let err = "";
        // Progress lines can arrive split across chunks — buffer to whole lines.
        let lineBuf = "";
        // Stall detection: a wall-clock ceiling AND an idle watchdog reset on each
        // chunk. On expiry, SIGKILL the child then reject so the reject propagates
        // into the outer finally{ rm(dir) } (no leaked process or temp dir).
        let settled = false;
        const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); clearTimeout(idle); fn(); };
        const killStall = (why: string) => { try { proc.kill("SIGKILL"); } catch {} settle(() => reject(new Error(`yt-dlp ${why} — killed (stalled download). ${err.slice(-200)}`))); };
        const wall = setTimeout(() => killStall(`exceeded ${wallMs}ms wall clock`), wallMs);
        let idle = setTimeout(() => killStall(`idle ${YTDLP_IDLE_MS}ms (no output)`), YTDLP_IDLE_MS);
        const bump = () => { clearTimeout(idle); idle = setTimeout(() => killStall(`idle ${YTDLP_IDLE_MS}ms (no output)`), YTDLP_IDLE_MS); };
        const scanProgress = (chunk: string) => {
          if (!onProgress) return;
          lineBuf += chunk;
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";
          for (const ln of lines) {
            const p = parseYtdlpProgress(ln);
            if (p) onProgress(p);
          }
        };
        let capAbort = false;
        proc.stdout.on("data", (d) => { bump(); const s = d.toString(); scanProgress(s); if (!capAbort && isMaxFilesizeAbort(s)) capAbort = true; });
        proc.stderr.on("data", (d) => { bump(); const s = d.toString(); scanProgress(s); if (!capAbort && isMaxFilesizeAbort(s)) capAbort = true; err += s; if (err.length > 8000) err = err.slice(-8000); });
        proc.on("error", (e) =>
          settle(() => reject(new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? SOCIAL_NEEDS_YTDLP : `yt-dlp failed: ${e.message}`))),
        );
        proc.on("close", (code) => settle(() => {
          // A --max-filesize abort is a SKIP to yt-dlp (exit 0, only a .part on
          // disk). Surface it as the real, non-retryable cause — a new IP/client
          // can't shrink the source.
          if (capAbort) {
            return reject(new Error(
              `Source is larger than the ${ytdlpMaxFilesize()} download cap (yt-dlp skipped it). Raise CLIP_MAX_DOWNLOAD_BYTES on the server or use a shorter/lower-resolution source.`,
            ));
          }
          lastYtdlpTail = err;
          if (code === 0) return resolve();
          // YouTube anti-bot wall (hits datacenter IPs, not home connections) —
          // translate yt-dlp's hint into the actual operator fix.
          if (/confirm you.re not a bot|--cookies|cookies-from-browser|Sign in to confirm/i.test(err)) {
            return reject(new Error(
              "YouTube blocked the server's IP (bot check). You can upload the video file in the Clipping tab or paste a Google Drive link instead. Ops fix: set APIFY_TOKEN (managed residential downloader), or YTDLP_COOKIES / a residential YTDLP_PROXY.",
            ));
          }
          // Residential proxy plan ran out of bandwidth — an ACCOUNT-level quota,
          // not a per-IP block, so a fresh sticky session (the retry below) can't
          // fix it. Surface the real cause instead of a cryptic exit-1; the message
          // deliberately avoids RETRYABLE's keywords so the loop below fails fast.
          if (/TRAFFIC_EXHAUSTED|407 .*roxy|Tunnel connection failed/i.test(err)) {
            return reject(new Error(
              "YouTube is blocking our download servers right now (backup proxy out of bandwidth, 407 TRAFFIC_EXHAUSTED). Upload the video file in the Clipping tab, or paste a Google Drive link — both skip YouTube.",
            ));
          }
          // DRM / SABR-only: no downloadable format exists for this specific video
          // (rentals, some music, or a YouTube DRM experiment). A fresh IP can't fix
          // it — surface an actionable message instead of a cryptic exit-1.
          if (/DRM protected|DRM-protected|only.*DRM|requested format.*not available.*drm/i.test(err)) {
            return reject(new Error(
              "This YouTube video is DRM-protected and can't be downloaded (usually a rental/movie, some music videos, or a temporary YouTube DRM experiment). Try a different video, or use a direct .mp4 or Google Drive source. Signed-in YTDLP_COOKIES sometimes unlocks a clean format.",
            ));
          }
          reject(new Error(`yt-dlp exited ${code}: ${err.slice(-300)}`));
        }));
      });

    // Retry on a FRESH sticky proxy exit IP: residential proxies rotate, and a
    // single exit IP can be rate-limited/bot-flagged even when the account is
    // healthy. A new session ⇒ a new IP, which usually clears a transient block or
    // a fragment 403. Only worthwhile WITH a proxy — retrying through the same
    // blocked SERVER IP can't help, so no-proxy stays single-shot (fail fast).
    // Attempt plan: two DIRECT player clients first (free), residential proxy
    // only as the final fallback. We deliberately do not remember a previous
    // proxy need: direct access can recover while a paid proxy quota can expire.
    const warpProxy = opts.directOnly ? undefined : process.env.YTDLP_WARP_PROXY?.trim() || undefined;
    const plan = planYtdlpAttempts({ hasProxy, proxyKnownNeeded: false, directFirst, hasWarp: Boolean(warpProxy), directWalled: directWalled() });
    const MAX_ATTEMPTS = plan.length;
    // A fresh workspace per retry avoids a stale `.part`/format file from a failed
    // attempt (a different player-client picks a different format) being mistaken
    // for the produced output. Clean any leftovers between tries.
    const RETRYABLE = /blocked the server|bot check|confirm you.re not a bot|Sign in to confirm|\b403\b|fragment|Unable to rename|stalled download|idle \d+ms|timed out|HTTP Error 4|HTTP Error 5|SSLError|SSL: |RECORD_LAYER_FAILURE|EOF occurred in violation of protocol|Connection reset by peer|Remote end closed connection|Requested format is not available|Please sign in/i;
    let lastErr: Error | null = null;
    let directFailure = "";
    const retryDeadline = Date.now() + (opts.retryBudgetMs ?? YTDLP_RETRY_BUDGET_MS);
    try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const remaining = retryDeadline - Date.now();
      if (remaining < 15_000) {
        // Not enough of the shared retry budget left for a meaningful attempt —
        // stop here instead of starting one doomed to be killed mid-flight.
        throw lastErr ?? new Error("yt-dlp retry budget exhausted before any attempt could run");
      }
      const wallMs = Math.min(YTDLP_WALL_MS, remaining);
      const step = plan[attempt - 1];
      const useProxy = step.useProxy;
      if (step.warp && step.rotate) await rotateWarp();
      const proxy = step.warp ? warpProxy : useProxy ? stickyProxy(process.env.YTDLP_PROXY, nextProxySessionId()) : undefined;
      // Direct attempts cap the wall clock lower: a walled direct pull usually
      // fails within seconds, and a stalled one shouldn't eat the proxy's budget.
      const attemptWallMs = useProxy ? wallMs : Math.min(wallMs, YTDLP_DIRECT_WALL_MS);
      try {
        await runAttempt(proxy, clientForAttempt(attempt), step.warp ? wallMs : attemptWallMs);
        if (step.warp) console.log(`[downloader] WARP pull ok for ${videoKey}${potProviderUrl ? " · POT" : ""}`);
        else if (!useProxy) console.log(`[downloader] direct pull ok (no proxy) for ${videoKey}${potProviderUrl ? " · POT" : ""}${cookiesPath ? " · cookies" : ""}`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (useProxy && /\b407\b|TRAFFIC_EXHAUSTED|out of (?:bandwidth|traffic)/i.test(lastErr.message)) markProxyExhausted();
        // Our own IP hit the bot wall → skip direct for a while (WARP goes first).
        if (!useProxy && !step.warp && warpProxy && /blocked the server|bot check|Sign in to confirm/i.test(lastErr.message)) markDirectWalled();
        // Keep WHY the free direct pull failed — once the proxy also fails, its
        // error hides the real (fixable) reason, e.g. YouTube's bot wall.
        if (!useProxy && !directFailure) directFailure = summarizeYtdlpError(lastErr.message);
        if (useProxy && directFailure && attempt >= MAX_ATTEMPTS) {
          lastErr = new Error(`${lastErr.message} [direct pull failed first: ${directFailure}]`);
        }
        // A missing binary won't be fixed by a new IP — fail immediately.
        const fatal = lastErr.message === SOCIAL_NEEDS_YTDLP;
        if (fatal || attempt >= MAX_ATTEMPTS || !RETRYABLE.test(lastErr.message)) throw lastErr;
        const next = plan[attempt];
        const via = (a: YtdlpAttempt) => (a.warp ? (a.rotate ? "WARP (fresh identity)" : "WARP") : a.useProxy ? "fresh proxy IP" : "direct");
        console.warn(`[downloader] yt-dlp attempt ${attempt}/${MAX_ATTEMPTS} (${via(step)}, client=${clientForAttempt(attempt)}) failed, next=${via(next)} client=${clientForAttempt(attempt + 1)}: ${lastErr.message.slice(0, 160)}`);
        // Drop any partial files so the next attempt (possibly a different format)
        // starts clean and the produced-file scan can't pick up a stale `.part`.
        try {
          for (const n of await readdir(dir)) {
            if (n.startsWith("src.")) await (await import("node:fs/promises")).rm(join(dir, n), { force: true });
          }
        } catch { /* best-effort cleanup */ }
      }
    }
    } catch (chainErr) {
      // Every yt-dlp route (direct+POT, cookies, residential proxy) is walled or
      // out of quota → managed residential downloader (lib/server/managedYoutube),
      // when configured. Never for the health probe (directOnly measures OUR IP).
      const e = chainErr instanceof Error ? chainErr : new Error(String(chainErr));
      const walled = /blocked the server|bot check|confirm you.re not a bot|Sign in to confirm|TRAFFIC_EXHAUSTED|\b407\b|out of bandwidth|\b403\b|Please sign in/i.test(e.message);
      if (!walled || opts.directOnly || !isYoutubeUrl(url) || !managedYoutubeConfigured()) throw e;
      console.warn(`[downloader] yt-dlp walled for ${videoKey} (${summarizeYtdlpError(e.message)}) — managed residential fallback`);
      const envCap = Number(process.env.YTDLP_MAX_HEIGHT);
      const fbHeight = Math.max(240, Math.round(maxHeight ?? (Number.isFinite(envCap) && envCap > 0 ? envCap : 1440)));
      await managedYoutubeFallback(url, dir, { mode, section, maxHeight: fbHeight, ffmpegLocation });
    }

    const entries = await readdir(dir);
    const produced = entries.find((n) => n.startsWith("src.") && !n.endsWith(".part") && n !== "cookies.txt");
    if (!produced) {
      // Exit 0 with nothing on disk — include what yt-dlp last said so the next
      // silent-skip variant is diagnosable from the job log instead of a mystery.
      const leftovers = entries.filter((n) => n !== "cookies.txt").join(", ") || "none";
      throw new Error(`yt-dlp produced no output file (files: ${leftovers}). ${lastYtdlpTail.trim().slice(-240)}`.trim());
    }
    const { statSync } = await import("node:fs");
    const finalPath = join(dir, "src");
    await rename(join(dir, produced), finalPath);
    if (statSync(finalPath).size === 0) throw new Error("yt-dlp produced an empty file");
    if (mode === "audio" && ytdlpAudioNeedsExtract(produced)) {
      // No audio-only stream existed → yt-dlp fell back to a progressive VIDEO
      // file. Strip it to the tiny mono-16k mp3 STT wants (same extractor the
      // Drive audio path uses) so a 58-min 360p pull doesn't upload 240 MB of
      // video as "audio". Without ffmpeg the video file still transcribes fine.
      if (ffmpegLocation) {
        const audioPath = join(dir, "src.audio.mp3");
        try {
          await runAudioExtract(ffmpegLocation, finalPath, audioPath);
          if (statSync(audioPath).size > 0) {
            await (await import("node:fs/promises")).rm(finalPath, { force: true });
            await rename(audioPath, finalPath);
            console.log(`[downloader] audio mode: progressive fallback (${produced}) stripped to mono mp3`);
            return { path: finalPath, mime: "audio/mpeg" };
          }
        } catch (e) {
          console.warn(`[downloader] audio extract of progressive fallback failed (${e instanceof Error ? e.message : e}) — using the video file`);
        }
      }
      return { path: finalPath, mime: "video/mp4" };
    }
    return { path: finalPath, mime: mode === "audio" ? "audio/mp4" : "video/mp4" };
    // NOTE: workDir cleanup is the CALLER's responsibility (downloadAndStore's finally).
  },
};

function isYoutubeUrl(url: string): boolean {
  try { return /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname); } catch { return false; }
}

/**
 * Last-resort YouTube pull through the managed residential downloader. Writes
 * `src.<ext>` into `dir` so the caller's normal produced-file scan picks it up.
 * Segment mode: the actor returns the whole video, so the requested window is
 * cut locally (frame-accurate re-encode, same contract as --force-keyframes-at-cuts).
 */
async function managedYoutubeFallback(
  url: string,
  dir: string,
  o: { mode: "full" | "audio" | "segment"; section?: { start: number; end: number }; maxHeight: number; ffmpegLocation?: string },
): Promise<void> {
  const { join } = await import("node:path");
  const { rename, rm } = await import("node:fs/promises");
  const audioOnly = o.mode === "audio";
  const timeoutMs = Number(process.env.APIFY_YT_TIMEOUT_MS) || 8 * 60_000;
  const t0 = Date.now();
  const r = await runManagedYoutube(url, { maxHeight: o.maxHeight, audioOnly, timeoutMs });
  const ext = audioOnly ? "mp3" : "mp4";
  const target = join(dir, `src.${ext}`);
  await streamFetchToFile(r.fileUrl, target, { timeoutMs: Math.max(120_000, timeoutMs), requireVideo: !audioOnly });
  console.log(`[downloader] managed fallback ok (${r.quality ?? "?"}, ${r.fileSizeBytes ? `${Math.round(r.fileSizeBytes / 1e6)}MB` : "?"}) in ${Math.round((Date.now() - t0) / 1000)}s`);
  if (o.mode === "segment" && o.section && o.ffmpegLocation) {
    const cut = join(dir, "cut.mp4");
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      const p = spawn(o.ffmpegLocation!, [
        "-y", "-ss", o.section!.start.toFixed(2), "-i", target, "-t", (o.section!.end - o.section!.start).toFixed(2),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", cut,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-400); });
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`segment cut failed: ${err.trim().split("\n").pop()}`))));
    });
    await rm(target, { force: true });
    await rename(cut, target);
  }
}

/** Pick the downloader for a URL: yt-dlp for social hosts, direct fetch otherwise. */
export function resolveDownloader(url: string): Downloader {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* fall through */ }
  if (DRIVE_HOSTS.test(host)) return driveDownloader;
  if (SOCIAL_HOSTS.test(host)) return socialDownloader;
  return directFetch;
}
