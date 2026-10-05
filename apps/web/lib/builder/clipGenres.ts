/**
 * Content genres for the Source node (OpusClip-style "choose genres that fit
 * your content"). Genre never touches the cached transcript analysis — the
 * analysis stays genre-neutral so one cache row serves every run (see
 * transcribe-clip route). Instead, a genre re-WEIGHTS the per-moment sub-scores
 * (hook/flow/value/trend) the analysis already produced, then re-ranks:
 * deterministic, zero extra LLM cost, cache-safe. "auto" keeps the default
 * virality weighting (same numbers as clipAnalysis overall score).
 */
export interface ClipGenre {
  id: string;
  label: string;
  emoji: string;
  /** Sub-score weights (sum to 1). */
  weights: { hook: number; flow: number; value: number; trend: number };
}

export const CLIP_GENRES: ClipGenre[] = [
  // Default analysis weighting — what "Let AI detect" means: trust the
  // genre-neutral virality ranking the analyzer already computed.
  { id: "auto", label: "Let AI detect", emoji: "✓", weights: { hook: 0.4, flow: 0.2, value: 0.2, trend: 0.2 } },
  // Long-form conversation: coherent self-contained exchanges carry the clip.
  { id: "podcast", label: "Podcast", emoji: "🎙️", weights: { hook: 0.3, flow: 0.3, value: 0.3, trend: 0.1 } },
  // Relatability is the product — trend/theme outranks information.
  { id: "lifestyle", label: "Lifestyle", emoji: "🏡", weights: { hook: 0.35, flow: 0.2, value: 0.15, trend: 0.3 } },
  // Highlight-reel content: the first seconds are everything.
  { id: "sports", label: "Sports", emoji: "🏅", weights: { hook: 0.5, flow: 0.15, value: 0.1, trend: 0.25 } },
  // Conversion content: the viewer must take something away.
  { id: "marketing", label: "Marketing & Webinar", emoji: "📈", weights: { hook: 0.35, flow: 0.15, value: 0.4, trend: 0.1 } },
  { id: "entertainment", label: "Entertainment", emoji: "🎭", weights: { hook: 0.45, flow: 0.2, value: 0.1, trend: 0.25 } },
  // Timeliness over evergreen value.
  { id: "news", label: "News", emoji: "🗞️", weights: { hook: 0.35, flow: 0.15, value: 0.2, trend: 0.3 } },
  { id: "educational", label: "Informative & Educational", emoji: "📚", weights: { hook: 0.25, flow: 0.25, value: 0.4, trend: 0.1 } },
];

export const CLIP_GENRE_BY_ID: Record<string, ClipGenre> = Object.fromEntries(
  CLIP_GENRES.map((g) => [g.id, g]),
);

/** Genre-adjusted overall score from analysis sub-scores; falls back to the
 *  moment's own viralScore when sub-scores are missing (live-selector moments,
 *  pre-v2 analyses) so mixed lists still sort sensibly. */
export function genreScore(
  m: { viralScore?: number; scores?: { hook?: number; flow?: number; value?: number; trend?: number } },
  genreId: string,
): number {
  const g = CLIP_GENRE_BY_ID[genreId];
  const s = m.scores;
  if (!g || g.id === "auto" || !s) return m.viralScore ?? 0;
  return Math.round(
    g.weights.hook * (s.hook ?? 0) +
    g.weights.flow * (s.flow ?? 0) +
    g.weights.value * (s.value ?? 0) +
    g.weights.trend * (s.trend ?? 0),
  );
}
