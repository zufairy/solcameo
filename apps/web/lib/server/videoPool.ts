/**
 * Pool selection for the Hook Videos + Main Content apps.
 *
 * Both apps hold a POOL of operator-uploaded videos rather than a single file (the
 * Video CTA app's shape). Every produced video draws one hook from the hook pool,
 * and — when "No clip / UGC needed" is on — one body from the main pool.
 *
 * Selection is CONTEXTUAL: each upload is transcribed once (through the existing
 * /api/video/transcribe-clip cache, so it is free after the first run) and the
 * candidate whose transcript best matches the clip's own words wins. That is what
 * makes a hook feel authored rather than random.
 *
 * Everything here is PURE. The caller supplies transcripts; this module never
 * fetches, so the matching rules stay unit-testable and cheap to reason about.
 */

/** A pool entry: the stored video URL plus its transcript, once known. */
export interface PoolItem {
  url: string;
  /** Spoken words from the upload. Absent until transcription has run. */
  transcript?: string;
}

// Words that carry no topical signal. Kept deliberately short — an aggressive stop
// list would strip the domain words ("price", "buy") that make a match meaningful.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "so", "of", "to", "in", "on", "at",
  "for", "with", "is", "are", "was", "were", "be", "been", "it", "its", "this",
  "that", "these", "those", "i", "you", "he", "she", "we", "they", "my", "your",
  "our", "their", "me", "him", "her", "them", "as", "by", "from", "up", "out",
  "just", "like", "get", "got", "do", "does", "did", "will", "would", "can",
  "could", "not", "no", "yes", "have", "has", "had", "what", "when", "how", "all",
]);

/** Content words, lowercased and de-duplicated. */
export function keywords(text: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^a-z0-9']+/)) {
    // 3+ chars: shorter tokens are almost all stop words or noise, and matching on
    // them produces confident-looking nonsense.
    if (raw.length >= 3 && !STOP_WORDS.has(raw)) out.add(raw);
  }
  return out;
}

/**
 * Jaccard-style overlap of two keyword sets, normalized by the SMALLER set.
 *
 * Normalizing by the smaller side is what makes a short hook competitive: a 6-word
 * hook that is entirely on-topic should beat a rambling 200-word one that mentions
 * the topic once. Returns 0..1.
 */
export function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (large.has(w)) shared++;
  return shared / small.size;
}

export interface PickArgs {
  /** Candidate videos, in the order the operator uploaded them. */
  pool: PoolItem[];
  /** The text this output is about — the clip's transcript, caption, or topic. */
  clipText?: string;
  /** Which output this is (0-based). Drives the deterministic fallback. */
  index?: number;
  /**
   * Minimum overlap for a match to count. Below it we fall back to cycling rather
   * than pretending a weak match was a choice.
   */
  minScore?: number;
}

export interface PickResult {
  url: string;
  /** How the pick was made — surfaced in run logs so the choice is explainable. */
  reason: "match" | "cycle";
  score: number;
}

/**
 * Choose one video from a pool.
 *
 * Prefers the best transcript match; falls back to CYCLING by index when no
 * candidate clears `minScore` (no transcripts yet, an off-topic pool, or a pool of
 * one). Cycling rather than random means every upload eventually airs and a re-run
 * is reproducible.
 *
 * Returns null only for an empty pool — the caller then behaves as if the app were
 * not installed.
 */
export function pickFromPool({ pool, clipText, index = 0, minScore = 0.12 }: PickArgs): PickResult | null {
  const items = pool.filter((p) => p && typeof p.url === "string" && p.url.trim().length > 0);
  if (items.length === 0) return null;
  if (items.length === 1) return { url: items[0].url, reason: "cycle", score: 0 };

  const clipWords = keywords(clipText);
  if (clipWords.size > 0) {
    let best: { url: string; score: number } | null = null;
    for (const item of items) {
      if (!item.transcript) continue;
      const score = overlapScore(clipWords, keywords(item.transcript));
      // Strict > keeps the FIRST of equally-scoring candidates, so a tie resolves to
      // upload order instead of whichever happened to be scanned last.
      if (!best || score > best.score) best = { url: item.url, score };
    }
    if (best && best.score >= minScore) return { url: best.url, reason: "match", score: best.score };
  }

  // Deterministic round-robin. Negative/huge indexes are normalized so a caller
  // can pass a raw loop counter without thinking about it.
  const i = ((Math.trunc(index) % items.length) + items.length) % items.length;
  return { url: items[i].url, reason: "cycle", score: 0 };
}

/**
 * The uploads that still need transcribing — pool entries with no transcript yet.
 * Callers hand these to the transcribe route (which caches by source), then pass the
 * enriched pool back into {@link pickFromPool}.
 */
export function untranscribed(pool: PoolItem[]): string[] {
  return pool.filter((p) => p?.url && !p.transcript).map((p) => p.url);
}

/** Normalize a stored `string[]` of URLs into pool items. */
export function toPool(urls: readonly string[] | undefined | null, transcripts?: Record<string, string>): PoolItem[] {
  return (urls ?? [])
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .map((url) => ({ url: url.trim(), ...(transcripts?.[url.trim()] ? { transcript: transcripts[url.trim()] } : {}) }));
}
