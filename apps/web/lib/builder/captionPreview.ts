import type { CaptionPresetRender } from "./captionPresets";
import type { TranscriptWord } from "@/lib/server/clipTypes";
import { chunkWords, isKeyword, isEmphasis, makeKeywordGate } from "@/lib/server/captionRenderer";

/**
 * Client-side re-implementation of `presetEvents()` (lib/server/captionRenderer.ts)
 * for the /dev/captions-lab playground — computes, for a given elapsed time,
 * EXACTLY what the burned-in ASS caption would show at that instant, so the
 * preview is a faithful preview and not a hand-approximated one.
 *
 * Reuses `chunkWords`/`isKeyword`/`isEmphasis` from the real renderer directly
 * (pure functions, no server-only APIs) instead of re-deriving them, so page
 * chunking and keyword detection can't silently drift from production.
 *
 * ASS timing this mirrors:
 *  - Color/keyword swaps are INSTANT at word start — no tween (verified OpusClip
 *    mechanic, see captionPresets.ts's file doc).
 *  - `\t(t1,t2,accel,...)` tweens are a POWER curve: progress = ((now-t1)/(t2-t1))^accel.
 *  - Entrance (`entranceTag` in captionRenderer.ts) plays once, timed from the
 *    PAGE's first word's start — not per-word — since in the real ASS output
 *    only word index 0's Dialogue event carries the entrance override tag.
 */

const assEase = (elapsedMs: number, durationMs: number, accel: number): number => {
  if (durationMs <= 0) return 1;
  const x = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return Math.pow(x, accel);
};

/** Sample sentence with deliberate keyword/emphasis hits (see isKeyword/isEmphasis
 *  in captionRenderer.ts) so every preset — including keyword-highlight and
 *  keyword-typography presets — has something to actually demo. Timings are
 *  hand-tuned, not real STT output; ~4.3s of speech + a trailing pause, so the
 *  whole loop reads as one clean "5s preview" per the ask. */
export const PREVIEW_WORDS: TranscriptWord[] = (() => {
  const text = ["This", "is", "the", "number", "1", "secret", "nobody", "ever", "tells", "you", "today."];
  const step = 0.38;
  const lead = 0.2;
  return text.map((word, i) => ({ word, start: lead + i * step, end: lead + i * step + 0.32 }));
})();

/** Trailing silence after the last word before the loop restarts. */
export const PREVIEW_TAIL_SEC = 0.7;
export const PREVIEW_LOOP_SEC =
  PREVIEW_WORDS[PREVIEW_WORDS.length - 1].end + PREVIEW_TAIL_SEC - PREVIEW_WORDS[0].start;

export interface PreviewWordFrame {
  key: string;
  text: string;
  /** true only for the word revealed/active THIS frame — drives the one-shot
   *  scale/blur tween (they reset to steady-state next frame). */
  isNew: boolean;
  color?: string;
  scalePercent: number; // 100 = no scale
  blurPx: number; // 0 = sharp
  underline: boolean;
  keywordFont?: string;
  keywordItalic: boolean;
  /** lineGlow — a genuine halo (CSS text-shadow, multiple soft white glows)
   *  behind still-crisp text, mirroring the real dual-layer ASS technique
   *  (a separate, bigger, more-blurred copy of the word on a layer behind
   *  the sharp one) — NOT a filter:blur on the word itself, which would
   *  fuzz out the letterforms instead of making them shine. */
  glow: boolean;
  /** Aesthetic mixed-type effect (wordFonts) — this word's own resting font,
   *  distinct from keywordFont (keyword wins when both apply). */
  ownFont?: string;
}

export interface PreviewFrame {
  /** Words to render, in order. In "cumulative" reveal this is a PREFIX of
   *  the page (later words simply aren't in the array yet); otherwise it's
   *  the whole page every frame, each with its own color/scale state. */
  words: PreviewWordFrame[];
  /** Force a line break after this many rendered words (Editorial Stack). */
  stackAfter?: number;
  /** Page-level entrance transform, applied to the whole caption block. */
  entranceOpacity: number;
  entranceScalePercent: number;
  /** No page is on screen right now (mid-tail-pause). */
  empty: boolean;
  /** align:"left" — mirrors presetEvents()'s posOverride: left-anchored
   *  instead of the usual centered flow, pinned to top-left or bottom-left
   *  for this page (alternates by page index when spawnCorner:"alternate"). */
  leftAnchor?: { top: boolean };
}

const EMPTY_FRAME: PreviewFrame = { words: [], entranceOpacity: 1, entranceScalePercent: 100, empty: true };

/** Mirrors pickCycle() in lib/server/captionRenderer.ts — round-robins a
 *  per-word cycle array by word position. */
function pickCycle<T>(arr: T[] | undefined, idx: number): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[idx % arr.length];
}

function entranceState(kind: NonNullable<CaptionPresetRender["entrance"]> | undefined, elapsedMs: number) {
  switch (kind) {
    case "fade":
      return { opacity: Math.min(1, elapsedMs / 160), scale: 100 };
    case "float": {
      const opacity = Math.min(1, elapsedMs / 150);
      const scale = 90 + 10 * assEase(elapsedMs, 240, 0.6);
      return { opacity, scale };
    }
    case "pop": {
      const opacity = Math.min(1, elapsedMs / 50);
      const scale = 55 + 45 * assEase(elapsedMs, 190, 0.7);
      return { opacity, scale };
    }
    default:
      return { opacity: 1, scale: 100 };
  }
}

/** Compute the exact on-screen caption state at `tSec` (seconds into ONE loop
 *  of PREVIEW_LOOP_SEC) for the given preset render spec. */
export function computePreviewFrame(preset: CaptionPresetRender, tSec: number): PreviewFrame {
  const pages = chunkWords(PREVIEW_WORDS, Math.max(1, preset.wordsPerPage));
  const entranceKind = preset.entrance ?? (preset.popIn ? "pop" : undefined);
  const scaleTarget = preset.activeScale && preset.activeScale !== 100 ? preset.activeScale : null;
  const kwAny = preset.keywordColor != null || preset.keywordFont != null || preset.keywordItalic === true || preset.keywordScale != null;
  // Mirrors presetEvents(): decide keyword-or-not for EVERY word up front,
  // with ONE gate instance for the whole clip (keywordMaxPerSentence caps
  // highlights per sentence, not per page) — reused from captionRenderer.ts
  // directly so the cap logic can't drift between preview and production.
  const kwGate = makeKeywordGate(preset.keywordMaxPerSentence);
  const allowedKwByPage = pages.map((page) => page.map((w) => kwGate(w.word, kwAny && (isKeyword(w.word) || isEmphasis(w.word)))));

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const allowedKw = allowedKwByPage[pageIdx];
    const pageStart = page[0].start;
    const pageEnd = page[page.length - 1].end;
    if (tSec < pageStart || tSec >= pageEnd) continue;

    // Active word: the one whose span [start, next word's start) contains t —
    // mirrors the per-word Dialogue `end` in presetEvents() (holds until the
    // next word starts, or the page ends for the last word).
    let activeIdx = page.length - 1;
    for (let i = 0; i < page.length; i++) {
      const wordEnd = i + 1 < page.length ? page[i + 1].start : pageEnd;
      if (tSec >= page[i].start && tSec < wordEnd) { activeIdx = i; break; }
    }

    // In the real ASS output the entrance override tag is stamped ONLY onto
    // word 0's own Dialogue event (`hasEntrance = entrance != null && i === 0`
    // in presetEvents()) — every later word's event is a fresh Dialogue line
    // with no leading transform, so it snaps to full scale/opacity the instant
    // word 0's event ends, even mid-tween. Reproduce that snap instead of
    // letting the tween keep gliding across the whole page.
    const { opacity: entranceOpacity, scale: entranceScalePercent } = activeIdx === 0
      ? entranceState(entranceKind, (tSec - pageStart) * 1000)
      : { opacity: 1, scale: 100 };

    if (preset.reveal === "cumulative") {
      const lineSwap = preset.lineOrderAlternate === true && pageIdx % 2 === 1;
      const leftAnchor = preset.align === "left"
        ? { top: preset.spawnCorner === "alternate" ? pageIdx % 2 === 0 : preset.spawnCorner === "topLeft" }
        : undefined;
      const words: PreviewWordFrame[] = [];
      for (let j = 0; j <= activeIdx; j++) {
        const isNew = j === activeIdx;
        const isKw = allowedKw[j];
        // Aesthetic mixed-type (wordFonts/wordScales/wordColors) — this
        // word's own resting font/size/color, cycled by position. Keyword
        // wins over ownFont/ownColor where both apply; ownScale is the
        // PERMANENT resting size (stays after the word is no longer "new"),
        // unlike the temporary activeScale pop below.
        const ownFont = pickCycle(preset.wordFonts, j);
        const ownColor = pickCycle(preset.wordColors, j);
        const ownScale = pickCycle(preset.wordScales, j);
        // Per-LINE styling — see captionRenderer.ts's presetEvents() doc:
        // stackAfter only ever inserts ONE line break, so there are only
        // ever two "lines" (before/after that index), not a repeating group.
        const rawLineIdx = preset.stackAfter != null && j >= preset.stackAfter ? 1 : 0;
        const lineIdx = lineSwap ? 1 - rawLineIdx : rawLineIdx;
        const lineFont = pickCycle(preset.lineFonts, lineIdx);
        const lineColor = pickCycle(preset.lineColors, lineIdx);
        const lineGlow = pickCycle(preset.lineGlow, lineIdx) === true;
        const lineScale = pickCycle(preset.lineScales, lineIdx) ?? 1;
        const wordElapsedMs = isNew ? (tSec - page[j].start) * 1000 : Infinity;
        // keywordScale is a PERMANENT (untweened) size, same as keywordColor
        // — takes priority over ownScale, same as keyword font/color do.
        // lineScale (the whole line reads bigger) stacks on top either way.
        const restingScale = (isKw && preset.keywordScale != null
          ? preset.keywordScale * 100
          : ownScale != null ? ownScale * 100 : 100) * lineScale;
        // Mirrors presetEvents(): the active-word tween explicitly resets to
        // 100% before animating, so it clobbers ownScale/keywordScale for the
        // word's "new" moment rather than tweening FROM it — faithful to
        // that real (slightly quirky) production behavior rather than
        // smoothing it over here only.
        const scalePercent = isNew && scaleTarget != null
          ? 100 + (scaleTarget - 100) * assEase(wordElapsedMs, 150, 0.6)
          : restingScale;
        const blurPx = isNew && preset.blurIn ? 6 * (1 - assEase(wordElapsedMs, 180, 1)) : 0;
        words.push({
          key: `${page[j].start}`,
          text: preset.allCaps ? page[j].word.toUpperCase() : page[j].word,
          isNew,
          color: isKw ? preset.keywordColor : (lineColor ?? (isNew && preset.activeColor ? preset.activeColor : ownColor)),
          scalePercent,
          blurPx,
          glow: lineGlow,
          underline: false,
          keywordFont: isKw ? preset.keywordFont : undefined,
          keywordItalic: isKw && preset.keywordItalic === true,
          ownFont: isKw ? undefined : (lineFont ?? ownFont),
        });
      }
      return { words, stackAfter: preset.stackAfter, entranceOpacity, entranceScalePercent, empty: false, leftAnchor };
    }

    const words: PreviewWordFrame[] = page.map((w, j) => {
      const isActive = j === activeIdx;
      const isSpoken = j < activeIdx;
      const isKw = allowedKw[j];
      const wordElapsedMs = isActive ? (tSec - w.start) * 1000 : 0;
      const hasEntranceHere = entranceKind != null && j === 0; // word 0's own tween is superseded by the page entrance visually, but scale still applies additively on real word0 in the renderer — kept 100 here since entrance already carries the visual.
      const ownFont = pickCycle(preset.wordFonts, j);
      const ownColor = pickCycle(preset.wordColors, j);
      const ownScale = pickCycle(preset.wordScales, j);
      let color: string | undefined = ownColor;
      if (isKw) color = preset.keywordColor;
      else if (isActive) color = preset.activeColor ?? (preset.spokenColor ? preset.spokenColor : ownColor);
      else if (isSpoken && preset.spokenColor) color = preset.spokenColor;
      const restingScale = isKw && preset.keywordScale != null
        ? preset.keywordScale * 100
        : ownScale != null ? ownScale * 100 : 100;
      const scalePercent = isActive && scaleTarget != null && !hasEntranceHere
        ? 100 + (scaleTarget - 100) * assEase(wordElapsedMs, 150, 0.6)
        : restingScale;
      return {
        key: `${w.start}`,
        text: preset.allCaps ? w.word.toUpperCase() : w.word,
        isNew: isActive,
        color,
        scalePercent,
        blurPx: 0,
        glow: false,
        underline: isActive && preset.activeUnderline === true,
        keywordFont: isKw ? preset.keywordFont : undefined,
        ownFont: isKw ? undefined : ownFont,
        keywordItalic: isKw && preset.keywordItalic === true,
      };
    });
    return { words, entranceOpacity, entranceScalePercent, empty: false };
  }

  return EMPTY_FRAME;
}

// ── Collage layout (layout: "collage") — a completely different render
// mode: every word is independently, absolutely positioned instead of
// flowing in one centered line. Mirrors collageLayout()/collageEvents() in
// lib/server/captionRenderer.ts byte-for-byte (same heuristics, same
// JITTER_CYCLE) so the preview matches the real burn, not an approximation.

export interface CollageWordSlot {
  key: string;
  text: string;
  /** Position in the SAME 1080×1920 canvas space the real renderer computes
   *  in — CaptionStage converts with the same framePx/1080 scale it already
   *  uses for fontSize/outline. */
  xCenter: number;
  y: number;
  fontPx: number;
  rotDeg: number;
  color?: string;
  fontFamily: string;
  italic: boolean;
  opacity: number; // 0→1 fade-in, own per-word timer
}

export interface CollageFrame {
  slots: CollageWordSlot[];
  empty: boolean;
}

const JITTER_CYCLE = [-1, 1, 0, -0.6, 0.8, -0.3];

interface CollageLayoutSlot { j: number; xCenter: number; y: number; fontPx: number; rotDeg: number }

function collageLayoutPage(page: TranscriptWord[], preset: CaptionPresetRender, globalWordIdx0: number, allowedKw: boolean[]): CollageLayoutSlot[] {
  const PLAY_W = 1080;
  const PLAY_H = 1920;
  const CHAR_W = 0.62;
  const PAD = 0.4;
  const maxRowWidth = PLAY_W * 0.86;
  const maxRows = 3;

  type RowWord = { j: number; w: number; fontPx: number };
  const rows: RowWord[][] = [[]];
  let rowWidth = 0;
  for (let j = 0; j < page.length; j++) {
    const gIdx = globalWordIdx0 + j;
    // Size a word off the SAME final size it will actually render at
    // (keywordScale when it's a highlighted word, wordScales cycle
    // otherwise) — sizing off wordScales while it renders bigger via
    // keywordScale is exactly what caused real overlap in production.
    const sizeMul = allowedKw[j] && preset.keywordScale ? preset.keywordScale : (pickCycle(preset.wordScales, gIdx) ?? 1);
    const fontPx = preset.fontSize * sizeMul;
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
  const anchorY = PLAY_H * 0.81;
  let y = anchorY - totalHeight / 2 + rowHeights[0] / 2;

  const slots: CollageLayoutSlot[] = [];
  rows.forEach((row, ri) => {
    const rowTotalW = row.reduce((s, r) => s + r.w, 0);
    let x = (PLAY_W - rowTotalW) / 2;
    for (const { j, w, fontPx } of row) {
      const gIdx = globalWordIdx0 + j;
      const jitter = pickCycle(JITTER_CYCLE, gIdx + 3) ?? 0;
      slots.push({
        j, xCenter: x + w / 2, y: y + jitter * fontPx * 0.14, fontPx,
        rotDeg: pickCycle(preset.wordRotations, gIdx) ?? 0,
      });
      x += w;
    }
    y += rowHeights[ri];
  });
  return slots;
}

/** Compute every word slot visible at `tSec` for a layout:"collage" preset —
 *  a word is "born" (fades in) at its own spoken time and stays for the rest
 *  of its page, same overlapping-events model as the real renderer. */
export function computeCollageFrame(preset: CaptionPresetRender, tSec: number): CollageFrame {
  const pages = chunkWords(PREVIEW_WORDS, Math.max(1, preset.wordsPerPage));
  const kwAny = preset.keywordColor != null || preset.keywordFont != null || preset.keywordItalic === true || preset.keywordScale != null;
  const baseFontName = preset.font ?? "Arial";
  // ONE gate for the whole clip (keywordMaxPerSentence caps per sentence,
  // not per page) — computed up front over ALL pages so it's correct
  // regardless of which page tSec lands in.
  const kwGate = makeKeywordGate(preset.keywordMaxPerSentence);
  const allowedKwByPage = pages.map((page) => page.map((w) => kwGate(w.word, kwAny && (isKeyword(w.word) || isEmphasis(w.word)))));

  let globalWordIdx = 0;
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageEnd = page[page.length - 1].end;
    if (tSec < page[0].start || tSec >= pageEnd) { globalWordIdx += page.length; continue; }

    const allowedKw = allowedKwByPage[pageIdx];
    const layout = collageLayoutPage(page, preset, globalWordIdx, allowedKw);
    const slots: CollageWordSlot[] = [];
    for (const slot of layout) {
      const w = page[slot.j];
      if (tSec < w.start) continue; // not born yet this page
      const gIdx = globalWordIdx + slot.j;
      const isKw = allowedKw[slot.j];
      const fontFamily = isKw ? (preset.keywordFont ?? baseFontName) : (pickCycle(preset.wordFonts, gIdx) ?? baseFontName);
      const color = isKw ? preset.keywordColor : pickCycle(preset.wordColors, gIdx);
      const trueFontPx = isKw && preset.keywordScale ? preset.fontSize * preset.keywordScale : slot.fontPx;
      const wordElapsedMs = (tSec - w.start) * 1000;
      const opacity = Math.min(1, wordElapsedMs / 160);
      // Mirrors collageEvents(): land at 135% and ease DOWN to true size over
      // 220ms (accel 0.55 = decelerate/overshoot-settle) instead of a flat pop.
      const bounceProgress = assEase(wordElapsedMs, 220, 0.55);
      const fontPx = trueFontPx * (1.35 - 0.35 * bounceProgress);
      slots.push({
        key: `${w.start}`,
        text: preset.allCaps ? w.word.toUpperCase() : w.word,
        xCenter: slot.xCenter, y: slot.y, fontPx, rotDeg: slot.rotDeg,
        color, fontFamily, italic: isKw && preset.keywordItalic === true, opacity,
      });
    }
    return { slots, empty: slots.length === 0 };
  }
  return { slots: [], empty: true };
}
