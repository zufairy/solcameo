import { spawn } from "node:child_process";
import { VELLO_WATERMARK_ASSET } from "@/lib/builder/velloWatermark";
import { writeVelloWatermark } from "./velloWatermark";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath, runWithDiscardCorruptFallback } from "@/lib/server/ffmpegBin";
// Resolved binary (not the raw ffmpeg-static export — the dev bundler can
// rewrite that path into .next where no binary exists).
const ffmpegPath = resolveFfmpegPath();
import { putVideo } from "@/lib/server/videoStorage";
import { validateEditPlan, type EditOp } from "@/lib/server/clipEditOps";
import { computeFillerRanges, keepRanges, remapTime, remapWords } from "@/lib/server/fillerCut";
import { computeRandomJumpCuts } from "@/lib/server/jumpCuts";
import { detectFaceCenter } from "@/lib/server/faceTrack";
import { detectFaces, type FaceBox } from "@/lib/server/centerface";
import { analyzeSpeakers, readMonoPcm, toSamplePoints } from "@/lib/server/speakerTrack";
import { buildCameraPlan, shouldUseCameraPlan, DEFAULT_CAMERA_GEOMETRY, MODE_MAX_ZOOM, MODE_TARGET_ZOOM, type CameraGeometry, type FaceShot, type SamplePoint } from "@/lib/builder/faceShots";
import { detectSceneCuts } from "@/lib/server/sceneDetect";
import { buildClipGraph } from "@/lib/server/clipFilterGraph";
import { renderCaptionsAss } from "@/lib/server/captionRenderer";
import { transformCaptionWords } from "@/lib/server/captionTransform";
import { safeFetchToBuffer } from "@/lib/server/downloader";
import { resolveFontFile } from "@/lib/server/videoFont";
import { retimeStitchedWords } from "@/lib/server/clipMomentSelector";
import type { TranscriptWord, CaptionStyle } from "@/lib/server/clipTypes";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const KIE_KEY = process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";

/** Typed render failure so the thin /api/video/clip wrapper maps the right HTTP
 *  status: "budget" → 503, "window" → 400, "render" → 500. */
export class ClipRenderError extends Error {
  constructor(message: string, readonly code: "budget" | "window" | "render") {
    super(message);
    this.name = "ClipRenderError";
  }
}

// Font resolution for drawtext / ASS burn is shared with the influencer-video
// overlay-burn route (@/lib/server/videoFont) so both pin the SAME font and can't
// drift. resolveFontFile() probes CLIP_FONT_PATH + common OS paths.

// Wall-clock ceiling for a single ffmpeg invocation. Under the 300s maxDuration
// so a hung encode is SIGKILLed (freeing the pinned CPU core on the long-lived
// Railway process) before the request itself is force-terminated.
const FFMPEG_WALL_MS = 280_000;

/**
 * MEMORY CAP for every encode.
 *
 * x264 allocates frame buffers PER THREAD and defaults to one thread per core, so
 * on a many-core host a single 1080x1920 encode reserves hundreds of MB before the
 * filtergraph (libass, scale, overlays) adds its own. Past the container's cgroup
 * limit the kernel OOM-kills the biggest process — ffmpeg — while Node survives, so
 * the run surfaced as `ffmpeg null` (exit code null = died on a signal) with a
 * perfectly healthy-looking log ending at `frame= 1`.
 *
 * Capping threads trades a little wall-clock for an encode that fits. Raise
 * FFMPEG_THREADS on a box with real memory headroom.
 */
const FFMPEG_THREADS = Math.max(1, Number(process.env.FFMPEG_THREADS) || 2);

/** Thread caps for encode + filtergraph. Prepended to the OUTPUT args. */
export const threadArgs = (threads: number = FFMPEG_THREADS): string[] => [
  "-threads", String(threads),
  "-filter_threads", String(threads),
  "-filter_complex_threads", String(threads),
];

/**
 * True when ffmpeg died on a SIGNAL rather than exiting with a code — i.e. it was
 * killed from outside (the cgroup OOM killer, or a container shutdown during a
 * deploy). Retrying the SAME graph is pointless; a leaner one may fit.
 */
export function isKilledBySignal(e: unknown): boolean {
  return e instanceof Error && /killed by SIG|ffmpeg null/i.test(e.message);
}

function runFfmpeg(bin: string, args: string[], cwd?: string, wallMs: number = FFMPEG_WALL_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let e = ""; proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 8000) e = e.slice(-8000); });
    // Wall-clock kill: SIGKILL a hung encode, then reject (propagates into the
    // outer finally{ rm(workDir) }). Cleared on close/error so a normal exit
    // never fires it. wallMs may be tightened by the caller to the route's
    // REMAINING budget so the kill+clean-error beats the platform's 502.
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); fn(); };
    const wall = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      settle(() => reject(new Error(`ffmpeg killed: exceeded ${wallMs}ms wall clock. ${e.slice(-500)}`)));
    }, Math.max(5_000, wallMs));
    proc.on("error", (err) => settle(() => reject(err)));
    // `code` is null when the process died on a SIGNAL — the OOM-killer case. The
    // old message ("ffmpeg null: <tail of a healthy-looking log>") named neither the
    // signal nor the cause, so an out-of-memory kill read as a mystery encode error.
    proc.on("close", (c, signal) => settle(() => {
      if (c === 0) return resolve();
      if (c === null) {
        const hint = signal === "SIGKILL"
          ? " — killed from outside the process: almost always the container's OOM killer (lower FFMPEG_THREADS or give the service more memory), otherwise a deploy/restart mid-encode"
          : " — killed from outside the process (deploy/restart, or a supervisor)";
        return reject(new Error(`ffmpeg killed by ${signal ?? "signal"}${hint}. ${e.slice(-400)}`));
      }
      reject(new Error(`ffmpeg ${c}: ${e.slice(-500)}`));
    }));
  });
}

// Detect whether a source file has an audio stream via `ffmpeg -i` (no separate
// ffprobe binary is bundled). title_card builds a static filtergraph that can't
// conditionally select a maybe-absent stream, so audio presence must be known
// before the graph is built. Best-effort: any probe failure defaults to true,
// preserving the prior behavior for normal (speech) sources.
function probeHasAudio(bin: string, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => resolve(/Stream #\d+:\d+.*: Audio:/.test(err)));
    proc.on("error", () => resolve(true));
  });
}

/** Source video's natural pixel dimensions, parsed from `ffmpeg -i` stderr
 *  (same no-ffprobe-binary pattern as probeHasAudio) — needed as the camera
 *  plan's source geometry (buildCameraPlan's CameraGeometry.srcW/srcH) so the
 *  dense scan's crop math matches the real frame, not a guessed 1920x1080.
 *  null on any probe failure; callers fall back to DEFAULT_CAMERA_GEOMETRY. */
function probeDimensions(bin: string, path: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const m = err.match(/Stream #\d+:\d+.*: Video:.*?(\d{2,5})x(\d{2,5})/);
      resolve(m ? { w: Number(m[1]), h: Number(m[2]) } : null);
    });
    proc.on("error", () => resolve(null));
  });
}


/**
 * Duration of a local file in seconds, parsed from `ffmpeg -i` stderr (no ffprobe
 * binary is bundled). Returns 0 when it can't be read — callers treat that as
 * "unusable input" rather than guessing a length.
 */
export function probeDurationSec(path: string): Promise<number> {
  const bin = resolveFfmpegPath();
  if (!bin) return Promise.resolve(0);
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0);
    });
    proc.on("error", () => resolve(0));
  });
}

// Fetch a logo/watermark image into the work dir; returns the local path, or
// undefined if it can't be retrieved (the graph builder drops + warns).
async function fetchImage(url: string, dest: string, opts?: { timeoutMs?: number }): Promise<string | undefined> {
  try {
    // SSRF-guarded + size-capped (20MB for an overlay image). Caller passes a
    // budget-bounded timeoutMs so a slow logo host can't eat the encode budget.
    const { buffer, mime } = await safeFetchToBuffer(url, { maxBytes: 20 * 1024 * 1024, ...(opts ?? {}) });
    if (mime && !/^image\//i.test(mime)) return undefined;
    await writeFile(dest, buffer);
    return dest;
  } catch {
    return undefined;
  }
}

// Fetch a media file (gameplay bg VIDEO for composite_bg, or a trending AUDIO
// file for audio_overlay) into the work dir; returns the local path, or undefined
// if it can't be retrieved (the graph builder drops + warns). Mirrors fetchImage
// but accepts a video/audio (or unknown) content-type — the host's mp4/mp3/wav
// rarely sets a precise mime, and ffmpeg sniffs the container anyway.
async function fetchMedia(url: string, dest: string, kind: "video" | "audio", opts?: { maxBytes?: number; timeoutMs?: number }): Promise<string | undefined> {
  try {
    // SSRF-guarded + size-capped. Callers pass a tighter cap for the gameplay bg
    // so a fat loop can't consume the whole route budget (→ 502).
    const { buffer, mime } = await safeFetchToBuffer(url, opts ?? {});
    // Reject only an obvious wrong-type (an HTML error page); allow empty/unknown.
    if (mime && /^(text\/html|application\/json)\b/i.test(mime)) return undefined;
    if (mime && /^image\//i.test(mime)) return undefined;
    void kind; // both kinds share the same fetch; ffmpeg demuxes by container
    await writeFile(dest, buffer);
    return dest;
  } catch {
    return undefined;
  }
}

/**
 * Render ONE clip from an already-on-disk source via ffmpeg input-seek (`-ss`
 * before `-i`: RAM-safe, reads only the window — never buffers the whole file).
 * `srcPath` lifetime is owned by the CALLER; this fn owns only its per-clip
 * workDir (created + cleaned here). No auth, no metering — those live in the
 * /api/video/clip wrapper (canvas path) and clipJobs economy gate (cloud path).
 *
 * Coordinates are ABSOLUTE source seconds (startSeconds/endSeconds + words),
 * exactly like the canvas /api/video/clip path: `-ss startSeconds` resets the
 * stream PTS to 0-based, buildClipGraph uses only the (end-start) duration, and
 * renderCaptionsAss rebases words by clipStartSec — so this is byte-identical to
 * the canvas render contract.
 */
/* ── Process-wide render gate ────────────────────────────────────────────────
 * Every batch route / canvas render / admin sample starts renders in THIS web
 * process, and nothing capped how many ran together: several agents' batches
 * (heartbeat cron + manual) meant several 1080x1920 encodes + face-detect
 * passes at once, the container ran out of memory, Railway killed it and the
 * whole site hung until it restarted. Renders now queue for one of
 * RENDER_CONCURRENCY slots (default 2); a queued render's own time budget only
 * starts once it holds a slot. */
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY) || 2);
/** Give up waiting after this long so a stuck queue surfaces as a clean error. */
const RENDER_QUEUE_MAX_MS = 15 * 60_000;
let rendersActive = 0;
const renderWaiters: Array<() => void> = [];
async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (rendersActive >= RENDER_CONCURRENCY) {
    let waiter!: () => void;
    const got = await Promise.race([
      new Promise<boolean>((res) => { waiter = () => res(true); renderWaiters.push(waiter); }),
      new Promise<boolean>((res) => setTimeout(() => res(false), RENDER_QUEUE_MAX_MS)),
    ]);
    if (!got) {
      const i = renderWaiters.indexOf(waiter);
      if (i >= 0) renderWaiters.splice(i, 1);
      throw new ClipRenderError("render queue is full — try again in a few minutes", "render");
    }
  }
  rendersActive++;
  try {
    return await fn();
  } finally {
    rendersActive--;
    renderWaiters.shift()?.();
  }
}

export function renderClipFromFile(
  srcPath: string,
  args: { startSeconds: number; endSeconds: number; ops: unknown; words?: TranscriptWord[]; width?: number; height?: number; cameraTransitions?: boolean; transition?: { id: string; durationSec?: number } },
  opts?: { maxMs?: number },
): Promise<{ clipUrl: string; warnings: string[] }> {
  return withRenderSlot(() => renderClipFromFileNow(srcPath, args, opts));
}

async function renderClipFromFileNow(
  srcPath: string,
  args: { startSeconds: number; endSeconds: number; ops: unknown; words?: TranscriptWord[]; width?: number; height?: number; cameraTransitions?: boolean; transition?: { id: string; durationSec?: number } },
  opts?: { maxMs?: number },
): Promise<{ clipUrl: string; warnings: string[] }> {
  // Whole-render deadline. maxMs is a HARD ceiling — a brain-rot (composite_bg)
  // render stacks face-detect + gameplay-bg fetch + a 2-stream encode, and the
  // SUM (not any one ffmpeg) can blow it. We bound the final encode to the
  // remaining budget so an overrun dies with a clean, actionable error.
  const startedAt = Date.now();
  const maxMs = opts?.maxMs ?? 300_000;
  if (!ffmpegPath || !CONVEX_URL) throw new ClipRenderError("ffmpeg/convex unavailable", "render");

  const { startSeconds, endSeconds } = args;
  if (!(endSeconds > startSeconds)) throw new ClipRenderError("invalid clip window (end <= start)", "window");

  // Output canvas dims (from the Aspect Crop node); default to 9:16. Clamp + force
  // even numbers so libx264 (yuv420p) doesn't reject an odd dimension.
  const evenClamp = (n: unknown, def: number) => { const v = Math.round(Math.min(2160, Math.max(120, Number(n) || def))); return v % 2 === 0 ? v : v - 1; };
  const width = evenClamp(args.width, 1080);
  const height = evenClamp(args.height, 1920);

  const ops = validateEditPlan(args.ops);
  const words = Array.isArray(args.words) ? args.words : [];
  const dur = endSeconds - startSeconds;
  const warnings: string[] = [];
  const workDir = await mkdtemp(join(tmpdir(), "vello-clip-"));
  try {
    // Every pre-encode fetch (logos, gameplay bg, meme audio) must finish with
    // time to spare for face-detect + the encode, or a SINGLE slow host blows the
    // wall before the encode budget guard is reached. Bound each by a shared
    // deadline that reserves ~160s for face-detect (KIE up to 75s) + encode + upload.
    const fetchDeadlineMs = startedAt + maxMs - 160_000;
    const fetchBudgetMs = () => Math.max(8_000, fetchDeadlineMs - Date.now());
    // True wall-clock left. Used to bound the intermediate ffmpeg stages
    // (filler-cut pre-pass, face-frame extraction) and to skip face-detect entirely
    // when too little remains — so the SUM of stages can never reach maxMs before
    // the final-encode guard returns a clean budget error.
    const routeRemainingMs = () => startedAt + maxMs - Date.now();

    // 1. Source is already on disk at srcPath (caller-owned). No download here.

    // 1b. Filler Cut pre-pass: physically trim+concat the filler words out,
    // then run the normal graph on the tightened intermediate. Word/op times
    // are remapped onto the post-cut timeline so captions/overlays stay synced.
    let effSrc = srcPath;
    let effStart = startSeconds;
    let effEnd = endSeconds;
    let effWords = words;
    let effOps = ops;
    const fillerOp = ops.find((o) => o.op === "remove_fillers");
    // Filler Cut · Random (Specials, clip.fillercut config.mode:"random"): pure
    // TIME-based micro-trims, no transcript needed — computeRandomJumpCuts
    // returns clip-relative cuts in the SAME shape as computeFillerRanges, so
    // it reuses this entire pre-pass (trim+concat, word/op remap) unchanged.
    const jumpCutOp = ops.find((o) => o.op === "random_jump_cuts");
    const wantsWordFillerCut = fillerOp && fillerOp.op === "remove_fillers" && words.length > 0;
    const wantsRandomJumpCuts = !wantsWordFillerCut && !!jumpCutOp;
    if (wantsWordFillerCut || wantsRandomJumpCuts) {
      const cuts = wantsWordFillerCut
        ? computeFillerRanges(words, startSeconds, endSeconds, fillerOp && fillerOp.op === "remove_fillers" && fillerOp.aggressive === true)
        : computeRandomJumpCuts(dur, (Math.random() * 0xffffffff) >>> 0);
      const keeps = cuts.length > 0 ? keepRanges(cuts, dur) : [];
      if (cuts.length > 0 && keeps.length === 0) {
        // keepRanges returns [] when the cuts cover the ENTIRE clip window; a
        // concat=n=0 filter graph has no input pads and crashes ffmpeg, so skip
        // the pre-pass and let the original (un-cut) window render instead.
        warnings.push(wantsWordFillerCut ? "filler cut: skipped — clip window is entirely filler" : "filler cut (random): skipped — computed cuts covered the entire window");
      } else if (keeps.length > 0) {
        // A source whose audio track was stripped has no [0:a] — hardcoding it
        // made ffmpeg error "0:a matches no streams". Probe + build video-only.
        const srcHasAudio = await probeHasAudio(ffmpegPath, srcPath);
        const segs: string[] = [];
        const maps: string[] = [];
        keeps.forEach((k, i) => {
          // CLIP-RELATIVE trim ranges (0-based), paired with the `-ss startSeconds`
          // input seek below. The seeked stream's PTS is 0-based at startSeconds, so
          // the keep ranges (already clip-relative from keepRanges) trim directly.
          // This input-seeks instead of decoding from t=0 — essential when srcPath
          // is a multi-HOUR whole source (a late clip would otherwise decode hours
          // of frames before its window and blow the wall). Output frames are
          // identical to the old absolute-trim-on-unseeked-input form.
          const a = k.start.toFixed(3);
          const b = k.end.toFixed(3);
          segs.push(`[0:v]trim=${a}:${b},setpts=PTS-STARTPTS[v${i}]`);
          if (srcHasAudio) segs.push(`[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS[a${i}]`);
          maps.push(srcHasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
        });
        segs.push(`${maps.join("")}concat=n=${keeps.length}:v=1:a=${srcHasAudio ? 1 : 0}[vc]${srcHasAudio ? "[ac]" : ""}`);
        const cutPath = join(workDir, "cut.mp4");
        // runWithDiscardCorruptFallback: this decodes a raw slice of the ORIGINAL
        // source's audio — the same failure mode that killed transcription
        // ("TNS filter order 16 is greater than maximum 12" / "Invalid data found
        // when processing input") can land inside a clip's own cut window just as
        // easily, and would otherwise fail this clip's render outright on every
        // retry (the filtergraph-simplify fallback below reruns the SAME corrupt
        // input, so it can't help — only tolerating the bad frame can).
        await runWithDiscardCorruptFallback(
          (a) => runFfmpeg(ffmpegPath, a, workDir, fetchBudgetMs()),
          [
            // Input-seek + duration-bound to the clip window so only that span is
            // decoded (mirrors the main encode's `-ss … -t … -i`).
            "-y", "-ss", startSeconds.toFixed(3), "-t", dur.toFixed(3), "-i", srcPath,
            "-filter_complex", segs.join(";"),
            "-map", "[vc]", ...(srcHasAudio ? ["-map", "[ac]"] : []),
            // High-quality intermediate (crf 16) so the final re-encode below
            // doesn't compound generation loss from this filler-cut pre-pass.
            ...threadArgs(),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
            ...(srcHasAudio ? ["-c:a", "aac"] : ["-an"]), cutPath,
            // Budget-bound this intermediate encode too — a long source's filler-cut
            // re-encode could otherwise eat the whole route (default 280s wall).
          ],
        );
        const newDur = keeps.reduce((s, k) => s + (k.end - k.start), 0);
        // Rebase everything onto the cut timeline (clip-relative, starts at 0).
        effSrc = cutPath;
        effStart = 0;
        effEnd = newDur;
        const rel = words
          .filter((w) => w.end > startSeconds && w.start < endSeconds)
          .map((w) => ({ ...w, start: w.start - startSeconds, end: w.end - startSeconds }));
        effWords = remapWords(rel, cuts);
        effOps = ops
          .filter((o) => o.op !== "remove_fillers" && o.op !== "random_jump_cuts")
          .map((o) => {
            if (o.op === "text_overlay") return { ...o, startSec: remapTime(o.startSec, cuts), endSec: Math.max(remapTime(o.startSec, cuts) + 0.5, remapTime(o.endSec, cuts)) };
            if (o.op === "emphasis") return { ...o, atSec: remapTime(o.atSec, cuts) };
            // Audio overlays (meme audio / reaction SFX) are timed by atSec too — a
            // filler cut shifts every later moment earlier, so the sound must remap
            // or it lands at the wrong beat on filler-cut clips.
            if (o.op === "audio_overlay") return { ...o, atSec: remapTime(o.atSec, cuts) };
            return o;
          });
        const removed = cuts.reduce((s, c) => s + (c.end - c.start), 0);
        warnings.push(wantsWordFillerCut
          ? `filler cut: removed ${cuts.length} fillers (${removed.toFixed(1)}s tightened)`
          : `filler cut (random): removed ${cuts.length} micro-windows (${removed.toFixed(1)}s tightened, fresh pattern)`);
      }
    }

    // 1c. Fetch each composite_bg gameplay VIDEO (Brain Rot) into the work dir FIRST
    // — BEFORE the ASS write — preserving op order (the graph feeds them as extra -i
    // inputs, mirroring logos). Done here, not after the ASS, so step 2 can size the
    // ASS to the clip pane ONLY when a gameplay bg actually resolved (else a failed
    // fetch leaves a pane-sized ASS stretched ~2x on the degraded full-frame burn).
    const bgOps = effOps.filter((o) => o.op === "composite_bg");
    const bgPaths: (string | undefined)[] = [];
    for (let i = 0; i < bgOps.length; i++) {
      if (fetchDeadlineMs - Date.now() <= 0) { warnings.push("brain-rot: gameplay background skipped — render time budget"); break; }
      const o = bgOps[i];
      if (o.op === "composite_bg") {
        if (o.bgKind === "image") {
          // Podcast article-photo pane: a single still, fetched through the
          // image path (fetchMedia's "video" mode explicitly REJECTS image/*
          // mimes — a plain photo URL would silently no-op there).
          bgPaths[i] = await fetchImage(o.bgUrl, join(workDir, `bg${i}.jpg`), { timeoutMs: Math.min(30_000, fetchBudgetMs()) });
          if (!bgPaths[i]) { warnings.push(`podcast photo: could not be fetched (${o.bgUrl.slice(0, 80)}) — composite skipped`); continue; }
          continue;
        }
        // Gameplay loops are short; cap at 150MB / 25s so a mis-sized or slow-host
        // bg can't burn the encode budget. Was 90s — with only ~60s nominally
        // reserved for ALL pre-encode fetches combined (fetchDeadlineMs above), a
        // single gameplay-bg fetch allowed to run that long could already consume
        // most of the render's whole time budget before the encode guard even gets
        // its reserved window, surfacing as "render time budget exhausted before
        // final encode (208s spent fetching/probing)". A genuinely short loop
        // transfers well within 25s on any reasonable host; a slower one now fails
        // fast and skips gracefully (composite still renders without it) instead
        // of stalling the whole clip. Over-cap → skip + warn.
        bgPaths[i] = await fetchMedia(o.bgUrl, join(workDir, `bg${i}.mp4`), "video", { maxBytes: 150 * 1024 * 1024, timeoutMs: Math.min(25_000, fetchBudgetMs()) });
        if (!bgPaths[i]) { warnings.push(`brain-rot: gameplay background could not be fetched (${o.bgUrl.slice(0, 80)}) — composite skipped`); continue; }
        // No per-clip start offset: the graph loops the bg (-stream_loop -1) and cuts
        // it to the clip length (vstack shortest=1), so it always fills the clip.
        // Input-seeking a looped stream (-ss) corrupts its PTS → a vstack dup-explosion
        // that hangs the encode; per-clip variety comes from the Random bgId instead.
      }
    }

    // 2. Write the ASS subtitle file (if a subtitles op is present). ffmpeg runs
    // with cwd=workDir and the filter references the ASS by BASENAME — embedding
    // the absolute Windows path breaks the subtitles filter parser (the drive
    // colon gets re-split inside the filter → "original_size: invalid argument").
    let assRef: string | undefined;
    const subOp = effOps.find((o) => o.op === "subtitles");
    if (subOp && subOp.op === "subtitles") {
      const inWin = effWords.filter((w) => w.end > effStart && w.start < effEnd);
      if (inWin.length === 0) {
        // An empty ASS burns nothing yet exits 0 — surface it so the client can
        // tell the user WHY a captions skill produced no visible captions.
        warnings.push(
          effWords.length === 0
            ? "captions: transcript has no words (transcription failed or silent video) — nothing to burn"
            : `captions: none of the ${effWords.length} transcript words fall inside the ${effStart}-${effEnd}s clip window`,
        );
      }
      // Smart Captions: rewrite the in-window words per the operator's instruction
      // (translate / casing / emojis), preserving timing 1:1, then render those.
      let captionWords = effWords;
      const captionPrompt = (subOp.style as CaptionStyle).prompt;
      if (captionPrompt && captionPrompt.trim() && inWin.length > 0) {
        const { words: transformed, mode } = await transformCaptionWords(inWin, captionPrompt, KIE_KEY);
        const inWinSet = new Set(inWin);
        let ti = 0;
        captionWords = effWords.map((w) => (inWinSet.has(w) ? transformed[ti++] ?? w : w));
        // Report what ACTUALLY happened (an LLM rewrite, an offline casing
        // fallback, or nothing applicable) — never claim a rewrite that didn't run.
        const label = captionPrompt.trim().slice(0, 60);
        warnings.push(
          mode === "llm"
            ? `captions: rewritten to follow "${label}"`
            : mode === "lowercase" || mode === "uppercase"
              ? `captions: applied "${label}" with offline ${mode === "lowercase" ? "lowercasing" : "uppercasing"} (AI editor unavailable)`
              : `captions: "${label}" needs the AI editor (only casing works offline) — kept as spoken`,
        );
      }
      assRef = "subs.ass";
      // Brain-rot: when the clip is composited into a pane, size the ASS to the CLIP
      // pane (so PlayResY = the pane height, e.g. 960 for vstack) and anchor the
      // caption to the pane BOTTOM (spot:"bottom" → ASS \an2 + the pane-local MarginV)
      // so it sits near the bottom of the clip — NOT \an5 dead-center, which lands the
      // caption in the middle of the clip pane and blocks the content. The graph burns
      // this on the clip-pane stream, so it stays off the gameplay half.
      // Size the ASS to the clip PANE only when a composite will ACTUALLY render (a
      // gameplay bg fetched, bgPaths resolved above in step 1c). If the bg fetch
      // failed, buildClipGraph degrades to a full-frame burn, so a pane-sized
      // (half-height) ASS would be stretched ~2x — keep it full-frame instead.
      const compositeOp = effOps.find((o) => o.op === "composite_bg");
      const clipPane = compositeOp && compositeOp.op === "composite_bg" && bgPaths.some(Boolean)
        ? { layout: compositeOp.layout, spot: "bottom" as const }
        : undefined;
      await writeFile(join(workDir, assRef), renderCaptionsAss(captionWords, { clipStartSec: effStart, clipEndSec: effEnd, style: subOp.style as CaptionStyle, width, height, clipPane }));
    }

    // 3. Fetch each logo_overlay image (preserving op order) into the work dir.
    const logoOps = effOps.filter((o) => o.op === "logo_overlay");
    const logoPaths: (string | undefined)[] = [];
    for (let i = 0; i < logoOps.length; i++) {
      if (logoOps[i].op === "logo_overlay" && logoOps[i].imageUrl === VELLO_WATERMARK_ASSET) {
        logoPaths[i] = await writeVelloWatermark(join(workDir, `logo${i}.png`), width, height);
        continue;
      }
      // Past the fetch deadline → stop (each fetch's 8s floor would otherwise
      // accumulate across N inputs and blow the wall before the encode guard).
      if (fetchDeadlineMs - Date.now() <= 0) { warnings.push("logo overlay(s) skipped — render time budget"); break; }
      const o = logoOps[i];
      if (o.op === "logo_overlay") logoPaths[i] = await fetchImage(o.imageUrl, join(workDir, `logo${i}.png`), { timeoutMs: fetchBudgetMs() });
    }

    // 3a-overlay. Fetch each image_overlay image (Overlay Image skill upload —
    // preserving op order) into the work dir, fed as extra -i inputs like logos.
    const overlayImageOps = effOps.filter((o) => o.op === "image_overlay");
    const imagePaths: (string | undefined)[] = [];
    for (let i = 0; i < overlayImageOps.length; i++) {
      if (fetchDeadlineMs - Date.now() <= 0) { warnings.push("overlay image(s) skipped — render time budget"); break; }
      const o = overlayImageOps[i];
      if (o.op === "image_overlay") {
        imagePaths[i] = await fetchImage(o.imageUrl, join(workDir, `overlayimg${i}.png`), { timeoutMs: fetchBudgetMs() });
        if (!imagePaths[i]) warnings.push(`Overlay Image skipped: the uploaded image could not be downloaded (${o.imageUrl.slice(0, 90)}). Check the image is still in storage and reachable.`);
      }
    }

    // 3a-broll. Fetch each broll_overlay photo (podcast-style cutaway — preserving
    // op order) into the work dir, fed as extra -i inputs like logos/overlays.
    const brollOps = effOps.filter((o) => o.op === "broll_overlay");
    const brollPaths: (string | undefined)[] = [];
    for (let i = 0; i < brollOps.length; i++) {
      if (fetchDeadlineMs - Date.now() <= 0) { warnings.push("broll cutaway(s) skipped — render time budget"); break; }
      const o = brollOps[i];
      if (o.op === "broll_overlay") {
        brollPaths[i] = await fetchImage(o.imageUrl, join(workDir, `broll${i}.jpg`), { timeoutMs: fetchBudgetMs() });
        if (!brollPaths[i]) warnings.push(`B-roll skipped: the photo could not be downloaded (${o.imageUrl.slice(0, 90)}).`);
      }
    }

    // 3a-bg. (Gameplay bg fetch moved ABOVE the ASS write — see step 1c — so the ASS
    // is sized to the clip pane ONLY when a gameplay bg actually fetched; a failed
    // fetch otherwise left a pane-sized half-height ASS burned ~2x on the full frame.)

    // 3a-audio. Fetch each audio_overlay trending AUDIO file (Meme Audio) into the
    // work dir, preserving op order (fed as extra -i inputs for the amix branch).
    const audioOverlayOps = effOps.filter((o) => o.op === "audio_overlay");
    const audioPaths: (string | undefined)[] = [];
    for (let i = 0; i < audioOverlayOps.length; i++) {
      if (fetchDeadlineMs - Date.now() <= 0) { warnings.push("meme-audio: overlay skipped — render time budget"); break; }
      const o = audioOverlayOps[i];
      if (o.op === "audio_overlay") {
        audioPaths[i] = await fetchMedia(o.audioUrl, join(workDir, `audio${i}`), "audio", { timeoutMs: fetchBudgetMs() });
        if (!audioPaths[i]) warnings.push(`AUDIO SKIPPED: the trending/reaction sound could not be downloaded (${o.audioUrl.slice(0, 90)}). The track URL is unreachable — check TRENDING_AUDIO_BASE_URL / REACTION_SFX_BASE_URL and that the file exists in the bucket. The clip rendered WITHOUT this audio.`);
      }
    }

    // 3b. Face Track: sample frames across the clip window and locate the
    // speaker's face (Gemini vision). Failure → centered crop + a warning.
    let faceCx: number | undefined;
    let faceCy: number | undefined;
    let faceBiasTop: number | undefined;
    let faceXMin: number | undefined;
    let faceXMax: number | undefined;
    // Face-track couldn't confidently localize the speaker → letterbox/fit instead of
    // guess-cropping (set from the detector's recommendFit; only acted on in `auto`).
    let recommendFit = false;
    // Smart Framing mode chosen in the inspector (rides the face_reframe op).
    const framingMode = (effOps.find((o) => o.op === "face_reframe") as { mode?: "auto" | "pan" | "zoom" | "full" } | undefined)?.mode;
    const hasFaceReframe = effOps.some((o) => o.op === "face_reframe");
    // Detect the face for an explicit Smart Framing op OR for a brain-rot composite
    // (composite_bg) OR for a plain crop reframe (the default op, always present —
    // see validateEditPlan). Without this, an agent with no Face Track skill wired
    // got a dead-center 9:16 crop that routinely sliced the speaker's face off a
    // landscape/podcast source. Face-aware centering is now the crop BASELINE, not
    // a paid-skill-only feature — face_reframe (clip.facetrack, $0.43) still governs
    // billing/PAN/ZOOM/FULL framing modes; this just feeds faceCx/faceCy into the
    // plain crop path too.
    const needsFaceDetect = effOps.some((o) =>
      o.op === "face_reframe" || o.op === "composite_bg" || (o.op === "reframe" && o.mode === "crop") || (o.op === "emphasis" && (o as { kind?: string }).kind === "zoom_punch"));
    if (needsFaceDetect && routeRemainingMs() < 30_000) {
      // Face-detect is now local CenterFace inference (~3-4ms/frame) — the
      // real cost here is the ffmpeg frame extracts, not the detection
      // itself. 30s is generous headroom; this used to need 120s when
      // detection meant a 45-75s hosted vision call.
      warnings.push("smart framing: skipped to protect the render time budget — using centered crop");
    } else if (needsFaceDetect) {
      const span = effEnd - effStart;
      // Prioritize the speaker SPEAKING: snap each sample timestamp to the nearest
      // spoken word (transcript we already have — zero extra cost, no new API call)
      // instead of a blind fixed fraction of the clip. A fixed-fraction sample can
      // land on a pause, a reaction cutaway, or someone off-camera; a word-anchored
      // one guarantees the frame sent to the vision model shows someone mid-speech.
      // Falls back to the original fixed fractions when the window has no words
      // (silent / music-only b-roll — face-detect there is for subject framing).
      const inWindowWords = effWords.filter((w) => w.end > effStart && w.start < effEnd);
      const samples = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => {
        const target = effStart + span * f;
        if (inWindowWords.length === 0) return target;
        let best = inWindowWords[0];
        let bestDist = Infinity;
        for (const w of inWindowWords) {
          const mid = (w.start + w.end) / 2;
          const d = Math.abs(mid - target);
          if (d < bestDist) { bestDist = d; best = w; }
        }
        return (best.start + best.end) / 2;
      });
      const framePaths: string[] = [];
      // A second still ~120ms after each anchor, same spot — lets
      // detectFaceCenter tell WHICH face is actually talking (mouth motion)
      // instead of defaulting to whoever's biggest, on a 2+ guest podcast
      // frame. Best-effort and index-aligned to framePaths: a failed/skipped
      // burst just leaves that anchor on the old largest-face behavior.
      const burstPaths: (string[] | undefined)[] = [];
      for (let i = 0; i < samples.length; i++) {
        // Out of budget mid-sampling → stop and detect with the frames we have.
        if (routeRemainingMs() < 70_000) break;
        const fp = join(workDir, `face${i}.jpg`);
        try {
          await runFfmpeg(ffmpegPath, ["-y", "-ss", samples[i].toFixed(2), "-i", effSrc, "-frames:v", "1", "-vf", "scale=480:-2", fp], undefined, Math.max(5_000, Math.min(25_000, routeRemainingMs() - 60_000)));
          framePaths.push(fp);
          if (routeRemainingMs() > 75_000 && framingMode !== "zoom") {
            const bp = join(workDir, `face${i}b.jpg`);
            try {
              await runFfmpeg(ffmpegPath, ["-y", "-ss", (samples[i] + 0.12).toFixed(2), "-i", effSrc, "-frames:v", "1", "-vf", "scale=480:-2", bp], undefined, Math.max(3_000, Math.min(10_000, routeRemainingMs() - 65_000)));
              burstPaths.push([bp]);
            } catch { burstPaths.push(undefined); }
          } else {
            burstPaths.push(undefined);
          }
        } catch { /* unreadable frame — skip */ }
      }
      const subj = await detectFaceCenter(framePaths, burstPaths);
      if (subj) {
        faceCx = subj.cx;
        faceCy = subj.cy;
        faceXMin = subj.xMin;
        faceXMax = subj.xMax;
        recommendFit = subj.recommendFit === true;
        // Face → bias into the upper third (headroom below). Subject (b-roll) →
        // keep it centered. (Only has vertical effect when the source is taller
        // than 9:16 after the cover-scale; for 16:9 there's no vertical slack.)
        faceBiasTop = subj.kind === "face" ? 0.38 : 0.5;
        const modeLabel = framingMode ?? "auto";
        const multi = typeof subj.xMin === "number" && typeof subj.xMax === "number";
        // Smart Framing in AUTO but the speaker couldn't be confidently located →
        // fit the whole shot over a blurred background (not black bars) rather than
        // crop the table on a wide podcast frame.
        if (hasFaceReframe && recommendFit && (framingMode === undefined || framingMode === "auto")) {
          warnings.push("smart framing (auto): couldn't confidently locate the speaker — fitting the whole shot over a blurred background instead of guess-cropping");
        } else {
          warnings.push(subj.kind === "face"
            ? (multi
                ? `smart framing (${modeLabel}): ${Math.round(((subj.xMax! - subj.xMin!)) * 100)}%-wide subject span — ${modeLabel === "pan" ? "panning between guests" : modeLabel === "zoom" ? "zooming the speaker" : modeLabel === "full" ? "showing the full shot" : "fitting the people"}`
                : `smart framing (${modeLabel}): speaker at x=${(subj.cx * 100).toFixed(0)}% — crop follows the face`)
            : `smart framing (${modeLabel}): no face — framing the main subject at x=${(subj.cx * 100).toFixed(0)}%`);
        }
      } else {
        // Detection returned nothing at all → treat like recommendFit so a wide shot
        // is fit-over-blur (full frame kept) rather than blindly centre-cropped.
        recommendFit = true;
        warnings.push("smart framing: no subject found — fitting the whole shot over a blurred background");
      }
    }

    // 3c. Camera Settings (clip.facetrack auto/pan/zoom) — a real per-shot
    // DYNAMIC camera, not just the single aggregate point computed above.
    // Mirrors the Editor's own Camera tool exactly: a dense CenterFace +
    // active-speaker scan across the WHOLE clip window (speakerTrack.ts's
    // mouth-motion-gated-by-audio signal — same one /dev/face-detect and the
    // Editor use), segmented into shots by buildCameraPlan (lib/builder/
    // faceShots.ts — the SAME function the Editor preview draws with). Without
    // this the cloud pipeline only ever had ONE static crop point for the
    // whole clip (the median of 5 sparse anchors above), so a clip where the
    // conversation goes back and forth between two guests stayed locked on
    // whichever guest that median favored — it never cut to the other
    // speaker mid-clip, unlike a clip manually built in the Editor.
    // Best-effort and purely ADDITIVE: any failure/timeout leaves faceShots
    // undefined and the render falls through to the aggregate point above
    // (already speaker-aware via detectFaceCenter's burst pass) — never a
    // regression, only a strictly richer camera when it succeeds.
    let faceShots: FaceShot[] | undefined;
    let shotZoom: number | undefined;
    // No explicit mode = Auto: the inspector SHOWS "Auto" as the default but only
    // writes framingMode once the operator re-picks it, so the op usually arrives
    // with no mode — which used to skip this scan entirely and leave a 2-guest
    // left/right podcast on one static point. A plain crop reframe (no Face Track
    // skill) gets the same per-speaker camera: every crop is face-aware.
    const dynamicCameraMode = framingMode === undefined || framingMode === "auto" || framingMode === "pan" || framingMode === "zoom";
    const plainCrop = effOps.some((o) => o.op === "reframe" && o.mode === "crop") && !effOps.some((o) => o.op === "composite_bg");
    if ((hasFaceReframe || plainCrop) && dynamicCameraMode && routeRemainingMs() > 70_000) {
      try {
        const SCAN_FPS = 10; // must match lib/builder/faceShots.ts's FACE_SAMPLE_FPS
        const scanDurS = Math.min(effEnd - effStart, 60); // clip windows are already short (20-45s); cap defensively
        await runFfmpeg(
          ffmpegPath,
          ["-y", "-ss", effStart.toFixed(2), "-i", effSrc, "-t", scanDurS.toFixed(2), "-vf", `fps=${SCAN_FPS},scale=640:-2`, join(workDir, "cam%05d.jpg")],
          undefined,
          Math.max(10_000, Math.min(45_000, routeRemainingMs() - 60_000)),
        );
        const camFiles = (await readdir(workDir)).filter((f) => f.startsWith("cam") && f.endsWith(".jpg")).sort();
        if (camFiles.length >= 5) {
          const detected = await Promise.all(camFiles.map(async (f, i) => {
            const path = join(workDir, f);
            try { return { t: i / SCAN_FPS, path, faces: await detectFaces(path) }; }
            catch { return { t: i / SCAN_FPS, path, faces: [] as FaceBox[] }; }
          }));
          const pcm = await readMonoPcm(
            (args) => runFfmpeg(ffmpegPath, args, undefined, 15_000),
            effSrc, join(workDir, "cam-audio.f32"), scanDurS, effStart,
          ).catch(() => null);
          const speakerFrames = await analyzeSpeakers(detected, pcm, SCAN_FPS);
          // Shared with /api/video/detect-face-track (the dev page + Editor's
          // Camera tool) — see speakerTrack.ts's toSamplePoints doc for why
          // this is ONE function instead of two copies drifting apart.
          const samples: SamplePoint[] = toSamplePoints(speakerFrames);
          const srcDims = await probeDimensions(ffmpegPath, effSrc);
          const geom: CameraGeometry = {
            srcW: srcDims?.w ?? DEFAULT_CAMERA_GEOMETRY.srcW,
            srcH: srcDims?.h ?? DEFAULT_CAMERA_GEOMETRY.srcH,
            outW: width, outH: height,
          };
          const plan = buildCameraPlan(samples, framingMode ?? "auto", geom);
          // A moving speaker may stay within ONE committed shot. Its path is
          // still essential: dropping it freezes the crop at the sparse-scan
          // point for the entire clip. Auto only replaces a single static shot
          // when the dense scan found meaningful motion; explicit Face Crop
          // trusts its tracked face even when that person holds still.
          if (shouldUseCameraPlan(plan.shots, framingMode ?? "auto")) {
            faceShots = plan.shots;
            shotZoom = plan.zoomHint;
            warnings.push(`smart framing (${framingMode ?? "auto"}): tracking camera built from ${samples.length} samples across the clip — follows the speaker's movement`);
          }
        }
      } catch (e) {
        console.warn(`[clipRender] dynamic camera plan scan failed, falling back to the single-point crop: ${e instanceof Error ? e.message : e}`);
      }
    }

    // When the dense scan times out or cannot decode enough frames, retain the
    // sparse detector's speaker position with enough crop room to centre it.
    // A plain cover crop has no horizontal slack for portrait→portrait video,
    // so an x=.82 speaker otherwise remains stuck against the right edge.
    if (!faceShots && typeof faceCx === "number" && !recommendFit && dynamicCameraMode && (hasFaceReframe || plainCrop) && routeRemainingMs() > 20_000) {
      const srcDims = await probeDimensions(ffmpegPath, effSrc);
      if (srcDims?.w && srcDims.h) {
        const baseScale = Math.max(width / srcDims.w, height / srcDims.h);
        const edge = Math.max(0.02, Math.min(faceCx, 1 - faceCx));
        const mode = framingMode ?? "auto";
        shotZoom = Math.min(MODE_MAX_ZOOM[mode], Math.max(MODE_TARGET_ZOOM[mode], width / (srcDims.w * baseScale * 2 * edge)));
        faceShots = [{ startT: 0, endT: effEnd - effStart, cx: faceCx, cy: faceCy ?? 0.5, confident: true }];
        warnings.push(`smart framing (${mode}): using edge-safe single-speaker crop after dense scan was unavailable`);
      }
    }

    // Multi Clips (Specials, clip.multiscene): instead of ONE crop point (or
    // face-tracked path) for the whole clip, hard-cut between 2-4 DIFFERENT
    // random crop windows across the duration — reads as several distinct
    // "scenes" from the same footage instead of one fixed framed moment.
    // Independent of face detection (no scan needed, so it's instant) and
    // takes PRIORITY over whatever the block above found — the operator
    // turned this on specifically to get variety, not the tracked speaker.
    if (effOps.some((o) => o.op === "multi_scene_crop")) {
      const span = effEnd - effStart;
      const shotCount = span > 24 ? 4 : span > 12 ? 3 : 2;
      const shots: FaceShot[] = [];
      for (let i = 0; i < shotCount; i++) {
        shots.push({
          startT: (span / shotCount) * i,
          endT: i === shotCount - 1 ? span : (span / shotCount) * (i + 1),
          // Safe crop band — stays well inside frame edges at the zoom below.
          cx: 0.32 + Math.random() * 0.36,
          cy: 0.38 + Math.random() * 0.18,
          confident: true,
        });
      }
      faceShots = shots;
      shotZoom = 1.18;
      warnings.push(`multi clips: ${shotCount} randomized crop scenes across the clip`);
    }

    // 4. Build the ffmpeg graph (reframe → emphasis → overlays → subtitles → logo → title) and run.
    // Probe the (possibly filler-cut) source for an audio stream first: the
    // title_card slate concat must branch on real-vs-silent audio at build time
    // (the graph can't conditionally select a maybe-absent stream). Best-effort —
    // defaults to true on probe failure, so normal speech sources are unaffected.
    const hasAudio = await probeHasAudio(ffmpegPath, effSrc);
    // Camera-change transitions (Transitions skill wired): scan the clip window for
    // shot boundaries so the graph can dip-to-black at each cut. Best-effort + time-
    // bounded — a failure or slow scan just yields no transitions.
    let cutTimesSec: number[] = [];
    if (args.cameraTransitions && maxMs - (Date.now() - startedAt) > 60_000) {
      cutTimesSec = await detectSceneCuts(ffmpegPath, effSrc, effStart, effEnd - effStart, {
        threshold: 0.4,
        timeoutMs: Math.min(45_000, Math.max(10_000, maxMs - (Date.now() - startedAt) - 40_000)),
      });
      if (cutTimesSec.length) warnings.push(`transitions: ${cutTimesSec.length} camera change${cutTimesSec.length === 1 ? "" : "s"} detected — dipping to black at each cut`);
    }
    // EFFECTIVE framing. An explicit pan/zoom mode is always honored (crop-follows-face).
    // For the FIT case — either an explicit "full", OR AUTO where face-detect couldn't
    // confidently localize a speaker (recommendFit) on a wide podcast shot — we fit the
    // WHOLE frame over a BLURRED, enlarged copy of itself (reusing the Zoom Punch
    // blur_frame composite) instead of black letterbox bars. Nothing is cropped away,
    // the full 2-person conversation stays visible, and the blurred fill removes the
    // dead "empty space" the black pillarbox left. blur_frame REPLACES the crop reframe
    // in buildClipGraph and forces the complex path, so it takes over framing entirely.
    const wantsBlurFit =
      framingMode === "full" ||
      (hasFaceReframe && recommendFit && (framingMode === undefined || framingMode === "auto"));
    const effectiveFramingMode: "auto" | "pan" | "zoom" | "full" | undefined =
      wantsBlurFit ? "full" : framingMode;
    const graphOps: EditOp[] =
      wantsBlurFit && !effOps.some((o) => o.op === "blur_frame")
        ? [...effOps, { op: "blur_frame", style: "static" } as EditOp]
        : effOps;
    const outPath = join(workDir, "out.mp4");
    const UPLOAD_TAIL_MS = 12_000;
    // Build + run the final encode for a given op set. Factored so a filtergraph
    // failure can RETRY with a simplified graph (below) instead of failing the clip.
    const buildAndRun = async (ops: EditOp[], primary: boolean, lean = false) => {
      // Render burned-in captions at 60fps so the per-word pop + page-entrance \t
      // tweens animate over ~2x the frames (buttery vs steppy at 30fps). Only when a
      // subtitles op is present, so plain clips keep the cheaper 30fps encode.
      const captionsFps = ops.some((o) => o.op === "subtitles") ? 60 : 30;
      const graph = buildClipGraph({ ops, startSeconds: effStart, endSeconds: effEnd, assPath: assRef, logoPaths, bgPaths, audioPaths, imagePaths, brollPaths, width, height, fps: captionsFps, cutTimesSec, fontFile: resolveFontFile(), faceCx, faceCy, faceBiasTop, faceXMin, faceXMax, framingMode: effectiveFramingMode, hasAudio, transition: args.transition, faceShots, shotZoom });
      if (primary) {
        graph.warnings.forEach((w) => console.warn(`[video/clip] ${w}`));
        warnings.push(...graph.warnings);
      }
      // drawtext reads each text from a file (textfile=) — write them into workDir.
      for (const tf of graph.textFiles) await writeFile(join(workDir, tf.name), tf.content);
      // Encode budget: bound the final ffmpeg to the REMAINING time (minus a tail for
      // the storage upload) so an overrun is SIGKILLed into a clean error. Recomputed
      // per attempt so a retry uses only what's left.
      const remainingMs = maxMs - (Date.now() - startedAt) - UPLOAD_TAIL_MS;
      if (remainingMs < 15_000) {
        const spent = Math.round((Date.now() - startedAt) / 1000);
        throw new ClipRenderError(
          `render time budget exhausted before final encode (${spent}s spent fetching/probing — likely a slow gameplay background or source download). Try a shorter clip or turn off Brain Rot.`,
          "budget",
        );
      }
      // preset medium was too slow on shared CPU for every render, not just heavy
      // ones — a clip is watched on a phone feed at social-app bitrates, so the
      // extra compression-efficiency `medium` buys over `veryfast` is invisible
      // after re-encode on TikTok/IG's side anyway. veryfast for ALL renders now
      // (used to be conditional on composite_bg/>45s/OOM-retry) so every clip
      // finishes and uploads faster with no perceptible quality loss. crf bumped
      // 18→21 for the same reason: smaller file = faster ffmpeg write + faster
      // Convex/storage upload = the clip shows up in the feed sooner. `lean` (the
      // OOM-retry) also drops to one thread, which is what actually shrinks
      // x264's per-thread frame buffers.
      const encPreset = "veryfast";
      // runWithDiscardCorruptFallback: `effSrc` is often still the RAW original
      // source (no filler-cut pre-pass ran) — same corrupt-frame exposure as
      // above, at the step that actually produces the deliverable.
      await runWithDiscardCorruptFallback(
        (a) => runFfmpeg(ffmpegPath, a, workDir, remainingMs),
        [
          "-y", "-ss", String(effStart), "-t", String(effEnd - effStart), "-i", effSrc,
          ...graph.inputArgs, ...graph.filterArgs,
          // Force the output frame rate so the caption \t tweens actually render at the
          // higher rate (the subtitles filter draws once per output frame).
          "-r", String(captionsFps),
          ...threadArgs(lean ? 1 : undefined),
          "-c:v", "libx264", "-preset", encPreset, "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath,
        ],
      );
    };

    try {
      await buildAndRun(graphOps, true);
    } catch (err) {
      // A budget throw is a genuine failure — never retry (it'd just fail again).
      if (err instanceof ClipRenderError && err.code === "budget") throw err;
      // KILLED FROM OUTSIDE (exit code null) = the container OOM-killer, not a bad
      // filtergraph. Simplifying the graph is the wrong remedy; the memory is in
      // x264's per-thread frame buffers, so retry the SAME edit single-threaded on
      // the cheapest preset. The clip keeps every effect it was supposed to have.
      if (isKilledBySignal(err)) {
        console.warn(`[video/clip] encode was killed (${err instanceof Error ? err.message.slice(0, 160) : err}) — retrying single-threaded`);
        warnings.push("encode was killed mid-render (out of memory) and was retried single-threaded");
        await buildAndRun(graphOps, false, true);
      } else {
      // Otherwise the filtergraph itself failed (a fancy effect the ffmpeg build
      // rejected, e.g. an unsupported filter option). RETRY ONCE with only the
      // essentials — plain crop framing + burned captions + brand logo + color
      // grade — so the clip still renders instead of failing outright. This is the
      // hard guarantee that advanced effects can never fail a whole clip.
      const SAFE_OPS = new Set(["reframe", "face_reframe", "text_overlay", "subtitles", "logo_overlay", "image_overlay", "color_filter"]);
      const kept = graphOps.filter((o) => SAFE_OPS.has(o.op));
      const safeOps: EditOp[] = kept.some((o) => o.op === "reframe")
        ? kept
        : [{ op: "reframe", mode: "crop" }, ...kept];
      if (safeOps.length < graphOps.length) {
        console.warn(`[video/clip] primary render failed (${err instanceof Error ? err.message : err}) — retrying with a simplified graph`);
        warnings.push("render fell back to a simplified graph (dropped advanced effects) after an ffmpeg error — the clip still rendered");
        await buildAndRun(safeOps, false);
      } else {
        throw err; // nothing left to simplify — a plain crop already failed
      }
      }
    }

    // 5. Store the rendered clip (R2, Convex fallback).
    const out = await readFile(outPath);
    const { url: clipUrl } = await putVideo(out, { keyPrefix: "clips", convexUrl: CONVEX_URL });

    return { clipUrl, warnings };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * CROSS-VIDEO FILL render (fill-short): assemble ONE clip from sub-windows spanning
 * MULTIPLE source files, then render it through the SAME single-file pipeline.
 *
 * Each `inputs[i]` is a sub-window {srcPath, start, end} (in that file's own
 * seconds) plus its source-absolute caption `words`. This runs a NORMALIZE+CONCAT
 * pre-pass — identical in spirit to the filler-cut pre-pass above, but ACROSS
 * different input files — that reframes every sub-window to the SAME target
 * canvas (cover-scale + crop, the SAME transform reframeFilter uses), pins a
 * single CFR + pixel format + audio format, and concats them into ONE intermediate
 * mp4. Because that intermediate is already exactly width×height, the delegate
 * renderClipFromFile's own reframe is an idempotent no-op — so ALL the caption /
 * overlay / encode / upload machinery is reused unchanged, with words re-timed onto
 * the concatenated 0-based timeline (retimeStitchedWords).
 *
 * The #1 failure mode is a resolution / fps / audio-stream MISMATCH between pooled
 * sources (they differ) — the concat filter demands identical frame + stream props
 * across inputs. Handled explicitly here: every video sub-window is forced to
 * width×height, setsar=1, fps, format=yuv420p; every audio sub-window is forced to
 * 44.1k/stereo, and a SILENT sub-window gets a synthesized anullsrc track so the
 * concat audio pads line up.
 *
 * Caller owns srcPath lifetimes (the batch route pulls + dedups them); this fn owns
 * only its own pre-pass workDir. `ops` are already in the STITCHED timeline coords.
 */
export async function renderStitchedClip(
  inputs: { srcPath: string; start: number; end: number; words?: TranscriptWord[] }[],
  args: { ops: unknown; width?: number; height?: number },
  opts?: { maxMs?: number },
): Promise<{ clipUrl: string; warnings: string[] }> {
  const startedAt = Date.now();
  const maxMs = opts?.maxMs ?? 300_000;
  if (!ffmpegPath || !CONVEX_URL) throw new ClipRenderError("ffmpeg/convex unavailable", "render");

  const segs = inputs.filter((i) => i && i.srcPath && i.end > i.start);
  if (segs.length === 0) throw new ClipRenderError("stitch: no valid input segments", "window");

  // Same even-clamp + default canvas as renderClipFromFile so the pre-pass targets
  // the IDENTICAL 9:16 the delegate would (its reframe then becomes a no-op).
  const evenClamp = (n: unknown, def: number) => { const v = Math.round(Math.min(2160, Math.max(120, Number(n) || def))); return v % 2 === 0 ? v : v - 1; };
  const width = evenClamp(args.width, 1080);
  const height = evenClamp(args.height, 1920);
  const FPS = 30;
  const warnings: string[] = [];
  const workDir = await mkdtemp(join(tmpdir(), "vello-stitch-"));
  try {
    // Reserve roughly half the budget (capped) for this pre-pass; the delegate
    // render (captions/overlays/encode/upload) gets the remainder.
    const prepMaxMs = Math.max(15_000, Math.min(Math.round(maxMs * 0.5), 150_000));

    // Probe each sub-window's source for an audio stream (silent segments get a
    // synthesized track below so the concat audio pads stay aligned).
    const hasAudio: boolean[] = [];
    for (const s of segs) hasAudio.push(await probeHasAudio(ffmpegPath, s.srcPath));

    const inputArgs: string[] = [];
    const filterParts: string[] = [];
    const vLabels: string[] = [];
    const aLabels: string[] = [];
    let inputIdx = 0;
    segs.forEach((s, i) => {
      const dur = +(s.end - s.start).toFixed(3);
      // Input-seek + duration-bound each source so only the sub-window is decoded.
      inputArgs.push("-ss", s.start.toFixed(3), "-t", dur.toFixed(3), "-i", s.srcPath);
      const idx = inputIdx++;
      // Normalize the sub-window to the EXACT canvas: cover-scale + crop (the SAME
      // transform reframeFilter uses), square pixels, one CFR + pixel format, reset
      // PTS. This is what makes mismatched-resolution/fps pooled sources concat.
      filterParts.push(`[${idx}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${FPS},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
      vLabels.push(`[v${i}]`);
      if (hasAudio[i]) {
        filterParts.push(`[${idx}:a]aresample=async=1,aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        // Silent sub-window → synthesize matching silence so concat's audio pads align.
        inputArgs.push("-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
        const sidx = inputIdx++;
        filterParts.push(`[${sidx}:a]aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      }
      aLabels.push(`[a${i}]`);
    });
    const n = segs.length;
    const concatIns = segs.map((_, i) => `${vLabels[i]}${aLabels[i]}`).join("");
    filterParts.push(`${concatIns}concat=n=${n}:v=1:a=1[vc][ac]`);

    const stitchedPath = join(workDir, "stitched.mp4");
    // runWithDiscardCorruptFallback: `inputArgs` decodes each sub-window's own
    // source file (hook video + the main clip's source) — same corrupt-frame
    // exposure as the single-file paths above. This only inserts tolerance
    // before the FIRST `-i` it finds; with multiple real inputs here a frame
    // that's bad in one of the LATER inputs (not the first) would still need a
    // second pass to cover — rare enough (a hook video is short and unlikely to
    // carry a damaged frame) that a single targeted retry is the right cost/
    // benefit call rather than adding blanket tolerance to every input always.
    await runWithDiscardCorruptFallback(
      (a) => runFfmpeg(ffmpegPath, a, workDir, prepMaxMs),
      [
        "-y", ...inputArgs,
        "-filter_complex", filterParts.join(";"),
        "-map", "[vc]", "-map", "[ac]",
        // High-quality intermediate (crf 16) so the delegate's final re-encode doesn't
        // compound generation loss from this concat pre-pass (mirrors the filler-cut pre-pass).
        ...threadArgs(),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "160k", stitchedPath,
      ],
    );

    // Re-time words onto the concatenated 0-based timeline (cumulative sub-segment
    // offsets) — the same pure math the edit-planner saw for these sub-windows.
    const retimed = retimeStitchedWords(segs.map((s) => ({ start: s.start, end: s.end, words: s.words ?? [] })));
    const totalLen = +segs.reduce((sum, s) => sum + (s.end - s.start), 0).toFixed(3);

    // Delegate to the SAME single-file renderer on the already-normalized WxH
    // intermediate (its reframe is a no-op on a pre-sized input; startSeconds=0).
    const remainingMs = Math.max(15_000, maxMs - (Date.now() - startedAt));
    const res = await renderClipFromFile(
      stitchedPath,
      { startSeconds: 0, endSeconds: totalLen, ops: args.ops, words: retimed, width, height },
      { maxMs: remainingMs },
    );
    return { clipUrl: res.clipUrl, warnings: [...warnings, ...res.warnings, `cross-video fill: stitched ${n} segments (~${totalLen.toFixed(1)}s)`] };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
