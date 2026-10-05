import type { TranscriptWord, CaptionStyle } from "./clipTypes";
import { BURN_FONT_FAMILIES } from "../builder/burnFonts";
import { CAPTION_PRESET_BY_ID, captionPillPadding, type CaptionPresetRender } from "../builder/captionPresets";
import { toAssTime, toAssColor } from "./assUtils";

const ALIGN: Record<CaptionStyle["position"], number> = { bottom: 2, center: 5, top: 8 };

// High-signal keyword classes for the Keyword Pop skill (deterministic — no
// LLM call). NOTE: actual emoji glyphs are NOT burned — ffmpeg-static's libass
// renders color emoji as tofu — so keywords pop via the highlight color instead.
const KEYWORDS = [
  /\b(money|cash|dollar|profit|revenue|paid|salary|price)s?\b/i,
  /\b(grow|growth|scale|scaling|increase)\b/i,
  /\b(fail|failure|mistake|wrong|lose|losing|lost)s?\b/i,
  /\b(win|winning|won|success|successful)\b/i,
  /\b(fire|hot|amazing|insane|crazy)\b/i,
  /\b(secret|hidden|nobody)\b/i,
  /\b(launch|rocket|ship|shipped)\b/i,
  /\b(warning|careful|danger|risk|risky)\b/i,
];
// Exported so non-caption callers (e.g. the Gen Z sample template's
// keyword-triggered zoom-punch + SFX) can trigger on the SAME words the
// captions themselves highlight — one definition of "keyword", not two.
export const isKeyword = (word: string): boolean => KEYWORDS.some((re) => re.test(word));

// Deterministic emphasis: numbers, long words, and power words pop in the
// highlight color — the OpusClip "keyword highlight" effect without an LLM call.
const POWER = /\b(never|always|nobody|everyone|biggest|best|worst|free|stop|now|today|secret|mistake|truth|hack|wrong|right)\b/i;
export const isEmphasis = (word: string): boolean =>
  // \p{L} (any-script letters) instead of [A-Za-z] so non-latin "long words" still
  // emphasize (a CJK/Arabic word of 8+ letters used to score 0 and never pop).
  /\d/.test(word) || word.replace(/[^\p{L}]/gu, "").length >= 8 || POWER.test(word);

/** Times (clip-relative seconds) worth a Zoom Punch — the Specials panel's
 *  keyword-triggered punch reuses the SAME keyword/emphasis detection the
 *  caption Keyword Pop skill and the Sound Effect tool already trigger on, so
 *  "punch on certain keywords" behaves consistently across the app instead of
 *  inventing a third keyword list. Bounded (`max`) and spaced apart
 *  (`minGapSec`) so a keyword-dense clip doesn't punch on every other word.
 *  Pure + deterministic. */
export function pickZoomPunchTimes(words: TranscriptWord[], opts: { max?: number; minGapSec?: number } = {}): number[] {
  const max = opts.max ?? 4;
  const minGap = opts.minGapSec ?? 3;
  const out: number[] = [];
  for (const w of words) {
    if (out.length >= max) break;
    const clean = w.word.trim();
    if (!clean) continue;
    if (!(isKeyword(clean) || isEmphasis(clean))) continue;
    if (out.length > 0 && w.start - out[out.length - 1] < minGap) continue;
    out.push(Math.max(0, w.start));
  }
  return out;
}

// Pick a script-appropriate ASS font when the captions are non-latin, so CJK /
// Arabic / Devanagari / Thai don't render as tofu boxes (Arial is latin-only).
// Returns a fontconfig family NAME — the render image must have the matching Noto
// family installed; otherwise libass/fontconfig substitutes the closest available.
function fontForText(text: string, fallback: string): string {
  if (/[가-힯]/.test(text)) return "Noto Sans CJK KR"; // Hangul — checked FIRST: the Hangul range overlaps the CJK compat block
  if (/[぀-ヿ㐀-鿿豈-﫿]/.test(text)) return "Noto Sans CJK SC"; // CJK ideographs + kana
  if (/[؀-ۿݐ-ݿ]/.test(text)) return "Noto Sans Arabic";
  if (/[ऀ-ॿ]/.test(text)) return "Noto Sans Devanagari";
  if (/[฀-๿]/.test(text)) return "Noto Sans Thai";
  return fallback;
}

// Emoji & pictographic symbols that ffmpeg-static's libass CANNOT render — it burns
// each one as a tofu (▯) box, which is exactly the "broken symbols" the operator saw
// crashing the captions. Strip them so captions are TEXT ONLY. Covers the emoji planes
// (emoticons, symbols & pictographs, transport, extended-A), misc-technical (⌚⏰),
// misc-symbols + dingbats (★✂✅❤✈), misc-symbols-&-arrows (⬅⭐), plus the emoji
// variation selectors / ZWJ / keycap that ride along in multi-codepoint sequences.
// Deliberately does NOT touch letters (any script), digits, ordinary punctuation, or
// common typographic marks (™ © ® ° №) — those render fine and ARE text.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

// ASS override blocks are brace-delimited — strip braces from transcript words so a
// stray "{" can't inject tags or unbalance the event. Then drop emoji/pictographs
// (tofu), normalize smart punctuation to ASCII, and collapse any gaps left behind.
const sanitize = (raw: string): string =>
  raw
    .replace(/\n/g, " ")
    .replace(/[{}]/g, "")
    .replace(EMOJI_RE, "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s{2,}/g, " ")
    .trim();

export interface RenderCaptionsOpts {
  clipStartSec: number;
  clipEndSec: number;
  style: CaptionStyle;
  width?: number;
  height?: number;
  /** When the clip is composited into a brain-rot PANE (clip.brainrot), the caption
   *  must land inside the CLIP pane, not the gameplay half. The graph burns this ASS
   *  onto the clip-pane STREAM (before stacking), so set PlayRes to the pane dims —
   *  libass then positions within the pane — and center the caption (spot "center")
   *  so it sits in the middle of the clip, clear of the seam. vstack → full-width ×
   *  half-height pane; hstack → half-width × full-height pane. */
  clipPane?: { layout: "vstack" | "hstack"; spot?: "center" | "bottom" };
}

/** Group words into OpusClip-style caption pages: at most `size` words, broken
 *  early at sentence punctuation or speech gaps > 1.2s so pages read naturally. */
export function chunkWords(words: TranscriptWord[], size: number): TranscriptWord[][] {
  const pages: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length >= size || (prev && w.start - prev.end > 1.2)) {
      pages.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?]$/.test(w.word.trim())) {
      pages.push(cur);
      cur = [];
    }
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/**
 * Chunked word-sync engine (preset path). Per page, one Dialogue per word
 * showing the WHOLE page with the active word styled — confirmed OpusClip
 * mechanics: instant recolor + scale hold for the word's spoken duration.
 * Everything is plain ASS overrides, so the existing subtitles= burn-in path
 * needs no ffmpeg changes.
 */
/** Round-robins a per-word cycle array by word index (word 0 → arr[0], word 1
 *  → arr[1 % len], …) — the "aesthetic mixed-type" effect (wordFonts/
 *  wordScales/wordColors): every word its own size/font/color, deterministic
 *  and reproducible rather than actually-random (a real RNG would make the
 *  same clip look different on every re-render). */
function pickCycle<T>(arr: T[] | undefined, idx: number): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[idx % arr.length];
}

/** One word's computed slot in a collage row-pack. */
interface CollageSlot { j: number; xCenter: number; y: number; fontPx: number; rotDeg: number }

/** Greedy row-pack a page's words into up to 3 rows by ESTIMATED width (no
 *  real font metrics available at render time — a per-character heuristic is
 *  close enough for layout purposes, since this is a scattered collage look,
 *  not pixel-exact typesetting), then center each row horizontally and stack
 *  the rows vertically centered on the usual caption anchor. `globalWordIdx0`
 *  is this page's first word's position across the WHOLE clip (not reset per
 *  page) — wordScales/wordFonts/wordColors/wordRotations all cycle off that,
 *  so a later page in the same clip naturally lands on a different phase of
 *  each cycle than the page before it — different arrangement per "spawn"
 *  without needing real randomness.
 *
 *  `allowedKw[j]` MUST be the same per-word keyword decision the caller is
 *  about to render with (precomputed once, via the shared sentence-cap
 *  gate — see collageEvents) — sizing a word off wordScales while it
 *  actually renders at keywordScale is exactly what caused real word
 *  overlap: the reserved row width didn't match the rendered glyph size. */
function collageLayout(
  page: TranscriptWord[],
  p: CaptionPresetRender,
  playW: number,
  playH: number,
  globalWordIdx0: number,
  allowedKw: boolean[],
): CollageSlot[] {
  const CHAR_W = 0.62; // heuristic: avg glyph advance as a fraction of font size, bold sans/serif — a hair generous, better an extra gap than an overlap
  const PAD = 0.4; // inter-word breathing room, as a fraction of font size
  const maxRowWidth = playW * 0.86;
  const maxRows = 3;

  type RowWord = { j: number; w: number; fontPx: number };
  const rows: RowWord[][] = [[]];
  let rowWidth = 0;
  for (let j = 0; j < page.length; j++) {
    const gIdx = globalWordIdx0 + j;
    const sizeMul = allowedKw[j] && p.keywordScale ? p.keywordScale : (pickCycle(p.wordScales, gIdx) ?? 1);
    const fontPx = p.fontSize * sizeMul;
    const w = page[j].word.length * fontPx * CHAR_W + fontPx * PAD;
    const row = rows[rows.length - 1];
    if (rowWidth + w > maxRowWidth && row.length > 0 && rows.length < maxRows) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1].push({ j, w, fontPx });
    rowWidth += w;
  }

  const lineGap = 1.2;
  const rowHeights = rows.map((row) => Math.max(...row.map((r) => r.fontPx)) * lineGap);
  const totalHeight = rowHeights.reduce((a, b) => a + b, 0);
  // Block-centered on the same ~19%-from-bottom anchor every other preset
  // uses, so a collage preset still sits in the platform's caption-safe zone.
  const anchorY = playH * 0.81;
  let y = anchorY - totalHeight / 2 + rowHeights[0] / 2;

  const slots: CollageSlot[] = [];
  rows.forEach((row, ri) => {
    const rowTotalW = row.reduce((s, r) => s + r.w, 0);
    let x = (playW - rowTotalW) / 2;
    for (const { j, w, fontPx } of row) {
      const gIdx = globalWordIdx0 + j;
      // Small deterministic vertical jitter (own cycle, offset from the size
      // cycle so they don't move in lockstep) — keeps the row from reading
      // as a perfectly straight baseline, the "not stacked" organic feel.
      const jitter = pickCycle(JITTER_CYCLE, gIdx + 3) ?? 0;
      slots.push({
        j, xCenter: x + w / 2, y: y + jitter * fontPx * 0.14, fontPx,
        rotDeg: pickCycle(p.wordRotations, gIdx) ?? 0,
      });
      x += w;
    }
    y += rowHeights[ri];
  });
  return slots;
}

const JITTER_CYCLE = [-1, 1, 0, -0.6, 0.8, -0.3];

/** Caps how many words get keyword-highlighted PER SENTENCE (not per page —
 *  a sentence can straddle a page break) — without this, every single
 *  keyword/emphasis hit lit up, which for a dense sentence ("number 1
 *  secret nobody ever tells you today") could pop 4+ words red in one
 *  breath, way past "usually 1, sometimes 2" restraint. Returns a stateful
 *  gate: call it ONCE per word, in transcript order, for the whole clip —
 *  calling it more than once for the same word (e.g. once per re-rendered
 *  frame) would over-count. `max == null` means uncapped (existing presets'
 *  behavior, unchanged). */
export function makeKeywordGate(max: number | undefined) {
  let countInSentence = 0;
  return (word: string, isCandidate: boolean): boolean => {
    let allow = false;
    if (isCandidate) {
      if (max == null || countInSentence < max) { allow = true; countInSentence++; }
    }
    if (/[.!?]$/.test(word.trim())) countInSentence = 0; // sentence ends AFTER this word
    return allow;
  };
}

/** Collage layout's own event builder — a word is one PERSISTENT, absolutely-
 *  positioned Dialogue event (born at its spoken time, stays through the
 *  page) instead of the whole page being rebuilt every frame. Overlapping
 *  events naturally give the cumulative "words land one at a time" reveal —
 *  no separate reveal/stackAfter/entrance handling needed. */
function collageEvents(
  inWin: TranscriptWord[],
  p: CaptionPresetRender,
  clipStartSec: number,
  style: CaptionStyle,
  playW: number,
  playH: number,
): string[] {
  const events: string[] = [];
  const kw = p.keywordColor ? toAssColor(p.keywordColor) : null;
  const kwFont = p.keywordFont ?? null;
  const kwItalic = p.keywordItalic === true;
  const kwAny = kw != null || kwFont != null || kwItalic || p.keywordScale != null;
  const baseFontName = p.font ?? "Arial";
  const kwGate = makeKeywordGate(p.keywordMaxPerSentence);

  let globalWordIdx = 0;
  for (const page of chunkWords(inWin, Math.max(1, p.wordsPerPage))) {
    const pageEnd = page[page.length - 1].end - clipStartSec;
    // Decide keyword-or-not for every word ONCE, in order, before layout —
    // collageLayout needs the FINAL decision to size each word's reserved
    // row-slot correctly (see its doc), and the gate must only be called
    // once per word or the sentence cap over-counts.
    const allowedKw = page.map((w) => kwGate(w.word, kwAny && (isKeyword(w.word) || isEmphasis(w.word))));
    const slots = collageLayout(page, p, playW, playH, globalWordIdx, allowedKw);
    for (const slot of slots) {
      const w = page[slot.j];
      const start = w.start - clipStartSec;
      if (pageEnd <= start) continue;
      const gIdx = globalWordIdx + slot.j;
      const isKw = allowedKw[slot.j];
      const ownFont = isKw ? (kwFont ?? baseFontName) : (pickCycle(p.wordFonts, gIdx) ?? baseFontName);
      const ownColorHex = isKw ? p.keywordColor : pickCycle(p.wordColors, gIdx);
      const fontPx = isKw && p.keywordScale ? p.fontSize * p.keywordScale : slot.fontPx;
      const scalePct = Math.round((fontPx / p.fontSize) * 100);
      let text = sanitize(w.word);
      if (p.allCaps) text = text.toUpperCase();
      // Bounce-in: land at ~135% of the word's own size and ease DOWN to its
      // true size over 220ms (accel 0.55 = decelerate, so it overshoots then
      // settles) instead of just popping straight to size — a livelier
      // "landing" than a flat static size, still per-word/independent.
      const overshootPct = Math.round(scalePct * 1.35);
      const tags = [
        `\\an5\\pos(${Math.round(slot.xCenter)},${Math.round(slot.y)})`,
        `\\fscx${overshootPct}\\fscy${overshootPct}\\t(0,220,0.55,\\fscx${scalePct}\\fscy${scalePct})`,
        `\\fn${ownFont}`,
        ownColorHex ? `\\c${toAssColor(ownColorHex)}` : "",
        isKw && kwItalic ? "\\i1" : "",
        slot.rotDeg ? `\\frz${slot.rotDeg}` : "",
        "\\fad(160,0)", // each word fades in on its own, independent of its neighbors
        p.blurIn ? "\\blur6\\t(0,180,\\blur0)" : "", // focus-pulls sharp as it lands
      ].filter(Boolean).join("");
      events.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(pageEnd)},Def,{${tags}}${text}`);
    }
    globalWordIdx += page.length;
  }
  return events;
}

function presetEvents(
  inWin: TranscriptWord[],
  p: CaptionPresetRender,
  clipStartSec: number,
  baseColor: string,
  style: CaptionStyle,
  playW: number,
  playH: number,
): string[] {
  if (p.layout === "collage") return collageEvents(inWin, p, clipStartSec, style, playW, playH);

  const events: string[] = [];
  const active = p.activeColor ? toAssColor(p.activeColor) : null;
  const base = toAssColor(baseColor);
  const spoken = p.spokenColor ? toAssColor(p.spokenColor) : null;
  // Keyword highlight: prefer the preset's own keywordColor (Beasty/Mozi); else honor
  // the Keyword Pop skill's style.highlightColor (+emoji flag) so wiring Keyword Pop
  // ON TOP of a non-keyword preset (karaoke/youshaei/…) still pops keywords instead of
  // silently no-op'ing (the skill is billed, so a silent drop is a paid no-op).
  const kw = p.keywordColor
    ? toAssColor(p.keywordColor)
    : (style.emoji && style.highlightColor ? toAssColor(style.highlightColor) : null);
  // Keyword TYPOGRAPHY switch (Editorial preset): important words render in a
  // DIFFERENT font (e.g. an italic serif inside a bold sans line — the
  // "the *8th* time" look) via inline \fn/\i overrides. Active with or without
  // a keyword recolor.
  const kwFont = p.keywordFont ?? null;
  const kwItalic = p.keywordItalic === true;
  // NOTE: keywordScale and activeScale both write \fscx/\fscy — a preset
  // that sets BOTH will see the active-word tween (below) briefly override
  // keywordScale during that word's own "active" turn, then keywordScale
  // reasserts once it's no longer active. Fine for a preset that only uses
  // one of the two (the common case); combining them isn't recommended.
  const kwScale = p.keywordScale && p.keywordScale !== 1 ? Math.round(p.keywordScale * 100) : null;
  const kwAny = kw != null || kwFont != null || kwItalic || kwScale != null;
  const baseFontName = p.font ?? "Arial";
  const baseItalic = p.italic ? 1 : 0;
  const kwTags = (): string[] => {
    const t: string[] = [];
    if (kw) t.push(`\\c${kw}`);
    if (kwFont) t.push(`\\fn${kwFont}`);
    if (kwItalic) t.push("\\i1");
    if (kwScale) t.push(`\\fscx${kwScale}\\fscy${kwScale}`);
    return t;
  };
  const scale = p.activeScale && p.activeScale !== 100 ? p.activeScale : null;
  // A word that pops to e.g. 130% (\fscx/\fscy) grows past its normal advance
  // width, and libass doesn't reserve extra room for that growth — the
  // scaled-up word visually crowds or overlaps its neighbor across a single
  // ASS space. Widen the gap between EVERY word pair (not just around the
  // currently-active one) so spacing stays constant regardless of which word
  // is popped — a gap that only widened around the active word would visibly
  // shift as focus moves across the page.
  const wordGap = (scale || kwScale || (p.wordScales && p.wordScales.length > 0)) ? "  " : " ";
  const kwGate = makeKeywordGate(p.keywordMaxPerSentence);

  // Smooth page-entrance animation (plays once, on the page's first frame). Uses
  // ASS \fad (alpha) + an EASED \t (the 3rd arg is the acceleration exponent;
  // <1 decelerates → an ease-out that lands softly instead of snapping). `popIn`
  // is the legacy boolean and maps to "pop".
  const entrance = p.entrance ?? (p.popIn ? "pop" : null);
  const entranceTag = (kind: NonNullable<CaptionPresetRender["entrance"]>): string => {
    switch (kind) {
      case "fade":
        return "\\fad(160,0)";
      case "float":
        return "\\fscx90\\fscy90\\fad(150,0)\\t(0,240,0.6,\\fscx100\\fscy100)";
      case "pop":
      default:
        return "\\fscx55\\fscy55\\fad(50,0)\\t(0,190,0.7,\\fscx100\\fscy100)";
    }
  };

  const pages = chunkWords(inWin, Math.max(1, p.wordsPerPage));
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageEnd = page[page.length - 1].end;
    // Decide keyword-or-not for every word in this page ONCE, in order —
    // this loop below re-renders the page's text once per active-word index
    // (i), so recomputing isKw inline per-event would call the sentence-cap
    // gate multiple times for the same word and over-count it.
    const allowedKw = page.map((w) => kwGate(w.word, kwAny && (isKeyword(w.word) || isEmphasis(w.word))));
    // Swap which physical line gets lineFonts[0] vs [1], alternating by page
    // — so two pages in the same clip don't always put the script line on
    // top. Deterministic (page parity), not actual randomness.
    const lineSwap = p.lineOrderAlternate === true && pageIdx % 2 === 1;
    // align:"left" bypasses the Style line's centered Alignment/MarginV
    // entirely via an explicit \an+\pos override — MUST be reasserted on
    // EVERY event of the page (not just the first), since each word-reveal
    // is its own independent Dialogue line that otherwise falls back to the
    // Style default and visibly jumps position between words.
    let posOverride: string | null = null;
    if (p.align === "left") {
      const top = p.spawnCorner === "alternate" ? pageIdx % 2 === 0 : p.spawnCorner === "topLeft";
      const marginPx = Math.round(playW * 0.07);
      // Both spots sit in the LOWER half, close together (not one near the
      // top of frame and one near the bottom — that read as "too far apart")
      // — an1 (bottom-left anchor) both times, just two nearby heights.
      posOverride = top
        ? `\\an1\\pos(${marginPx},${Math.round(playH * 0.64)})`
        : `\\an1\\pos(${marginPx},${Math.round(playH * 0.82)})`;
    }
    for (let i = 0; i < page.length; i++) {
      const start = page[i].start - clipStartSec;
      // Hold each frame until the next word starts (or the page ends) so the
      // page never flickers off between words.
      const end = (i + 1 < page.length ? page[i + 1].start : pageEnd) - clipStartSec;
      if (end <= start) continue;

      const parts: string[] = [];
      if (posOverride) parts.push(`{${posOverride}}`);
      // Page-enter animation on the first word/frame only, as a leading override.
      const hasEntrance = entrance != null && i === 0;
      if (hasEntrance) parts.push(`{${entranceTag(entrance)}}`);

      // CUMULATIVE reveal (premium build-up presets): only words 0..i exist in
      // the text at all — word i+1 isn't rendered dim/invisible, it simply
      // isn't there yet, so the caption visibly GROWS with each spoken word
      // instead of showing the whole page from frame 1 and just recoloring the
      // active one. `stackAfter` forces an ASS line break (\N) at that word
      // count, for a stacked ("i had / one rule") layout instead of one long
      // growing line; `blurIn` animates the newly-revealed word sharp from a
      // soft blur (ASS \blur + \t) as an extra per-word entrance flourish.
      if (p.reveal === "cumulative") {
        const chunks: string[] = [];
        // A SECOND, invisible-except-for-glow-words copy of this same page,
        // rendered on a LOWER Layer (drawn first, so it sits BEHIND the main
        // text) — bigger and much more blurred, so it reads as a genuine
        // bright halo bleeding out from behind the sharp letters, not just a
        // soft-focus word. Only built (and only pushed) when a line in this
        // page actually has lineGlow set — every other preset costs nothing.
        const haloChunks: string[] = [];
        let hasGlow = false;
        for (let j = 0; j <= i; j++) {
          let text = sanitize(page[j].word);
          if (p.allCaps) text = text.toUpperCase();
          const isNew = j === i; // the word revealed by THIS event
          const isKw = allowedKw[j];
          // Aesthetic mixed-type: this word's OWN resting font/size/color,
          // cycled by position — applies whether or not it's the newly-
          // revealed word, so once a word lands it keeps its distinct look
          // (not just a one-frame flourish). Keyword typography still wins
          // where both are set (isKw gates font/color, never scale — a
          // keyword should still size-vary with its neighbors).
          const ownFont = pickCycle(p.wordFonts, j);
          const ownColor = pickCycle(p.wordColors, j);
          const ownScale = pickCycle(p.wordScales, j);
          // Per-LINE (not per-word) styling — a "line" is just which side of
          // the single stackAfter break this word falls on (stackAfter only
          // ever inserts ONE \N, not a repeating group-every-N split — see
          // the `j === p.stackAfter` check below). The "script title line /
          // bold body line" two-line hook.
          const rawLineIdx = p.stackAfter != null && j >= p.stackAfter ? 1 : 0;
          const lineIdx = lineSwap ? 1 - rawLineIdx : rawLineIdx;
          const lineFont = pickCycle(p.lineFonts, lineIdx);
          const lineColor = pickCycle(p.lineColors, lineIdx);
          const lineGlow = pickCycle(p.lineGlow, lineIdx) === true;
          const lineScale = pickCycle(p.lineScales, lineIdx);
          if (lineGlow) hasGlow = true;
          const resolvedFont = (isKw ? kwFont : null) ?? lineFont ?? ownFont ?? baseFontName;
          const resolvedColor = (isKw ? kw : null) ?? (lineColor ? toAssColor(lineColor) : null) ?? (ownColor ? toAssColor(ownColor) : null) ?? base;
          // The line's own boost (lineScales) stacks with the word's own
          // wordScales jitter — "the highlight LINE reads bigger" plus
          // "every word still its own size" are independent knobs.
          const effectiveScale = (ownScale ?? 1) * (lineScale ?? 1);
          const tags: string[] = [];
          if (lineFont && !isKw) tags.push(`\\fn${lineFont}`);
          else if (ownFont && !isKw) tags.push(`\\fn${ownFont}`);
          if (lineColor && !isKw) tags.push(`\\c${toAssColor(lineColor)}`);
          else if (ownColor && !isKw) tags.push(`\\c${toAssColor(ownColor)}`);
          if (effectiveScale !== 1) tags.push(`\\fscx${Math.round(effectiveScale * 100)}\\fscy${Math.round(effectiveScale * 100)}`);
          if (isKw) tags.push(...kwTags()); // keyword typography applies from the word's first frame
          if (isNew) {
            if (active && !isKw) tags.push(`\\c${active}`);
            if (scale) tags.push(`\\fscx100\\fscy100\\t(0,150,0.6,\\fscx${scale}\\fscy${scale})`);
            if (p.blurIn) tags.push("\\blur6\\t(0,180,\\blur0)");
          }
          const reset: string[] = [];
          if (tags.some((t) => t.startsWith("\\c"))) reset.push(`\\c${base}`);
          if (tags.some((t) => t.startsWith("\\fscx"))) reset.push("\\fscx100", "\\fscy100");
          if (tags.some((t) => t.startsWith("\\fn"))) reset.push(`\\fn${baseFontName}`);
          if (tags.includes("\\i1")) reset.push(`\\i${baseItalic}`);
          chunks.push(tags.length ? `{${tags.join("")}}${text}{${reset.join("")}}` : text);

          if (lineGlow) {
            const haloScalePct = Math.round(effectiveScale * 118);
            haloChunks.push(`{\\fn${resolvedFont}\\c${resolvedColor}\\fscx${haloScalePct}\\fscy${haloScalePct}\\blur8}${text}{\\blur0\\fscx100\\fscy100}`);
          } else {
            haloChunks.push(`{\\alpha&HFF&}${text}{\\alpha&H00&}`); // invisible in the halo layer
          }
        }
        const join = (arr: string[]) => {
          let out = "";
          for (let j = 0; j < arr.length; j++) {
            if (j > 0) out += p.stackAfter && j === p.stackAfter ? "\\N" : wordGap;
            out += arr[j];
          }
          return out;
        };
        const text = join(chunks);
        if (hasGlow) events.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Def,${posOverride ? `{${posOverride}}` : ""}${join(haloChunks)}`);
        parts.push(text);
        events.push(`Dialogue: ${hasGlow ? 1 : 0},${toAssTime(start)},${toAssTime(end)},Def,${parts.join("")}`);
        continue;
      }

      for (let j = 0; j < page.length; j++) {
        let text = sanitize(page[j].word);
        if (p.allCaps) text = text.toUpperCase();
        const isActive = j === i;
        const isSpoken = j < i;
        const isKw = allowedKw[j];
        const tags: string[] = [];
        // Aesthetic mixed-type (see the cumulative path above for the full
        // doc) — this word's own resting font/size/color, cycled by position.
        const ownFont = pickCycle(p.wordFonts, j);
        const ownColor = pickCycle(p.wordColors, j);
        const ownScale = pickCycle(p.wordScales, j);
        if (ownFont && !isKw) tags.push(`\\fn${ownFont}`);
        if (ownColor && !isKw) tags.push(`\\c${toAssColor(ownColor)}`);
        if (ownScale != null) tags.push(`\\fscx${Math.round(ownScale * 100)}\\fscy${Math.round(ownScale * 100)}`);
        // Keyword typography (font swap / italics / recolor) is positional —
        // it must not vanish while the word is the active one, so it applies
        // in every state.
        if (isKw) tags.push(...kwTags());
        if (isActive) {
          if (active && !isKw) tags.push(`\\c${active}`);
          else if (spoken && !isKw) tags.push(`\\c${spoken}`); // accumulate: active inks immediately
          // Smooth per-word pop: EASE the active word from 100% up to `scale` over
          // 150ms (ASS \t with a 0.6 accel = ease-out, so it lands softly instead of
          // snapping or overshooting). A clean spring-in on every spoken word.
          if (scale && !hasEntrance) tags.push(`\\fscx100\\fscy100\\t(0,150,0.6,\\fscx${scale}\\fscy${scale})`);
          if (p.activeUnderline) tags.push("\\u1");
        } else if (isSpoken && spoken && !isKw) {
          tags.push(`\\c${spoken}`); // accumulate presets: spoken words keep the ink
        }
        const reset: string[] = [];
        if (tags.some((t) => t.startsWith("\\c"))) reset.push(`\\c${base}`);
        if (tags.some((t) => t.startsWith("\\fscx"))) reset.push("\\fscx100", "\\fscy100");
        if (tags.some((t) => t.startsWith("\\fn"))) reset.push(`\\fn${baseFontName}`);
        if (tags.includes("\\i1")) reset.push(`\\i${baseItalic}`);
        if (tags.includes("\\u1")) reset.push("\\u0");
        parts.push(tags.length ? `{${tags.join("")}}${text}{${reset.join("")}}` : text);
      }
      events.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Def,${parts.join(wordGap)}`);
    }
  }
  return events;
}

// A single transcript "word" spanning several seconds is almost always upstream
// glue (a whole sentence returned as one token — e.g. a no-space script split by
// whitespace, or a salvaged/truncated STT response) rather than someone actually
// holding one word that long. Left alone it becomes ONE Dialogue event whose End
// sits seconds/minutes out, so the burned caption looks frozen on that one
// "sentence" for the rest of the clip instead of advancing. Re-split it, lang-aware,
// spreading its own span evenly across the pieces — the same fix as the STT
// synthesize-from-segments fallback (transcribe-clip route), applied as a last-line
// defense here so ANY source of a glued word (including a future one) still
// produces advancing captions.
const LONG_WORD_SEC = 3;
function splitLongWords(words: TranscriptWord[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  const hasSegmenter = typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function";
  const segmenter = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
  for (const w of words) {
    const dur = w.end - w.start;
    const text = w.word.trim();
    if (dur <= LONG_WORD_SEC || text.length <= 1) { out.push(w); continue; }
    const pieces = segmenter
      ? [...segmenter.segment(text)].filter((s) => s.isWordLike && s.segment.trim()).map((s) => s.segment.trim())
      : text.split(/\s+/).filter(Boolean);
    if (pieces.length <= 1) { out.push(w); continue; }
    const step = dur / pieces.length;
    pieces.forEach((word, i) => out.push({ word, start: w.start + i * step, end: w.start + (i + 1) * step }));
  }
  return out;
}

export function renderCaptionsAss(words: TranscriptWord[], opts: RenderCaptionsOpts): string {
  const { clipStartSec, clipEndSec, style, width = 1080, height = 1920, clipPane } = opts;
  const inWin = splitLongWords(words.filter((w) => w.end > clipStartSec && w.start < clipEndSec));
  // PlayRes = the clip PANE when compositing (the ASS is burned on the pane stream),
  // so every position is pane-local: vstack halves the height, hstack the width.
  const playW = clipPane && clipPane.layout === "hstack" ? Math.round(width / 2) : width;
  const playH = clipPane && clipPane.layout === "vstack" ? Math.round(height / 2) : height;
  // Inside a pane, center the caption (clear of the seam / the talking head's mouth)
  // unless the caller explicitly asks for the pane bottom. A dragged yPct always wins
  // outside a pane — alignment 8 (top-anchored) + MarginV as an exact % of the canvas
  // reproduces ANY vertical spot, the same way text_overlay's yPct drives drawtext's y=.
  const draggedYPct = !clipPane && typeof style.yPct === "number" && Number.isFinite(style.yPct)
    ? Math.min(92, Math.max(2, style.yPct))
    : undefined;
  // Dragged → alignment 5 + an explicit \pos on every event (see centreOnYPct
  // below): the WHOLE caption block is centred on yPct, exactly like the Editor
  // preview's `top: yPct%; translateY(-50%)`, however many lines the page wraps to.
  const alignment = clipPane && clipPane.spot !== "bottom" ? 5 : draggedYPct !== undefined ? 5 : ALIGN[style.position];
  const preset = style.preset ? CAPTION_PRESET_BY_ID[style.preset]?.render : undefined;

  // Style-line knobs: presets fully specify their look; the legacy path keeps
  // the historical hardcoded values so existing styles render byte-identically.
  // Non-latin captions override the (latin-only) font with a script font so they
  // don't tofu; latin text (English/Malay/Spanish/…) keeps the preset/Arial font.
  const fontName = fontForText(inWin.map((w) => w.word).join(""), preset?.font ?? "Arial");
  // Landscape (16:9) frames are far SHORTER than portrait, so a portrait-tuned font
  // (56-78px) dominates a wide frame. Cap it to ~7.5% of the (short) height so
  // captions read cleanly in both orientations.
  const landscape = playW > playH;
  const rawFontSize = preset?.fontSize ?? style.fontSize;
  const fontSize = landscape ? Math.min(rawFontSize, Math.round(playH * 0.075)) : rawFontSize;
  const fontColor = preset?.fontColor ?? style.fontColor;
  const italic = preset?.italic ? 1 : 0;
  // Bundled faces carry their weight in the FILE (Montserrat ExtraBold, Poppins
  // Black…). Bold=1 on top made libass faux-embolden them — thicker than the
  // editor preview, which renders the same file at its native weight. Legacy
  // (Arial) and non-latin script fallbacks keep Bold=1.
  const bold = BURN_FONT_FAMILIES.has(fontName) ? 0 : 1;
  // BorderStyle=3 draws the pill in OutlineColour, padded by Outline — a pill
  // preset with outline 0 / no outlineColor (Pod P) burned NO pill at all (black
  // text straight on the video) while the preview showed the chip. Force the box
  // color + a real padding so the burn matches captionPillPadding() in the preview.
  const outline = preset ? (preset.pillBg ? captionPillPadding(preset) : preset.outline) : 3;
  const outlineColor = toAssColor(preset?.pillBg ?? preset?.outlineColor ?? "#000000");
  const shadow = preset ? (preset.shadow ?? 0) : 1;
  // BorderStyle 3 = opaque box per line (Deep Diver pill); BackColour is the box.
  const borderStyle = preset?.pillBg ? 3 : 1;
  const backColor = preset?.pillBg ? toAssColor(preset.pillBg) : "&H64000000";
  // OpusClip parks captions ~19% up from the bottom edge — noticeably higher
  // than our old 120px. Presets adopt that; legacy styles keep 120.
  // Bottom-safe: a "bottom" caption must clear the platform's own caption/description
  // zone, so floor its margin at ~12% of the (pane) height even on the legacy path.
  // Portrait sits ~19% up (OpusClip parity, clear of the platform caption zone).
  // Landscape is short, so 19% floats mid-frame — drop captions to a ~10% lower-third
  // band that reads like standard widescreen subtitles.
  const baseMarginV = preset ? Math.round(playH * (landscape ? 0.10 : 0.19)) : 120;
  const marginV = draggedYPct !== undefined
    // Alignment 8 measures MarginV from the TOP of the line, but the Editor preview
    // CENTERS the caption on yPct (translateY(-50%)) — shift up half a line so the
    // burned caption lands where it was dropped instead of half a line lower.
    ? Math.max(0, Math.round(playH * (draggedYPct / 100) - fontSize / 2))
    : style.position === "bottom" ? Math.max(baseMarginV, Math.round(playH * 0.12)) : baseMarginV;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playW}`, `PlayResY: ${playH}`,
    "ScaledBorderAndShadow: yes",
    // Smart-wrap within MarginL/MarginR so a long caption page never spills off-frame.
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Def,${fontName},${fontSize},${toAssColor(fontColor)},&H000000FF,${outlineColor},${backColor},${bold},${italic},0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},40,40,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
  ];

  // Exact placement for a dragged caption: pin each event's centre to
  // (canvas centre-x, yPct of the height). Events that already position
  // themselves (collage words, left-aligned spawn corners) keep their own \pos.
  const centreOnYPct = (events: string[]): string[] => {
    if (draggedYPct === undefined) return events;
    const pos = `{\\an5\\pos(${Math.round(playW / 2)},${Math.round(playH * draggedYPct / 100)})}`;
    return events.map((e) => {
      if (e.includes("\\pos(")) return e;
      const at = e.indexOf(",Def,");
      return at < 0 ? e : `${e.slice(0, at + 5)}${pos}${e.slice(at + 5)}`;
    });
  };

  if (preset) {
    return [...header, ...centreOnYPct(presetEvents(inWin, preset, clipStartSec, fontColor, style, playW, playH))].join("\n");
  }

  // ── Legacy path (no preset): single-word karaoke or one full line. ──
  // Per-word decoration: preset transforms (uppercase), two-tone emphasis via
  // inline ASS color override, and keyword emoji (Emoji Captions skill).
  const decorate = (raw: string): string => {
    let w = sanitize(raw);
    if (style.uppercase) w = w.toUpperCase();
    // Highlight when a preset provides a color (emphasis words), or when the
    // Keyword Pop skill is on (keyword/emphasis words, gold by default).
    const pop = (style.highlightColor && isEmphasis(raw)) || (style.emoji && (isKeyword(raw) || isEmphasis(raw)));
    if (pop) {
      const color = style.highlightColor ?? "#05F827";
      // Karaoke keyword pop: recolor AND bump the word size so the emphasis reads
      // (a same-size recolor off the yellow base was nearly invisible).
      const scale = style.mode === "karaoke" ? "\\fscx118\\fscy118" : "";
      const reset = scale ? "\\fscx100\\fscy100" : "";
      w = `{\\c${toAssColor(color)}${scale}}${w}{\\c${toAssColor(style.fontColor)}${reset}}`;
    }
    return w;
  };

  const events: string[] = [];
  if (style.mode === "karaoke") {
    for (const w of inWin) {
      events.push(`Dialogue: 0,${toAssTime(w.start - clipStartSec)},${toAssTime(w.end - clipStartSec)},Def,${decorate(w.word)}`);
    }
  } else {
    // 'line' mode: one caption PAGE at a time (chunked at sentence punctuation /
    // speech gaps / ~6 words, like karaoke + the preset engine), NOT the whole
    // in-window transcript joined into one static event — a 20-45s clip would
    // otherwise dump dozens of words on screen at once as an unreadable wall of text.
    for (const page of chunkWords(inWin, 6)) {
      const text = page.map((w) => decorate(w.word)).join(" ");
      if (!text) continue;
      const start = page[0].start - clipStartSec;
      const end = page[page.length - 1].end - clipStartSec;
      events.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Def,${text}`);
    }
  }

  return [...header, ...centreOnYPct(events)].join("\n");
}
