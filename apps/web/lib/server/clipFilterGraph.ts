import type { EditOp, Anchor, Corner } from "./clipEditOps";
import { VELLO_WATERMARK_ASSET } from "@/lib/builder/velloWatermark";
import { shotCropExpr, FACE_BIAS_Y, FACE_CROP_MIN_ZOOM, type FaceShot } from "@/lib/builder/faceShots";
import { resolveXfadeName } from "./transitionsPack";
import { hookFontFilePath, hookFontsDir, hasHookFonts } from "./hookFonts";
import { hookBlockLayout, hookFxLayout, isHookFxLayout, type HookRect } from "@/lib/builder/hookDesigns";
import { assDoc, hookFxEvents, shineEvents } from "./hookFxAss";

/** The font file to burn a text overlay in: the template's own bundled font when the
 *  op carries a `font` token (so an Auto Hook renders in Manrope/Montserrat/etc.),
 *  else the graph's generic global font. */
const overlayFontFile = (styleFont: string | undefined, globalFont?: string): string | undefined =>
  hookFontFilePath(styleFont) ?? globalFont;

/**
 * Builds the ffmpeg argument tail (extra inputs + filter graph + stream maps)
 * for cutting ONE clip from an already-seeked source (input 0). Kept pure and
 * free of IO so the whole filtergraph is unit-testable; the route handles the
 * download / logo fetch / ASS + text-file writes / spawn around it.
 *
 * Drawtext text is written to files and referenced via `textfile=` (see textFiles
 * in the result) — inline-escaping arbitrary text in a filtergraph passed through
 * Node's argv is unreliable (apostrophes/colons render empty on Windows).
 */

export interface BuildGraphParams {
  /** Validated plan (reframe forced first by validateEditPlan). */
  ops: EditOp[];
  /** Transitions app (clip.transitions) pick, applied at the title-slate→body seam.
   *  Absent = hard cut (the historical behaviour). */
  transition?: { id: string; durationSec?: number };
  /** Clip window in source seconds; the output timeline is rebased to 0. */
  startSeconds: number;
  endSeconds: number;
  /** Basename of the written ASS subtitle file (route runs ffmpeg with cwd=workDir). */
  assPath?: string;
  /** Local file paths for `logo_overlay` ops, in the order those ops appear. */
  logoPaths?: (string | undefined)[];
  /** Local file paths for `image_overlay` ops (the uploaded Overlay Image skill
   *  asset), in the order those ops appear. Resolved by the route (mirrors logoPaths). */
  imagePaths?: (string | undefined)[];
  /** Local file paths for `broll_overlay` ops (fetched cutaway photos), in the
   *  order those ops appear. Resolved by the route (mirrors imagePaths). */
  brollPaths?: (string | undefined)[];
  /** Local file paths for `composite_bg` ops (the fetched gameplay bg VIDEOS),
   *  in the order those ops appear. Resolved by the route (mirrors logoPaths). */
  bgPaths?: (string | undefined)[];
  /** Per-`composite_bg` start offset (seconds) — seek the gameplay bg to a random
   *  (deterministic) window so a long loop varies across clips. Index-aligned to
   *  the composite_bg ops; 0/absent = start at the beginning. */
  bgStartOffsets?: number[];
  /** Local file paths for `audio_overlay` ops (the fetched trending audio files),
   *  in the order those ops appear. Resolved by the route. */
  audioPaths?: (string | undefined)[];
  /** Output framerate for slate concat (title_card). Defaults to 30. */
  fps?: number;
  /** Output canvas dimensions. Default 1080x1920 (9:16). */
  width?: number;
  height?: number;
  /** Camera-change timestamps (seconds, clip-relative) at which to drop a quick
   *  dip-to-black transition. From the scene-detection pre-pass; empty/absent = none. */
  cutTimesSec?: number[];
  /** Absolute path to a font file for drawtext (title_card / text_overlay). When
   *  set, drawtext pins it explicitly so renders don't hard-fail on a host with
   *  no fontconfig default (Linux/Docker). Resolved by the route. */
  fontFile?: string;
  /** Detected speaker face / main-subject center X (0..1 of source width). When
   *  set (and a face_reframe op is present) the crop pans to it, clamped to the
   *  frame. Resolved by the route via faceTrack. */
  faceCx?: number;
  /** Center Y (0..1 of source height) of the face/subject. Only has a vertical
   *  effect when the source is taller than the canvas after the cover-scale. */
  faceCy?: number;
  /** Target vertical position of the subject (fraction from the top): ~0.38 for a
   *  face (upper third), 0.5 to center a b-roll subject. Default 0.5. */
  faceBiasTop?: number;
  /** Smart Framing: horizontal bounds (0..1 of source width) of ALL detected faces
   *  — set only for 2+ separated guests. Lets `auto` fit both + `pan` sweep them. */
  faceXMin?: number;
  faceXMax?: number;
  /** Smart Framing mode (clip.facetrack). auto = fit the subjects / center the
   *  speaker; pan = keyframe-pan between guests; zoom = tight on the speaker; full
   *  = letterbox the whole shot. Undefined ⇒ auto (= legacy face-follow). */
  framingMode?: "auto" | "pan" | "zoom" | "dual" | "full";
  /** Face-tracked SHOT timeline (lib/builder/faceShots — the /dev/face-detect
   *  algorithm): fixed crop point per shot, hard cut between shots. When set
   *  (and framingMode ≠ full) it REPLACES the single-point faceCx/faceCy crop
   *  with a per-frame piecewise crop expression of `t` (clip-relative seconds).
   *  Unconfident shots crop to frame-center. */
  faceShots?: FaceShot[];
  /** Dual-mode left/right face tracks, rendered as top/bottom panes whenever
   *  both tracks are confident at the same time. */
  dualFaceShots?: { top: FaceShot[]; bottom: FaceShot[] };
  /** Extra zoom on top of the cover-scale for the faceShots crop (1 = none).
   *  Defaults per framingMode to lib/builder/faceShots MODE_TARGET_ZOOM. */
  shotZoom?: number;
  /** Whether the source (input 0) actually has an audio stream. A static
   *  filtergraph can't conditionally select a stream, so the title_card slate
   *  must branch on this at build time: a source WITH audio keeps its real audio
   *  in the body, a SILENT source falls back to generated silence. Resolved by
   *  the route (ffprobe). Defaults to true (the common case — clip speech). */
  hasAudio?: boolean;
}

export interface BuiltGraph {
  /** ffmpeg input args to append AFTER `-i <source>`. */
  inputArgs: string[];
  /** Either `["-vf", chain]` or `["-filter_complex", graph, "-map", "[vout]", "-map", aMap]`. */
  filterArgs: string[];
  /** Ops that could not be rendered (e.g. logo with no fetched file). */
  warnings: string[];
  usesComplex: boolean;
  /** Drawtext text written to files (referenced via textfile=) — the route writes
   *  each {name, content} into workDir before spawning ffmpeg. */
  textFiles: { name: string; content: string }[];
}

// drawtext anchor -> x/y expressions on the output canvas.
const POS: Record<Anchor, { x: string; y: string }> = {
  // Hook text reads best inside the frame thirds, clear of the phone UI that
  // overlays the very top/bottom edges. Top sits at 30% down (the upper third,
  // not jammed against the top safe area) and bottom at 70% (above the gesture
  // bar / bottom UI) — both more centered and viewable than the old 16%/82%.
  // (Corner LOGOS keep 8% via their own top-left/top-right entries below.)
  top: { x: "(w-text_w)/2", y: "h*0.30" },
  center: { x: "(w-text_w)/2", y: "(h-text_h)/2" },
  bottom: { x: "(w-text_w)/2", y: "h*0.70" },
  "top-left": { x: "40", y: "h*0.08" },
  "top-right": { x: "w-text_w-40", y: "h*0.08" },
  "bottom-left": { x: "40", y: "h*0.82" },
  "bottom-right": { x: "w-text_w-40", y: "h*0.82" },
};

// ── Overlay vertical stacking ─────────────────────────────────────────────────
// Two text overlays anchored to the SAME band (e.g. a hook banner + a viral
// sticker, both "top") would otherwise drawtext at the identical y and print on
// top of each other — an illegible double-banner (the clip.sticker bug). A
// per-render stacker offsets the Nth same-band overlay so they stack, not collide.
type OverlayBand = "top" | "center" | "bottom";
function overlayBand(position: Anchor): OverlayBand {
  if (position === "center") return "center";
  return position.startsWith("bottom") ? "bottom" : "top";
}
function makeStacker() {
  const n: Record<OverlayBand, number> = { top: 0, center: 0, bottom: 0 };
  return (position: Anchor | undefined): { x: string; y: string } => {
    const pos = position ?? "top";
    const base = POS[pos] ?? POS.top;
    const band = overlayBand(pos);
    const slot = n[band]++;
    if (slot === 0) return base;
    // Top band stacks DOWN; center/bottom stack UP. text_h = the rendered line height
    // of the overlay being drawn; +24px gap. Approximate but reliably de-collides.
    const step = `${slot}*(text_h+24)`;
    return { x: base.x, y: band === "top" ? `${base.y}+${step}` : `${base.y}-${step}` };
  };
}

/** Override a stacked position's y with an exact `yPct` (0-100 from the top),
 *  keeping the stacker's x (still centered/aligned per the anchor). Used by the
 *  Editor tab's drag-to-position hook control — bypasses the fixed top/center/
 *  bottom bands entirely when the operator dragged the overlay to a specific spot.
 *  yPct is the text block's vertical CENTER — the Editor preview (and the clip.hook
 *  inspector's slider) place the hook with `top: yPct%; translateY(-50%)`, so a
 *  top-edge y here burned it half a block lower than the preview showed. Clamped
 *  so a hook dragged to the very edge never renders partly off-frame. Quoted so
 *  the commas inside max/min aren't read as filtergraph separators. */
function withYPct(p: { x: string; y: string }, yPct: number | undefined): { x: string; y: string } {
  if (typeof yPct !== "number" || !Number.isFinite(yPct)) return p;
  return { x: p.x, y: `'max(0,min(h-text_h,h*${clamp(yPct, 0, 100) / 100}-text_h/2))'` };
}

// logo corner -> overlay x:y on the canvas (W/H = main, w/h = logo).
const LOGO_POS: Record<Corner, string> = {
  tl: "30:30",
  tr: "W-w-30:30",
  bl: "30:H-h-30",
  br: "W-w-30:H-h-30",
};

// Overlay Image (clip.overlayimage) position -> overlay x:y on the canvas.
// "overlay" centers the image on the frame; "top"/"bottom" pin it to a band with a
// 40px safe margin (clear of the phone UI edges) and keep it horizontally centered.
const IMAGE_POS: Record<"top" | "center" | "bottom", string> = {
  top: "(W-w)/2:40",
  center: "(W-w)/2:(H-h)/2",
  bottom: "(W-w)/2:H-h-40",
};

// Normalize smart punctuation to ASCII the default drawtext font can render
// (curly quotes/dashes/ellipsis tofu otherwise), strip emoji/pictographs (same
// font also has no emoji glyphs -- an unstripped emoji renders as an empty ▯
// box), strip control chars, cap length. Exported for unit testing.
export const sanitizeText = (t: string) =>
  t
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Strip astral-plane color emoji (😂🔥🎉… all U+1F000-U+1FFFF: emoticons,
    // pictographs, transport, regional-indicator flag pairs, symbols-and-
    // pictographs-extended, etc. — the actual tofu cause) plus the combining
    // codepoints that ride along but aren't astral themselves: variation
    // selectors, ZWJ (joins multi-codepoint sequences like flags/families), and
    // the combining enclosing keycap (1️⃣-style sequences). Deliberately narrower
    // than \p{Extended_Pictographic}/\p{Emoji}: those ALSO match common BMP
    // symbols the render fonts (Arial / DejaVu Sans Bold / Liberation Sans Bold)
    // DO have glyphs for — ™ © ® ♥ ✔ ➡ ☺ — so stripping via that class silently
    // dropped renderable content instead of just the unrenderable emoji.
    .replace(/[\u{1F000}-\u{1FFFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    // Emoji removal can leave a run of 2+ spaces behind (e.g. "a 🔥 b" -> "a  b");
    // collapse those to one. Newlines are left untouched (drawtext line breaks
    // from wrapDrawtext must survive).
    .replace(/ {2,}/g, " ")
    // Keep \n (drawtext line breaks from wrapDrawtext); map other control chars to space.
    .replace(/[\s\S]/g, (c) => (c === "\n" ? "\n" : c.charCodeAt(0) < 32 ? " " : c))
    // A leading/trailing single space can remain when the emoji sat at either
    // edge of the string (nothing to collapse against) -- strip it. Trim only
    // SPACES, not `.trim()`'s full Unicode-whitespace class, which would also
    // eat a leading/trailing \n (the drawtext line break this function must
    // preserve, now that it's exported and used directly).
    .replace(/^ +| +$/g, "")
    // 600, not 200: the text-story overlays (FOMO/Emotional) are 40-60 word
    // blocks (~350 chars) — the old 200-char cap silently cut them mid-story.
    .slice(0, 600);

// Collects drawtext strings into files; returns a basename ffmpeg reads via textfile=.
// `ass()` stores a whole libass script verbatim (premium hook motion) and returns
// its basename for `subtitles=` — resolved against the same cwd=workDir.
interface TextReg { ref(text: string): string; ass(content: string): string; files: { name: string; content: string }[]; }
function makeTextReg(): TextReg {
  const files: { name: string; content: string }[] = [];
  return {
    ref(text: string) {
      const name = `txt${files.length}.txt`;
      files.push({ name, content: sanitizeText(text) });
      return name;
    },
    ass(content: string) {
      const name = `hookfx${files.length}.ass`;
      files.push({ name, content });
      return name;
    },
    files,
  };
}

/**
 * `subtitles=` with the bundled font directory attached.
 *
 * libass resolves an ASS `Fontname` through fontconfig, which on a minimal
 * container knows nothing about apps/web/assets/fonts — so a caption styled
 * "Arial" (or any preset face) silently fell back to whatever fontconfig had,
 * which is what the render log's `fontselect: (Arial, 700, 0) -> …` line records.
 * Pointing libass at the bundled directory makes the caption render in the font
 * the preset actually asked for. Omitted when the directory is absent, so the
 * filter never carries a dead path.
 */
function subtitlesFilter(assPath: string): string {
  const dir = hasHookFonts() ? hookFontsDir() : undefined;
  return `subtitles=${escFilterPath(assPath)}${dir ? `:fontsdir=${escFilterPath(dir)}` : ""}`;
}

// ffmpeg filter-path escaping (subtitles=/fontfile= PATH). The drive colon must
// survive TWO parse passes inside -filter_complex (graph-split on ';'/',' strips
// one escape layer, then the per-filter option-split on ':' strips another), so
// the colon is DOUBLE-escaped (C\\:). A single \: re-splits and ffmpeg reads the
// drive letter as the next option ("Invalid argument" / "unable to parse as image
// size"). The doubled form is also accepted on the simple -vf path (verified), and
// prod Linux paths have no drive colon so output there is unchanged. Single quotes
// are likewise backslash-escaped.
const escFilterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\\\:").replace(/'/g, "\\'");

// drawtext fontcolor is interpolated raw into the filtergraph, so any value with
// : , ' \ [ ] or whitespace (e.g. `rgb(255,215,0)` or `bright yellow`) would
// break the graph or inject extra drawtext options. Validate strictly: expand
// 3-digit hex (#fff -> #ffffff, which ffmpeg's parser rejects), pass through
// #rrggbb / #rrggbbaa, allow a whitelist of named colors; everything else falls
// back to white (the upstream default).
const NAMED_COLORS = new Set<string>([
  "white", "black", "red", "green", "blue", "yellow", "orange", "purple", "pink",
  "cyan", "magenta", "gray", "grey", "gold", "silver", "brown", "navy", "teal",
  "lime", "maroon", "olive", "aqua", "fuchsia",
]);
const normColor = (c: string): string => {
  const s = c.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return s;
  if (NAMED_COLORS.has(s.toLowerCase())) return s.toLowerCase();
  return "white";
};

// drawtext reads its text from a file (textfile=<basename>, resolved against the
// ffmpeg cwd=workDir) and runs with expansion=none so %, ', : and unicode are all
// literal -- this avoids every inline-escaping trap. `enable` is a plain
// expression (between(t,..)) single-quoted in the graph; it has no user text.
// drawtext color@alpha: normColor can return an 8-digit #rrggbbaa, and drawtext
// rejects a doubled alpha (#rrggbbaa@0.9). Strip any existing alpha to 6 digits
// before appending the box's translucency.
const colorWithAlpha = (color: string, alpha: number): string =>
  `${normColor(color).replace(/^(#[0-9a-fA-F]{6})[0-9a-fA-F]{2}$/, "$1")}@${alpha.toFixed(2)}`;

// `style` carries the optional hook-design knobs (outline color/width + a solid
// box). Defaults reproduce the legacy look exactly: borderw=3, black outline, no
// box — so every existing text_overlay renders byte-identically.
const drawtext = (
  file: string, pos: { x: string; y: string }, fontColor: string, fontSize: number,
  enable?: string, fontFile?: string,
  style?: { outlineColor?: string; outlineWidth?: number; boxColor?: string },
  alpha?: string,
) => {
  const bw = Math.max(0, Math.min(12, Math.round(style?.outlineWidth ?? 3)));
  const bc = normColor(style?.outlineColor ?? "black");
  const box = style?.boxColor ? `:box=1:boxcolor=${colorWithAlpha(style.boxColor, 0.92)}:boxborderw=22` : "";
  // An animated x/y (hook entrances) carries commas — single-quote it so the
  // graph parser doesn't read them as filter separators (same trick as enable).
  const q = (e: string) => (e.includes(",") && !e.startsWith("'") ? `'${e}'` : e);
  return `drawtext=textfile=${file}:expansion=none:fontcolor=${normColor(fontColor)}:fontsize=${fontSize}:borderw=${bw}:bordercolor=${bc}${box}:x=${q(pos.x)}:y=${q(pos.y)}` +
    (fontFile ? `:fontfile=${escFilterPath(fontFile)}` : "") +
    // Time-varying opacity for animated title slates (fade / rise). Comma-safe:
    // the whole expression is single-quoted, so ffmpeg treats internal commas as
    // function args, not filtergraph separators (same trick as `enable`).
    (alpha ? `:alpha='${alpha}'` : "") +
    (enable ? `:enable='${enable}'` : "");
};

/** Editorial hooks use video-sized shapes, never drawtext's glyph-following box.
 *  The backgrounds are independent filters; the text is drawn on top.
 *
 *  Motion (style.hookMotion): drawbox has no time variable (its `t` is the
 *  border thickness), so box motion is FRAME-SLICED — a handful of drawboxes,
 *  each enabled for one short time window:
 *   - wipe/stagger: each line box grows in over ~0.25s (stagger = one line after
 *     another, alternating direction), then the full box holds;
 *   - shine: a soft band + a bright core glide across every box, clipped inside
 *     it, repeating every periodSec via mod(t,…) for as long as the hook shows —
 *     so an "Always on" hook keeps shining to the end of the video.
 *  Text uses drawtext's own time-aware alpha / y expressions (fade + drop/rise),
 *  and fades out at endSec. Order: boxes → shine → text, so the sheen passes
 *  UNDER the letters and they stay crisp. */
function editorialHookFilters(
  o: Extract<EditOp, { op: "text_overlay" }>,
  reg: { ref: (text: string) => string; ass: (content: string) => string },
  width: number,
  height: number,
  fallbackFont?: string,
): string[] | null {
  const layout = o.style.hookLayout;
  if (!layout || layout === "plain") return null;
  // Animated entrance templates: shapes, gradient, per-word type and motion are
  // all drawn by libass from the shared hookFxLayout geometry.
  if (isHookFxLayout(layout)) {
    const fx = hookFxLayout({
      text: o.text, kind: layout, fontSize: o.style.fontSize, font: o.style.font ?? "montserratblack",
      fontColor: o.style.fontColor, boxColor: o.style.bgColor, accentColor: o.style.hookAccentColor,
      position: o.position === "bottom" || o.position === "center" ? o.position : "top",
      yPct: o.yPct, width, height,
    });
    if (!fx) return null;
    const events = hookFxEvents(fx, { width, height, startSec: o.startSec, endSec: o.endSec, motion: o.style.hookMotion });
    return [subtitlesFilter(reg.ass(assDoc(width, height, events)))];
  }
  // Geometry comes from the SAME function the Editor preview draws with, so the
  // burned block lands pixel-for-pixel where the operator dropped it.
  const geo = hookBlockLayout({
    text: o.text, fontSize: o.style.fontSize, layout, font: o.style.font,
    fontColor: o.style.fontColor, boxColor: o.style.bgColor, accentColor: o.style.hookAccentColor,
    position: o.position === "bottom" || o.position === "center" ? o.position : "top",
    yPct: o.yPct, width, height,
  });
  if (!geo) return null;
  const { size, top, totalH } = geo;
  const s0 = o.startSec;
  const e0 = o.endSec;
  const f = (n: number) => Number(n.toFixed(3));
  const within = (a: number, b: number) => `between(t,${f(a)},${f(b)})`;
  const bg = ffColorSource(o.style.bgColor ?? "#171717");
  const motion = o.style.hookMotion;
  const boxes: string[] = [];
  const shines: string[] = [];
  const texts: string[] = [];
  const box = (x: number, y: number, w: number, h: number, color: string, enable = within(s0, e0)) =>
    `drawbox=x=${x}:y=${y}:w=${Math.max(1, w)}:h=${Math.max(1, h)}:color=${color}:t=fill:enable='${enable}'`;

  // Per-line entrance delay: stagger builds the block one line at a time.
  const delay = (i: number) => (motion?.entrance === "stagger" ? i * 0.14 : 0);
  const WIPE = 0.25;
  const WIPE_STEPS = 5;
  /** A box that wipes in (from the left, or the right when `fromRight`) and then holds. */
  const wipeBox = (x: number, y: number, w: number, h: number, color: string, d: number, fromRight: boolean) => {
    if (!motion || (motion.entrance !== "wipe" && motion.entrance !== "stagger")) {
      boxes.push(box(x, y, w, h, color));
      return;
    }
    const step = WIPE / WIPE_STEPS;
    for (let k = 0; k < WIPE_STEPS; k++) {
      const ww = Math.round(w * (k + 1) / WIPE_STEPS);
      boxes.push(box(fromRight ? x + w - ww : x, y, ww, h, color, within(s0 + d + k * step, s0 + d + (k + 1) * step)));
    }
    boxes.push(box(x, y, w, h, color, within(s0 + d + WIPE, e0)));
  };

  /** Premium shine: a diagonal, blurred light streak (libass) clipped to the box
   *  interior, sweeping once per period after the entrance lands. */
  const shineEv: string[] = [];
  const shine = (x: number, y: number, w: number, h: number, d: number) => {
    if (!motion) return;
    const rect: HookRect = { x, y, w, h, color: "" };
    shineEv.push(...shineEvents(rect, motion, s0 + d + 0.6, e0, size, 3, Math.max(0, 480 - shineEv.length)));
  };

  if (geo.card) {
    const { x, w, radius } = geo.card;
    const steps = 10;
    boxes.push(box(x, top + radius, w, totalH - 2 * radius, bg));
    for (let step = 0; step < steps; step++) {
      const y0 = Math.round(step * radius / steps);
      const y1 = Math.round((step + 1) * radius / steps);
      if (y1 <= y0) continue;
      const mid = (y0 + y1) / 2;
      const inset = Math.round(radius - Math.sqrt(Math.max(0, radius * radius - (radius - mid) ** 2)));
      boxes.push(box(x + inset, top + y0, w - 2 * inset, y1 - y0, bg));
      boxes.push(box(x + inset, top + totalH - y1, w - 2 * inset, y1 - y0, bg));
    }
    // Keep the sweep off the rounded corners: they're only fully filled once
    // `radius` in from each side.
    shine(x + radius, top, w - 2 * radius, totalH, 0);
  }
  for (let i = 0; i < geo.lines.length; i++) {
    const { text: lineText, y, color: lineColor, box: lb } = geo.lines[i];
    const d = delay(i);
    if (lb) {
      wipeBox(lb.x, lb.y, lb.w, lb.h, ffColorSource(lb.color), d, motion?.entrance === "stagger" && i % 2 === 1);
      shine(lb.x, lb.y, lb.w, lb.h, d);
    }
    // Text: fade in (after the line's box has wiped in), optional drop/rise,
    // and fade out at the end of its window.
    const tIn = s0 + d + (motion && (motion.entrance === "wipe" || motion.entrance === "stagger") ? WIPE * 0.6 : 0);
    const fadeIn = `min(1,max(0,(t-${f(tIn)})/0.3))`;
    const alpha = motion ? `min(${fadeIn},max(0,min(1,(${f(e0)}-t)/0.25)))` : undefined;
    const off = motion?.entrance === "drop" ? -Math.round(size * 0.45) : motion?.entrance === "rise" ? Math.round(size * 0.45) : 0;
    const yExpr = off
      ? `${y}+${off}*pow(1-min(1,max(0,(t-${f(tIn)})/0.35)),2)`
      : String(y);
    texts.push(drawtext(reg.ref(lineText), { x: "(w-text_w)/2", y: yExpr },
      lineColor,
      size, within(s0, e0), overlayFontFile(o.style.font, fallbackFont),
      { outlineColor: o.style.outlineColor, outlineWidth: 0 }, alpha));
  }
  if (shineEv.length) shines.push(subtitlesFilter(reg.ass(assDoc(width, height, shineEv))));
  return [...boxes, ...shines, ...texts];
}

/** ffmpeg lavfi `color=c=` accepts named colours and 0xRRGGBB, but NOT #RRGGBB.
 *  normColor yields #RRGGBB or a name; convert the hex form to 0xRRGGBB. */
const ffColorSource = (c: string): string => {
  const s = normColor(c);
  return s.startsWith("#") ? `0x${s.slice(1, 7)}` : s;
};

/** Entrance-animation expressions for the title slate, in drawtext syntax.
 *  Returns an `alpha` opacity ramp and an optional animated `y` (rise-from-below).
 *  Kept comma-free of filtergraph separators by the caller's single-quoting. */
function titleAnimExprs(anim: "none" | "fade" | "rise" | "typebar" | undefined, baseY: string): { alpha?: string; y: string } {
  const FADE = 0.35; // seconds of fade-in
  if (!anim || anim === "none") return { y: baseY };
  const fadeIn = `min(1,t/${FADE})`;
  if (anim === "rise") {
    // Text starts 70px lower and eases up to its resting Y over FADE seconds while
    // fading in — a smooth "rise into place" that reads as a real title animation.
    return { alpha: fadeIn, y: `${baseY}+70*(1-min(1,t/${FADE}))` };
  }
  // fade + typebar: a clean opacity fade-in (typebar's distinct look is its bg/serif,
  // not a per-glyph reveal, which drawtext can't do without a font shaper).
  return { alpha: fadeIn, y: baseY };
}

const TEXT_MARGIN = 40; // matches the ASS caption MarginL/MarginR

/**
 * Overlay font sizes (hooks, memes, stickers, titles) are authored at a 1080×1920
 * reference. Scale them to the REAL output canvas so a 720p video renders the same
 * PROPORTIONAL size — before this, the same absolute px drew ~1.5× too big on a
 * 720×1280 canvas (the "hook text is huge" complaint). Clamped so a very short
 * landscape canvas doesn't shrink the text into unreadability, and a larger canvas
 * can't blow it past the reference look.
 */
export function scaleOverlayFont(fontSize: number, height: number | undefined): number {
  const h = height && height > 0 ? height : 1920;
  const k = Math.max(0.5, Math.min(1.2, h / 1920));
  return Math.round(fontSize * k);
}

/**
 * drawtext does NOT wrap, so a long centered overlay line spills off both edges
 * of the frame. Pre-wrap it: greedily pack words into lines that fit
 * (frameWidth - 2*margin) at the font size (hard-splitting any single over-wide
 * word), and shrink the font (down to 70%) if it would need more than maxLines.
 * Returns the wrapped text — \n line breaks, which drawtext's textfile renders as
 * real breaks (sanitizeText now preserves \n) — and the (possibly shrunk) size.
 *
 * Overflow: when the text STILL needs more than maxLines after shrinking to the
 * font floor, we don't blindly drop the overflow lines (that severs the line at an
 * arbitrary wrap point and reads as cut mid-word — e.g. "...my aunt made siu" /
 * "...quit painting for footba"). Instead the last KEPT line is re-packed to end
 * on a WORD boundary with a trailing ellipsis, so the hook always reads as a
 * complete-looking phrase. (A single over-wide word is still hard-split + …'d.)
 */
export function wrapDrawtext(text: string, fontSize: number, frameWidth: number, maxLines = 2): { text: string; fontSize: number } {
  // Bold/all-caps caption fonts + the 3px border run ~0.68*fontSize per glyph.
  const charsAt = (fs: number) => Math.max(1, Math.floor((frameWidth - 2 * TEXT_MARGIN) / (0.68 * fs)));
  const minFs = Math.round(fontSize * 0.7);
  let fs = fontSize;
  for (;;) {
    const max = charsAt(fs);
    const lines: string[] = [];
    let line = "";
    for (let word of text.split(/\s+/).filter(Boolean)) {
      while (word.length > max) { if (line) { lines.push(line); line = ""; } lines.push(word.slice(0, max)); word = word.slice(max); }
      const cand = line ? `${line} ${word}` : word;
      if (cand.length <= max) line = cand;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return { text: lines.join("\n"), fontSize: fs };
    if (fs <= minFs) {
      // Still overflows at the smallest font: keep maxLines but re-pack the LAST
      // kept line to a word boundary + "…" so we never cut mid-word. Budget one
      // char for the ellipsis. Fall back to a hard char-cut for an over-wide word.
      const kept = lines.slice(0, maxLines);
      const budget = Math.max(1, max - 1);
      const lastWords = kept[kept.length - 1].split(" ");
      let last = "";
      for (const w of lastWords) {
        const cand = last ? `${last} ${w}` : w;
        if (cand.length <= budget) last = cand;
        else break;
      }
      if (!last) last = kept[kept.length - 1].slice(0, budget); // single word too long
      kept[kept.length - 1] = `${last}…`;
      return { text: kept.join("\n"), fontSize: fs };
    }
    fs = Math.max(minFs, Math.round(fs * 0.85));
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "#RRGGBB" -> [r,g,b] decimal (0-255 each). Malformed input falls back to black
 *  rather than throwing — a bad hex should degrade the LOOK, never crash the render. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

/** The reframe filter string (crop-to-fill or pad-to-fit the W x H canvas).
 *  With a detected face/subject (face_reframe op + faceCx) the crop pans to it,
 *  clamped to the frame edges; faceCy biases it vertically when the source has
 *  vertical slack. `force_original_aspect_ratio=increase` covers the canvas in
 *  BOTH dimensions so sources narrower than 9:16 don't crash the crop. */
let reframeSplitSeq = 0;
function reframeFilter(
  ops: EditOp[], width: number, height: number,
  faceCx?: number, faceCy?: number, faceBiasTop?: number,
  faceXMin?: number, faceXMax?: number, framingMode?: string, clipDurationSec?: number,
  faceShots?: BuildGraphParams["faceShots"], shotZoom?: number,
  dualFaceShots?: BuildGraphParams["dualFaceShots"],
): string {
  const r = ops.find((o) => o.op === "reframe");
  const fr = ops.find((o) => o.op === "face_reframe") as { op: "face_reframe"; mode?: string } | undefined;
  // Mode: the op's own mode wins, else the graph-level framingMode, else auto.
  const mode = fr?.mode || framingMode || "auto";

  // DUAL TOP/BOTTOM: split the same decoded frame into three branches. One
  // branch keeps the normal single-person Auto crop as the fallback; the other
  // two independently crop the detected left/right faces into half-height
  // panes and are stacked. The stack overlays the fallback only during stable
  // time ranges where BOTH face tracks are confident, matching the lab page.
  if (mode === "dual" && dualFaceShots) {
    const topShots = dualFaceShots.top.filter((sh) => Number.isFinite(sh.startT) && Number.isFinite(sh.endT) && sh.endT > sh.startT);
    const bottomShots = dualFaceShots.bottom.filter((sh) => Number.isFinite(sh.startT) && Number.isFinite(sh.endT) && sh.endT > sh.startT);
    const overlaps: [number, number][] = [];
    for (const a of topShots) for (const b of bottomShots) {
      if (!a.confident || !b.confident) continue;
      const start = Math.max(a.startT, b.startT), end = Math.min(a.endT, b.endT);
      if (end > start) overlaps.push([start, end]);
    }
    if (overlaps.length > 0) {
      const id = `dual${reframeSplitSeq++}`;
      const paneH = Math.round(height / 4) * 2;
      const paneCrop = (shots: FaceShot[]) => {
        const z = 1.3;
        const zw = Math.round(width * z / 2) * 2, zh = Math.round(paneH * z / 2) * 2;
        const cxT = shotCropExpr(shots, "cx").replace(/,/g, "\\,");
        const cyT = shotCropExpr(shots, "cy").replace(/,/g, "\\,");
        const x = `min(max((${cxT})*in_w-${Math.round(width / 2)}\\,0)\\,in_w-${width})`;
        const y = `min(max((${cyT})*in_h-${Math.round(paneH * FACE_BIAS_Y)}\\,0)\\,in_h-${paneH})`;
        return `scale=${zw}:${zh}:force_original_aspect_ratio=increase,crop=${width}:${paneH}:${x}:${y},setsar=1`;
      };
      const single = reframeFilter(ops, width, height, faceCx, faceCy, faceBiasTop, faceXMin, faceXMax, "auto", clipDurationSec, faceShots, 1.2);
      const enable = overlaps.map(([a, b]) => `between(t\\,${a.toFixed(3)}\\,${b.toFixed(3)})`).join("+");
      return `split=3[${id}base][${id}top][${id}bottom];` +
        `[${id}base]${single}[${id}single];` +
        `[${id}top]${paneCrop(topShots)}[${id}t];` +
        `[${id}bottom]${paneCrop(bottomShots)}[${id}b];` +
        `[${id}t][${id}b]vstack=inputs=2[${id}stack];` +
        `[${id}single][${id}stack]overlay=x=0:y=0:eof_action=pass:enable=${enable}`;
    }
  }

  // setsar=1 normalizes pixel aspect so a non-square source doesn't break the
  // concat (title_card) or overlay compositing with square-pixel inputs.
  // FULL mode (or an explicit pad reframe) → letterbox the WHOLE shot into 9:16.
  // force_original_aspect_ratio=decrease (NOT scale=W:-2): a source TALLER than the
  // canvas (portrait phone clip, 9:19.5) scaled by width alone overflows the height,
  // and pad cannot shrink ("Padded dimensions cannot be smaller than input") → the
  // whole render crashes. `decrease` fits the source within BOTH W and H first, so
  // pad only ever adds bars. Wide/exact-9:16 output is unchanged.
  if ((r && r.op === "reframe" && r.mode === "pad") || (fr && mode === "full"))
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;

  // Cover the canvas (>= width AND >= height), then crop. For 16:9 this is
  // identical to the old scale=-2:height; for narrow sources it avoids a
  // width<canvas crash.
  const cover = `scale=${width}:${height}:force_original_aspect_ratio=increase`;
  const half = Math.round(width / 2);

  // SHOT-TRACKED crop (Editor Camera tool, same algorithm as /dev/face-detect):
  // cover-scale × a fixed per-clip zoom, then crop a W×H window whose center
  // follows a PIECEWISE-CONSTANT point of t — one static point per shot, hard
  // cut at each shot boundary (no pan, no per-frame jitter). crop's x/y are
  // per-frame expressions so this is a single filter, no segment concat.
  const shots = (faceShots ?? []).filter((sh) => Number.isFinite(sh.startT) && Number.isFinite(sh.endT) && sh.endT > sh.startT);
  if (shots.length > 0 && mode !== "full") {
    const z = Math.min(3, Math.max(mode === "zoom" ? FACE_CROP_MIN_ZOOM : 1, Number.isFinite(shotZoom as number) ? (shotZoom as number) : (mode === "zoom" ? 1.35 : mode === "pan" ? 1.12 : 1.2)));
    const zw = Math.round(width * z / 2) * 2, zh = Math.round(height * z / 2) * 2;
    const coverZ = `scale=${zw}:${zh}:force_original_aspect_ratio=increase`;
    // Crop center of t: static per shot, smoothstep-eased PANs between nearby
    // shots, piecewise-linear FOLLOW paths inside busy shots, hard cuts
    // otherwise — the same math the Editor preview evaluates (faceShots.cropAt),
    // so what the operator saw is what burns. Commas escaped for the filtergraph.
    const cxT = shotCropExpr(shots, "cx").replace(/,/g, "\\,");
    const cyT = shotCropExpr(shots, "cy").replace(/,/g, "\\,");
    if (mode === "zoom") {
      // Face Crop honours 0% extra zoom even for a portrait source whose face
      // is near an edge. Move the sharp source with the tracked face, and fill
      // any exposed side with a soft copy instead of secretly zooming 3× or
      // clamping the face off-centre. Keep y inside the source to avoid bars.
      const id = `rf${reframeSplitSeq++}`;
      const x = `${half}-(${cxT})*overlay_w`;
      const y = `if(gte(overlay_h\\,${height})\\,max(${height}-overlay_h\\,min(0\\,${Math.round(height * FACE_BIAS_Y)}-(${cyT})*overlay_h))\\,(${height}-overlay_h)/2)`;
      const noFace = shots.filter((sh) => !sh.confident);
      const enable = noFace.map((sh) => `between(t\\,${sh.startT.toFixed(3)}\\,${Math.min(sh.endT, 1e5).toFixed(3)})`).join("+");
      const tracked = `split=${noFace.length ? 3 : 2}[${id}bg][${id}fg]${noFace.length ? `[${id}fit]` : ""};` +
        `[${id}bg]${cover},crop=${width}:${height},gblur=sigma=28,eq=brightness=-0.06:saturation=1.05[${id}b];` +
        `[${id}fg]${coverZ},setsar=1[${id}f];` +
        `[${id}b][${id}f]overlay=x='${x}':y='${y}':eval=frame:shortest=1${noFace.length ? `[${id}track]` : ",setsar=1"}`;
      if (!noFace.length) return tracked;
      return tracked + `;[${id}fit]scale=${width}:${height}:force_original_aspect_ratio=decrease[${id}whole];` +
        `[${id}track][${id}whole]overlay=x=(W-w)/2:y=(H-h)/2:eof_action=pass:enable='${enable}',setsar=1`;
    }
    const x = `min(max((${cxT})*in_w-${half}\\,0)\\,in_w-${width})`;
    // Face sits at FACE_BIAS_Y of the pane (upper third-ish), same as the
    // Editor preview's computeFramedGeometry — not dead centre.
    const y = `min(max((${cyT})*in_h-${Math.round(height * FACE_BIAS_Y)}\\,0)\\,in_h-${height})`;
    const cropChain = `${coverZ},crop=${width}:${height}:${x}:${y},setsar=1`;
    // LETTERBOX the no-face stretches (unconfident shots: title card, empty
    // room) exactly like the Editor preview does, instead of a blind centre
    // crop. crop can't change size per frame, so the graph splits: the cropped
    // branch plays by default and a scale-to-fit+pad branch is overlaid only
    // while t is inside an unconfident shot (overlay's timeline `enable`).
    const fitRanges = shots.filter((sh) => !sh.confident).map((sh) => [sh.startT, Math.min(sh.endT, 1e5)] as const);
    if (fitRanges.length === 0) return cropChain;
    const id = `rf${reframeSplitSeq++}`;
    const enable = fitRanges.map(([a, b]) => `between(t\\,${a.toFixed(3)}\\,${b.toFixed(3)})`).join("+");
    const fitChain = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    return `split[${id}a][${id}b];[${id}b]${fitChain}[${id}f];[${id}a]${cropChain}[${id}c];[${id}c][${id}f]overlay=x=0:y=0:eof_action=pass:enable=${enable}`;
  }
  // Clamp a crop-x expression into [0, in_w-width] (in_w = the SCALED width).
  const clampX = (expr: string) => `min(max(${expr}\\,0)\\,in_w-${width})`;
  const hasCx = typeof faceCx === "number" && faceCx >= 0 && faceCx <= 1;
  const hasBounds =
    typeof faceXMin === "number" && typeof faceXMax === "number" && faceXMax > faceXMin &&
    faceXMin >= 0 && faceXMax <= 1;

  // Face-aware centering is now the crop BASELINE (clipRender always runs
  // detection ahead of a plain "crop" reframe), not gated on an explicit
  // face_reframe op — a plain crop with a detected face still follows it.
  if (hasCx || hasBounds) {
    // Vertical: place the subject at faceBiasTop (~0.38 face / 0.5 subject) from
    // the top, clamped. No-op when there's no vertical slack (e.g. 16:9 source).
    const bias = Math.round(height * (faceBiasTop ?? 0.5));
    const yExpr = typeof faceCy === "number" && faceCy >= 0 && faceCy <= 1
      ? `min(max(${faceCy.toFixed(4)}*in_h-${bias}\\,0)\\,in_h-${height})`
      : "0";

    // PAN: keyframe-pan the crop window from the left guest to the right over the
    // clip, so both are seen. (crop x is a per-frame expression of t.)
    if (mode === "pan" && hasBounds) {
      const dur = Math.max(1, Math.round(clipDurationSec ?? 6));
      // Smoothstep (t*t*(3-2t)) instead of raw linear progress — the pan now eases
      // in/out instead of sweeping at constant velocity, which read as a robotic,
      // mechanical camera move rather than a smooth tracking shot.
      const lin = `min(t\\,${dur})/${dur}`;
      const eased = `(${lin})*(${lin})*(3-2*(${lin}))`;
      const xc = `(${faceXMin!.toFixed(4)}+(${(faceXMax! - faceXMin!).toFixed(4)})*(${eased}))*in_w-${half}`;
      return `${cover},crop=${width}:${height}:${clampX(xc)}:${yExpr},setsar=1`;
    }

    // ZOOM: crop a TIGHTER window centered on the primary face, then scale it back
    // up to the canvas — a punch-in on the speaker.
    if (mode === "zoom" && hasCx) {
      const z = 1.4;
      const cw = Math.max(2, Math.round((width / z) / 2) * 2);
      const ch = Math.max(2, Math.round((height / z) / 2) * 2);
      const zbias = Math.round(ch * (faceBiasTop ?? 0.5));
      const zx = `min(max(${faceCx!.toFixed(4)}*in_w-${Math.round(cw / 2)}\\,0)\\,in_w-${cw})`;
      const zy = typeof faceCy === "number" && faceCy >= 0 && faceCy <= 1
        ? `min(max(${faceCy.toFixed(4)}*in_h-${zbias}\\,0)\\,in_h-${ch})`
        : "0";
      return `${cover},crop=${cw}:${ch}:${zx}:${zy},scale=${width}:${height},setsar=1`;
    }

    // AUTO (default): if the subjects' bounding box FITS the crop window (after the
    // cover-scale) center it so BOTH stay in frame; otherwise center on the PRIMARY
    // (largest) face — never the dead-center gap between two guests (the old bug).
    // The fit test runs in the filtergraph (in_w = scaled width) so it's res-correct.
    if (hasBounds) {
      const mid = ((faceXMin! + faceXMax!) / 2).toFixed(4);
      const span = (faceXMax! - faceXMin!).toFixed(4);
      const cxP = (hasCx ? faceCx! : (faceXMin! + faceXMax!) / 2).toFixed(4);
      const xc = `if(lte(${span}*in_w\\,${width})\\,${mid}*in_w-${half}\\,${cxP}*in_w-${half})`;
      return `${cover},crop=${width}:${height}:${clampX(xc)}:${yExpr},setsar=1`;
    }
    // Single face / no bounds → center on the face point (legacy behavior).
    const x = clampX(`${(hasCx ? faceCx! : 0.5).toFixed(4)}*in_w-${half}`);
    return `${cover},crop=${width}:${height}:${x}:${yExpr},setsar=1`;
  }
  return `${cover},crop=${width}:${height},setsar=1`;
}

/**
 * Zoom Punch "blur frame" framing (complex path only). Produces ONE output label
 * from `srcLabel`, fitting the WHOLE frame into the WxH canvas (so a face is never
 * cropped in half) over a blurred, enlarged copy of the same frame — the Apple-glass
 * frosted background. Optional gentle motion: a slow push-in (zoom_in) or reveal
 * (zoom_out) applied to the finished composite via zoompan. Returns the graph
 * segments plus the final output label to chain from.
 */
function blurFrameSegments(
  op: Extract<EditOp, { op: "blur_frame" }>,
  srcLabel: string,
  width: number,
  height: number,
  fps: number,
  next: () => string,
  clipDurationSec?: number,
): { segments: string[]; out: string } {
  const segments: string[] = [];
  const bgSrc = next(), fgSrc = next(), bg = next(), fg = next(), comp = next();
  // Split the frame: one copy becomes the blurred cover background, the other the
  // sharp, fully-contained foreground.
  segments.push(`[${srcLabel}]split=2[${bgSrc}][${fgSrc}]`);
  // Background: cover the canvas (crop to fill), enlarge slightly, heavy gaussian
  // blur + a touch darker/desaturated so the sharp subject pops (frosted glass).
  segments.push(
    `[${bgSrc}]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
      `gblur=sigma=28,eq=brightness=-0.06:saturation=1.05,setsar=1[${bg}]`,
  );
  // Foreground: FIT the whole frame inside the canvas (decrease = never crop). The
  // full person is always visible; the blurred bg fills the letterbox gaps.
  segments.push(`[${fgSrc}]scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[${fg}]`);
  // Center the contained foreground over the blurred background. No `format=` option
  // (its accepted values vary across ffmpeg builds and can error); the default
  // handles the yuv pipeline fine.
  segments.push(`[${bg}][${fg}]overlay=(${width}-w)/2:(${height}-h)/2[${comp}]`);

  // Motion. A smooth, lively push that travels across the WHOLE clip (not a quick
  // stop) so the shot never feels static, while staying subtle enough that the fully
  // contained person is essentially always in frame. zoom_out starts slightly punched
  // and eases back to full; zoom_in slowly pushes in.
  const style = op.style ?? "static";
  if (style === "static") return { segments, out: comp };
  const amt = clamp(op.amount ?? 0.14, 0.04, 0.3); // total zoom travel (0.14 ⇒ up to 1.14x)
  const zTop = (1 + amt).toFixed(3);
  // Spread the travel across the clip's whole duration (min ~4s of frames) so the
  // motion is continuous end-to-end rather than snapping to the max in the first
  // second — the key to a smooth, non-static feel.
  const spanFrames = Math.max(fps * 4, Math.round(fps * Math.max(2, clipDurationSec ?? 6)));
  const step = (amt / spanFrames).toFixed(6);
  const zExpr = style === "zoom_out"
    ? `if(lte(on,1),${zTop},max(zoom-${step},1.0))`
    : `min(zoom+${step},${zTop})`;
  const out = next();
  segments.push(
    `[${comp}]zoompan=z='${zExpr}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}[${out}]`,
  );
  return { segments, out };
}

// Named color-grade presets (Video Filters skill). Each is a full graded CHAIN
// — not just one filter — layering a base grade (curves/colorbalance/hue) with
// contrast + gamma, a light `unsharp` sharpen (perceived-HD "clarity" boost,
// the thing CapCut-style filters do that a bare eq=saturation never did), and
// where the look calls for it, `vignette`/`noise` (film grain) for a premium,
// non-flat finish instead of a faint uniform tint. ffmpeg v6 verified: curves
// preset, colorbalance, hue, eq, unsharp, vignette, noise all native filters
// (no external .cube LUT files needed/bundled).
const FILTER_PRESETS: Record<string, string> = {
  vintage: "curves=preset=vintage,eq=contrast=1.04:saturation=0.92:gamma=1.03,vignette=PI/6,noise=alls=10:allf=t+u",
  warm: "colorbalance=rs=0.08:gs=0.02:bs=-0.06:rm=0.14:gm=0.05:bm=-0.12,eq=contrast=1.08:saturation=1.12,unsharp=5:5:0.6:5:5:0.0",
  cool: "colorbalance=rs=-0.06:bs=0.08:rm=-0.12:gm=0.02:bm=0.14,eq=contrast=1.08:saturation=1.08,unsharp=5:5:0.6:5:5:0.0",
  bw: "hue=s=0,eq=contrast=1.22:brightness=0.015:gamma=1.05,unsharp=5:5:0.8:5:5:0.0,noise=alls=8:allf=t+u",
  // Punchy "vivid": vibrance lifts the less-saturated pixels most (real pop without
  // clipping already-saturated areas) + saturation & contrast bump, so it reads as
  // vivid even on low-chroma/overcast footage (a plain eq=saturation=1.5 was invisible).
  vivid: "vibrance=intensity=0.5,eq=saturation=1.55:contrast=1.16:gamma=1.02,unsharp=5:5:0.7:5:5:0.0",
  // Blockbuster teal-shadow / orange-skin split-tone.
  cinematic: "colorbalance=rs=0.08:gs=0.02:bs=-0.10:rm=-0.04:bm=0.06:rh=0.10:gh=0.02:bh=-0.08,eq=contrast=1.12:saturation=1.05:gamma=1.02,vignette=PI/5,unsharp=5:5:0.5:5:5:0.0,noise=alls=6:allf=t+u",
  // "Clean HD": no tint, no grain — pure clarity/sharpen + a touch of contrast so
  // soft/compressed source footage reads noticeably crisper.
  hd: "eq=contrast=1.1:saturation=1.08:gamma=1.02,unsharp=7:7:1.0:7:7:0.0",
  // "Super HD" — the CapCut-style "4K enhance" look: denoise FIRST (hqdn3d,
  // gentle values) so compression artifacts don't get sharpened along with real
  // detail, then a TWO-PASS unsharp (a tight radius for fine detail + a much
  // wider radius for "clarity"/local contrast — the actual trick behind
  // "enhance" LUTs, a single unsharp pass reads as over-sharpened halos
  // instead), then vibrance (boosts the LESS-saturated pixels most, so it pops
  // without blowing out skin tones) and a mild contrast/gamma lift. No tint,
  // no grain, no vignette — reads as "remastered," not "styled."
  superhd: "hqdn3d=1.5:1.5:4:4,unsharp=5:5:0.8:5:5:0.0,unsharp=13:13:0.4:13:13:0.0,vibrance=intensity=0.35,eq=contrast=1.12:saturation=1.1:gamma=1.02",
  moody: "curves=preset=darker,colorbalance=rs=-0.06:bs=0.10,eq=contrast=1.1:saturation=0.85,vignette=PI/4.5",
  filmic: "curves=preset=medium_contrast,eq=saturation=0.95:gamma=1.02,noise=alls=8:allf=t+u,unsharp=5:5:0.4:5:5:0.0",
  matte: "curves=preset=lighter,eq=contrast=0.94:saturation=0.88:brightness=0.02,vignette=PI/6",
};

/**
 * Resolve the Transitions pick into an xfade for a seam of `slateDur` seconds, or
 * undefined when the seam is too short to hold one.
 *
 * A transition longer than the slate would need a negative offset, which ffmpeg
 * rejects outright — so it is clamped to at most a third of the slate, and dropped
 * entirely below a threshold where a cross-fade reads as a glitch rather than a cut.
 */
function resolveSeamTransition(
  pick: { id: string; durationSec?: number } | undefined,
  slateDur: number,
): { xfade: string; d: number } | undefined {
  if (!pick?.id) return undefined;
  const requested = typeof pick.durationSec === "number" && pick.durationSec > 0 ? pick.durationSec : 0.5;
  const d = Math.min(requested, slateDur / 3);
  if (!(d >= 0.12)) return undefined;
  return { xfade: resolveXfadeName(pick.id), d };
}

/** ffmpeg color chain for a color_filter op (preset + saturation/brightness), or
 *  "" when it's a no-op. Applied right after reframe, before captions/overlays. */
function colorFilterChain(op: Extract<EditOp, { op: "color_filter" }>): string {
  const parts: string[] = [];
  if (op.preset && FILTER_PRESETS[op.preset]) parts.push(FILTER_PRESETS[op.preset]);
  const sat = typeof op.saturation === "number" ? op.saturation : 1;
  const bri = typeof op.brightness === "number" ? op.brightness : 0;
  if (sat !== 1 || bri !== 0) parts.push(`eq=saturation=${clamp(sat, 0, 3).toFixed(2)}:brightness=${clamp(bri, -1, 1).toFixed(2)}`);
  return parts.join(",");
}

/** Linear single-stream filters in op order: color grade, speed, text overlays, subtitles burn. */
function linearFilters(params: BuildGraphParams, reg: TextReg): string[] {
  const out: string[] = [];
  // Color grade FIRST (right after reframe), before overlays/captions.
  const colorOp = params.ops.find((o) => o.op === "color_filter");
  if (colorOp && colorOp.op === "color_filter") {
    const chain = colorFilterChain(colorOp);
    if (chain) out.push(chain);
  }
  const stack = makeStacker();
  for (const o of params.ops) {
    if (o.op === "emphasis" && o.kind === "speed") {
      out.push(`setpts=${(1 / clamp(o.amount ?? 1.25, 0.5, 4)).toFixed(3)}*PTS`);
    }
    if (o.op === "text_overlay") {
      const editorial = editorialHookFilters(o, reg, params.width ?? 1080, params.height ?? 1920, params.fontFile);
      if (editorial) { out.push(...editorial); continue; }
      const p = withYPct(stack(o.position), o.yPct);
      const wrapped = wrapDrawtext(o.text, scaleOverlayFont(o.style.fontSize, params.height), params.width ?? 1080, o.style.maxLines ?? 2);
      out.push(drawtext(reg.ref(wrapped.text), p, o.style.fontColor, wrapped.fontSize, `between(t,${o.startSec},${o.endSec})`, overlayFontFile(o.style.font, params.fontFile),
        { outlineColor: o.style.outlineColor, outlineWidth: o.style.outlineWidth, boxColor: o.style.bgColor }));
    }
  }
  const sub = params.ops.find((o) => o.op === "subtitles");
  if (sub && sub.op === "subtitles" && params.assPath) out.push(subtitlesFilter(params.assPath));
  return out;
}

/** Detect whether any op forces the filter_complex path. Counts already-filtered
 *  to fetched files (logo/bg/audio/image): a composite_bg needs a 2nd video input,
 *  an audio_overlay needs a 2nd audio input + amix → [aout]. */
function needsComplex(ops: EditOp[], fetchedLogos: number, fetchedBgs: number, fetchedAudio: number, fetchedImages = 0, fetchedBroll = 0): boolean {
  if (fetchedLogos > 0 || fetchedBgs > 0 || fetchedAudio > 0 || fetchedImages > 0 || fetchedBroll > 0) return true;
  return ops.some(
    (o) => o.op === "title_card" || o.op === "blur_frame" || o.op === "gradient_overlay" || o.op === "motion_card" || (o.op === "emphasis" && (o.kind === "zoom_punch" || o.kind === "freeze")),
  );
}

function buildSimple(params: BuildGraphParams): { filter: string; textFiles: { name: string; content: string }[] } {
  const width = params.width ?? 1080;
  const height = params.height ?? 1920;
  const reg = makeTextReg();
  const filter = [reframeFilter(params.ops, width, height, params.faceCx, params.faceCy, params.faceBiasTop, params.faceXMin, params.faceXMax, params.framingMode, params.endSeconds - params.startSeconds, params.faceShots, params.shotZoom, params.dualFaceShots), ...linearFilters(params, reg)].join(",");
  return { filter, textFiles: reg.files };
}

/**
 * Build the filter_complex graph. Video pipeline:
 *   [0:v] reframe -> emphasis(speed/zoom/freeze) -> text_overlay(s) -> subtitles -> logo(s) -> [body]
 * then, if a title_card is present, prepend a slate via concat. Final video is [vout];
 * audio is [aout] (title concat) or mapped from 0:a?.
 */
function buildComplex(
  params: BuildGraphParams,
  logoFiles: string[],
  bgFiles: string[],
  audioFiles: string[],
  bgOffsets: number[] = [],
  imageFiles: string[] = [],
  brollFiles: string[] = [],
): { graph: string; inputArgs: string[]; aMap: string; textFiles: { name: string; content: string }[] } {
  const fps = params.fps ?? 30;
  const width = params.width ?? 1080;
  const height = params.height ?? 1920;
  const reg = makeTextReg();
  const segments: string[] = [];
  const inputArgs: string[] = [];
  let cur = "0:v";
  let n = 0;
  const next = () => `v${n++}`;

  // 1. Framing (label the entry of the chain). A Zoom Punch blur_frame op takes
  // over framing entirely — full-person contain over a blurred background — so it
  // REPLACES the crop reframe here (they'd otherwise both try to frame the shot).
  let lbl = next();
  const blurOp = params.ops.find((o) => o.op === "blur_frame") as Extract<EditOp, { op: "blur_frame" }> | undefined;
  if (blurOp) {
    const bf = blurFrameSegments(blurOp, cur, width, height, fps, next, params.endSeconds - params.startSeconds);
    segments.push(...bf.segments);
    lbl = bf.out;
  } else {
    segments.push(`[${cur}]${reframeFilter(params.ops, width, height, params.faceCx, params.faceCy, params.faceBiasTop, params.faceXMin, params.faceXMax, params.framingMode, params.endSeconds - params.startSeconds, params.faceShots, params.shotZoom, params.dualFaceShots)}[${lbl}]`);
  }
  cur = lbl;

  // 1b. color grade right after reframe (before composite / overlays / captions).
  const colorOp = params.ops.find((op) => op.op === "color_filter");
  if (colorOp && colorOp.op === "color_filter") {
    const chain = colorFilterChain(colorOp);
    if (chain) { lbl = next(); segments.push(`[${cur}]${chain}[${lbl}]`); cur = lbl; }
  }

  // 1c. gradient scrim (top/bottom dark fade) — also right after color grade, so
  // burned-in text (intro words, title cards) always sits on top of it.
  let nextLogoInput = 1; // input 0 is the source
  const gradientOp = params.ops.find((op) => op.op === "gradient_overlay") as Extract<EditOp, { op: "gradient_overlay" }> | undefined;
  if (gradientOp) {
    const dur = Math.max(0.1, params.endSeconds - params.startSeconds);
    const gIdx = nextLogoInput++;
    // "Ali Abdal" open: a warm cream tint (not flat black) by default — still
    // reads as a cinematic scrim, not a dead-light dimmer.
    const [gr, gg, gb] = hexToRgb(gradientOp.color ?? "#F4E9D8");
    inputArgs.push("-f", "lavfi", "-t", String(dur), "-i", `color=c=0x${toHex2(gr)}${toHex2(gg)}${toHex2(gb)}:s=${width}x${height}`);
    const edges = gradientOp.edges && gradientOp.edges.length > 0 ? gradientOp.edges : ["top", "bottom"];
    // 0.5 = the band reaches the vertical CENTER — "top" + "bottom" together
    // cover the whole frame and meet in the middle (the requested look), not a
    // thin edge scrim.
    const hf = clamp(gradientOp.heightFrac ?? 0.5, 0.05, 0.5);
    const maxA = Math.round(clamp(gradientOp.opacity ?? 0.55, 0, 1) * 255);
    // Per-pixel alpha ramp: darkest at the edge, fading linearly to 0 at the inner
    // edge of the band. geq/if commas must be escaped (filtergraph delimiter).
    const topExpr = `if(lt(Y\\,H*${hf})\\,(1-(Y/(H*${hf})))*${maxA}\\,0)`;
    const botExpr = `if(gt(Y\\,H*(1-${hf}))\\,((Y-(H*(1-${hf})))/(H*${hf}))*${maxA}\\,0)`;
    const aExpr = edges.includes("top") && edges.includes("bottom")
      ? `max(${topExpr}\\,${botExpr})`
      : edges.includes("top") ? topExpr : botExpr;
    // Time envelope, 3 phases: 0 at t=0 ramping to full over fadeInSec (0 =
    // appears at full strength instantly, no ramp) → HOLDS at full strength for
    // holdSec → ramps back to 0 over fadeOutSec (an intro flourish that clears —
    // NOT a scrim burned in for the whole clip; the fade-out is the only
    // animated removal). `T` = the current frame's timestamp in seconds, native
    // to geq. Each phase is clamped against what's left of `dur` so a short clip
    // still resolves to a sane (if compressed) sequence instead of overlapping
    // negative windows.
    const fadeIn = clamp(gradientOp.fadeInSec ?? 3, 0, dur);
    const hold = clamp(gradientOp.holdSec ?? 0, 0, Math.max(0, dur - fadeIn));
    const fadeOutStart = fadeIn + hold;
    const fadeOut = clamp(gradientOp.fadeOutSec ?? 1.5, 0, Math.max(0, dur - fadeOutStart));
    const fadeOutEnd = fadeOutStart + fadeOut;
    // min(1, ...) — during the hold (T < fadeOutStart) the raw ramp term is
    // >1 (T-fadeOutStart is negative), which the geq alpha channel would silently
    // clamp on write anyway, but capping it explicitly keeps the expression
    // correct on its own terms instead of relying on that implicit clamp.
    const holdExpr = fadeOut > 0
      ? `if(lt(T\\,${fadeOutEnd.toFixed(2)})\\,min(1\\,1-(T-${fadeOutStart.toFixed(2)})/${fadeOut.toFixed(2)})\\,0)`
      : "1";
    const envExpr = fadeIn > 0
      ? `if(lt(T\\,${fadeIn.toFixed(2)})\\,T/${fadeIn.toFixed(2)}\\,${holdExpr})`
      : holdExpr;
    const gLbl = next();
    segments.push(`[${gIdx}:v]format=rgba,geq=r=${gr}:g=${gg}:b=${gb}:a='(${aExpr})*(${envExpr})'[${gLbl}]`);
    lbl = next();
    segments.push(`[${cur}][${gLbl}]overlay=0:0[${lbl}]`);
    cur = lbl;
  }

  // 2. ops in order (skip reframe; logos + title handled after).
  const logoQueue = [...logoFiles];
  const bgQueue = [...bgFiles];
  const bgOffsetQueue = [...bgOffsets];
  const imageQueue = [...imageFiles];
  const brollQueue = [...brollFiles];
  const stack = makeStacker();
  for (const o of params.ops) {
    if (o.op === "reframe" || o.op === "title_card" || o.op === "color_filter" || o.op === "gradient_overlay") continue; // handled above/after

    if (o.op === "composite_bg") {
      const file = bgQueue.shift();
      bgOffsetQueue.shift(); // consumed but NOT applied — see the -ss note below
      if (!file) continue; // already warned by caller
      // LOOP the bg so it's never SHORTER than the clip; overlay's shortest=1 below
      // cuts the output to the clip length (no gameplay continuing after the clip,
      // no truncation when the loop is shorter). A VIDEO loops via -stream_loop -1;
      // a STILL PHOTO (bgKind:"image" — the podcast article-photo pane) loops via
      // -loop 1, ffmpeg's image-demuxer equivalent (an infinite single-frame
      // stream) — same infinite-duration contract, so shortest=1 still governs.
      // CRITICAL: do NOT input-seek the bg (-ss). Combined with -stream_loop -1 it
      // corrupts the looped PTS and framesync explodes into a runaway frame-dup
      // (the encode hangs to the wall clock — a 37s clip emitted 120k+ duped frames).
      // Per-clip variety comes from the Random bgId (a different gameplay file per
      // clip), not a within-file start offset.
      inputArgs.push(...(o.bgKind === "image" ? ["-loop", "1"] : ["-stream_loop", "-1"]), "-i", file);
      const bgIdx = nextLogoInput++;
      // "Brain-rot" layout, fixed: the gameplay bg used to be COVER-CROPPED into
      // its own half of the canvas, and the main clip was ALSO cover-cropped into
      // its half — so the operator lost picture off both edges of the real content
      // to make it "fill" a rectangle it was never shot for. Now: the bg fills the
      // ENTIRE canvas (still cover-cropped — it's decorative filler, cropping it is
      // fine), and the clip is CONTAIN-FIT (scaled to fit, never cropped) into its
      // half of the screen and overlaid on top — so the full, uncropped source
      // frame is always visible, with the gameplay showing through in the letterbox
      // margins around it. This is the standard "brainrot behind, real video in
      // front" composition, not a 50/50 split where both sides get chopped.
      const isV = o.layout === "vstack";
      // The box the clip is centered/contain-fit into: vstack → full width, half
      // height; hstack → half width, full height. Even dims keep libx264 happy.
      const boxW = isV ? width : Math.max(2, Math.round(width / 2) - (Math.round(width / 2) % 2));
      const boxH = isV ? Math.max(2, Math.round(height / 2) - (Math.round(height / 2) % 2)) : height;
      // clipPos picks which half of the canvas the clip's box sits in; the bg fills
      // every pixel behind it regardless.
      const clipFirst = isV ? o.clipPos !== "bottom" : o.clipPos !== "right";
      const boxX = isV ? 0 : (clipFirst ? 0 : width - boxW);
      const boxY = isV ? (clipFirst ? 0 : height - boxH) : 0;
      // fps=${fps} FIRST on the bg: normalize it to the output's CONSTANT frame rate
      // before overlay (a framesync filter, same as the old vstack). A gameplay rip
      // with a higher/odd framerate (50/60 or a weird tbr) would otherwise drive
      // framesync at its own rate while the finite clip is held, flooding the
      // encoder with near-identical-PTS dups until it hangs to the wall clock.
      const bgFull = next();
      segments.push(`[${bgIdx}:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[${bgFull}]`);
      // Contain-fit the clip into its box — NEVER crops. force_divisible_by=2 keeps
      // the (aspect-dependent, otherwise unpredictable) output dims even.
      const clipFit = next();
      segments.push(`[${cur}]scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=fps=${fps}[${clipFit}]`);
      lbl = next();
      // shortest=1 → the output ends with the finite clip, cutting the looped
      // gameplay to the clip's exact length. x/y center the (variable-sized,
      // aspect-preserved) clip inside its box using overlay's own w/h vars.
      segments.push(
        `[${bgFull}][${clipFit}]overlay=x=${boxX}+(${boxW}-overlay_w)/2:y=${boxY}+(${boxH}-overlay_h)/2:shortest=1:eof_action=pass[${lbl}]`,
      );
      cur = lbl;
    } else if (o.op === "emphasis" && o.kind === "speed") {
      lbl = next();
      segments.push(`[${cur}]setpts=${(1 / clamp(o.amount ?? 1.25, 0.5, 4)).toFixed(3)}*PTS[${lbl}]`);
      cur = lbl;
    } else if (o.op === "emphasis" && o.kind === "zoom_punch") {
      const f = clamp(o.amount ?? 1.2, 1.05, 2);
      const a = o.atSec;
      // SMOOTHED (was a hard instant swap): the old version split the stream and
      // `overlay`'d a STATIC zoomed-in crop for a flat 0.5s window via
      // enable='between(...)' — a binary flash to the zoomed frame and an equally
      // instant pop back, not an animation. Now the scale factor itself is a
      // continuous function of time — a single raised-cosine pulse from 1x up to
      // `f` and back to 1x over PUNCH_SEC — so the punch actually eases in and out.
      const PUNCH_SEC = 0.6;
      const progress = `clip((t-${a.toFixed(3)})/${PUNCH_SEC}\\,0\\,1)`;
      const scaleExpr = `(1+(${f.toFixed(3)}-1)*sin(PI*${progress}))`;
      // Anchor the punch-in on the face — but NOT by re-applying the raw
      // params.faceCx/faceCy here. Those are fractions of the ORIGINAL SOURCE
      // frame, and by this point `cur` is already the reframe op's output: the
      // very first op in every plan (validateEditPlan guarantees it, always
      // runs first) crops the source into this exact width×height canvas
      // USING THOSE SAME faceCx/faceCy — landing the face at horizontal-center
      // and `faceBiasTop` from the top (reframeFilter's single-point branch).
      // Reapplying the raw source-relative fraction against this ALREADY
      // face-centered, already-rescaled frame was a coordinate-space bug: the
      // punch crop re-applied the pre-crop offset to post-crop pixels, so with
      // any off-center source face it clamped straight to a frame edge instead
      // of tracking the face — the reported "zoom punch doesn't follow the
      // face" bug. Scaling preserves normalized fractional position (a point
      // at fraction (fx,fy) of the frame stays at (fx,fy) after `scale=iw*k`),
      // so the fix is simply: punch toward where the face NOW sits — center
      // horizontally, faceBiasTop vertically — not where it sat pre-reframe.
      const hasFace = typeof params.faceCx === "number" && params.faceCx >= 0 && params.faceCx <= 1;
      const bias = hasFace ? clamp(params.faceBiasTop ?? 0.5, 0, 1) : 0.5;
      const zcx = `(in_w-${width})/2`;
      const zcy = bias !== 0.5
        ? `min(max(${bias.toFixed(4)}*in_h-${Math.round(height / 2)}\\,0)\\,in_h-${height})`
        : `(in_h-${height})/2`;
      lbl = next();
      segments.push(`[${cur}]scale=w='iw*${scaleExpr}':h='ih*${scaleExpr}':eval=frame,crop=${width}:${height}:${zcx}:${zcy}[${lbl}]`);
      cur = lbl;
    } else if (o.op === "emphasis" && o.kind === "freeze") {
      const d = clamp(o.amount ?? 0.5, 0.2, 2);
      const a = o.atSec, b = (o.atSec + d);
      const fa = next(), fb = next(), held = next();
      lbl = next();
      segments.push(`[${cur}]split[${fa}][${fb}]`);
      // grab ~1 frame at atSec, hold it for the whole stream, regenerate CFR PTS
      // via fps (robust for VFR sources where the FR setpts constant is undefined).
      segments.push(`[${fb}]trim=start=${a}:end=${a + 0.05},setpts=PTS-STARTPTS,loop=loop=-1:size=1:start=0,fps=${params.fps ?? 30}[${held}]`);
      segments.push(`[${fa}][${held}]overlay=0:0:eof_action=pass:enable='between(t,${a},${b})'[${lbl}]`);
      cur = lbl;
    } else if (o.op === "motion_card") {
      // Motion-graphics beat: push the video down into a bottom PIP, revealing a
      // text card in the top region — timed to what's said (caller picks atSec
      // off the transcript). ANIM_SEC eases in/out; CARD_FRAC caps how much of
      // the canvas the card claims at peak (leaves the speaker clearly visible,
      // not a full takeover).
      // 0.65s glide + QUINTIC smootherstep (x³(6x²-15x+10)) — zero velocity AND
      // zero acceleration at both ends, so the push-down lands like a settled
      // spring instead of the old cubic's slightly abrupt finish.
      const ANIM_SEC = 0.65;
      const CARD_FRAC = 0.36;
      const enterStart = Math.max(0, o.atSec - ANIM_SEC);
      const holdEnd = o.atSec + o.durationSec;
      const exitEnd = holdEnd + ANIM_SEC;
      // Trapezoid 0→1→0 via two clipped ramps (proven pattern, mirrors the
      // gradient_overlay time envelope), then smootherstep-eased pointwise —
      // valid because smootherstep is monotonic on [0,1], so easing the
      // ALREADY-shaped trapezoid value (not time itself) yields an eased
      // version of the same shape rather than a different one.
      const envelope = (startSec: number, endSec: number): string => {
        const up = `clip((t-${startSec.toFixed(2)})/${ANIM_SEC}\\,0\\,1)`;
        const down = `clip((t-${endSec.toFixed(2)})/${ANIM_SEC}\\,0\\,1)`;
        const r = `(${up}-${down})`;
        return `(${r}*${r}*${r}*(${r}*(${r}*6-15)+10))`;
      };
      const eased = envelope(enterStart, holdEnd);
      const bg = ffColorSource(o.bg ?? "#F4E9D8");
      const accent = o.accent ?? "#1A1A1A";
      // Uniform shrink (both dims, so no squish) then pad back to the full canvas
      // with the card's own bg color filling the revealed area — bottom-anchored
      // (x centers, y = full push to the bottom) so the shrink reads as "push
      // down", not "shrink in place". Proven live against the real ffmpeg binary
      // (scale/pad eval=frame with time-varying w/h/x/y all resolve correctly).
      lbl = next();
      segments.push(
        `[${cur}]scale=w='iw*(1-${CARD_FRAC}*${eased})':h='ih*(1-${CARD_FRAC}*${eased})':eval=frame,` +
        `pad=${width}:${height}:x='(ow-iw)/2':y='(oh-ih)':color=${bg}:eval=frame[${lbl}]`,
      );
      cur = lbl;
      // Headline settles at ~8% from the top once fully revealed, with a subtle
      // rise-into-place (starts ~9% of canvas height lower) synced to the SAME
      // eased envelope as the push — the text arrives WITH the card, not before/after.
      const headlineFontSize = scaleOverlayFont(64, height);
      const headline = wrapDrawtext(o.headline, headlineFontSize, width - TEXT_MARGIN * 2, 2);
      // Raw (unquoted) — composed into subtextY below — then EACH USE gets its
      // own surrounding quotes (ffmpeg quoting protects a whole option value, it
      // doesn't nest, so quoting has to happen at the final drawtext call, not
      // baked into the shared sub-expression). Needed because `eased` carries
      // escaped commas (clip(a\,b\,c)) that would otherwise read as filtergraph
      // chain delimiters inside the unquoted x=/y= drawtext() normally expects.
      const headlineYRaw = `${height}*(0.08+0.09*(1-${eased}))`;
      lbl = next();
      segments.push(
        `[${cur}]${drawtext(reg.ref(headline.text), { x: String(TEXT_MARGIN), y: `'${headlineYRaw}'` }, accent, headline.fontSize, `between(t,${enterStart.toFixed(2)},${exitEnd.toFixed(2)})`, params.fontFile, undefined, eased)}[${lbl}]`,
      );
      cur = lbl;
      if (o.subtext) {
        const subFontSize = scaleOverlayFont(34, height);
        const subtext = wrapDrawtext(o.subtext, subFontSize, width - TEXT_MARGIN * 2, 2);
        // Offset by the headline's ACTUAL line count (drawtext line-height ≈
        // 1.2×fontsize) + a small gap — a fixed 1-line offset clipped a 2-line
        // headline's second line straight through the subtext underneath it.
        const headlineLines = headline.text.split("\n").length;
        // STAGGERED entrance: the subtext trails the headline by ~180ms (its
        // own eased envelope, shifted) and rises a shorter distance — layered
        // choreography (card → headline → supporting line) instead of
        // everything arriving on one beat. It still exits WITH the card.
        const STAGGER = 0.18;
        const subEased = envelope(enterStart + STAGGER, holdEnd);
        const subtextYRaw = `(${height}*(0.08+0.05*(1-${subEased})))+${Math.round(headline.fontSize * 1.25 * headlineLines + 20)}`;
        lbl = next();
        segments.push(
          `[${cur}]${drawtext(reg.ref(subtext.text), { x: String(TEXT_MARGIN), y: `'${subtextYRaw}'` }, accent, subtext.fontSize, `between(t,${(enterStart + STAGGER).toFixed(2)},${exitEnd.toFixed(2)})`, params.fontFile, undefined, subEased)}[${lbl}]`,
        );
        cur = lbl;
      }
    } else if (o.op === "text_overlay") {
      const editorial = editorialHookFilters(o, reg, width, height, params.fontFile);
      if (editorial) {
        for (const filter of editorial) {
          lbl = next();
          segments.push(`[${cur}]${filter}[${lbl}]`);
          cur = lbl;
        }
        continue;
      }
      const p = withYPct(stack(o.position), o.yPct);
      const wrapped = wrapDrawtext(o.text, scaleOverlayFont(o.style.fontSize, height), width, o.style.maxLines ?? 2);
      lbl = next();
      segments.push(`[${cur}]${drawtext(reg.ref(wrapped.text), p, o.style.fontColor, wrapped.fontSize, `between(t,${o.startSec},${o.endSec})`, overlayFontFile(o.style.font, params.fontFile),
        { outlineColor: o.style.outlineColor, outlineWidth: o.style.outlineWidth, boxColor: o.style.bgColor })}[${lbl}]`);
      cur = lbl;
    } else if (o.op === "subtitles" && params.assPath) {
      lbl = next();
      segments.push(`[${cur}]${subtitlesFilter(params.assPath)}[${lbl}]`);
      cur = lbl;
    } else if (o.op === "logo_overlay") {
      const file = logoQueue.shift();
      if (!file) continue; // already warned by caller
      inputArgs.push("-i", file);
      const logoIdx = nextLogoInput++;
      const lg = next();
      lbl = next();
      segments.push(`[${logoIdx}:v]format=rgba,colorchannelmixer=aa=${clamp(o.opacity, 0, 1)}[${lg}]`);
      segments.push(`[${cur}][${lg}]overlay=${o.imageUrl === VELLO_WATERMARK_ASSET ? "0:0" : LOGO_POS[o.corner]}[${lbl}]`);
      cur = lbl;
    } else if (o.op === "image_overlay") {
      const file = imageQueue.shift();
      if (!file) continue; // already warned by caller
      inputArgs.push("-i", file);
      const imgIdx = nextLogoInput++;
      const ig = next();
      lbl = next();
      if (o.mode === "frame") {
        // Video-in-a-frame: the uploaded image fills the WHOLE canvas (cover-crop
        // so any aspect works) and becomes the frame/backdrop; the video is scaled
        // down to a centered box (frameScale of the canvas, both dims) so the ENTIRE
        // video stays visible inside the image border. The image's opacity still
        // blends the frame; the box stays crisp on top of it.
        const fs = clamp(o.frameScale ?? 0.85, 0.5, 0.95);
        const boxW = Math.max(2, Math.round((width * fs) / 2) * 2);
        const boxH = Math.max(2, Math.round((height * fs) / 2) * 2);
        segments.push(
          `[${imgIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgba,colorchannelmixer=aa=${clamp(o.opacity, 0, 1)}[${ig}]`,
        );
        segments.push(`[${cur}]scale=${boxW}:${boxH},setsar=1[${lbl}]`);
        segments.push(`[${ig}][${lbl}]overlay=(W-w)/2:(H-h)/2[${(lbl = next())}]`);
      } else {
        segments.push(`[${imgIdx}:v]format=rgba,colorchannelmixer=aa=${clamp(o.opacity, 0, 1)}[${ig}]`);
        // "face" (Gen Z sticker skill): center the sticker on the clip's one
        // detected face point instead of a fixed band. No per-frame tracking
        // exists yet (detectFaceCenter samples a handful of frames and returns a
        // single median position), so the sticker holds that one spot for the
        // whole clip rather than following motion — falls back to the frame
        // center when no face was detected.
        const facePos = typeof params.faceCx === "number" && typeof params.faceCy === "number"
          ? `${Math.round(params.faceCx * width)}-w/2:${Math.round(params.faceCy * height)}-h/2`
          : IMAGE_POS.center;
        segments.push(`[${cur}][${ig}]overlay=${o.position === "face" ? facePos : IMAGE_POS[o.position]}[${lbl}]`);
      }
      cur = lbl;
    } else if (o.op === "broll_overlay") {
      const file = brollQueue.shift();
      if (!file) continue; // already warned by caller
      inputArgs.push("-loop", "1", "-i", file);
      const brollIdx = nextLogoInput++;
      const fadeSec = o.fadeSec ?? 0.6;
      const enterStart = Math.max(0, o.atSec - fadeSec);
      const holdEnd = o.atSec + o.durationSec;
      const exitEnd = holdEnd + fadeSec;
      // Slow Ken Burns push-in for the whole hold (continues through the fade
      // window too — the zoom motion shouldn't visibly pause the instant the
      // photo reaches full opacity). `clip()` IS valid inside scale's eval=frame
      // expression (proven — motion_card uses the same pattern), unlike geq's
      // expression evaluator below, which does NOT register `clip` (confirmed
      // live: geq only accepts the base if/lt/gt set), hence the two different
      // idioms in this one op.
      const KB = 0.10;
      const kb = `clip((t-${o.atSec.toFixed(2)})/${o.durationSec.toFixed(2)}\\,0\\,1)`;
      // Cover-fill the canvas, apply the time-varying zoom, then crop back to
      // the fixed canvas centered — a proper "zoom into center" Ken Burns.
      const covered = next();
      segments.push(
        `[${brollIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
        `scale=w='iw*(1+${KB}*${kb})':h='ih*(1+${KB}*${kb})':eval=frame,` +
        `crop=${width}:${height}:'(iw-${width})/2':'(ih-${height})/2',format=rgba[${covered}]`,
      );
      // Alpha envelope (fade in → hold → fade out), same trapezoid shape as
      // motion_card/gradient_overlay but expressed with if/lt/gt (geq's
      // expression evaluator, unlike scale's, has no `clip` function).
      const aExpr =
        `if(lt(T\\,${enterStart.toFixed(2)})\\,0\\,` +
        `if(lt(T\\,${o.atSec.toFixed(2)})\\,(T-${enterStart.toFixed(2)})/${fadeSec.toFixed(2)}*255\\,` +
        `if(lt(T\\,${holdEnd.toFixed(2)})\\,255\\,` +
        `if(lt(T\\,${exitEnd.toFixed(2)})\\,(1-(T-${holdEnd.toFixed(2)})/${fadeSec.toFixed(2)})*255\\,0))))`;
      const faded = next();
      segments.push(`[${covered}]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${aExpr}'[${faded}]`);
      lbl = next();
      segments.push(`[${cur}][${faded}]overlay=0:0:eof_action=pass[${lbl}]`);
      cur = lbl;
    }
  }

  // 3. Allocate the audio_overlay inputs NOW (before the title block reads
  //    nextLogoInput) so the -i ordering stays deterministic. Each overlay needs
  //    a distinct delay/gain so they can't share one labelled stream.
  const audioOverlayOps = params.ops.filter((o) => o.op === "audio_overlay");
  const overlayInputs: { idx: number; op: Extract<EditOp, { op: "audio_overlay" }> }[] = [];
  const audioQueue = [...audioFiles];
  for (const o of audioOverlayOps) {
    if (o.op !== "audio_overlay") continue;
    const file = audioQueue.shift();
    if (!file) continue; // already warned by caller
    inputArgs.push("-i", file);
    overlayInputs.push({ idx: nextLogoInput++, op: o });
  }

  // ── Audio base: the stream the overlays mix on top of. With a title_card the
  //    base is the slate+body concat audio; otherwise it's the source audio (or
  //    generated silence for a silent source). amix needs every input to exist,
  //    so we materialize a concrete labelled base whenever overlays are present.
  let audioBaseLabel: string | null = null; // a graph label we can amix; null => map a stream directly
  let directAudioMap = "0:a?";    // fallback command-level map (no overlays/title)

  // Source audio_gain (quiet a loud original track): needs the source audio to
  // pass through the graph (the "0:a?" fast-path skips all filtering), so its
  // presence forces the same base-materialization as an audio_overlay would.
  const gainOp = params.ops.find((o) => o.op === "audio_gain") as Extract<EditOp, { op: "audio_gain" }> | undefined;
  const gainFilter = gainOp ? `,volume=${gainOp.gainDb.toFixed(2)}dB` : "";

  // 4. title_card: generate a slate + concat in front of the body.
  const title = params.ops.find((o) => o.op === "title_card");
  if (title && title.op === "title_card") {
    const dur = title.durationSec;
    const titleInputIdx = nextLogoInput;
    const silenceInputIdx = titleInputIdx + 1;
    // Body-silence lavfi input is only consumed when the source has no audio
    // stream; added unconditionally (harmless — an unmapped input is ignored).
    const bodySilenceIdx = silenceInputIdx + 1;
    // Slate background: the template's bgColor paints the whole card (default black
    // when unset) — this is what makes newspaper / breaking-news looks render. It
    // colours the lavfi SOURCE, never a drawtext box, so the text stays crisp.
    const slateColor = ffColorSource(title.style.bgColor ?? "black");
    inputArgs.push("-f", "lavfi", "-t", String(dur), "-i", `color=c=${slateColor}:s=${width}x${height}:r=${fps}`);
    inputArgs.push("-f", "lavfi", "-t", String(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    inputArgs.push("-f", "lavfi", "-t", String(Math.max(dur, params.endSeconds - params.startSeconds)), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    const titlev = next(), bodya = next(), titlea = next();
    const wrappedTitle = wrapDrawtext(title.text, scaleOverlayFont(title.style.fontSize, height), width, 3);
    // Entrance animation (fade / rise) for the slate text, driven off the op's anim.
    const anim = titleAnimExprs(title.anim, "(h-text_h)/2");
    const p = { x: POS.center.x, y: anim.y };
    // Headline, then (optional) the news KICKER badge above it — a boxed drawtext
    // (BREAKING NEWS / LIVE / …) that turns a plain slate into a news graphic. The
    // badge sits in the upper third and shares the headline's entrance fade. When
    // there's no kicker (non-news templates), the slate renders exactly as before.
    let titleChain = drawtext(reg.ref(wrappedTitle.text), p, title.style.fontColor, wrappedTitle.fontSize, undefined, params.fontFile, undefined, anim.alpha);
    if (title.kicker) {
      const kickerSize = Math.max(28, Math.round(scaleOverlayFont(title.style.fontSize, height) * 0.5));
      const kickerPos = { x: POS.center.x, y: "h*0.30" };
      const kickerStyle = { outlineWidth: 0, boxColor: title.kickerColor ?? "#C81E1E" };
      titleChain += `,${drawtext(reg.ref(title.kicker), kickerPos, title.kickerTextColor ?? "#FFFFFF", kickerSize, undefined, params.fontFile, kickerStyle, anim.alpha)}`;
    }
    // GRADE THE SLATE TOO. The slate is its own lavfi input concatenated in front of
    // the body, so the body-only colour grade left a B&W clip opening on a
    // full-colour title card — read (correctly) as "the filter did not apply".
    // Applied AFTER the text so the whole card is graded uniformly, exactly like the
    // footage that follows it.
    const slateGrade = colorOp && colorOp.op === "color_filter" ? colorFilterChain(colorOp) : "";
    segments.push(`[${titleInputIdx}:v]${titleChain}${slateGrade ? `,${slateGrade}` : ""}[${titlev}]`);
    segments.push(`[${cur}]fps=${fps}[${cur}fps]`);
    // Body audio: a filtergraph can't conditionally select a maybe-absent stream
    // (`[0:a?]` is a command-level -map specifier, illegal inside the graph and
    // amix needs both inputs to exist). Branch on hasAudio, known at build time:
    // keep the source's REAL audio when present, else use the body-silence input.
    if (params.hasAudio === false)
      segments.push(`[${bodySilenceIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo[${bodya}]`);
    else
      segments.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo${gainFilter}[${bodya}]`);
    segments.push(`[${silenceInputIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo[${titlea}]`);
    // When overlays follow, route the concat audio into a label we can amix;
    // otherwise terminate directly at [aout] (the original behavior).
    // SEAM: the Transitions app documents the title-slate→body join as one of the
    // seams it styles, but this was always a hard `concat` — the operator's pick was
    // silently ignored here (it only ever reached the CTA join and the multi-clip
    // stitch). xfade needs the outgoing stream to keep running under the incoming
    // one, so the offset is measured from the slate's own length.
    const seam = resolveSeamTransition(params.transition, dur);
    const vJoin = seam
      ? `[${titlev}][${cur}fps]xfade=transition=${seam.xfade}:duration=${seam.d.toFixed(3)}:offset=${(dur - seam.d).toFixed(3)}`
      : `[${titlev}][${titlea}][${cur}fps][${bodya}]concat=n=2:v=1:a=1`;
    const aJoin = seam ? `[${titlea}][${bodya}]acrossfade=d=${seam.d.toFixed(3)}` : "";
    if (overlayInputs.length > 0) {
      if (seam) {
        segments.push(`${vJoin}[vout]`);
        segments.push(`${aJoin}[abase]`);
      } else {
        segments.push(`${vJoin}[vout][abase]`);
      }
      // The slate+body audio IS the base an audio_overlay mixes onto (a meme sting
      // must land on the body beat, past the slate) — dropping this label silently
      // removed the amix and the overlay never played.
      audioBaseLabel = "abase";
    } else {
      if (seam) {
        segments.push(`${vJoin}[vout]`);
        segments.push(`${aJoin}[aout]`);
      } else {
        segments.push(`${vJoin}[vout][aout]`);
      }
      directAudioMap = "[aout]";
    }
  } else {
    // No title: terminate the video chain at [vout].
    segments.push(`[${cur}]null[vout]`);
    // With overlays present, materialize a concrete base to amix against (amix
    // can't take a maybe-absent 0:a? specifier). Branch on hasAudio at build time.
    if (overlayInputs.length > 0 || gainOp) {
      if (params.hasAudio === false) {
        const dur = Math.max(0.1, params.endSeconds - params.startSeconds);
        const silIdx = nextLogoInput++;
        inputArgs.push("-f", "lavfi", "-t", String(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
        segments.push(`[${silIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo[abase]`);
      } else {
        segments.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo${gainFilter}[abase]`);
      }
      audioBaseLabel = "abase";
    }
  }

  // 5. Mix the meme-audio overlays onto the base: each input is delayed to its
  //    moment (adelay, ms, both channels), gained (volume, dB) and optionally
  //    trimmed, then amix-ed with the base. duration=first keeps the output the
  //    length of the base (the source/title timeline), not the longest input.
  if (audioBaseLabel) {
    const mixLabels: string[] = [audioBaseLabel];
    // With a title_card the amix base (abase) is the slate+body CONCAT, so the real
    // body audio starts `title.durationSec` in. Video overlays/subtitles are baked
    // onto the body BEFORE the concat (so they stay synced), but audio overlays are
    // delayed AFTER it — push their (body/moment-relative) atSec back by the slate
    // duration or the reaction SFX sting lands ON the black title slate, not the beat.
    const slateOffsetSec = title && title.op === "title_card" ? title.durationSec : 0;
    overlayInputs.forEach(({ idx, op }, i) => {
      const delayMs = Math.max(0, Math.round((op.atSec + slateOffsetSec) * 1000));
      const gain = typeof op.gainDb === "number" ? op.gainDb : -3;
      const trim = op.durationSec && op.durationSec > 0 ? `atrim=0:${op.durationSec.toFixed(3)},` : "";
      const oa = `oa${i}`;
      segments.push(
        `[${idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,${trim}volume=${gain.toFixed(2)}dB,adelay=${delayMs}|${delayMs}[${oa}]`,
      );
      mixLabels.push(oa);
    });
    // normalize=0 (NOT a static post-amix `volume=N`): amix renormalizes to the
    // count of CURRENTLY-ACTIVE inputs, so once the short reaction SFX hits EOF the
    // base jumps from base/N back to base/1 — and a constant `,volume=N` would then
    // blow the clip speech up to N× (clipping) for the WHOLE remainder. normalize=0
    // sums inputs unscaled: the base stays at native level the whole clip and each
    // sting adds on top at its own gainDb.
    segments.push(`${mixLabels.map((l) => `[${l}]`).join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
    return { graph: segments.join(";"), inputArgs, aMap: "[aout]", textFiles: reg.files };
  }

  // No overlays: use whatever the title/no-title branch resolved.
  return { graph: segments.join(";"), inputArgs, aMap: directAudioMap, textFiles: reg.files };
}

/** Quick dip-to-black at each camera-change timestamp: fade OUT to black over the
 *  ~60ms before the cut, then fade IN from black over the ~60ms after — a clean,
 *  reliable transition on every scene change. Chained fades are pass-through outside
 *  their windows, and the caller de-dupes cuts <250ms apart so windows never overlap. */
function dipTransitionChain(cuts: number[]): string {
  const d = 0.06;
  return cuts
    .map((t) => `fade=t=out:st=${(t - d).toFixed(3)}:d=${d.toFixed(3)}:color=black,fade=t=in:st=${t.toFixed(3)}:d=${d.toFixed(3)}:color=black`)
    .join(",");
}

export function buildClipGraph(params: BuildGraphParams): BuiltGraph {
  const warnings: string[] = [];
  // Speed emphasis applies setpts to VIDEO only — the audio has no atempo and the
  // burned ASS captions keep the original timeline, so the whole clip desyncs.
  // Strip it until proper atempo + caption-timestamp scaling land; a synced clip
  // without the speed effect beats a desynced one.
  const speedCount = params.ops.filter((o) => o.op === "emphasis" && o.kind === "speed").length;
  if (speedCount > 0) {
    warnings.push(`speed emphasis skipped (${speedCount}) — retimes video only and would desync audio/captions (pending atempo support)`);
    params = { ...params, ops: params.ops.filter((o) => !(o.op === "emphasis" && o.kind === "speed")) };
  }
  // The opening title slate is retired (it was concatenated BEFORE the footage,
  // so clips started late). Any title_card still in a stored/legacy plan is
  // dropped here — the hook lives only as an overlay on the playing video.
  if (params.ops.some((o) => o.op === "title_card")) {
    warnings.push("title_card skipped — retired; the hook renders as an on-video overlay");
    params = { ...params, ops: params.ops.filter((o) => o.op !== "title_card") };
  }
  const logoPaths = params.logoPaths ?? [];

  // Map logo_overlay ops to fetched files in order; warn + drop any without one.
  const logoOps = params.ops.filter((o) => o.op === "logo_overlay");
  const logoFiles: string[] = [];
  logoOps.forEach((_, i) => {
    const f = logoPaths[i];
    // Keep INDEX-ALIGNED to op order ("" = failed fetch). A dense array + shift()
    // would hand a later op an earlier (failed) op's slot → wrong asset rendered.
    logoFiles.push(f ?? "");
    if (!f) warnings.push(`logo_overlay #${i} skipped - no fetched image file`);
  });

  // Map composite_bg ops to fetched gameplay-bg VIDEO files (mirror logo).
  const bgPaths = params.bgPaths ?? [];
  const bgOffsetsSrc = params.bgStartOffsets ?? [];
  const bgOps = params.ops.filter((o) => o.op === "composite_bg");
  const bgFiles: string[] = [];
  const bgOffsets: number[] = [];
  bgOps.forEach((_, i) => {
    const f = bgPaths[i];
    bgFiles.push(f ?? ""); // index-aligned to op order ("" = failed fetch, skipped at consume)
    bgOffsets.push(bgOffsetsSrc[i] ?? 0);
    if (!f) warnings.push(`composite_bg #${i} skipped - no fetched gameplay video`);
  });

  // Map audio_overlay ops to fetched trending-audio files (mirror logo).
  const audioPaths = params.audioPaths ?? [];
  const audioOps = params.ops.filter((o) => o.op === "audio_overlay");
  const audioFiles: string[] = [];
  audioOps.forEach((_, i) => {
    const f = audioPaths[i];
    audioFiles.push(f ?? ""); // index-aligned to op order ("" = failed fetch, skipped at consume)
    if (!f) warnings.push(`audio_overlay #${i} skipped - no fetched audio file`);
  });

  // Map image_overlay ops to fetched user-uploaded images (mirror logo).
  const imagePaths = params.imagePaths ?? [];
  const imageOps = params.ops.filter((o) => o.op === "image_overlay");
  const imageFiles: string[] = [];
  imageOps.forEach((_, i) => {
    const f = imagePaths[i];
    imageFiles.push(f ?? ""); // index-aligned to op order ("" = failed fetch, skipped at consume)
    if (!f) warnings.push(`image_overlay #${i} skipped - no fetched image file`);
  });

  // Map broll_overlay ops to fetched cutaway photos (mirror image_overlay).
  const brollPathsSrc = params.brollPaths ?? [];
  const brollOps = params.ops.filter((o) => o.op === "broll_overlay");
  const brollFiles: string[] = [];
  brollOps.forEach((_, i) => {
    const f = brollPathsSrc[i];
    brollFiles.push(f ?? "");
    if (!f) warnings.push(`broll_overlay #${i} skipped - no fetched photo`);
  });

  // Count only REAL files (the arrays now carry "" placeholders for failed
  // fetches to stay index-aligned) so an all-failed set doesn't force the
  // complex path with no actual overlays.
  // Camera-change transitions: a quick dip-to-black (~120ms) at each detected cut,
  // appended to the FINAL video so it dips the whole frame (captions included).
  const cuts = (params.cutTimesSec ?? []).filter((t) => Number.isFinite(t) && t > 0.1);
  const dip = cuts.length ? dipTransitionChain(cuts) : "";

  const dualFraming = params.framingMode === "dual" && !!params.dualFaceShots;
  if (!dualFraming && !needsComplex(params.ops, logoFiles.filter(Boolean).length, bgFiles.filter(Boolean).length, audioFiles.filter(Boolean).length, imageFiles.filter(Boolean).length, brollFiles.filter(Boolean).length)) {
    const { filter, textFiles } = buildSimple(params);
    const finalFilter = dip ? `${filter},${dip}` : filter;
    return { inputArgs: [], filterArgs: ["-vf", finalFilter], warnings, usesComplex: false, textFiles };
  }

  const built = buildComplex(params, logoFiles, bgFiles, audioFiles, bgOffsets, imageFiles, brollFiles);
  const { inputArgs, aMap, textFiles } = built;
  // Insert the dip on the final [vout] label (unique output of the video chain).
  const graph = dip ? `${built.graph.replace("[vout]", "[vpredip]")};[vpredip]${dip}[vout]` : built.graph;
  return {
    inputArgs,
    filterArgs: ["-filter_complex", graph, "-map", "[vout]", "-map", aMap],
    warnings,
    usesComplex: true,
    textFiles,
  };
}
