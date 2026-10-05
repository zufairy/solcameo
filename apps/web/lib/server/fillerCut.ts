import type { TranscriptWord } from "./clipTypes";

/**
 * Filler-word removal ("Filler Cut" skill). Pure math here — the clip route
 * turns the ranges into an ffmpeg trim+concat pre-pass. All times CLIP-RELATIVE.
 */
export interface CutRange { start: number; end: number }

const CORE_FILLER = /^(um+|uh+|erm+|uhm+|hm+|mhm+|mm+)[.,!?;:]*$/i;
const AGGRESSIVE_SINGLE = /^(basically|literally|actually)[.,!?;:]*$/i;
const AGGRESSIVE_BIGRAMS: [RegExp, RegExp][] = [
  [/^you[.,]?$/i, /^know[.,!?;:]*$/i],
  [/^i[.,]?$/i, /^mean[.,!?;:]*$/i],
  [/^sort[.,]?$/i, /^of[.,!?;:]*$/i],
  [/^kind[.,]?$/i, /^of[.,!?;:]*$/i],
];

const PAD = 0.03;       // keep a hair of audio around the cut so it doesn't click
const MERGE_GAP = 0.12; // merge cuts separated by less than this
const MAX_CUTS = 30;    // ffmpeg filter-graph sanity cap

/** Find filler ranges (clip-relative seconds) inside [clipStart, clipEnd]. */
export function computeFillerRanges(
  words: TranscriptWord[],
  clipStart: number,
  clipEnd: number,
  aggressive = false,
): CutRange[] {
  const inWin = words
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({ ...w, start: Math.max(0, w.start - clipStart), end: Math.min(clipEnd - clipStart, w.end - clipStart) }));

  const raw: CutRange[] = [];
  for (let i = 0; i < inWin.length; i++) {
    const w = inWin[i];
    if (CORE_FILLER.test(w.word) || (aggressive && AGGRESSIVE_SINGLE.test(w.word))) {
      raw.push({ start: w.start, end: w.end });
      continue;
    }
    if (aggressive && i + 1 < inWin.length) {
      const next = inWin[i + 1];
      if (AGGRESSIVE_BIGRAMS.some(([a, b]) => a.test(w.word) && b.test(next.word))) {
        raw.push({ start: w.start, end: next.end });
        i++;
      }
    }
  }
  if (raw.length === 0) return [];

  // Pad, clamp, sort, merge.
  const dur = clipEnd - clipStart;
  const padded = raw
    .map((r) => ({ start: Math.max(0, r.start - PAD), end: Math.min(dur, r.end + PAD) }))
    .sort((a, b) => a.start - b.start);
  const merged: CutRange[] = [];
  for (const r of padded) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < MERGE_GAP) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  // Cap: keep the longest cuts (most impact) if a rambling video has too many.
  return merged.length <= MAX_CUTS
    ? merged
    : [...merged].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, MAX_CUTS).sort((a, b) => a.start - b.start);
}

/** Complement of the cuts: the keep-windows (clip-relative) for trim+concat. */
export function keepRanges(cuts: CutRange[], durationSec: number): CutRange[] {
  const keeps: CutRange[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start - cursor > 0.05) keeps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (durationSec - cursor > 0.05) keeps.push({ start: cursor, end: durationSec });
  return keeps;
}

/** Map an original clip-relative time onto the post-cut timeline. */
export function remapTime(t: number, cuts: CutRange[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t >= c.end) removed += c.end - c.start;
    else if (t > c.start) return c.start - removed; // inside a cut → snap to its start
    else break;
  }
  return t - removed;
}

/** Remap words onto the post-cut timeline, dropping words inside cuts. */
export function remapWords(words: TranscriptWord[], cuts: CutRange[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of words) {
    const insideCut = cuts.some((c) => w.start >= c.start - 1e-3 && w.end <= c.end + 1e-3);
    if (insideCut) continue;
    const start = remapTime(w.start, cuts);
    const end = Math.max(start + 0.05, remapTime(w.end, cuts));
    out.push({ ...w, start, end });
  }
  return out;
}
