import type { CutRange } from "./fillerCut";

/** mulberry32 — small, fast, deterministic PRNG. Same numeric seed always
 *  produces the same sequence; different seeds diverge immediately. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random "jump cut" ranges — pure TIME-based micro-trims, NOT tied to filler
 * words, silence, or any script at all ("Filler Cut" in the Specials panel's
 * random-cuts mode). Lets the SAME source produce a genuinely different-
 * looking render on every burn (the operator's "doesn't have to be a
 * straight script, make more variations" ask) — a different `seed` yields a
 * different cut pattern, the same seed reproduces the same one. Output is the
 * same CutRange shape fillerCut.ts's keepRanges/remapWords/remapTime already
 * consume, so the existing trim+concat rendering machinery applies it
 * identically to a filler cut.
 */
export function computeRandomJumpCuts(
  durationSec: number,
  seed: number,
  opts: { count?: number; cutLenRange?: [number, number]; edgeMarginSec?: number } = {},
): CutRange[] {
  const margin = opts.edgeMarginSec ?? 1.5;
  const usable = durationSec - margin * 2;
  if (usable <= 2) return []; // too short to cut without eating the hook/outro
  const rand = mulberry32(seed);
  const count = opts.count ?? Math.max(1, Math.min(4, Math.floor(durationSec / 8)));
  const [loLen, hiLen] = opts.cutLenRange ?? [0.15, 0.5];
  const raw: CutRange[] = [];
  for (let i = 0; i < count; i++) {
    const t = margin + rand() * usable;
    const len = loLen + rand() * (hiLen - loLen);
    raw.push({ start: t, end: Math.min(durationSec - margin, t + len) });
  }
  raw.sort((a, b) => a.start - b.start);
  const merged: CutRange[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < 0.1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
