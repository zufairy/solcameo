// JEV moment picker — pure ranking logic (no I/O), ported from
// github.com/Anmol-Srv/jev-video-search (core.search / server.run_search).
//
// That repo searches video by what happens in it: a cheap retriever shortlists
// candidate scenes (~30ms), then Jev — Typesafe's judge model — scores each one
// against the query and can say "nothing here matches". Here the "scenes" are
// transcript windows of a system video, so a clip is picked by a query instead
// of an LLM reading the whole transcript: seconds instead of a minute.

export type Seg = { start: number; end: number; text: string };

export type Candidate = {
  id: number;
  start: number;
  end: number;
  text: string;
  /** retriever score (cosine for embeddings, BM25 for lexical) */
  sim: number;
  /** 1-based rank in the retriever order */
  simRank: number;
  /** Jev probability 0..1, null when Jev could not score it */
  jev: number | null;
};

export type Window = Omit<Candidate, "sim" | "simRank" | "jev">;

// Calibrated to jev-1.13.0 in the source repo (FINDINGS.md): below this Jev is
// saying "this does not show the query".
export const JEV_FLOOR = 0.55;

export type Word = { word: string; start: number; end: number };

/**
 * Fine sentence units from word timings. Provider segments can be minutes long
 * (a sparse or chunked STT emits one segment per chunk), which leaves no window
 * inside [minLen, maxLen]; words split at sentence ends, pauses, and a length
 * cap always give cut points. Falls back to the provider segments when the
 * transcript has too few words to rebuild from.
 */
export function resegment(words: Word[], segs: Seg[], maxUnit = 8, pause = 0.7): Seg[] {
  const ws = words
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start && w.word?.trim())
    .sort((a, b) => a.start - b.start);
  if (ws.length < 20) return segs;
  const out: Seg[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: Math.max(cur[cur.length - 1].end, cur[0].start + 0.1), text: cur.map((w) => w.word.trim()).join(" ") });
    cur = [];
  };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (cur.length && (w.start - cur[cur.length - 1].end > pause || w.end - cur[0].start > maxUnit)) flush();
    cur.push(w);
    if (/[.!?…]["')\]]?$/.test(w.word.trim())) flush();
  }
  flush();
  return out;
}

/**
 * Candidate clip windows from sentence segments. Every window starts AND ends on
 * a segment boundary (no mid-sentence cuts). From each start segment we emit the
 * first window that reaches `minLen` and the longest one that stays ≤ `maxLen`,
 * so the ranker can prefer a tight or a fuller cut of the same moment.
 */
export function buildWindows(segs: Seg[], minLen: number, maxLen: number): Window[] {
  const clean = segs
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.text?.trim())
    .sort((a, b) => a.start - b.start);
  const out: Window[] = [];
  const seen = new Set<string>();
  const push = (i: number, j: number) => {
    const key = `${i}:${j}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: out.length,
      start: clean[i].start,
      end: clean[j].end,
      text: clean.slice(i, j + 1).map((s) => s.text.trim()).join(" "),
    });
  };
  for (let i = 0; i < clean.length; i++) {
    let firstFit = -1;
    let lastFit = -1;
    for (let j = i; j < clean.length; j++) {
      const len = clean[j].end - clean[i].start;
      if (len > maxLen) break;
      if (len >= minLen) {
        if (firstFit < 0) firstFit = j;
        lastFit = j;
      }
    }
    if (firstFit >= 0) push(i, firstFit);
    if (lastFit >= 0) push(i, lastFit);
  }
  if (out.length || !clean.length) return out;

  // Fallback — mirrors core.py's `scenes()`: `return segs or [(0.0, dur)]`, which
  // NEVER leaves the caller with zero candidates. No sentence-boundary combo fit
  // [minLen, maxLen] (a short video, a transcript whose few segments each span
  // minutes, or word timings too sparse/wide for resegment to split finely) — so
  // slice the transcript's own time span into windows near the target length
  // instead of failing outright, pulling text from whatever overlaps each slice.
  const start0 = clean[0].start;
  const end0 = clean[clean.length - 1].end;
  const span = end0 - start0;
  if (span <= 0) return out;
  const step = Math.min(maxLen, Math.max(span, minLen));
  for (let t = start0; t < end0 - 0.001; t += step) {
    const wEnd = Math.min(t + step, end0);
    const text = clean.filter((s) => s.start < wEnd && s.end > t).map((s) => s.text.trim()).join(" ");
    if (text.trim()) out.push({ id: out.length, start: t, end: wEnd, text });
  }
  return out;
}

const STOP = new Set(
  "a an the and or but of to in on at for with is are was were be been it this that these those i you he she we they my your his her our their me him them as by from so if then than just really very do does did not no yes".split(" "),
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Okapi BM25 — the lexical retriever used when no local embedding model is up. */
export function bm25Scores(query: string, docs: string[], k1 = 1.4, b = 0.75): number[] {
  const q = [...new Set(tokenize(query))];
  const toks = docs.map(tokenize);
  const N = docs.length || 1;
  const avg = toks.reduce((n, t) => n + t.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  return toks.map((t) => {
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avg)));
    }
    return score;
  });
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** Top-k indices by descending score (stable on ties). */
export function topK(scores: number[], k: number): number[] {
  return scores
    .map((s, i) => [s, i] as const)
    .sort((x, y) => y[0] - x[0] || x[1] - y[1])
    .slice(0, k)
    .map(([, i]) => i);
}

/**
 * Shortlist for a lexical retriever. BM25 scores 0 for every window that shares
 * no word with the query ("a funny moment" rarely appears in speech), and plain
 * top-k would then hand Jev the first k windows of the video. Keep the lexical
 * hits, then fill the rest with windows spread evenly across the whole video so
 * Jev — which judges meaning, not words — still sees all of it.
 */
export function lexicalShortlist(scores: number[], k: number): number[] {
  const hits = topK(scores, k).filter((i) => scores[i] > 0);
  const room = Math.min(k, scores.length) - hits.length;
  if (room <= 0) return hits;
  const taken = new Set(hits);
  const rest = scores.map((_, i) => i).filter((i) => !taken.has(i));
  const step = rest.length / room;
  for (let n = 0; n < room; n++) hits.push(rest[Math.floor(n * step)]);
  return hits;
}

/**
 * Rank by Jev, retriever position as the tiebreak. Candidates Jev could not score
 * keep their retriever rank below everything Jev saw — same rule as the source
 * repo, so a Jev outage degrades to plain retrieval instead of an empty result.
 */
export function rankCandidates(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => (b.jev ?? -1) - (a.jev ?? -1) || a.simRank - b.simRank);
}

/** Greedy non-overlapping pick in rank order. */
export function pickNonOverlapping(ranked: Candidate[], max: number, gapSeconds = 0): Candidate[] {
  const picked: Candidate[] = [];
  for (const c of ranked) {
    if (picked.length >= max) break;
    if (picked.some((p) => c.start < p.end + gapSeconds && c.end > p.start - gapSeconds)) continue;
    picked.push(c);
  }
  return picked;
}

/** A no-LLM title: the opening words of the window, trimmed at a word. */
export function titleFromText(text: string, maxWords = 9): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const t = words.slice(0, maxWords).join(" ");
  return words.length > maxWords ? `${t.replace(/[,.;:!?]+$/, "")}…` : t;
}

// A word that carries no content on its own — stripped before judging whether
// a query names something specific to look for, or is really "find me the
// best parts" with the actual judgment left to whoever's watching.
const GENERIC_WORDS = new Set(
  ("best top great good nice cool amazing awesome interesting viral standout " +
   "highlight highlights moment moments part parts clip clips section sections " +
   "scene scenes bit bits segment segments the a an of in on this video for " +
   "me find show get most").split(" "),
);

/**
 * True when a query has no content words left after stripping vibe/filler
 * terms — "best moments", "highlights", "find the good parts" all reduce to
 * nothing. A query like that names no subject for Jev to match a caption
 * against, so literal semantic matching correctly (but unhelpfully) finds
 * nothing: there is nothing in the footage that specifically "depicts best
 * moments". It needs judgment over the whole video instead — see
 * lib/server/jev/jevClient.ts pickBestMoments().
 */
export function isGenericQuery(query: string): boolean {
  const content = tokenize(query).filter((w) => !GENERIC_WORDS.has(w));
  return content.length === 0;
}

// Cheap, no-network pre-filter for generic "best moments" mode — plays the
// role BM25 plays for a content query: narrow hundreds of windows down to a
// pool worth spending one LLM call on, without spending a call to do it.
// Signals correlate with "clippable" moments in creator-economy short-form
// (hooks, stakes, reveals, humor) without claiming to BE the judgment itself
// — the Kie call still does the actual picking.
const INTEREST_WORDS =
  /(never|always|secret|mistake|shocked|shocking|crazy|insane|honestly|actually|literally|wow|omg|unbelievable|worst|best|huge|massive|million|thousand|percent|free|win|won|lost|lose|fail|failed|scared|afraid|scary|died|die|kill|love|hate|amazing|incredible|wait|stop|truth|lie|lying|nobody|everyone|changed|change|realized|realize|turns? out)/i;

export function heuristicInterest(text: string): number {
  let score = 0;
  score += (text.match(/!/g) ?? []).length * 1.2;
  score += (text.match(/\?/g) ?? []).length * 0.6;
  score += (text.match(/\$\s?\d|\d+\s?(%|percent)/gi) ?? []).length * 1;
  score += (text.match(INTEREST_WORDS) ?? []).length * 1.5;
  // A little length credit — a one-liner rarely carries a full beat.
  score += Math.min(1, text.length / 200);
  return score;
}
