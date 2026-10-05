import type { CSSProperties } from "react";
import { burnFontStack } from "./burnFonts";

/**
 * OpusClip-parity caption presets. Visual specs reverse-engineered from
 * OpusClip's production renderer (June 2026): their canvas engine works at
 * 720x1280 with Large=56px type; ours renders ASS at 1080x1920, so sizes here
 * are theirs x1.5. Word-sync mechanics confirmed from their code:
 *  - active word recolors INSTANTLY at word start and scales to 130% for
 *    exactly the word's spoken duration (no tween) — default green #04F827;
 *  - "accumulate" presets (Deep Diver) flip each word to the spoken color and
 *    keep it (read-along), no scale pop;
 *  - pages are short chunks re-rendered per word, bottom margin ~19% of height.
 *
 * `render` maps 1:1 onto ASS/libass features (per-word Dialogue events, inline
 * \c/\fscx/\u overrides, BorderStyle=3 box) — see lib/server/captionRenderer.ts.
 * Every font (font / keywordFont / wordFonts / lineFonts) MUST be a family in
 * lib/builder/burnFonts BURN_FONTS — a bundled .ttf libass loads via fontsdir
 * and the editor preview loads via @font-face, so preview == burn. System names
 * (Georgia, Futura, Arial Black…) don't exist on the prod image and silently fell
 * back to DejaVu; captionPresets.test pins this.
 */
export interface CaptionPresetRender {
  /** ASS Fontname (fontconfig fallback applies). */
  font?: string;
  italic?: boolean;
  allCaps?: boolean;
  /** Base/upcoming word fill. */
  fontColor: string;
  /** Font size at 1080x1920. */
  fontSize: number;
  /** Outline width px (0 = none). */
  outline: number;
  outlineColor?: string;
  /** Shadow depth px (0 = none). */
  shadow?: number;
  /** Word-sync: active word fill (omit = no recolor). */
  activeColor?: string;
  /** Word-sync: active word scale percent (e.g. 130). */
  activeScale?: number;
  /** Word-sync: underline the active word (Popline). */
  activeUnderline?: boolean;
  /** Accumulate mode: words flip to this color once spoken and STAY (Deep Diver). */
  spokenColor?: string;
  /** Opaque box behind each line (BorderStyle=3), e.g. "#E4E4E4". */
  pillBg?: string;
  /** Static AI-keyword recolor (Beasty/Mozi green words) — uses the renderer's
   *  deterministic emphasis/keyword detection. */
  keywordColor?: string;
  /** Keyword TYPOGRAPHY swap: important words render in this ASS font family
   *  instead of the base font — the editorial "the *8th* time" mixed-type look
   *  (bold sans line, serif keyword). Works with or without keywordColor. */
  keywordFont?: string;
  /** Italicize keyword words (pairs with keywordFont for the serif-italic
   *  emphasis; libass synthesizes the oblique when the family has no italic). */
  keywordItalic?: boolean;
  /** Keyword size: keyword/emphasis words render at this PERMANENT multiplier
   *  of the base fontSize (instant, no tween — same as keywordColor) instead
   *  of just the base size — the "one signature word is bigger" editorial
   *  look (white sans line, one bold-red-serif word standing taller). Unlike
   *  `activeScale` (a transient pop on whichever word is CURRENTLY being
   *  spoken, then relaxes), this stays applied for as long as the word is on
   *  screen. */
  keywordScale?: number;
  /** Caps how many words get keyword-highlighted PER SENTENCE (sentences end
   *  at . ! ?) — without this, EVERY keyword/emphasis hit lights up, which
   *  for a dense sentence can pop several words at once. Omit for the
   *  existing unlimited behavior (Beasty/Mozi); set to e.g. 2 for a
   *  restrained "usually 1, sometimes 2" accent. */
  keywordMaxPerSentence?: number;
  /** "collage" — abandons the single flowing/stacked line entirely: every
   *  word gets its OWN absolute position, greedy-packed into up to 3 rows by
   *  estimated width and centered per row (a real justified block, not eyeballed),
   *  with small per-word vertical jitter and tilt (wordRotations) so it reads
   *  as a scattered magazine collage rather than neat stacked lines. Each
   *  word is its own persistent ASS event (born at its spoken time, fades in,
   *  stays for the rest of the page) instead of the whole page being
   *  rebuilt every frame — cumulative reveal falls out of that naturally.
   *  Sizing/font/color still come from wordScales/wordFonts/wordColors
   *  (cycled by the word's position across the WHOLE clip, not reset per
   *  page, so different pages/pages land on different cycle phases — two
   *  pages in the same clip get visibly different arrangements). Ignores
   *  `reveal`/`stackAfter`/`entrance` (collage defines its own per-word
   *  fade-in and its own row layout instead). */
  layout?: "collage";
  /** Collage layout only: cycles these Z-axis tilt angles (degrees, ASS
   *  \frz) round-robin by word position — the "not neatly stacked" organic
   *  scatter. Small angles (roughly -10..10) read as a tasteful tilt; large
   *  ones get illegible fast. */
  wordRotations?: number[];
  /** Words per caption page (chunk). */
  wordsPerPage: number;
  /** Page-enter pop: scale 0→100% over 80ms (Seamless Bounce / pop-in).
   *  Legacy flag — maps to `entrance: "pop"`. Prefer `entrance` for new presets. */
  popIn?: boolean;
  /** Smooth page-entrance motion as each caption page appears on screen:
   *  - "pop"   — eased scale-up from 55% with a quick fade (punchy, still smooth)
   *  - "fade"  — clean fade-in (understated, premium)
   *  - "float" — fade + gentle ease-out scale from 90% (elegant, floats into place)
   *  Rendered as ASS \fad + eased \t, so no ffmpeg change (see captionRenderer.ts). */
  entrance?: "pop" | "fade" | "float";
  /** "cumulative" — words APPEAR one at a time as they're spoken (word 3 isn't
   *  in the text at all until it's said) instead of the default "show the whole
   *  page, recolor the active word" — the "premium explainer" build-up look
   *  (Editorial Stack / Lead In Flare / Blur Ladder). Omit for the classic
   *  full-page-recolor behavior every other preset uses. */
  reveal?: "cumulative";
  /** Cumulative-reveal only: force an ASS line break after this many words in
   *  the page, so a 4-word page stacks as two 2-word lines instead of one long
   *  line (Editorial Stack's "i had / one rule" look). */
  stackAfter?: number;
  /** Cumulative-reveal only: each new word enters blurred and sharpens over
   *  ~180ms (ASS \blur animated via \t) instead of just appearing — a soft,
   *  premium "focus pull" per word (Blur Ladder). */
  blurIn?: boolean;
  /** Per-LINE font (cumulative + `stackAfter` only — a "line" is the run of
   *  `stackAfter` words between each forced \N break). Cycled by LINE index,
   *  not word index — every word on that line shares the same entry, unlike
   *  wordFonts (which cycles per-word). The "script title line, bold body
   *  line" two-line hook look. */
  lineFonts?: string[];
  /** Per-LINE fill color, same indexing as lineFonts. */
  lineColors?: string[];
  /** Per-LINE size multiplier (on top of the base fontSize, and on top of
   *  any per-word wordScales variation), same indexing as lineFonts — the
   *  "highlight line reads bigger than the other line" knob. */
  lineScales?: number[];
  /** Per-LINE glow: a PERSISTENT (non-decaying — unlike blurIn, which tweens
   *  sharp) soft blur bloom on every word of that line, same indexing as
   *  lineFonts. A real ASS \blur bloom (bright blurred edges), not a multi-
   *  layer neon halo — libass has no native glow filter; this is the
   *  closest single-pass approximation. */
  lineGlow?: boolean[];
  /** Swap which physical line (top/bottom) gets lineFonts[0] vs lineFonts[1]
   *  (same for lineColors/lineGlow) — alternates by PAGE index (deterministic,
   *  not random), so two pages in the same clip don't always put the same
   *  style on top. Cumulative + stackAfter only. */
  lineOrderAlternate?: boolean;
  /** Left-anchors the caption block instead of the usual centered flow —
   *  cumulative + stackAfter only. Combines with `spawnCorner` for where on
   *  the left edge it sits; alone, defaults to bottom-left. */
  align?: "left";
  /** With `align: "left"`, where the block sits vertically: fixed top-left,
   *  fixed bottom-left, or ALTERNATE between the two by page index
   *  (deterministic — a later page in the same clip lands on the other
   *  corner from the page before it, not truly random). */
  spawnCorner?: "topLeft" | "bottomLeft" | "alternate";
  /** Photoshop-"Invert"-style knockout: pure white text composited onto the
   *  footage with a difference/exclusion blend, so the rendered pixels are
   *  the exact per-pixel inverse of whatever's under them — CSS
   *  `mix-blend-mode: difference` in the browser (app/dev/captions-lab), read
   *  by CaptionStage there. NOT YET burnable by the real ffmpeg pipeline —
   *  captionRenderer.ts's `subtitles=` (libass) burn is a single flat pass
   *  with no blend modes, so a real export of this preset currently just
   *  falls back to a plain solid-white fill (no inversion). Burning it for
   *  real needs a new compositing stage (render captions to an alpha layer,
   *  `ffmpeg blend=difference` against the footage) — not implemented. */
  blendInvert?: boolean;
  /** Aesthetic mixed-type "scrapbook" effect: cycles these ASS font families
   *  round-robin by word POSITION in the page (word 0 → wordFonts[0], word 1
   *  → wordFonts[1 % len], …) instead of one base font for every word —
   *  every word can be a different typeface. Deterministic, not literally
   *  random, so the same clip looks the same on re-render. Pairs with
   *  wordScales/wordColors for the full "every word its own size/font/color"
   *  collage look. */
  wordFonts?: string[];
  /** Aesthetic mixed-type effect: cycles these size MULTIPLIERS (applied to
   *  the base fontSize) round-robin by word position — e.g. [1, 1.6, 0.8,
   *  1.35] makes every word a different size. Unlike `activeScale` (which
   *  pops only the currently-spoken word for its turn), this is each word's
   *  own PERMANENT resting size — once revealed it keeps that size. */
  wordScales?: number[];
  /** Aesthetic mixed-type effect: cycles these fill colors round-robin by
   *  word position, instead of one base fontColor for every word. */
  wordColors?: string[];
}

export interface CaptionPreset {
  id: string;
  name: string;
  blurb: string;
  render: CaptionPresetRender;
  /** Picker chip preview (CSS approximation of the burned-in look). */
  preview: { base: CSSProperties; active?: CSSProperties; chipBg?: string };
}

const OUTLINE = (px: number, color = "#000") =>
  `-${px}px -${px}px 0 ${color}, ${px}px -${px}px 0 ${color}, -${px}px ${px}px 0 ${color}, ${px}px ${px}px 0 ${color}`;

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: "default",
    name: "Classic",
    blurb: "A few words at a time in warm premium yellow — the spoken word pops white, floats in smoothly.",
    render: { font: "Montserrat ExtraBold", fontColor: "#FFDE59", fontSize: 66, outline: 4, outlineColor: "#0A0A0A", shadow: 2, activeColor: "#FFFFFF", activeScale: 118, entrance: "float", wordsPerPage: 3 },
    preview: { base: { color: "#FFDE59", fontWeight: 800, fontFamily: "Montserrat, system-ui, sans-serif", textShadow: OUTLINE(1.5) } },
  },
  {
    id: "mono",
    name: "Mono",
    blurb: "Clean black & white — crisp white caps, deep outline, smooth fade-in.",
    render: { font: "Montserrat ExtraBold", allCaps: true, fontColor: "#FFFFFF", fontSize: 70, outline: 5, outlineColor: "#000000", shadow: 2, activeScale: 110, entrance: "fade", wordsPerPage: 4 },
    preview: {
      base: { color: "#fff", fontWeight: 800, fontFamily: "Montserrat, system-ui, sans-serif", textShadow: OUTLINE(1.5) },
      active: { color: "#fff", fontWeight: 900, fontFamily: "Montserrat, system-ui, sans-serif", textShadow: OUTLINE(1.5), transform: "scale(1.08)", display: "inline-block" },
    },
  },
  {
    id: "gold",
    name: "Gold",
    blurb: "Elegant premium gold — refined serif, soft glow, words ease up as spoken.",
    render: { font: "Gelasio", fontColor: "#EAC15A", fontSize: 62, outline: 2, outlineColor: "#4A360C", shadow: 3, activeColor: "#FFE9A8", activeScale: 115, entrance: "float", wordsPerPage: 3 },
    preview: {
      base: { color: "#EAC15A", fontWeight: 700, fontFamily: "Georgia, 'Times New Roman', serif", textShadow: "0 2px 8px rgba(74,54,12,0.55)" },
      active: { color: "#FFE9A8", fontWeight: 700, fontFamily: "Georgia, 'Times New Roman', serif", transform: "scale(1.1)", display: "inline-block", textShadow: "0 2px 12px rgba(255,220,120,0.45)" },
    },
  },
  {
    id: "karaoke",
    name: "Karaoke",
    blurb: "White caps; the spoken word turns green and pops 130%.",
    render: { font: "Bebas Neue", allCaps: true, fontColor: "#FFFFFF", fontSize: 78, outline: 5, activeColor: "#04F827", activeScale: 130, entrance: "float", wordsPerPage: 4 },
    preview: {
      base: { color: "#fff", fontWeight: 900, fontFamily: "'Bebas Neue', Impact, sans-serif", textShadow: OUTLINE(1.5) },
      active: { color: "#04F827", fontWeight: 900, fontFamily: "'Bebas Neue', Impact, sans-serif", textShadow: OUTLINE(1.5), transform: "scale(1.15)", display: "inline-block" },
    },
  },
  {
    id: "beasty",
    name: "Beasty",
    blurb: "MrBeast style — chunky italic caps, keywords flash green.",
    render: { font: "Archivo Black", italic: true, allCaps: true, fontColor: "#FFFFFF", fontSize: 66, outline: 6, shadow: 2, keywordColor: "#05F827", entrance: "float", wordsPerPage: 3 },
    preview: {
      base: { color: "#fff", fontWeight: 900, fontStyle: "italic", textShadow: OUTLINE(2) },
      active: { color: "#05F827", fontWeight: 900, fontStyle: "italic", textShadow: OUTLINE(2) },
    },
  },
  {
    id: "mozi",
    name: "Mozi",
    blurb: "Hormozi style — white caps, money words flash green, pages float in.",
    render: { font: "Archivo Black", allCaps: true, fontColor: "#FFFFFF", fontSize: 72, outline: 5, keywordColor: "#05F827", entrance: "float", wordsPerPage: 4 },
    preview: {
      base: { color: "#fff", fontWeight: 900, fontFamily: "'Archivo Black', Impact, sans-serif", textShadow: OUTLINE(1.5) },
      active: { color: "#05F827", fontWeight: 900, fontFamily: "'Archivo Black', Impact, sans-serif", textShadow: OUTLINE(1.5) },
    },
  },
  {
    id: "youshaei",
    name: "Youshaei",
    blurb: "One line, grey words — the spoken word glows mint and pops.",
    render: { font: "Inter ExtraBold", fontColor: "#727071", fontSize: 58, outline: 0, shadow: 2, activeColor: "#6BF5C7", activeScale: 130, entrance: "float", wordsPerPage: 4 },
    preview: {
      base: { color: "#727071", fontWeight: 800, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
      active: { color: "#6BF5C7", fontWeight: 800, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", transform: "scale(1.12)", display: "inline-block" },
    },
  },
  {
    id: "deepdiver",
    name: "Deep Diver",
    blurb: "White pill background; words ink in black as they're read.",
    // VSFilter/libass quirk: with BorderStyle=3 the box is drawn in
    // OutlineColour (BackColour only colors the shadow) — so the pill color
    // must be set as outlineColor too, or the box renders black.
    render: { font: "Fira Sans", fontColor: "#ABABAB", fontSize: 56, outline: 4, outlineColor: "#E4E4E4", pillBg: "#E4E4E4", spokenColor: "#000000", entrance: "fade", wordsPerPage: 4 },
    preview: {
      chipBg: "#E4E4E4",
      base: { color: "#ABABAB", fontWeight: 700 },
      active: { color: "#000", fontWeight: 700 },
    },
  },
  {
    id: "podp",
    name: "Pod P",
    blurb: "Inverted podcast look — bold black caps on a clean white chip, words landing one at a time.",
    // INVERTED colors (text vs chip) + cumulative one-by-one reveal — the
    // premium podcast treatment; the hot-magenta ink survives as the active
    // word's color so the brand accent stays.
    render: { font: "Poppins Black", allCaps: true, fontColor: "#0B0B0D", fontSize: 66, outline: 0, shadow: 0, pillBg: "#FFFFFF", activeColor: "#FF5BE4", activeScale: 112, entrance: "float", reveal: "cumulative", blurIn: true, wordsPerPage: 4 },
    preview: {
      base: { color: "#0B0B0D", fontWeight: 900, fontFamily: "Poppins, system-ui, sans-serif" },
      active: { color: "#FF5BE4", fontWeight: 900, fontFamily: "Poppins, system-ui, sans-serif", transform: "scale(1.08)", display: "inline-block" },
      chipBg: "#FFFFFF",
    },
  },
  {
    id: "editorial",
    name: "Editorial",
    blurb: "Premium mixed type — heavy white sans, the key word flips to an italic serif; words float in one at a time.",
    // The "the *8th* time" film-title look: clean lowercase bold sans, no
    // outline (soft shadow keeps it legible on bright frames), cumulative
    // per-word reveal stacked two-per-line, keywords in italic Fraunces serif.
    render: {
      font: "Montserrat ExtraBold", fontColor: "#FFFFFF", fontSize: 78, outline: 0, shadow: 3,
      entrance: "float", reveal: "cumulative", stackAfter: 2, blurIn: true, wordsPerPage: 4,
      activeScale: 110, keywordFont: "Fraunces 144pt SemiBold", keywordItalic: true,
    },
    preview: {
      base: { color: "#fff", fontWeight: 800, fontFamily: "Montserrat, system-ui, sans-serif", textShadow: "0 2px 10px rgba(0,0,0,0.6)" },
      active: { color: "#fff", fontWeight: 600, fontStyle: "italic", fontFamily: "Fraunces, Georgia, serif", display: "inline-block", textShadow: "0 2px 10px rgba(0,0,0,0.6)" },
    },
  },
  {
    id: "popline",
    name: "Popline",
    blurb: "White caps; the spoken word turns purple, underlined, and pops.",
    render: { font: "Jost ExtraBold", allCaps: true, fontColor: "#FFFFFF", fontSize: 72, outline: 4, activeColor: "#8F2EED", activeScale: 130, activeUnderline: true, entrance: "float", wordsPerPage: 4 },
    preview: {
      base: { color: "#fff", fontWeight: 900, fontFamily: "Futura, 'Century Gothic', sans-serif", textShadow: OUTLINE(1.5) },
      active: { color: "#8F2EED", fontWeight: 900, fontFamily: "Futura, 'Century Gothic', sans-serif", textShadow: OUTLINE(1.5), textDecoration: "underline", textDecorationThickness: "3px" },
    },
  },
  {
    id: "glitch",
    name: "Glitch Pop",
    blurb: "Warm orange lowercase with a 3D punch — squashes in per page.",
    render: { font: "Nunito Black", fontColor: "#FFB02E", fontSize: 72, outline: 2, outlineColor: "#C75000", shadow: 5, popIn: true, wordsPerPage: 3 },
    preview: { base: { color: "#FFB02E", fontWeight: 900, fontFamily: "Nunito, system-ui, sans-serif", textShadow: "3px 3px 0 #C75000" } },
  },
  {
    id: "bounce",
    name: "Seamless Bounce",
    blurb: "Pages bounce in; the spoken word flashes green. Lowercase, outlined.",
    render: { font: "Quicksand", fontColor: "#FFFFFF", fontSize: 68, outline: 4, outlineColor: "#02340A", activeColor: "#05F827", activeScale: 120, popIn: true, wordsPerPage: 3 },
    preview: {
      base: { color: "#fff", fontWeight: 900, fontFamily: "Quicksand, system-ui, sans-serif", textShadow: OUTLINE(1.5, "#02340A") },
      active: { color: "#05F827", fontWeight: 900, fontFamily: "Quicksand, system-ui, sans-serif", textShadow: OUTLINE(1.5, "#02340A") },
    },
  },
  // ── Premium word-by-word BUILD-UP presets (reveal: "cumulative") ──────────
  // Distinct mechanic from every preset above: words APPEAR as they're spoken
  // instead of the whole page showing with the active word just recoloring.
  // Clean bundled sans faces (assets/fonts/, wired into libass via fontsdir —
  // see clipFilterGraph.ts's subtitlesFilter) instead of a loud
  // color-highlight, for the quiet "premium explainer" read.
  {
    id: "editorial-stack",
    name: "Editorial Stack",
    blurb: "Words build up two at a time, stacked — a clean editorial headline read.",
    render: {
      font: "Plus Jakarta Sans ExtraBold", fontColor: "#FFFFFF", fontSize: 76, outline: 0, shadow: 6,
      wordsPerPage: 4, stackAfter: 2, reveal: "cumulative", entrance: "float",
    },
    preview: {
      base: { color: "#fff", fontWeight: 800, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", textShadow: "0 6px 18px rgba(0,0,0,.55)" },
    },
  },
  {
    id: "lead-in-flare",
    name: "Lead In Flare",
    blurb: "One clean line that builds word by word, each new word landing with a soft warm flare.",
    render: {
      font: "Manrope ExtraBold", fontColor: "#FFFFFF", fontSize: 68, outline: 0, shadow: 5,
      activeColor: "#FFF4DC", activeScale: 108, wordsPerPage: 5, reveal: "cumulative", entrance: "fade",
    },
    preview: {
      base: { color: "#fff", fontWeight: 800, fontFamily: "Manrope, system-ui, sans-serif", textShadow: "0 6px 18px rgba(0,0,0,.5)" },
      active: { color: "#FFF4DC", fontWeight: 800, fontFamily: "Manrope, system-ui, sans-serif", textShadow: "0 0 22px rgba(255,244,220,.65), 0 6px 18px rgba(0,0,0,.5)" },
    },
  },
  {
    id: "blur-ladder",
    name: "Blur Ladder",
    blurb: "Each word focus-pulls sharp from a soft blur as it's spoken — a quiet, premium build.",
    render: {
      font: "Barlow SemiBold", fontColor: "#FFFFFF", fontSize: 74, outline: 0, shadow: 6,
      wordsPerPage: 4, reveal: "cumulative", blurIn: true, entrance: "fade",
    },
    preview: {
      base: { color: "#fff", fontWeight: 700, fontFamily: "Barlow, system-ui, sans-serif", textShadow: "0 6px 18px rgba(0,0,0,.55)", filter: "blur(0.2px)" },
    },
  },
  {
    id: "minimal-invert",
    name: "Minimal Invert",
    // Photoshop-"Invert" knockout: pure white + blendInvert (mix-blend-mode:
    // difference in the browser preview) means the RENDERED pixel is the
    // exact inverse of the footage under it — true real-time inversion, not
    // a flat white fill. See blendInvert's doc for the real-burn caveat (not
    // yet burnable by the ffmpeg pipeline — preview-only today). No
    // outline/shadow: a true inverse is self-contrasting against ANY
    // background by definition, so the usual legibility aids are redundant
    // here (and would look wrong composited under a difference blend).
    blurb: "Bold inverted type — the exact color-negative of the footage under it, live.",
    // Font MUST be one of the .ttf files actually bundled in assets/fonts/
    // (verified via each file's own name-table family string) — "Arial
    // Black" isn't bundled and silently falls back on the render container.
    // "Archivo Black" is the closest bundled equivalent (same blocky-heavy
    // display-black character).
    render: {
      font: "Archivo Black", allCaps: true, fontColor: "#FFFFFF", fontSize: 92, outline: 0, shadow: 0,
      entrance: "fade", wordsPerPage: 5, blendInvert: true,
    },
    preview: {
      base: { color: "#fff", fontWeight: 900, fontFamily: "'Archivo Black', Impact, sans-serif" },
    },
  },
  {
    id: "signature-serif",
    name: "Signature Serif",
    blurb: "Justified collage type — every word its own size, up to 3 rows, one signature word in red italic serif.",
    // layout:"collage" (not the old stackAfter line-break — that read as
    // flat "stacked" lines): every word gets its own greedy-packed,
    // row-centered position, up to 3 rows, each word's own size cycling via
    // wordScales so the block reads as a justified but visually varied
    // collage rather than a uniform grid. wordRotations adds a light organic
    // tilt. The KEYWORD/EMPHASIS word (real detection — isKeyword/isEmphasis
    // in captionRenderer.ts, not a fixed position) breaks to bigger red
    // italic Georgia, same as before. Sizing/rotation cycle off the word's
    // position across the WHOLE clip, not reset per page, so a later page in
    // the same clip lands on a different phase of each cycle — a different
    // arrangement per "spawn" without literal randomness (reproducible).
    // Fonts MUST be bundled (assets/fonts/, verified family strings) —
    // "Arial"/"Georgia" aren't and silently fell back on the render
    // container. "Montserrat SemiBold" for the base (clean, neutral, bold);
    // "Fraunces 144pt SemiBold" — the only bundled serif — for the keyword,
    // italic synthesized by libass since the bundled weight has no true italic.
    render: {
      font: "Montserrat SemiBold", fontColor: "#FFFFFF", fontSize: 88, outline: 0, shadow: 5,
      layout: "collage", blurIn: true, wordsPerPage: 7,
      wordScales: [1, 0.82, 1.15, 0.95, 1.25, 0.88, 1.05],
      wordRotations: [-4, 3, -2, 5, -3, 2, -5],
      keywordColor: "#E5231B", keywordFont: "Fraunces 144pt SemiBold", keywordItalic: true, keywordScale: 1.5,
      keywordMaxPerSentence: 2,
    },
    preview: {
      base: { color: "#fff", fontWeight: 800, fontFamily: "Montserrat, Helvetica, sans-serif", textShadow: "0 4px 14px rgba(0,0,0,.6)" },
      active: { color: "#E5231B", fontWeight: 700, fontStyle: "italic", fontFamily: "Fraunces, Georgia, serif", transform: "scale(1.4) rotate(-3deg)", display: "inline-block" },
    },
  },
  {
    id: "aesthetic-girly",
    name: "Aesthetic",
    blurb: "Bubbly girly collage — bigger, bouncier, one word breaks into a soft pink cursive script.",
    // Same collage concept as Signature Serif (justified row-pack, up to 3
    // rows, per-word size/tilt cycling, sentence-capped keyword highlight —
    // see that preset's doc): bigger base size, base words alternate between
    // two rounded girly sans faces (not just one) for more visible per-word
    // variety, and the highlight breaks into an elegant cursive script
    // (Dancing Script — genuine handwriting, not a blocky marker font) in
    // soft pink. Every word also bounces in (overshoot → settle, see
    // collageEvents()) instead of a flat pop — the "nice animation" ask.
    //
    // NOT done: actual flower/heart graphics. Captions burn as plain ASS
    // text via libass — no image compositing, and libass can't render color
    // emoji (renders as a tofu box; sanitize() in captionRenderer.ts strips
    // emoji for exactly this reason, from a prior incident). Real flower
    // decoration would need a separate image-overlay pass, not a caption
    // preset — flag if you want that built as its own feature.
    //
    // Fonts MUST be bundled (assets/fonts/, verified family strings) —
    // "Baloo 2"/"Quicksand"/"Dancing Script" aren't and silently fell back
    // on the render container. "Manrope Medium"/"Plus Jakarta Sans SemiBold"
    // for the rounded base-word pair, and "Satisfy" — a genuine bundled
    // handwriting script (assets/fonts/Satisfy-Regular.ttf) — for the
    // keyword highlight.
    render: {
      font: "Manrope Medium", fontColor: "#FFFFFF", fontSize: 100, outline: 0, shadow: 4,
      layout: "collage", blurIn: true, wordsPerPage: 7,
      wordFonts: ["Manrope Medium", "Plus Jakarta Sans SemiBold"],
      wordScales: [1, 0.85, 1.2, 0.9, 1.1, 0.95, 1.15],
      wordRotations: [-7, 5, -4, 8, -6, 3, -8],
      wordColors: ["#FFFFFF", "#FFD6EA", "#FFFFFF", "#FFE3F1"],
      keywordColor: "#FF5FAE", keywordFont: "Satisfy", keywordScale: 1.55,
      keywordMaxPerSentence: 2,
    },
    preview: {
      base: { color: "#fff", fontWeight: 700, fontFamily: "Manrope, system-ui, sans-serif", textShadow: "0 4px 12px rgba(0,0,0,.55)" },
      active: { color: "#FF5FAE", fontWeight: 400, fontFamily: "Satisfy, cursive", transform: "scale(1.4) rotate(-4deg)", display: "inline-block" },
    },
  },
  {
    id: "handwriting-glow",
    name: "Handwriting Glow",
    blurb: "Two-line hook, left-aligned — warm glowing handwritten line, bold clean line below.",
    // Fixed two-line hook: one line in Satisfy (a genuine casual handwriting
    // script — BUNDLED as assets/fonts/Satisfy-Regular.ttf, internal family
    // name verified via the font's own name table, "Satisfy") with a real
    // dual-layer glow (lineGlow — a second, bigger/more-blurred copy of the
    // word on an ASS layer BEHIND the sharp one, see presetEvents()'s doc —
    // genuine warm shine, not a soft-focus blur on the letters themselves),
    // the other in bold clean Poppins SemiBold, no glow. lineScales makes
    // the glow line noticeably bigger than the other, on top of wordScales'
    // per-word size variation. `lineOrderAlternate` swaps which line gets
    // which style, by page. `align:"left"` + `spawnCorner:"alternate"`
    // left-anchors the block and alternates between two nearby spots in the
    // LOWER half of frame (see posOverride in presetEvents()). Words appear
    // one at a time (reveal:"cumulative") with NO entrance/blurIn/
    // activeScale — literally just there-then-there. `wordsPerPage: 5` +
    // `stackAfter: 2` keeps this to a real max of 2 rows (2 words on line 1,
    // 3 on line 2) — a bigger wordsPerPage let line 2 grow past what fits on
    // one row and visibly wrap into 2-3 more rows, which is the "4 rows"
    // bug. Both are fixed word-COUNT splits, not semantic — a real
    // transcript with a different natural title length won't always land
    // exactly on 2+3 or fit one row.
    //
    // IMPORTANT lesson from this preset: EVERY font name here must be one of
    // the .ttf files actually bundled in assets/fonts/ (verified against
    // each file's own name-table family string — a name that LOOKS right
    // but isn't bundled silently falls back to whatever fontconfig finds on
    // the render container, which is how "the fonts all same" happened).
    // "Poppins" alone does NOT match the bundled file (its real internal
    // family is "Poppins SemiBold") — same class of bug as an unbundled
    // fantasy font name.
    render: {
      font: "Poppins SemiBold", fontColor: "#FFFFFF", fontSize: 110, outline: 0, shadow: 3,
      reveal: "cumulative", wordsPerPage: 5, stackAfter: 2,
      align: "left", spawnCorner: "alternate", lineOrderAlternate: true,
      lineFonts: ["Satisfy", "Poppins SemiBold"],
      lineColors: ["#FFD84D", "#FFFFFF"],
      lineGlow: [true, false],
      lineScales: [1.25, 1],
      wordScales: [1, 1.15, 0.9],
    },
    preview: {
      base: { color: "#fff", fontWeight: 800, fontFamily: "Poppins, system-ui, sans-serif", textShadow: "0 3px 10px rgba(0,0,0,.5)" },
      active: { color: "#FFD84D", fontWeight: 400, fontFamily: "Satisfy, cursive", transform: "scale(1.25)", textShadow: "0 0 12px rgba(255,216,77,.95), 0 0 28px rgba(255,216,77,.75), 0 0 56px rgba(255,190,40,.5)", display: "inline-block" },
    },
  },
  {
    id: "cream-editorial",
    name: "Cream Editorial",
    blurb: "Warm cream serif, one clean line — words blink in one by one, no motion.",
    // reveal:"cumulative" = words appear as spoken; NO entrance/blurIn/activeScale
    // so each word is a hard cut-in ("blink"). stackAfter omitted = single line,
    // wordsPerPage kept short so the line never wraps. Fraunces (bundled serif)
    // reads premium; soft shadow only, no outline, so it stays airy on video.
    render: {
      font: "Fraunces 144pt SemiBold", fontColor: "#F4EBD6", fontSize: 92, outline: 0, shadow: 3,
      reveal: "cumulative", wordsPerPage: 4,
    },
    preview: {
      base: { color: "#F4EBD6", fontWeight: 600, fontFamily: "Fraunces, Georgia, serif", textShadow: "0 3px 10px rgba(0,0,0,.45)" },
      active: { color: "#F4EBD6", fontWeight: 600, fontFamily: "Fraunces, Georgia, serif" },
    },
  },
];

/** Pill padding (px @ burn res) for BorderStyle=3 presets — shared by the ASS
 *  Style line and the editor preview so the chip is the same size in both. */
export function captionPillPadding(r: CaptionPresetRender): number {
  return Math.max(r.outline, 10);
}

// Picker chips (AppStore, inspector, drawer) render `preview` directly — pin
// their fonts to the SAME bundled families the burn uses (loaded globally via
// burnFontFaceCss) at native weight, so no chip shows a font the export lacks.
for (const p of CAPTION_PRESETS) {
  const r = p.render;
  p.preview.base = { ...p.preview.base, fontFamily: burnFontStack(r.font), fontWeight: 400, fontStyle: r.italic ? "italic" : p.preview.base.fontStyle };
  if (p.preview.active) {
    const activeFamily = r.keywordFont ?? r.lineFonts?.[0] ?? r.font;
    p.preview.active = { ...p.preview.active, fontFamily: burnFontStack(activeFamily), fontWeight: 400 };
  }
}

export const CAPTION_PRESET_BY_ID: Record<string, CaptionPreset> = Object.fromEntries(
  CAPTION_PRESETS.map((p) => [p.id, p]),
);

export const isCaptionPresetId = (id: unknown): id is string =>
  typeof id === "string" && id in CAPTION_PRESET_BY_ID;
