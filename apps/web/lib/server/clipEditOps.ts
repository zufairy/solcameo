import type { CaptionStyle, TextStyle } from "./clipTypes";
import { isHookLayout } from "@/lib/builder/hookDesigns";

export type Anchor =
  | "top" | "center" | "bottom"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type Corner = "tl" | "tr" | "bl" | "br";

export type EditOp =
  | { op: "reframe"; mode: "crop" | "pad" }
  | { op: "subtitles"; style: CaptionStyle }
  /** `yPct` (0-100, distance from the top as a % of canvas height) overrides
   *  `position`'s fixed band with an exact vertical placement — the Editor tab's
   *  drag-to-position hook control. `position` still selects x-alignment/stacking
   *  and is REQUIRED as the fallback anchor when yPct is absent. */
  | { op: "text_overlay"; text: string; position: Anchor; yPct?: number; startSec: number; endSec: number; style: TextStyle }
  | { op: "title_card"; text: string; durationSec: number; style: TextStyle; anim?: "none" | "fade" | "rise" | "typebar"; kicker?: string; kickerColor?: string; kickerTextColor?: string }
  | { op: "logo_overlay"; imageUrl: string; corner: Corner; opacity: number }
  /** Overlay Image skill (clip.overlayimage): burn the user's uploaded image onto
   *  the video. `mode` selects the compositing:
   *   - "overlay" (default): the image floats ON the full video at `position`
   *     (top / center / bottom) — the current behaviour.
   *   - "frame": the video scales DOWN to a centered box (size = `frameScale` of
   *     the canvas, default 0.85) and the image fills the ENTIRE canvas as the
   *     frame/backdrop behind it — the whole video stays fully visible inside
   *     the image border (classic "video in a frame" effect).
   *  Like logo_overlay the image is fetched to a temp file by the clip route and
   *  fed as an extra `-i` input; opacity 0-1 blends the image in (rgba
   *  colorchannelmixer). `position: "face"` (Gen Z sticker skill) anchors the
   *  image on the clip's detected face center (params.faceCx/faceCy) instead of
   *  a fixed band; falls back to "center" when no face was detected. */
  | { op: "image_overlay"; imageUrl: string; mode?: "overlay" | "frame"; position: "top" | "center" | "bottom" | "face"; opacity: number; frameScale?: number }
  | { op: "emphasis"; kind: "zoom_punch" | "speed" | "freeze"; atSec: number; amount?: number }
  /** Cut filler words (um/uh/you know…) out of the clip via the word transcript.
   *  Applied as a pre-pass in the clip route, not in the filter graph. */
  | { op: "remove_fillers"; aggressive?: boolean }
  /** Filler Cut · Random (Specials): a few random TIME-based micro-trims, not
   *  tied to filler words or a transcript. Pure pacing — a fresh cut pattern
   *  every render (see computeRandomJumpCuts, lib/server/jumpCuts.ts), applied
   *  as a pre-pass in the clip route, same convention as remove_fillers. */
  | { op: "random_jump_cuts" }
  /** Multi Clips (Specials): instead of ONE fixed crop point for the whole
   *  clip, splits it into 2-4 random time segments and hard-cuts between a
   *  DIFFERENT random crop/zoom window each segment — reads as multiple
   *  "scenes" from the same footage instead of one static framed moment.
   *  Independent of face-tracking; when both are on, this takes priority
   *  (see clipRender.ts). */
  | { op: "multi_scene_crop" }
  /** Center the 9:16 crop on the detected speaker's face instead of the frame
   *  center. Face detection runs in the clip route (Gemini vision); the graph
   *  receives the resolved faceCx. */
  | { op: "face_reframe"; mode?: "auto" | "pan" | "zoom" | "full" }
  /** Zoom Punch framing: fit the WHOLE person into the 9:16 frame (never crops a
   *  face in half) and fill the empty side/top-bottom with a blurred, enlarged copy
   *  of the same frame — the Apple-style frosted-glass background. `style` adds an
   *  optional gentle motion: static (no motion), zoom_in (slow push in), zoom_out
   *  (slow reveal). Rendered entirely in the filter graph; needs no face detection
   *  (the full frame is always contained), so it works even when detection fails. */
  | { op: "blur_frame"; style?: "static" | "zoom_in" | "zoom_out"; amount?: number }
  /** Brain-rot composite: stack the clip with a gameplay background video so the
   *  result is the classic split-screen brain-rot format. The bg is fetched to a
   *  temp file by the clip route (mirrors logo_overlay's URL fetch) and fed as an
   *  extra `-i` input; the graph vstack/hstack-s it with the clip, each half the
   *  canvas (final stays 9:16). `clipPos` chooses which half the clip occupies
   *  (default top for vstack / left for hstack). `bgKind` picks how the extra
   *  input is fed: "video" (default, gameplay loop, `-stream_loop -1`) or
   *  "image" (a single STILL photo held for the whole clip via `-loop 1` — the
   *  "podcast article photo on top, clip below" look; also skips the
   *  video-only mime check on fetch). */
  | { op: "composite_bg"; layout: "vstack" | "hstack"; bgUrl: string; clipPos?: "top" | "bottom" | "left" | "right"; bgKind?: "video" | "image" }
  /** Meme-audio overlay: mix a trending audio clip in at a context-aware moment.
   *  The audio file is fetched to a temp file by the clip route and fed as an
   *  extra `-i` input; the graph delays it by `atSec` (adelay), applies `gainDb`
   *  (volume), and amix-es it with the source audio into [aout]. */
  | { op: "audio_overlay"; audioUrl: string; atSec: number; gainDb?: number; durationSec?: number }
  /** Color grade / look filter (Video Filters skill). A named preset (vintage,
   *  warm, cool, b&w, vivid) and/or saturation+brightness tweaks, applied to the
   *  clip right after reframe (before captions/overlays) as an ffmpeg color chain. */
  | { op: "color_filter"; preset?: "vintage" | "warm" | "cool" | "bw" | "vivid" | "cinematic" | "hd" | "superhd" | "moody" | "filmic" | "matte"; saturation?: number; brightness?: number }
  /** Turn the SOURCE clip's own audio down (dB, negative = quieter). Distinct from
   *  `audio_overlay.gainDb`, which gains an ADDED track — this attenuates the
   *  original recording itself (e.g. a loud podcast mic under burned captions). */
  | { op: "audio_gain"; gainDb: number }
  /** Soft scrim faded in from the top and/or bottom edge — the cinematic "Ali
   *  Abdal" open a title/hook sits on so text stays readable over a bright frame.
   *  `heightFrac` is the band's height as a fraction of the canvas (from the edge
   *  inward — 0.5 reaches the vertical center, so "top" + "bottom" together cover
   *  the whole frame, meeting in the middle); `opacity` is the scrim's darkest
   *  point (at the edge), fading linearly to 0 at the inner edge of the band.
   *  `color` is a hex tint (default a warm cream, not flat black — the "apple
   *  cream" look). Timing: `fadeInSec` ramps 0→full opacity (0 = appears at full
   *  strength instantly, no ramp); it then HOLDS at full strength for `holdSec`;
   *  then `fadeOutSec` ramps back to 0 — an intro flourish that clears to reveal
   *  the clean shot, not a static overlay for the whole clip. */
  | { op: "gradient_overlay"; edges?: ("top" | "bottom")[]; opacity?: number; heightFrac?: number; color?: string; fadeInSec?: number; holdSec?: number; fadeOutSec?: number }
  /** Motion-graphics beat ("Ali Abdal" explainer style): at `atSec`, the video
   *  eases into a smaller PIP anchored at the bottom of frame (a smooth push-down,
   *  not a hard cut), revealing a card in the newly-opened top region that shows
   *  `headline` (+ optional `subtext`) — timed to what's actually being SAID at
   *  that moment (the caller picks `atSec` off the clip's own transcript word
   *  timing). Holds through `durationSec`, then eases back to full-frame. Multiple
   *  ops chain into multiple beats through one clip — each is a no-op outside its
   *  own [atSec, atSec+durationSec] window, so they never fight each other or
   *  need to be merged. `bg`/`accent` are hex; default is the same warm-cream /
   *  near-black pairing the rest of the Ali Abdal look uses. */
  | { op: "motion_card"; atSec: number; durationSec: number; headline: string; subtext?: string; bg?: string; accent?: string }
  /** Full-bleed B-ROLL cutaway: a still photo covers the ENTIRE canvas from
   *  `atSec` for `durationSec`, fading in/out over `fadeSec` (default 0.6) with a
   *  slow Ken Burns zoom (subtle push-in) while it holds, then clears back to the
   *  live video — the "podcast cuts to a relevant photo for a few seconds" look.
   *  The source video (and its audio) keeps playing underneath the whole time;
   *  this is a TIMED overlay, not a composite_bg split-screen pane. Multiple ops
   *  chain into multiple cutaways through one clip, each a no-op outside its own
   *  window. `imageUrl` is fetched by the route (mirrors composite_bg's
   *  bgKind:"image" fetch — image/* only, not the video-only fetch path). */
  | { op: "broll_overlay"; imageUrl: string; atSec: number; durationSec: number; fadeSec?: number };

const ANCHORS: Anchor[] = ["top", "center", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"];
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
// The LLM routinely quotes numbers ("startSec":"3"). A strict typeof check was
// silently dropping every overlay/title/emphasis op — accept numeric strings.
const toNum = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(+v)) return +v;
  return NaN;
};
// Normalize anchor spellings the LLM actually emits (top_left, topLeft, MIDDLE…)
// onto the canonical hyphenated set instead of dropping the whole op.
const normAnchor = (v: unknown): Anchor | null => {
  if (typeof v !== "string") return null;
  let p = v.trim().replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[_\s]+/g, "-");
  if (p === "middle" || p === "centre") p = "center";
  return (ANCHORS as string[]).includes(p) ? (p as Anchor) : null;
};

function coerceCaptionStyle(v: unknown): CaptionStyle | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const mode = s.mode === "line" ? "line" : s.mode === "karaoke" ? "karaoke" : null;
  if (!mode) return null;
  const fontSize = toNum(s.fontSize);
  const pos = typeof s.position === "string" ? s.position.trim().toLowerCase() : "";
  return {
    mode,
    fontColor: str(s.fontColor) ? (s.fontColor as string) : "#FFFFFF",
    // Clamp to a positive px range (mirrors the outlineWidth clamp below): a 0 or
    // negative LLM fontSize makes ffmpeg drawtext fail FT_Set_Pixel_Sizes and
    // aborts the whole render.
    fontSize: Number.isFinite(fontSize) ? Math.max(8, Math.min(200, fontSize)) : 64,
    position: pos === "top" || pos === "center" || pos === "middle" ? (pos === "middle" ? "center" : (pos as "top" | "center")) : "bottom",
    // Exact dragged placement (block centre, % from the top) — must survive the
    // clip route's re-validate or a placed caption falls back to its band.
    ...(Number.isFinite(toNum(s.yPct)) ? { yPct: Math.min(100, Math.max(0, toNum(s.yPct))) } : {}),
    // Preset/emoji decorations survive validation (set by style skills).
    ...(s.uppercase === true ? { uppercase: true } : {}),
    ...(str(s.highlightColor) ? { highlightColor: s.highlightColor as string } : {}),
    ...(s.emoji === true ? { emoji: true } : {}),
    // OpusClip-parity preset id — resolved against the catalog at render time,
    // so an unknown/LLM-hallucinated id degrades to the legacy style fields.
    ...(str(s.preset) ? { preset: (s.preset as string).trim() } : {}),
    // Smart Captions prompt — preserved through the clip route's re-validate so
    // the caption-text instruction reaches the renderer.
    ...(str(s.prompt) ? { prompt: (s.prompt as string).trim() } : {}),
  };
}

/** Validate a stored/LLM hookMotion; anything malformed is dropped (the hook
 *  still renders, just without the entrance + shine). */
export function coerceHookMotion(v: unknown): Pick<TextStyle, "hookMotion"> | null {
  if (!v || typeof v !== "object") return null;
  const m = v as { entrance?: unknown; shine?: { color?: unknown; alpha?: unknown; periodSec?: unknown } };
  if (m.entrance !== "wipe" && m.entrance !== "stagger" && m.entrance !== "drop" && m.entrance !== "rise") return null;
  const alpha = toNum(m.shine?.alpha);
  const periodSec = toNum(m.shine?.periodSec);
  if (!str(m.shine?.color) || !Number.isFinite(alpha) || !Number.isFinite(periodSec)) return null;
  return { hookMotion: { entrance: m.entrance, shine: {
    color: m.shine!.color as string,
    alpha: Math.min(0.8, Math.max(0, alpha)),
    periodSec: Math.min(10, Math.max(1.5, periodSec)),
  } } };
}

function coerceTextStyle(v: unknown, defaultSize: number): TextStyle {
  const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const fontSize = toNum(s.fontSize);
  const outlineWidth = toNum(s.outlineWidth);
  return {
    fontColor: str(s.fontColor) ? (s.fontColor as string) : "#FFFFFF",
    bgColor: str(s.bgColor) ? (s.bgColor as string) : undefined,
    ...(isHookLayout(s.hookLayout) ? { hookLayout: s.hookLayout } : {}),
    ...(str(s.hookAccentColor) ? { hookAccentColor: s.hookAccentColor as string } : {}),
    ...(coerceHookMotion(s.hookMotion) ?? {}),
    // Clamp to a positive px range (mirrors the outlineWidth clamp below): a 0 or
    // negative LLM fontSize makes ffmpeg drawtext fail FT_Set_Pixel_Sizes and
    // aborts the whole render.
    fontSize: Number.isFinite(fontSize) ? Math.max(8, Math.min(200, fontSize)) : defaultSize,
    bold: typeof s.bold === "boolean" ? s.bold : true,
    // Hook-design outline knobs — preserved through validation so the chosen
    // design survives the clip route's re-validateEditPlan (else stripped).
    ...(str(s.outlineColor) ? { outlineColor: s.outlineColor as string } : {}),
    ...(Number.isFinite(outlineWidth) ? { outlineWidth: Math.max(0, Math.min(12, outlineWidth)) } : {}),
    // Font TOKEN — preserved so the drawtext path can burn the overlay in the
    // template's bundled font (not the generic global clip font).
    ...(str(s.font) ? { font: s.font as string } : {}),
  };
}

/** Max overlay text length before we WORD-BOUNDARY trim (never mid-word). Generous
 *  enough for a full hook (~6-8 words); wrapDrawtext does the on-canvas fitting
 *  (wrap + shrink + word-boundary ellipsis), so this only bounds pathological input. */
const OVERLAY_TEXT_MAX = 100;
function clampOverlayText(raw: string): string {
  const t = raw.trim();
  if (t.length <= OVERLAY_TEXT_MAX) return t;
  const cut = t.slice(0, OVERLAY_TEXT_MAX);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 0 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function coerceOp(raw: unknown): EditOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  switch (o.op) {
    case "reframe":
      return { op: "reframe", mode: o.mode === "pad" ? "pad" : "crop" };
    case "subtitles": {
      const style = coerceCaptionStyle(o.style);
      return style ? { op: "subtitles", style } : null;
    }
    case "text_overlay": {
      const position = normAnchor(o.position);
      const startSec = toNum(o.startSec);
      const endSec = toNum(o.endSec);
      const yPct = toNum(o.yPct);
      if (!str(o.text) || !position || !Number.isFinite(startSec) || !Number.isFinite(endSec) || !(endSec > startSec)) return null;
      // Bound length WITHOUT cutting mid-word (the old slice(0,40) severed a hook like
      // "...BORROW MONEY" into "...BORROW M"). wrapDrawtext fits it to the canvas.
      return { op: "text_overlay", text: clampOverlayText(String(o.text)), position,
        ...(Number.isFinite(yPct) ? { yPct: Math.min(100, Math.max(0, yPct)) } : {}),
        startSec: Math.max(0, startSec), endSec, style: coerceTextStyle(o.style, 48) };
    }
    case "title_card":
      // RETIRED: the opening title slate was concatenated IN FRONT of the clip
      // (a black/news card before the footage), so every clip started late. The
      // hook now lives only as an overlay ON the playing video (text_overlay).
      // Dropped here so no LLM plan, stored plan or old node can bring it back.
      return null;
    case "logo_overlay": {
      const opacity = toNum(o.opacity);
      if (!str(o.imageUrl) || !CORNERS.includes(o.corner as Corner)) return null;
      return { op: "logo_overlay", imageUrl: o.imageUrl as string, corner: o.corner as Corner,
        opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.85 };
    }
    case "image_overlay": {
      const opacity = toNum(o.opacity);
      const pos = typeof o.position === "string" ? o.position.trim().toLowerCase() : "";
      if (!str(o.imageUrl) || !(["top", "center", "bottom", "face"] as string[]).includes(pos)) return null;
      const mode = o.mode === "frame" ? "frame" : "overlay";
      const frameScale = toNum(o.frameScale);
      return {
        op: "image_overlay",
        imageUrl: o.imageUrl as string,
        mode,
        position: pos as "top" | "center" | "bottom" | "face",
        opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.05, opacity)) : 1,
        frameScale: Number.isFinite(frameScale) ? Math.min(0.95, Math.max(0.5, frameScale)) : 0.85,
      };
    }
    case "emphasis": {
      const atSec = toNum(o.atSec);
      const amount = toNum(o.amount);
      if (!["zoom_punch", "speed", "freeze"].includes(o.kind as string) || !Number.isFinite(atSec)) return null;
      // Clamp the lower bound so a negative atSec can't yield an empty trim
      // (freeze/zoom would silently no-op or stall). Upper bound clamped at render.
      return { op: "emphasis", kind: o.kind as "zoom_punch" | "speed" | "freeze", atSec: Math.max(0, atSec), amount: Number.isFinite(amount) ? amount : undefined };
    }
    case "remove_fillers":
      return { op: "remove_fillers", ...(o.aggressive === true ? { aggressive: true } : {}) };
    case "random_jump_cuts":
      return { op: "random_jump_cuts" };
    case "multi_scene_crop":
      return { op: "multi_scene_crop" };
    case "face_reframe": {
      const m = typeof o.mode === "string" ? o.mode.trim().toLowerCase() : "";
      return { op: "face_reframe", ...((["auto", "pan", "zoom", "full"] as string[]).includes(m) ? { mode: m as "auto" | "pan" | "zoom" | "full" } : {}) };
    }
    case "blur_frame": {
      const st = typeof o.style === "string" ? o.style.trim().toLowerCase() : "";
      const style = (["static", "zoom_in", "zoom_out"] as string[]).includes(st) ? (st as "static" | "zoom_in" | "zoom_out") : "static";
      const amount = toNum(o.amount);
      return { op: "blur_frame", style, ...(Number.isFinite(amount) ? { amount: amount as number } : {}) };
    }
    case "composite_bg": {
      // The bg video URL is load-bearing (it becomes an extra ffmpeg input); drop
      // the op when absent so the graph never references a missing input.
      if (!str(o.bgUrl)) return null;
      const layout = o.layout === "hstack" ? "hstack" : "vstack";
      // clipPos must be valid for the chosen layout (top/bottom for vstack,
      // left/right for hstack); an out-of-axis value degrades to the default.
      const cp = typeof o.clipPos === "string" ? o.clipPos.trim().toLowerCase() : "";
      const clipPos = layout === "vstack"
        ? (cp === "bottom" ? "bottom" : "top")
        : (cp === "right" ? "right" : "left");
      const bgKind = o.bgKind === "image" ? "image" : "video";
      return { op: "composite_bg", layout, bgUrl: o.bgUrl as string, clipPos, ...(bgKind === "image" ? { bgKind } : {}) };
    }
    case "audio_overlay": {
      // The audio URL is load-bearing (extra ffmpeg input); drop the op when absent.
      if (!str(o.audioUrl)) return null;
      const atSec = toNum(o.atSec);
      const gainDb = toNum(o.gainDb);
      const durationSec = toNum(o.durationSec);
      return {
        op: "audio_overlay",
        audioUrl: o.audioUrl as string,
        atSec: Number.isFinite(atSec) ? Math.max(0, atSec) : 0,
        // Clamp gain to a sane mixing range so a stray LLM value can't blow out
        // or null the mix; default -3dB (slightly under the source).
        gainDb: Number.isFinite(gainDb) ? Math.min(12, Math.max(-30, gainDb)) : -3,
        ...(Number.isFinite(durationSec) && durationSec > 0 ? { durationSec } : {}),
      };
    }
    case "color_filter": {
      const preset = typeof o.preset === "string" ? o.preset.trim().toLowerCase() : "";
      const sat = toNum(o.saturation);
      const bri = toNum(o.brightness);
      // MUST mirror every key in FILTER_PRESETS (clipFilterGraph.ts) — this used
      // to hardcode only 5 of the (now 11) preset ids, so any op naming a preset
      // outside that stale list (cinematic/hd/superhd/moody/filmic/matte) got its
      // preset SILENTLY DROPPED here before it ever reached the renderer, on
      // every caller that validates through this coercion (renderClipFromFile →
      // validateEditPlan → here). The Ali Abdaal template's own "cinematic"
      // grade was hitting exactly this — never actually applying.
      const validPreset = (["vintage", "warm", "cool", "bw", "vivid", "cinematic", "hd", "superhd", "moody", "filmic", "matte"] as string[]).includes(preset);
      const hasSat = Number.isFinite(sat) && sat !== 1;
      const hasBri = Number.isFinite(bri) && bri !== 0;
      // A color_filter with no preset and default sliders is a no-op — drop it so
      // the graph never adds a dead filter pass.
      if (!validPreset && !hasSat && !hasBri) return null;
      return {
        op: "color_filter",
        ...(validPreset ? { preset: preset as "vintage" | "warm" | "cool" | "bw" | "vivid" | "cinematic" | "hd" | "superhd" | "moody" | "filmic" | "matte" } : {}),
        ...(hasSat ? { saturation: Math.min(2, Math.max(0, sat)) } : {}),
        ...(hasBri ? { brightness: Math.min(0.5, Math.max(-0.5, bri)) } : {}),
      };
    }
    case "audio_gain": {
      const gainDb = toNum(o.gainDb);
      if (!Number.isFinite(gainDb)) return null;
      // Attenuation only (never boosts past 0dB) — this op exists to quiet a
      // loud source track, not to amplify it and risk clipping.
      return { op: "audio_gain", gainDb: Math.min(0, Math.max(-30, gainDb)) };
    }
    case "gradient_overlay": {
      const edgesRaw = Array.isArray(o.edges) ? o.edges.filter((e) => e === "top" || e === "bottom") : [];
      const opacity = toNum(o.opacity);
      const heightFrac = toNum(o.heightFrac);
      const fadeInSec = toNum(o.fadeInSec);
      const holdSec = toNum(o.holdSec);
      const fadeOutSec = toNum(o.fadeOutSec);
      const color = str(o.color) && /^#[0-9A-Fa-f]{6}$/.test((o.color as string).trim()) ? (o.color as string).trim() : undefined;
      return {
        op: "gradient_overlay",
        ...(edgesRaw.length > 0 ? { edges: edgesRaw as ("top" | "bottom")[] } : {}),
        ...(Number.isFinite(opacity) ? { opacity: Math.min(1, Math.max(0.05, opacity)) } : {}),
        ...(Number.isFinite(heightFrac) ? { heightFrac: Math.min(0.5, Math.max(0.05, heightFrac)) } : {}),
        ...(color ? { color } : {}),
        ...(Number.isFinite(fadeInSec) ? { fadeInSec: Math.min(15, Math.max(0, fadeInSec)) } : {}),
        ...(Number.isFinite(holdSec) ? { holdSec: Math.min(60, Math.max(0, holdSec)) } : {}),
        ...(Number.isFinite(fadeOutSec) ? { fadeOutSec: Math.min(15, Math.max(0, fadeOutSec)) } : {}),
      };
    }
    case "motion_card": {
      const atSec = toNum(o.atSec);
      const durationSec = toNum(o.durationSec);
      if (!Number.isFinite(atSec) || !Number.isFinite(durationSec) || !str(o.headline)) return null;
      const hexOrUndef = (v: unknown) => (str(v) && /^#[0-9A-Fa-f]{6}$/.test((v as string).trim()) ? (v as string).trim() : undefined);
      const bg = hexOrUndef(o.bg);
      const accent = hexOrUndef(o.accent);
      return {
        op: "motion_card",
        atSec: Math.max(0, atSec),
        durationSec: Math.min(12, Math.max(0.8, durationSec)),
        headline: (o.headline as string).trim().slice(0, 60),
        ...(str(o.subtext) ? { subtext: (o.subtext as string).trim().slice(0, 80) } : {}),
        ...(bg ? { bg } : {}),
        ...(accent ? { accent } : {}),
      };
    }
    case "broll_overlay": {
      const atSec = toNum(o.atSec);
      const durationSec = toNum(o.durationSec);
      const fadeSec = toNum(o.fadeSec);
      if (!str(o.imageUrl) || !Number.isFinite(atSec) || !Number.isFinite(durationSec)) return null;
      return {
        op: "broll_overlay",
        imageUrl: o.imageUrl as string,
        atSec: Math.max(0, atSec),
        durationSec: Math.min(10, Math.max(1, durationSec)),
        ...(Number.isFinite(fadeSec) ? { fadeSec: Math.min(3, Math.max(0.1, fadeSec)) } : {}),
      };
    }
    default:
      return null;
  }
}

export function validateEditPlan(raw: unknown): EditOp[] {
  const arr = Array.isArray(raw) ? raw : [];
  const coerced = arr.map(coerceOp).filter((o): o is EditOp => o !== null);
  const reframe = coerced.find((o) => o.op === "reframe") ?? { op: "reframe" as const, mode: "crop" as const };
  const rest = coerced.filter((o) => o.op !== "reframe");
  return [reframe, ...rest];
}
