import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { repairInsaneTimestamps } from "@/lib/server/videoNormalize";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath, runWithDiscardCorruptFallback } from "@/lib/server/ffmpegBin";
// Resolved binary (not the raw ffmpeg-static export — the dev bundler can
// rewrite that path into .next where no binary exists).
const ffmpegPath = resolveFfmpegPath();
import { putVideo } from "@/lib/server/videoStorage";
import { buildClipGraph } from "@/lib/server/clipFilterGraph";
import { renderCaptionsAss, pickZoomPunchTimes } from "@/lib/server/captionRenderer";
import { computeRandomJumpCuts } from "@/lib/server/jumpCuts";
import { keepRanges, remapWords, type CutRange } from "@/lib/server/fillerCut";
import type { EditOp } from "@/lib/server/clipEditOps";
import type { TranscriptWord, CaptionStyle } from "@/lib/server/clipTypes";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { fetchSelf } from "@/lib/server/fetchInternal";
import { streamFetchToFile, safeFetchToBuffer } from "@/lib/server/downloader";
import { trendingAudioUrl, pickTrendingTrackByMood, isTrendingAudioId } from "@/lib/server/trendingAudioPack";
import { reactionSfxUrl, reactionSfxPackById, pickSfxFromKeywords } from "@/lib/server/reactionSfxPack";
import { isCaptionPresetId } from "@/lib/builder/captionPresets";
import { synthesizeWordsFromScript } from "@/lib/server/captionSynth";
import { translateCaptionWords } from "@/lib/server/captionTranslate";
import { sanitizeShots, type FaceShot, type FramingMode } from "@/lib/builder/faceShots";
import { resolveFontFile } from "@/lib/server/videoFont";
import { withVelloWatermark } from "@/lib/builder/velloWatermark";
import { HOOK_ALWAYS_ON_END_SEC } from "@/lib/builder/hookDesigns";
import { coerceHookMotion } from "@/lib/server/clipEditOps";
import { writeVelloWatermark } from "@/lib/server/velloWatermark";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// Wall-clock ceiling for a single ffmpeg invocation. Under the 300s maxDuration
// so a hung burn is SIGKILLed (freeing the pinned CPU core on the long-lived
// Railway process) before the request itself is force-terminated.
const FFMPEG_WALL_MS = 280_000;

/** Run ffmpeg, rejecting on non-zero exit with the tail of stderr. */
function runFfmpeg(bin: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // cwd matters: drawtext ops reference their text via RELATIVE textfile=
    // basenames (txt0.txt…), resolved against the process cwd — running from
    // anywhere but workDir fails with "txt0.txt could not be read or is empty".
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], cwd });
    let e = "";
    proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 8000) e = e.slice(-8000); });
    // Wall-clock kill: SIGKILL a hung burn, then reject. The route's catch maps
    // any throw to a graceful { ok: false, videoUrl } fallback (status 200), and
    // the outer finally{ rm(workDir) } still runs. Cleared on close/error so a
    // normal exit never fires it.
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); fn(); };
    const wall = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      settle(() => reject(new Error(`ffmpeg killed: exceeded ${FFMPEG_WALL_MS}ms wall clock. ${e.slice(-500)}`)));
    }, FFMPEG_WALL_MS);
    proc.on("error", (err) => settle(() => reject(err)));
    proc.on("close", (c) => settle(() => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${e.slice(-500)}`)))));
  });
}

/** Probe a file with `ffmpeg -i` (no ffprobe dependency — ffmpeg prints stream
 *  info to stderr and exits non-zero, which we ignore). Yields audio presence and
 *  the true video canvas dims so captions/reframe use the REAL aspect (a 16:9
 *  video must NOT be force-cropped to portrait). Falls back to 0s on any failure. */
function probeVideo(bin: string, path: string): Promise<{ hasAudio: boolean; width: number; height: number; durationSeconds: number; fps: number }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-hide_banner", "-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 20000) e = e.slice(-20000); });
    const done = () => {
      const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(e);
      const vm = e.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
      // "Duration: 00:00:12.34" — the source's real length. Callers use it to
      // bound every generated stream (silence base, music bed) to the video.
      const dm = e.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
      const durationSeconds = dm ? parseInt(dm[1], 10) * 3600 + parseInt(dm[2], 10) * 60 + parseFloat(dm[3]) : 0;
      // Declared nominal fps ("29.97 fps") — survives even when the PTS lie;
      // the timestamp repair re-times broken sources at this rate.
      const fm = e.match(/(\d+(?:\.\d+)?)\s*fps/);
      const fps = fm ? parseFloat(fm[1]) : 0;
      resolve({ hasAudio, width: vm ? parseInt(vm[1], 10) : 0, height: vm ? parseInt(vm[2], 10) : 0, durationSeconds, fps });
    };
    proc.on("error", () => resolve({ hasAudio: false, width: 0, height: 0, durationSeconds: 0, fps: 0 }));
    proc.on("close", done);
  });
}

/** Clamp to an even, sane pixel dimension (libx264/yuv420p rejects odd sizes). */
function evenDim(n: number, def: number): number {
  const v = Math.min(2160, Math.max(120, Math.round(n > 0 ? n : def)));
  return v % 2 === 0 ? v : v - 1;
}

interface HookText {
  text: string;
  position?: "top" | "center" | "bottom";
  /** Exact vertical placement (0-100, % from the top) from the Editor tab's
   *  drag-to-position control — overrides `position`'s fixed band when set. */
  yPct?: number;
  fontColor?: string;
  fontSize?: number;
  /** Bundled font token (lib/server/hookFonts.ts — "jakarta", "manrope",
   *  "montserrat", …). Unset → the graph's generic global font. */
  font?: string;
  /** Max wrapped lines (default 2 — hook-sized). Text-story overlays pass ~10 so
   *  the whole block renders as a tall centered stack instead of being truncated. */
  maxLines?: number;
  // Hook-design outline/box (resolved from the chosen template in the render path).
  outlineColor?: string;
  outlineWidth?: number;
  boxColor?: string;
  hookLayout?: import("@/lib/builder/hookDesigns").HookLayout;
  hookAccentColor?: string;
  /** Entrance + shine sweep of the chosen design (lib/builder/hookDesigns). */
  hookMotion?: import("@/lib/builder/hookDesigns").HookMotion;
  // How long the hook stays on screen (seconds). Defaults to 5 when absent.
  durationSeconds?: number;
  /** "Always on": hold the hook until the end of the video (ignores durationSeconds). */
  alwaysOn?: boolean;
}
interface CaptionsSpec {
  mode?: "karaoke" | "line"; fontColor?: string; fontSize?: number; position?: "top" | "center" | "bottom"; preset?: string;
  /** Exact vertical placement (0-100, % from the top) from the Editor tab's
   *  drag-to-position control — overrides `position`'s fixed band when set,
   *  same convention as HookText.yPct. */
  yPct?: number;
  /** The KNOWN spoken script. When transcription returns no words (quiet/short
   *  takes, STT outages) the words are SYNTHESIZED from this text — evenly timed
   *  across the clip — so requested captions ALWAYS burn instead of silently
   *  vanishing. */
  scriptText?: string;
  /** ISO 639 code pinning which language ElevenLabs Scribe decodes this
   *  clip's own voice as (e.g. "ms" vs "id" near-neighbor mix-ups). Unset/
   *  empty = auto-detect. Does NOT translate. */
  languageCode?: string;
  /** ISO 639 code of the language the SUBTITLES should be burned in. When it
   *  differs from the spoken/detected language the transcript is translated
   *  phrase-by-phrase (lib/server/captionTranslate) before the ASS render.
   *  Unset/empty = same as spoken (no translation). */
  subtitleLanguageCode?: string;
}

interface MusicSpec { trackId?: string; autoMusic?: boolean; volumePct?: number; customUrl?: string }
type FilterPreset = "vintage" | "warm" | "cool" | "bw" | "vivid" | "cinematic" | "hd" | "superhd" | "moody" | "filmic" | "matte";
interface FilterSpec { preset?: FilterPreset; saturation?: number; brightness?: number }
const FILTER_PRESETS = new Set<FilterPreset>(["vintage", "warm", "cool", "bw", "vivid", "cinematic", "hd", "superhd", "moody", "filmic", "matte"]);

/** Editor Camera tool — the SAME face-tracked shot algorithm as /dev/face-detect
 *  (lib/builder/faceShots): the client scans the clip with
 *  /api/video/detect-face-track, segments it into fixed-position shots, previews
 *  them, and sends the identical shots here so the burn crops EXACTLY what the
 *  preview showed. `full` = letterbox into the aspect (no crop, no shots). */
interface FramingSpec {
  mode: FramingMode;
  /** Target canvas — the editor's aspect picker. Defaults to 9:16. */
  aspectRatio?: AspectKey;
  shots?: unknown;
  /** Dual mode's left/right tracked faces, rendered into top/bottom panes. */
  dualShots?: { top?: unknown; bottom?: unknown };
  /** Zoom Punch slider (1..2). Other modes use their built-in target zoom. */
  zoomAmount?: number;
}
const FRAMING_MODES = new Set<string>(["auto", "zoom", "pan", "dual", "full"]);

/** Sound Effect tool (Editor tab) — see pickSfxFromKeywords in
 *  lib/server/reactionSfxPack.ts for the full algo explanation. `packId`
 *  chooses WHICH sting each bucket maps to; the AI still decides IF a sting
 *  fires and WHICH bucket, from the clip's own transcript. */
interface SfxSpec { packId?: string }

/** Specials tool (Editor tab): two independent, best-effort extras.
 *  `zoomPunch` punches in on keyword/emphasis beats found in the clip's OWN
 *  transcript (see pickZoomPunchTimes). `jumpCuts` removes a few random
 *  TIME-based micro-windows (see computeRandomJumpCuts) — NOT filler-word or
 *  script driven, purely for pacing/variation; a fresh pattern every burn. */
interface SpecialsSpec { zoomPunch?: boolean; jumpCuts?: boolean; velloWatermark?: boolean }

/** Reference Image tool (Editor tab Specials): a real photo — a news
 *  screenshot, product shot, whatever the operator captured/uploaded, or the
 *  research photo an idea's own news grounding turned up — composited for the
 *  clip's full length. Default is a full-width band flush against the bottom
 *  edge (position "bottom") so the whole captured page context is legible,
 *  not a small corner card; the corner positions remain for callers that
 *  want a smaller inset instead. Purely visual: it never touches which face
 *  renders (that's the identity-reference system). */
interface ImageOverlaySpec {
  url: string;
  position?: "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Width as a % of the canvas width. Default 96 for "bottom" (near
   *  edge-to-edge), 30 for a corner position. Clamped 15-100. */
  widthPct?: number;
}

/** Editor Overlay drawer: a freely placed image or (muted, looping) video
 *  overlay, positioned EXACTLY as the preview shows it — center at (xPct, yPct)
 *  of the canvas, width = widthPct of the canvas width, visible between
 *  startSec..endSec. Several may stack; composited after the main burn. */
interface MediaOverlaySpec {
  url: string;
  kind?: "image" | "video";
  xPct?: number;
  yPct?: number;
  widthPct?: number;
  startSec?: number;
  endSec?: number;
}
const MAX_MEDIA_OVERLAYS = 8;

/** Glass BG — see the `background` parsing above for the full explanation. */
interface BackgroundSpec {
  style: "blur";
  aspectRatio: "9:16" | "16:9" | "1:1";
  /** Gentle motion on the composite (blurFrameSegments) — default "static". */
  motion?: "static" | "zoom_in" | "zoom_out";
}
type AspectKey = BackgroundSpec["aspectRatio"];
/** Standard export dims per aspect — same canvas sizes the clipper renders at. */
const ASPECTS: Record<AspectKey, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
};

/** Convert a 0-100 loudness % to a decibel gain for ffmpeg `volume=`. 100% = 0dB
 *  (native level), 0% = fully silent. Clamped to [1,100]% so it never boosts.
 *  FIXED: this used to be a straight linear-amplitude mapping (20*log10(pct/100)),
 *  which put even 10% at -20dB — still clearly audible under a voiceover. The
 *  percentage is now squared before the dB conversion (same 0%/100% anchors, much
 *  steeper falloff at the low end) so the low half of the slider actually reads as
 *  quiet: 10% ~ -40dB, 20% ~ -28dB, 30% ~ -21dB. Mirrors the same fix applied to
 *  the AI Clipper's Trending Audio slider (inspector-panel.tsx musicPctToGainDb). */
function volumePctToGainDb(pct: number | undefined): number {
  const p = Math.max(1, Math.min(100, Math.round(typeof pct === "number" ? pct : 20)));
  const effectivePct = (p * p) / 100;
  return 20 * Math.log10(effectivePct / 100);
}

/** Small deterministic hash of a string → non-negative int (seed for track rotation). */
function seedFrom(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Burn a hook-text overlay and/or auto-captions onto a finished MP4 and return
 * the new Convex-storage URL.
 *
 * Robustness contract: on ANY failure this returns HTTP 200 with
 * `{ ok: false, videoUrl: <original> }` so the caller can transparently fall
 * back to the un-burned video instead of losing it to a 500.
 */
export async function POST(req: NextRequest) {
  // Gate: server-to-server (X-Internal-Secret, from render-step / videoJobs) or a
  // SIWS user. Was previously open to anyone — it runs ffmpeg over an arbitrary URL.
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }
  let body: { videoUrl?: string; voiceSourceUrl?: string; voiceOffsetSeconds?: number; hookText?: HookText; captions?: CaptionsSpec; music?: MusicSpec; filter?: FilterSpec; phoneLook?: boolean; background?: BackgroundSpec; sfx?: SfxSpec; specials?: SpecialsSpec; imageOverlay?: ImageOverlaySpec; framing?: FramingSpec; imageOverlays?: MediaOverlaySpec[]; aspectRatio?: AspectKey };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON", videoUrl: "" }, { status: 200 }); }

  const videoUrl = String(body.videoUrl ?? "");
  if (!videoUrl) return NextResponse.json({ ok: false, error: "videoUrl required", videoUrl }, { status: 200 });
  // Captions must be transcribed from the agent's own generated voice, never
  // a different clip's audio that got stitched onto `videoUrl` upstream
  // (e.g. a Hook Video pool prepending an unrelated uploaded clip — see
  // render-step/route.ts's `voiceSourceUrl`). Defaults to `videoUrl` for
  // every other caller (Editor tab's Apply, direct burns), unchanged.
  const voiceSourceUrl = typeof body.voiceSourceUrl === "string" && body.voiceSourceUrl.trim() ? body.voiceSourceUrl.trim() : videoUrl;
  // How far into `videoUrl` the transcribed clip's own audio actually starts
  // (e.g. a Hook Video prepended ahead of it) — word timestamps from
  // `voiceSourceUrl` are relative to ITS OWN t=0, so they need shifting by
  // this much to land correctly once burned onto `videoUrl`. 0 when
  // `voiceSourceUrl` IS `videoUrl` (every caller except render-step's hook-join case).
  const voiceOffsetSeconds = typeof body.voiceOffsetSeconds === "number" && body.voiceOffsetSeconds > 0 ? body.voiceOffsetSeconds : 0;

  const hookText = body.hookText && typeof body.hookText.text === "string" && body.hookText.text.trim() ? body.hookText : undefined;
  const captions = body.captions ? body.captions : undefined;
  const mediaOverlays: MediaOverlaySpec[] = (Array.isArray(body.imageOverlays) ? body.imageOverlays : [])
    .filter((o): o is MediaOverlaySpec => !!o && typeof o === "object" && typeof o.url === "string" && /^https?:\/\//i.test(o.url))
    .slice(0, MAX_MEDIA_OVERLAYS)
    .map((o) => ({
      url: o.url,
      kind: o.kind === "video" ? "video" : "image",
      xPct: typeof o.xPct === "number" && Number.isFinite(o.xPct) ? Math.min(100, Math.max(0, o.xPct)) : 50,
      yPct: typeof o.yPct === "number" && Number.isFinite(o.yPct) ? Math.min(100, Math.max(0, o.yPct)) : 50,
      widthPct: typeof o.widthPct === "number" && Number.isFinite(o.widthPct) ? Math.min(100, Math.max(3, o.widthPct)) : 33,
      startSec: typeof o.startSec === "number" && Number.isFinite(o.startSec) ? Math.max(0, o.startSec) : 0,
      endSec: typeof o.endSec === "number" && Number.isFinite(o.endSec) ? Math.max(0, o.endSec) : undefined,
    }));
  const framing: FramingSpec | undefined = body.framing && typeof body.framing === "object" && FRAMING_MODES.has(String(body.framing.mode))
    ? {
        mode: body.framing.mode,
        aspectRatio: body.framing.aspectRatio && body.framing.aspectRatio in ASPECTS ? body.framing.aspectRatio : "9:16",
        shots: body.framing.shots,
        dualShots: body.framing.dualShots,
        zoomAmount: typeof body.framing.zoomAmount === "number" && Number.isFinite(body.framing.zoomAmount) ? Math.min(3, Math.max(1, body.framing.zoomAmount)) : undefined,
      }
    : undefined;
  const music = body.music ? body.music : undefined;
  const filter: FilterSpec | undefined = body.filter && typeof body.filter === "object"
    ? {
        ...(FILTER_PRESETS.has(body.filter.preset as FilterPreset) ? { preset: body.filter.preset as FilterPreset } : {}),
        ...(typeof body.filter.saturation === "number" && Number.isFinite(body.filter.saturation) ? { saturation: Math.min(2, Math.max(0, body.filter.saturation)) } : {}),
        ...(typeof body.filter.brightness === "number" && Number.isFinite(body.filter.brightness) ? { brightness: Math.min(0.5, Math.max(-0.5, body.filter.brightness)) } : {}),
      }
    : undefined;
  const sfx = body.sfx ? body.sfx : undefined;
  const specials = body.specials ? body.specials : undefined;
  const imageOverlay = body.imageOverlay && typeof body.imageOverlay.url === "string" && /^https?:\/\//i.test(body.imageOverlay.url)
    ? body.imageOverlay
    : undefined;
  // Glass BG (Editor tab toggle): the operator wants the target aspect ratio's
  // letterbox gaps filled with a blurred, cover-scaled copy of the SAME video —
  // the "Apple frosted glass" look — instead of plain black bars. Reuses the
  // exact blur_frame composite the clipper's Zoom Punch skill already renders
  // (lib/server/clipFilterGraph.ts blurFrameSegments); only NEW here is letting
  // the canvas dims come from a requested aspect ratio instead of always the
  // source's native probe (see canvasW/canvasH below).
  const background = body.background && ASPECTS[body.background.aspectRatio as AspectKey] ? body.background : undefined;
  // "Shot on a phone" finishing pass: subtle temporal grain + soft vignette +
  // slightly lifted contrast / pulled saturation + a whisper of warmth — the
  // handheld-camera texture that makes an AI render read as phone footage.
  const phoneLook = body.phoneLook === true;

  // 1. No burn (hook/captions/music) was requested — this used to return the
  // original untouched, but that's exactly the raw Kie/Veo/stitched output
  // (high-bitrate, no faststart) that made "no-overlay" UGC renders load slow
  // everywhere they're embedded. Fall through instead: step 4 below always
  // re-encodes at the tuned crf/faststart settings, so EVERY final video is
  // guaranteed compressed regardless of whether it got an overlay burned in.

  if (!ffmpegPath || !CONVEX_URL) {
    return NextResponse.json({ ok: false, error: "ffmpeg/convex unavailable", videoUrl }, { status: 200 });
  }

  const workDir = await mkdtemp(join(tmpdir(), "vello-overlay-"));
  try {
    // 2. Download the source MP4. Streams to DISK (never a full-heap Buffer), so
    //    a large rendered / hook-joined video is NOT capped at the 500MB
    //    safeFetchToBuffer limit — which silently dropped the burn (captions /
    //    hook text) on bigger videos.
    let srcPath = join(workDir, "src.mp4");
    await streamFetchToFile(videoUrl, srcPath);

    // 2b. Probe the REAL canvas dims + audio presence. The generated video is
    // already at its intended aspect (Veo renders 9:16 OR 16:9 per config), so we
    // burn at its NATIVE dimensions. Previously this route hardcoded a portrait
    // 1080x1920 reframe, which center-cropped every 16:9 landscape video down to
    // 9:16 (destroying the frame) and mis-positioned captions. Probe → burn native.
    let probe = await probeVideo(ffmpegPath, srcPath);

    // 2c. BROKEN-TIMESTAMP REPAIR. Downloader-ripped mp4s (several of the stock
    // clips) carry a wrong container timescale — a ~17s clip probes as ~17
    // HOURS. Left alone, the graph's fps filter tries to synthesize hours of
    // frames and the encode dies on the wall clock ("time=16:49:15, frame=97").
    // repairInsaneTimestamps re-times such a source by frame index into a clean
    // 30fps clip (and throws if it can't — proceeding un-repaired IS the hang).
    const repaired = await repairInsaneTimestamps(ffmpegPath, srcPath, workDir, probe.durationSeconds, probe.hasAudio, probe.fps);
    if (repaired.repaired) {
      srcPath = repaired.path;
      probe = await probeVideo(ffmpegPath, srcPath);
      console.warn(`[video/overlay-burn] timestamp repair done — real duration ${probe.durationSeconds.toFixed(1)}s`);
    }

    // 2d. Random Jump Cuts pre-pass (Specials tool) — pure TIME-based micro-
    // trims, no transcript needed. Runs BEFORE canvas dims/duration are read
    // so everything downstream (captions, hook window, music bed length) sees
    // the ALREADY-TIGHTENED file, same convention as clipRender.ts's filler-cut
    // pre-pass. A fresh seed every burn (Date.now(), not just the video URL) so
    // repeat Applies of the same clip produce a genuinely different pattern
    // instead of the same fingerprint every time — the whole point of this
    // tool ("doesn't have to be a straight script, more variations").
    let jumpCutRanges: CutRange[] = [];
    if (specials?.jumpCuts) {
      jumpCutRanges = computeRandomJumpCuts(probe.durationSeconds, (Date.now() ^ seedFrom(videoUrl)) >>> 0);
      const keeps = jumpCutRanges.length > 0 ? keepRanges(jumpCutRanges, probe.durationSeconds) : [];
      if (keeps.length > 1) {
        // >1 keep window means an actual cut landed inside the clip (not a
        // no-op single keep spanning the whole thing).
        const srcHasAudio = probe.hasAudio;
        const segs: string[] = [];
        const maps: string[] = [];
        keeps.forEach((k, i) => {
          const a = k.start.toFixed(3);
          const b = k.end.toFixed(3);
          segs.push(`[0:v]trim=${a}:${b},setpts=PTS-STARTPTS[v${i}]`);
          if (srcHasAudio) segs.push(`[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS[a${i}]`);
          maps.push(srcHasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
        });
        segs.push(`${maps.join("")}concat=n=${keeps.length}:v=1:a=${srcHasAudio ? 1 : 0}[vc]${srcHasAudio ? "[ac]" : ""}`);
        const cutPath = join(workDir, "jumpcut.mp4");
        try {
          await runFfmpeg(ffmpegPath, [
            "-y", "-i", srcPath,
            "-filter_complex", segs.join(";"),
            "-map", "[vc]", ...(srcHasAudio ? ["-map", "[ac]"] : []),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
            ...(srcHasAudio ? ["-c:a", "aac"] : ["-an"]), cutPath,
          ], workDir);
          srcPath = cutPath;
          probe = await probeVideo(ffmpegPath, srcPath);
          console.log(`[video/overlay-burn] jump cuts: removed ${jumpCutRanges.length} window(s), new duration ${probe.durationSeconds.toFixed(1)}s`);
        } catch (e) {
          // Cosmetic extra — never let a pre-pass failure sink the whole burn.
          console.warn(`[video/overlay-burn] jump-cut pre-pass failed, continuing un-cut: ${e instanceof Error ? e.message : e}`);
          jumpCutRanges = [];
        }
      } else {
        jumpCutRanges = []; // collapsed to a no-op — nothing to remap later
      }
    }

    // Glass BG asks for a SPECIFIC target canvas (e.g. 9:16 even though the
    // source is 16:9) so the letterbox gaps actually exist to fill with the
    // blurred backdrop; otherwise burn at the source's own native dims as before.
    // The Camera tool likewise targets the editor's aspect (a 16:9 podcast
    // cropped/tracked into 9:16 is the whole point of the feature).
    // Plain editor aspect (no Glass BG / Camera) is the last fallback, so Apply
    // burns the shape the editor preview shows instead of the source's native one.
    const editorAspect: AspectKey | undefined = body.aspectRatio && body.aspectRatio in ASPECTS ? body.aspectRatio : undefined;
    const targetAspect: AspectKey | undefined = background?.aspectRatio ?? framing?.aspectRatio ?? editorAspect;
    const canvasW = targetAspect ? ASPECTS[targetAspect].w : evenDim(probe.width, 1080);
    const canvasH = targetAspect ? ASPECTS[targetAspect].h : evenDim(probe.height, 1920);

    // 3. Build the edit ops. `reframe crop` at the NATIVE dims is a no-op cover+crop
    // (setsar normalizes pixel aspect) — it preserves 16:9 and 9:16 alike instead of
    // forcing portrait. A blur_frame op (Glass BG) REPLACES this entirely inside
    // buildClipGraph regardless of ops order (it's found via .find, not position).
    // Camera "Fit (safe)" = pad (letterbox) instead of crop. Every other mode
    // crops, following the face-tracked shots below when the client sent them.
    const ops: EditOp[] = [{ op: "reframe", mode: framing?.mode === "full" ? "pad" : "crop" }];
    if (filter && (filter.preset || filter.saturation !== undefined || filter.brightness !== undefined)) {
      ops.push({ op: "color_filter", ...filter });
    }
    if (background) ops.push({ op: "blur_frame", style: background.motion ?? "static" });
    let faceShots: FaceShot[] = framing && framing.mode !== "full" ? sanitizeShots(framing.shots) : [];
    let dualFaceShots = framing?.mode === "dual"
      ? { top: sanitizeShots(framing.dualShots?.top), bottom: sanitizeShots(framing.dualShots?.bottom) }
      : undefined;
    if (faceShots.length > 0 && jumpCutRanges.length > 0) {
      // Shots are timed on the ORIGINAL timeline; after jump cuts the file is
      // shorter, so a time-keyed crop would drift. Hold the first confident
      // shot's position for the whole clip instead of tracking wrong.
      const first = faceShots.find((sh) => sh.confident) ?? faceShots[0];
      faceShots = [{ ...first, startT: 0, endT: 1e6 }];
      // Jump cuts retime the source, so time-varying dual tracks no longer line
      // up. Disable the split and keep the safe primary framing for this burn.
      dualFaceShots = undefined;
    }
    if (framing) console.log(`[video/overlay-burn] camera framing: ${framing.mode} → ${canvasW}x${canvasH}, ${faceShots.length} shot(s)${framing.zoomAmount ? `, zoom ${framing.zoomAmount}` : ""}`);

    // The clip filter graph does NOT trim — the route is responsible for any
    // -ss/-t input window. We pass NO trim flags below, so the whole video flows
    // through. startSeconds/endSeconds bound the ASS render window, the
    // text_overlay `enable` expression, AND the length of any GENERATED audio
    // (the silence base for an audio-less source) — so it must be the source's
    // REAL length, never a giant ceiling. The old `|| 100000` fallback sized the
    // silence base at 100000s on an audio-less stock clip + music bed, and amix
    // duration=first then encoded ~27 HOURS of audio until the wall-clock kill
    // ("ffmpeg killed: exceeded 280000ms … time=16:23:26"). Seeded from the
    // probe (always available); the transcription's value refines it below.
    // Hard 900s ceiling even post-repair — the silence base / ASS window derived
    // from this must never be sized past any plausible burn source.
    let durationSeconds = probe.durationSeconds > 0 ? Math.ceil(Math.min(probe.durationSeconds, 900)) : 0;
    let assPath: string | undefined;
    // Hoisted out of the `captions` block below (which populates it) so the
    // Trending Audio bed further down can read it too — a dialogue-heavy
    // video (near-continuous speech) should get an instrumental bed, same
    // signal the clipper's clip.trendingaudio floor uses.
    let words: TranscriptWord[] = [];
    // Language transcribe-clip actually decoded (pinned or auto-detected) — the
    // subtitle translator skips work when it already equals the subtitle language.
    let spokenLanguage = "";

    // Transcription is shared by captions, the Sound Effect tool (sfx), and
    // Zoom Punch (specials.zoomPunch) — pickSfxFromKeywords / pickZoomPunchTimes
    // need the same real per-word transcript captions already fetches.
    if (captions || sfx || specials?.zoomPunch) {
      try {
        // fetchSelf: loopback-first — fetching this server's own public origin
        // from inside the container is the classic silent "fetch failed", which
        // made captions quietly disappear (words=[] → no subtitles op).
        const tRes = await fetchSelf("/api/video/transcribe-clip", {
          method: "POST",
          // Server-to-server: forward the internal secret (transcribe-clip now
          // requires a SIWS session for user callers; this in-process call uses cron).
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
          },
          body: JSON.stringify({ sourceUrl: voiceSourceUrl, languageCode: captions?.languageCode || undefined }),
        }, req);
        if (tRes.ok) {
          const tData = (await tRes.json()) as { ok?: boolean; durationSeconds?: number; words?: TranscriptWord[]; language?: string };
          if (tData.ok) {
            // Refines the probe seed; never zero it back out on a partial reply.
            // Skipped when jump cuts already tightened the file — transcribe-clip
            // transcribes the ORIGINAL remote videoUrl (it has no idea a local
            // pre-pass shortened it), so its duration would silently undo the
            // post-cut length computed above. ALSO skipped when transcribing a
            // different (shorter, pre-hook-join) source than `videoUrl` — that
            // duration describes voiceSourceUrl alone, not the full video being burned.
            if (typeof tData.durationSeconds === "number" && tData.durationSeconds > 0 && jumpCutRanges.length === 0 && voiceOffsetSeconds === 0) {
              durationSeconds = tData.durationSeconds;
            }
            const rawWords = Array.isArray(tData.words) ? tData.words : [];
            // Timestamps came back relative to voiceSourceUrl's own t=0 — shift
            // them forward so they land at the right point once burned onto
            // videoUrl (which has voiceOffsetSeconds of OTHER footage first).
            words = voiceOffsetSeconds > 0
              ? rawWords.map((w) => ({ ...w, start: w.start + voiceOffsetSeconds, end: w.end + voiceOffsetSeconds }))
              : rawWords;
            spokenLanguage = typeof tData.language === "string" ? tData.language : "";
          }
        }
      } catch {
        // transcription failed — proceed without captions rather than aborting.
      }

      if (words.length === 0 && typeof captions?.scriptText === "string" && captions.scriptText.trim()) {
        words = synthesizeWordsFromScript(captions.scriptText, durationSeconds || 15);
        if (words.length) console.warn(`[overlay-burn] transcription empty — synthesized ${words.length} caption words from the provided script`);
      }
      if (words.length === 0) {
        console.warn(`[overlay-burn] captions/sfx requested but transcription returned no words for ${videoUrl.slice(0, 100)}`);
      }
      // Subtitle language ≠ spoken language → translate BEFORE the jump-cut remap
      // (phrase spans are original-timeline seconds, same as `words` here). Only the
      // burned captions change; sfx / zoom-punch keyword picks below still read the
      // translated words, which is fine — they key on emphasis, not exact tokens.
      const subtitleLang = (captions?.subtitleLanguageCode ?? "").trim().toLowerCase();
      if (captions && subtitleLang && words.length > 0) {
        const source = spokenLanguage || (captions.languageCode ?? "");
        const r = await translateCaptionWords(words, { target: subtitleLang, source });
        if (r.mode === "llm") { words = r.words; console.warn(`[overlay-burn] captions translated ${source || "auto"} → ${subtitleLang} (${words.length} tokens)`); }
        else if (r.mode === "failed") console.warn(`[overlay-burn] caption translation to ${subtitleLang} failed — burning in the spoken language`);
      }
      // The transcript above is in the ORIGINAL (pre-cut) timeline — remap it
      // onto the post-cut one so captions/sfx/zoom-punch timing matches the
      // ALREADY-TIGHTENED file jump cuts produced.
      if (jumpCutRanges.length > 0 && words.length > 0) {
        words = remapWords(words, jumpCutRanges);
      }
    }

    if (captions && words.length > 0) {
      const style: CaptionStyle = {
        mode: captions.mode ?? "karaoke",
        fontColor: captions.fontColor ?? "#FFFFFF",
        fontSize: captions.fontSize ?? 48,
        position: captions.position ?? "bottom",
        ...(typeof captions.yPct === "number" ? { yPct: captions.yPct } : {}),
        // Render with the SAME OpusClip-parity preset engine the AI Clipper uses,
        // so builder/hire captions are word-synced and look "like the clipping"
        // instead of the plain legacy karaoke style. Default to the karaoke preset
        // (white caps, spoken word pops green) when the operator hasn't picked one.
        preset: isCaptionPresetId(captions.preset) ? captions.preset : "karaoke",
      };
      assPath = join(workDir, "subs.ass");
      await writeFile(
        assPath,
        // Pass the TRUE canvas dims so PlayRes + margins match the real aspect —
        // otherwise a 16:9 video captioned against a portrait PlayRes puts text in
        // the wrong band at the wrong size.
        renderCaptionsAss(words, { clipStartSec: 0, clipEndSec: durationSeconds || 600, style, width: canvasW, height: canvasH }),
      );
      ops.push({ op: "subtitles", style });
    }

    if (hookText) {
      // On-screen window: 0 → durationSeconds (clamped 1-15). wrapDrawtext already
      // centers, word-wraps to multiple lines, and keeps a 40px edge margin, so the
      // hook never runs to the frame edge.
      const dur = hookText.alwaysOn === true
        ? HOOK_ALWAYS_ON_END_SEC
        : Math.max(1, Math.min(15, typeof hookText.durationSeconds === "number" && hookText.durationSeconds > 0 ? hookText.durationSeconds : 5));
      ops.push({
        op: "text_overlay",
        text: hookText.text,
        position: hookText.position ?? "top",
        ...(typeof hookText.yPct === "number" ? { yPct: hookText.yPct } : {}),
        startSec: 0,
        endSec: dur,
        style: {
          fontColor: hookText.fontColor ?? "#FFFFFF",
          fontSize: hookText.fontSize ?? 56,
          bold: true,
          ...(hookText.font ? { font: hookText.font } : {}),
          ...(typeof hookText.maxLines === "number" && hookText.maxLines > 0 ? { maxLines: Math.min(14, Math.round(hookText.maxLines)) } : {}),
          // Chosen hook design's outline + optional solid box behind the text.
          ...(hookText.outlineColor ? { outlineColor: hookText.outlineColor } : {}),
          ...(typeof hookText.outlineWidth === "number" ? { outlineWidth: hookText.outlineWidth } : {}),
          ...(hookText.boxColor ? { bgColor: hookText.boxColor } : {}),
          ...(hookText.hookLayout ? { hookLayout: hookText.hookLayout } : {}),
          ...(hookText.hookAccentColor ? { hookAccentColor: hookText.hookAccentColor } : {}),
          // Client-supplied → validated (feeds ffmpeg time expressions).
          ...(coerceHookMotion(hookText.hookMotion) ?? {}),
        },
      });
    }

    // Trending Audio bed — resolve a track, fetch it, and add an audio_overlay op
    // mixed UNDER the voiceover at `volumePct` loudness. Best-effort: if the track
    // library isn't configured (TRENDING_AUDIO_BASE_URL unset → empty URL) or the
    // fetch fails, we simply skip music and still burn hook/captions.
    const audioPaths: (string | undefined)[] = [];
    // Surfaced in the response so the Editor's Apply modal can actually tell the
    // operator music didn't make it in, instead of a video that silently has no
    // audio and no explanation — the graceful-degrade design below is right for
    // the render (never block a burn on a missing track), but silence about WHY
    // is what made "I picked random audio and it's not there" undiagnosable.
    let musicWarning: string | undefined;
    if (music) {
      // Dialogue-heavy source (near-continuous speech) → prefer an instrumental
      // bed over a vocal song, same signal + threshold as the clipper's
      // clip.trendingaudio floor (isDialogueHeavy in clipEditPlanner.ts) —
      // duplicated inline here since this route has no per-clip ClipMoment,
      // just the whole burn's word list + duration.
      const scriptWordCount = words.length || (typeof captions?.scriptText === "string" ? captions.scriptText.trim().split(/\s+/).filter(Boolean).length : 0);
      const heavyDialogue = scriptWordCount >= 8 && durationSeconds > 0 && (scriptWordCount / durationSeconds) >= 1.8;
      // Operator's own uploaded MP3 short-circuits the curated pack entirely —
      // same precedence as the clipper's clip.trendingaudio floor.
      const trackUrl = music.customUrl && music.customUrl.trim()
        ? music.customUrl.trim()
        : trendingAudioUrl(
            music.trackId && isTrendingAudioId(music.trackId)
              ? music.trackId
              : pickTrendingTrackByMood(undefined, seedFrom(videoUrl), heavyDialogue),
          );
      if (trackUrl) {
        try {
          const { buffer: musicBuf } = await safeFetchToBuffer(trackUrl);
          const musicPath = join(workDir, "music.audio");
          await writeFile(musicPath, musicBuf);
          audioPaths.push(musicPath);
          ops.push({ op: "audio_overlay", audioUrl: trackUrl, atSec: 0, gainDb: volumePctToGainDb(music.volumePct) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[video/overlay-burn] music fetch failed (404/unreachable track?), skipping: ${msg}`);
          musicWarning = `Music track couldn't be fetched (${msg}) — video burned without it.`;
        }
      } else {
        // trackUrl is "" ONLY when TRENDING_AUDIO_BASE_URL is unset on this server —
        // the track library can't resolve, so music is silently dropped. Make it
        // diagnosable (this is the #1 cause of "trending audio installed but not
        // playing"): the env must be set on the RUNTIME server (Railway), not just
        // .env.local.
        console.warn(`[video/overlay-burn] music requested (track=${music.trackId ?? "auto"}) but TRENDING_AUDIO_BASE_URL is unset — no audio bed mixed. Set TRENDING_AUDIO_BASE_URL on the server.`);
        musicWarning = "Music library isn't configured on the server (TRENDING_AUDIO_BASE_URL unset) — video burned without audio.";
      }
    }

    // Sound Effect tool (Editor tab) — the same algo clip.memeaudio uses
    // (one bucket, one sting, per clip) but the trigger is a WORD the clip's
    // own transcript actually says (pickSfxFromKeywords), not an LLM emotion
    // grade — the Editor's manually-assembled clips never have one of those.
    // A clip with no trigger word gets NO sting; never forced.
    if (sfx) {
      const match = pickSfxFromKeywords(words);
      if (match) {
        const pack = reactionSfxPackById(sfx.packId);
        const stingUrl = reactionSfxUrl(pack.stings[match.bucket]);
        if (stingUrl) {
          try {
            const { buffer: sfxBuf } = await safeFetchToBuffer(stingUrl);
            const sfxPath = join(workDir, "sfx.audio");
            await writeFile(sfxPath, sfxBuf);
            audioPaths.push(sfxPath);
            // Same fixed -3dB gain the clipper's clip.memeaudio floor uses —
            // a sting isn't a slider-controlled bed, it's a fixed accent.
            // Clamp so a trigger word near the very end never schedules a
            // sting the encode has no time left to play.
            const atSec = Math.min(match.atSec, Math.max(0, (durationSeconds || 15) - 0.3));
            ops.push({ op: "audio_overlay", audioUrl: stingUrl, atSec, gainDb: -3 });
            console.log(`[video/overlay-burn] sfx: "${match.word}" -> ${match.bucket} (${pack.label}) at ${atSec.toFixed(2)}s`);
          } catch (e) {
            console.warn(`[video/overlay-burn] sfx fetch failed (404/unreachable sting?), skipping: ${e instanceof Error ? e.message : e}`);
          }
        } else {
          console.warn(`[video/overlay-burn] sfx requested but the Reaction SFX pack is unconfigured — no sting mixed. Set R2_PUBLIC_BASE_URL (pack lives on R2 under sfx/) or REACTION_SFX_BASE_URL.`);
        }
      }
    }

    // Zoom Punch (Specials tool) — punch-in bursts on keyword/emphasis beats
    // in the clip's OWN transcript, reusing buildClipGraph's existing
    // emphasis:zoom_punch op (the same one the Clipping canvas's Zoom Punch
    // skill emits, just triggered by keyword time instead of the clip
    // midpoint) — no new graph support needed.
    if (specials?.zoomPunch && words.length > 0) {
      const punchTimes = pickZoomPunchTimes(words);
      for (const atSec of punchTimes) {
        ops.push({ op: "emphasis", kind: "zoom_punch", atSec, amount: 1.25 });
      }
      if (punchTimes.length > 0) {
        console.log(`[video/overlay-burn] zoom punch: ${punchTimes.length} beat(s) at ${punchTimes.map((t) => t.toFixed(1)).join(", ")}s`);
      }
    }

    // No early bail here anymore — even with only the base `reframe` op (no
    // caption/hook/music burned), step 4 still re-encodes below so every video
    // that reaches "final" is compressed, not just the ones with an overlay.

    // 4. Build the ffmpeg graph. endSeconds covers the full clip so the
    //    text_overlay enable window and subtitle render are not truncated; the
    //    graph itself never trims the stream.
    const watermarkLast = specials?.velloWatermark === true && (!!imageOverlay || mediaOverlays.length > 0 || body.phoneLook === true);
    const watermarkPath = specials?.velloWatermark === true
      ? await writeVelloWatermark(join(workDir, "vello-watermark.png"), canvasW, canvasH) : undefined;
    const graph = buildClipGraph({
      ops: withVelloWatermark(ops, !!watermarkPath && !watermarkLast),
      startSeconds: 0,
      // 600s (10 min) is the LAST-RESORT ceiling when even the probe couldn't
      // read a duration — bounded so a generated silence base can never dwarf
      // the encode budget again (the -shortest flag below is the second guard).
      endSeconds: durationSeconds || 600,
      assPath,
      logoPaths: watermarkPath && !watermarkLast ? [watermarkPath] : [],
      audioPaths,
      // Burn at the video's NATIVE dims (16:9 or 9:16) — not a hardcoded portrait
      // canvas — so landscape videos are never cropped to vertical.
      width: canvasW,
      height: canvasH,
      // Tell the graph whether the source actually has an audio stream. Without this
      // a silent clip makes ffmpeg reference a non-existent [0:a] and the WHOLE burn
      // (captions + music) throws → the route falls back to the un-burned video.
      hasAudio: probe.hasAudio,
      // 60fps output so the caption \t pop/scale tweens render at 60 smooth steps
      // instead of ~2-7 steppy frames at 30fps.
      fps: 60,
      // Pin an explicit font — drawtext with NO fontfile hard-fails on a font-less
      // host, and this route's fail-safe then silently returns the un-burned video
      // (the "captions/hook don't show" bug). Same resolver the clip pipeline uses.
      fontFile: resolveFontFile(),
      // Camera tool: per-shot face-tracked crop (same shots the editor previewed).
      ...(framing ? { framingMode: framing.mode, faceShots, dualFaceShots, shotZoom: framing.zoomAmount } : {}),
    });
    graph.warnings.forEach((w) => console.warn(`[video/overlay-burn] ${w}`));

    // drawtext (hook text / text_overlay ops) reads each text from a FILE —
    // buildClipGraph returns them as {name, content} and references the bare
    // basename via textfile=. They must exist in workDir BEFORE ffmpeg runs,
    // and ffmpeg must run WITH workDir as cwd (below) to resolve them — the
    // missing pair was the "txt0.txt could not be read or is empty" burn
    // failure on the text-story slots. Same contract as lib/server/clipRender.ts.
    for (const tf of graph.textFiles) await writeFile(join(workDir, tf.name), tf.content);

    // 5. Run ffmpeg over the FULL source (no -ss/-t → no truncation). Video must
    //    be re-encoded (filters); audio re-encoded to aac for broad container
    //    compatibility after the graph.
    const outPath = join(workDir, "out.mp4");
    // crf 21 / veryfast / faststart — same tuning as lib/server/clipRender.ts,
    // so every UGC render lands at the same "watched on a phone feed" bitrate
    // as clipper output instead of inheriting whatever bitrate Kie/Veo shipped.
    // runWithDiscardCorruptFallback: same corrupt-source-frame exposure as
    // lib/server/clipRender.ts's encodes ("TNS filter order …" / "Invalid data
    // found when processing input") — one bad AAC frame anywhere in srcPath
    // otherwise fails this burn outright with no fallback.
    await runWithDiscardCorruptFallback(
      (a) => runFfmpeg(ffmpegPath, a, workDir),
      [
      "-y", "-i", srcPath,
      ...graph.inputArgs, ...graph.filterArgs,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      // Belt-and-braces: end the mux when the VIDEO ends. Whatever the audio
      // graph produces (an over-long music bed, a mis-sized silence base), the
      // output can never run past the picture — the encode is bounded even if a
      // future graph change re-introduces an unbounded audio stream.
      "-shortest",
      "-movflags", "+faststart", outPath,
      ],
    );

    // 5b. Phone-look finishing pass (opt-in): fine temporal grain (like iPhone
    // sensor noise in indoor light), a soft vignette, gently crushed saturation
    // + a touch of contrast, and a whisper of warm/cool split toning. Applied as
    // its own encode so the caption/hook text above stays crisp under the grain
    // math (grain over text reads as compression, which is exactly the vibe).
    // Best-effort: if this pass fails the un-filtered burn still ships.
    let finalPath = outPath;
    if (phoneLook) {
      const lookPath = join(workDir, "look.mp4");
      try {
        await runFfmpeg(ffmpegPath, [
          "-y", "-i", outPath,
          "-vf", "noise=alls=7:allf=t+u,vignette=angle=PI/5.5,eq=contrast=1.03:saturation=0.92:brightness=-0.005,colorbalance=rm=0.015:bm=-0.015,format=yuv420p",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
          "-c:a", "copy",
          "-movflags", "+faststart", lookPath,
        ], workDir);
        finalPath = lookPath;
      } catch (e) {
        console.warn(`[overlay-burn] phone-look pass failed, shipping clean burn: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 5c. Reference-image inset (Specials "Reference Image" tool / a news
    // idea's own full-page article screenshot): composited for the WHOLE
    // clip so a viewer sees what's being discussed without reading a spoken
    // URL — default is a full-width band flush against the bottom edge
    // (position "bottom") so the whole captured page is legible, not a small
    // corner card. Best-effort — a failed download/composite ships the clean
    // burn rather than losing the video.
    if (imageOverlay) {
      try {
        const { buffer: imgBytes, mime } = await safeFetchToBuffer(imageOverlay.url, { maxBytes: 15_000_000 });
        // ffmpeg's image demuxers key off the file extension — a research/
        // screenshot URL, unlike an uploaded asset, doesn't reliably carry one.
        const imgPath = join(workDir, mime.includes("png") ? "ref.png" : mime.includes("webp") ? "ref.webp" : "ref.jpg");
        await writeFile(imgPath, imgBytes);

        const pos = imageOverlay.position ?? "bottom";
        const isFullWidth = pos === "bottom";
        const widthPct = Math.max(15, Math.min(100, imageOverlay.widthPct ?? (isFullWidth ? 96 : 30)));
        const cardW = Math.round((canvasW * widthPct) / 100 / 2) * 2; // even width for the encoder
        const border = Math.max(4, Math.round(canvasW * 0.006));
        // Full-width band: centered horizontally, flush against the bottom
        // edge (a small margin so it doesn't look clipped by the frame).
        // Corner card: unchanged small inset with margin on both axes.
        const margin = isFullWidth ? Math.max(16, Math.round(canvasW * 0.02)) : Math.max(24, Math.round(canvasW * 0.035));
        const x = isFullWidth ? `(W-w)/2` : pos.endsWith("right") ? `W-w-${margin}` : `${margin}`;
        const y = isFullWidth ? `H-h-${margin}` : pos.startsWith("top") ? `${margin}` : `H-h-${margin}`;

        const overlaidPath = join(workDir, "overlaid.mp4");
        await runFfmpeg(ffmpegPath, [
          "-y", "-i", finalPath, "-i", imgPath,
          "-filter_complex",
          `[1:v]scale=${cardW}:-2,pad=iw+${border * 2}:ih+${border * 2}:${border}:${border}:color=white[card];` +
          `[0:v][card]overlay=x=${x}:y=${y}:shortest=0[vout]`,
          "-map", "[vout]", "-map", "0:a?",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
          "-c:a", "copy",
          "-movflags", "+faststart", overlaidPath,
        ], workDir);
        finalPath = overlaidPath;
      } catch (e) {
        console.warn(`[overlay-burn] reference-image overlay failed, shipping without it: ${e instanceof Error ? e.message : e}`);
      }
    }

    // 5b. Editor Overlay drawer media (images / muted looping videos), placed
    // exactly where the preview had them. One extra ffmpeg pass over the
    // finished burn so it composes with captions/hook/music already baked in.
    // Best-effort per overlay: a dead URL skips THAT overlay, never the burn.
    if (mediaOverlays.length > 0) {
      try {
        const inputs: string[] = ["-i", finalPath];
        const chain: string[] = [];
        let idx = 0;
        const fetched: { spec: MediaOverlaySpec; path: string; inputIdx: number }[] = [];
        for (const spec of mediaOverlays) {
          try {
            const { buffer, mime } = await safeFetchToBuffer(spec.url, { maxBytes: spec.kind === "video" ? 80_000_000 : 15_000_000 });
            const ext = spec.kind === "video" ? "mp4" : mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
            const path = join(workDir, `ov${idx}.${ext}`);
            await writeFile(path, buffer);
            fetched.push({ spec, path, inputIdx: fetched.length + 1 });
            idx++;
          } catch (e) {
            console.warn(`[overlay-burn] media overlay skipped (${spec.url.slice(0, 80)}): ${e instanceof Error ? e.message : e}`);
          }
        }
        if (fetched.length > 0) {
          for (const f of fetched) {
            if (f.spec.kind === "video") inputs.push("-stream_loop", "-1", "-i", f.path);
            else inputs.push("-loop", "1", "-i", f.path);
          }
          let cur = "0:v";
          fetched.forEach((f, i) => {
            const w = Math.max(8, Math.round((canvasW * (f.spec.widthPct ?? 33)) / 100 / 2) * 2);
            const lbl = `m${i}`;
            // setpts resets the looped input's clock so `enable=between(t,…)` and
            // the overlay's own playback both start at the burn's t=0.
            chain.push(`[${f.inputIdx}:v]setpts=PTS-STARTPTS,scale=${w}:-2,format=rgba[${lbl}]`);
            const cx = Math.round((canvasW * (f.spec.xPct ?? 50)) / 100);
            const cy = Math.round((canvasH * (f.spec.yPct ?? 50)) / 100);
            const start = (f.spec.startSec ?? 0).toFixed(3);
            const end = (f.spec.endSec ?? (durationSeconds || 600)).toFixed(3);
            const out = i === fetched.length - 1 ? "vout" : `b${i}`;
            chain.push(`[${cur}][${lbl}]overlay=x=${cx}-w/2:y=${cy}-h/2:shortest=0:eof_action=pass:enable='between(t\,${start}\,${end})'[${out}]`);
            cur = out;
          });
          const overlaidPath = join(workDir, "media-overlaid.mp4");
          await runFfmpeg(ffmpegPath, [
            "-y", ...inputs,
            "-filter_complex", chain.join(";"),
            "-map", "[vout]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
            "-c:a", "copy", "-shortest",
            "-movflags", "+faststart", overlaidPath,
          ], workDir);
          finalPath = overlaidPath;
          console.log(`[overlay-burn] media overlays: composited ${fetched.length}/${mediaOverlays.length}`);
        }
      } catch (e) {
        console.warn(`[overlay-burn] media overlay pass failed, shipping without it: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Place the mark above any later media composites. Ordinary clips burn it
    // in the main encode; only multi-pass edits need this final composite.
    if (watermarkLast && watermarkPath) {
      const markedPath = join(workDir, "watermarked.mp4");
      await runFfmpeg(ffmpegPath, [
        "-y", "-i", finalPath, "-i", watermarkPath,
        "-filter_complex", "[0:v][1:v]overlay=0:0[v]",
        "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "copy",
        "-movflags", "+faststart", markedPath,
      ], workDir);
      finalPath = markedPath;
    }

    // 6. Store the burned video (R2, Convex fallback) and resolve a public URL.
    const out = await readFile(finalPath);
    const { url: newUrl } = await putVideo(out, { keyPrefix: "renders", convexUrl: CONVEX_URL });

    // 7. Done.
    return NextResponse.json({
      ok: true, videoUrl: newUrl, captionsApplied: !!assPath,
      ...(musicWarning ? { warning: musicWarning } : {}),
    }, { status: 200 });
  } catch (err) {
    // Never lose the original URL on failure.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), videoUrl },
      { status: 200 },
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
