import { CLIP_SKILL_PRICE_USDC, CLIP_SOURCE_MINUTE_ID } from "./servicePrices";

/**
 * Credit math for the Editor tab's clipping runs — see the big comment on
 * `CLIP_SOURCE_MINUTE_ID` in servicePrices.ts for the pricing rationale
 * (OpusClip charges by source length, not clip count; this mirrors that).
 *
 * 1 credit = $0.01 (lib/economy/nav.ts — the existing, platform-wide
 * conversion; not redefined here).
 */
const USD_PER_CREDIT = 0.01;

/** Per-minute price in credits, derived from the single source of truth
 *  (servicePrices.ts) so a price-tuning edit there can't silently drift out
 *  of sync with what the UI displays. */
export function creditsPerMinute(): number {
  return Math.round((CLIP_SKILL_PRICE_USDC[CLIP_SOURCE_MINUTE_ID] ?? 0) / USD_PER_CREDIT);
}

/** Credits for a run whose source is `durationSeconds` long. Rounds UP to the
 *  next full minute — same rule OpusClip uses ("a 30-minute original video
 *  consumes 30 credits"; under a minute still rounds up to 1) — with a
 *  1-minute floor so an unknown/zero duration never estimates as free. */
export function estimateClipRunCredits(durationSeconds: number | null | undefined): number {
  const minutes = Math.max(1, Math.ceil((durationSeconds ?? 0) / 60));
  return minutes * creditsPerMinute();
}

/** Even, LIVE-recomputed share of the run's total cost across however many
 *  clips exist for it right now. Call this on every render as clips are
 *  discovered/removed (React re-renders automatically off the same live
 *  Convex/store data the clip list itself comes from) — it deliberately does
 *  NOT cache a stale up-front guess, so a run that ends up with fewer clips
 *  than requested shows each survivor's TRUE share, not an underestimate.
 *  Rounds to 2dp purely for display; the actual charge is always the
 *  whole-run total, never split per clip. */
export function perClipCredits(totalCredits: number, clipCount: number): number {
  if (!(clipCount > 0)) return totalCredits;
  return +(totalCredits / clipCount).toFixed(2);
}
