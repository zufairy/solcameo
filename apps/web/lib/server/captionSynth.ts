import type { TranscriptWord } from "./clipTypes";

/** Evenly-timed word track from a known script — the caption fallback when STT
 *  yields nothing. Reading pace ≈ real speech (leaves a short lead-in/out). */
export function synthesizeWordsFromScript(script: string, durationSeconds: number): TranscriptWord[] {
  const tokens = script.trim().split(/\s+/).filter(Boolean).slice(0, 400);
  if (tokens.length === 0 || !(durationSeconds > 0.5)) return [];
  const lead = Math.min(0.4, durationSeconds * 0.05);
  const usable = Math.max(0.5, durationSeconds - lead * 2);
  const per = usable / tokens.length;
  return tokens.map((word, i) => ({ word, start: lead + i * per, end: lead + (i + 1) * per }));
}
