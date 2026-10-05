import { callClaudeJSON } from "./kie-claude";
import type { Transcript } from "./clipTypes";
import { dedupeOverlappingMoments } from "./clipMomentSelector";

/** OpusClip-style virality rubric — each 0-100. */
export interface ViralityScores {
  hook: number;   // does the first 3s stop the scroll?
  flow: number;   // is it self-contained + coherent?
  value: number;  // does the viewer learn/feel something?
  trend: number;  // does it ride a relatable/current theme?
}

/** One scored, clip-ready highlight (the "high-impact timing" the operator wants). */
export interface AnalyzedMoment {
  startSeconds: number;
  endSeconds: number;
  title: string;        // punchy hook / title for this moment
  viralScore: number;   // 0-100 overall (weighted from scores)
  scores?: ViralityScores;
  emotion: string;      // e.g. "funny", "shocking", "inspiring", "informative"
  reason: string;       // why it's clip-worthy
  captionText: string;  // a hook caption idea
}
export interface ClipAnalysis {
  moments: AnalyzedMoment[]; // ranked best-first
  chapters: { startSeconds: number; title: string }[];
  summary: string;
  version: number;
  /** True when the LLM failed and `moments` are evenly-spaced placeholders
   *  ("Clip 1", "Clip 2"…). Callers must NOT cache it — a cached fallback used to
   *  serve content-blind slices to every later run of the same video. */
  fallback?: boolean;
}

/** Bump when the analysis shape/prompt changes so cached rows re-process.
 *  5: invalidates rows that cached the evenly-spaced fallback or pre-dedupe pools
 *  (the "15 clips but 5 are identical" bug). */
export const ANALYSIS_VERSION = 5;

/**
 * Char budget for a SINGLE analysis call. Equals the historical `.slice(0, 45000)`
 * bound: any transcript whose joined `segText` fits in this takes the EXACT
 * pre-existing single-call path (same latency, same output, same cache validity).
 * Only transcripts LARGER than this are time-windowed.
 */
const SINGLE_CALL_CHAR_BUDGET = 45000;
/** Time-window width (seconds) for long-transcript analysis. ~25 min ≈ well under
 *  the char budget at normal speech density, so a window prompt is never truncated.
 *  A 4h source → ~10 windows. */
export const ANALYSIS_WINDOW_SECONDS = 1500;
/** Max concurrent window analyses. Bounded so parallel KIE calls don't trip the
 *  provider's rate limit (the transcribe step already notes this hazard). Analysis
 *  runs AFTER transcription, so this doesn't stack with transcribe concurrency. */
export const ANALYSIS_CONCURRENCY = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Result of analyzing one window: parsed moments (global timestamps) + the
 *  window's chapters/summary so the merge step can stitch whole-video metadata. */
interface WindowResult {
  moments: AnalyzedMoment[];
  chapters: { startSeconds: number; title: string }[];
  summary: string;
}

/**
 * One-time LLM analysis over a transcript → ranked viral moments + chapters.
 * This is the expensive "think about the whole video" pass; cache it so every
 * agent reuses it. Deterministic fallback (evenly-spaced) on LLM failure so the
 * result is NEVER empty — the clipper always has something to cut.
 *
 * Short transcripts (joined segText <= SINGLE_CALL_CHAR_BUDGET) take ONE LLM
 * call — byte-for-byte the historical behavior. Long transcripts are split into
 * fixed-time windows, each analyzed in parallel (bounded), then merged + globally
 * re-ranked so the returned moments SPAN THE WHOLE video instead of clustering in
 * the opening (the truncation bug). Output shape is identical either way, so all
 * callers (clipJobs, the routes) are transparent.
 */
export async function analyzeTranscript(
  transcript: Transcript,
  opts: { apiKey?: string; maxMoments?: number; targetCount?: number; clipLength?: { min: number; max: number }; autoPlan?: boolean } = {},
): Promise<ClipAnalysis> {
  const dur = transcript.durationSeconds || transcript.segments.at(-1)?.end || 0;
  // Extract as MANY good clips as the source supports (OpusClip-style) — ~1 per
  // 3 min of source, floored at 3 and capped for cost/time sanity. An explicit
  // opts.maxMoments still overrides. This is the FULL-duration count and is the
  // final cap applied AFTER the window merge for long sources.
  // autoPlan ("Let AI decide") asks for as many strong clips as the source
  // supports. Keep the ~1-per-3-min density but raise the FLOOR so even a short
  // source surfaces a healthy pool (the duration floor of 3 collapses to 1-2 after
  // dedupe on a 3-5 min video). An explicit maxMoments still wins.
  const floor = opts.autoPlan ? 8 : 3;
  // Pool ceiling: default 30. When the operator asked for a high clip count
  // (targetCount up to 60), raise the ceiling so a LONG source surfaces more
  // DISTINCT moments before the caller falls back to per-moment variations
  // (distinct beats variations for quality). The ~1-per-3-min DENSITY is unchanged,
  // so a short source is unaffected — only the ceiling on a long one moves.
  const ceiling = clamp(Math.round(opts.targetCount ?? 0), 30, 60);
  const maxMoments = opts.maxMoments ?? clamp(Math.round(dur / 180), floor, ceiling);
  const { min = 15, max = 60 } = opts.clipLength ?? {};

  // The joined transcript text, as historically sliced. Its full length decides
  // the path: if it fits the single-call budget, behave EXACTLY as before.
  const fullSegText = transcript.segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n");

  // ── FAST PATH (short sources): identical to the historical single call ──
  if (fullSegText.length <= SINGLE_CALL_CHAR_BUDGET) {
    const win = await analyzeWindow(transcript.segments, dur, { min, max, maxMoments, apiKey: opts.apiKey });
    if (win && win.moments.length > 0) {
      // De-overlap even on the single-call path: asked for more moments than a
      // source genuinely has, the LLM tends to re-pick the same strong beat
      // with slightly shifted bounds rather than admit it ran out — those
      // survive as visually-identical "distinct" clips without this prune.
      return {
        moments: dedupeOverlappingMoments(win.moments).slice(0, maxMoments),
        chapters: win.chapters,
        summary: win.summary,
        version: ANALYSIS_VERSION,
      };
    }
    // Deterministic fallback — evenly spaced windows so the clipper isn't blocked.
    console.warn("[clipAnalysis] using evenly-spaced fallback moments");
    return { moments: evenlySpaced(dur, min, max, maxMoments), chapters: [], summary: "", version: ANALYSIS_VERSION, fallback: true };
  }

  // ── WINDOWED PATH (long sources): analyze by TIME so coverage is uniform ──
  const windows = buildTimeWindows(transcript.segments, dur);
  // Per-window count: ~1 per 3 min like the global density, capped low per window
  // so the merge gets a healthy candidate pool without exploding tokens.
  // Spread the requested total across windows (+1 slack per window for dedupe), so
  // a high clip count isn't silently capped by the 1-8 per-window density.
  const perWindowMax = clamp(Math.ceil((maxMoments * ANALYSIS_WINDOW_SECONDS) / Math.max(1, dur)) + 1, 1, 15);
  const results = await analyzeWindowsBounded(windows, { min, max, apiKey: opts.apiKey, perWindowMax }, ANALYSIS_CONCURRENCY);

  const okResults = results.filter((r): r is WindowResult => r !== null && r.moments.length > 0);
  if (okResults.length === 0) {
    // Every window's LLM call failed → whole-video deterministic fallback.
    console.warn("[clipAnalysis] all windows failed; using evenly-spaced fallback moments");
    return { moments: evenlySpaced(dur, min, max, maxMoments), chapters: [], summary: "", version: ANALYSIS_VERSION, fallback: true };
  }

  // Merge: concat → de-overlap (greedy, viralScore desc) → keep parseMoments'
  // ordering contract (viralScore desc) → coverage backfill → cap to maxMoments.
  const pool = okResults.flatMap((r) => r.moments);
  let merged = dedupeOverlappingMoments(pool);
  merged = coverageBackfill(merged, pool, dur, maxMoments);
  // Final ordering MUST match parseMoments' contract: downstream re-sorts by
  // genreScore (which reads m.scores), so scores stay attached on every moment.
  merged.sort((a, b) => b.viralScore - a.viralScore);
  const moments = merged.slice(0, maxMoments);

  // Chapters: every window carries global timestamps; collect, sort, slice 30.
  const chapters = okResults
    .flatMap((r) => r.chapters)
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .slice(0, 30);
  // Summary: first window's (concat first two for a touch more whole-video sense).
  const summaries = okResults.map((r) => r.summary).filter((s) => s.length > 0);
  const summary = summaries.slice(0, 2).join(" ").slice(0, 500);

  return { moments, chapters, summary, version: ANALYSIS_VERSION };
}

/**
 * Analyze ONE window of segments (the historical single-call body, generalized).
 * Returns parsed global-timestamped moments + the window's chapters/summary, or
 * null if both attempts failed. `maxMoments` defaults to the per-window density.
 */
async function analyzeWindow(
  segments: Transcript["segments"],
  dur: number,
  opts: { min: number; max: number; maxMoments?: number; apiKey?: string; perWindowMax?: number },
): Promise<WindowResult | null> {
  const { min, max, apiKey } = opts;
  if (segments.length === 0) return null;
  const winStart = segments[0].start;
  const winEnd = segments[segments.length - 1].end;
  const winDur = Math.max(1, winEnd - winStart);
  // Per-window count: same ~1-per-3-min density, capped 1..8 so the candidate pool
  // is healthy but tokens stay bounded — raised to perWindowMax when the operator
  // asked for more clips than that density yields. An explicit maxMoments (fast path) wins.
  const maxMoments = opts.maxMoments ?? Math.max(clamp(Math.round(winDur / 180), 1, 8), opts.perWindowMax ?? 0);

  const segText = segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n")
    .slice(0, SINGLE_CALL_CHAR_BUDGET);

  const system = `You are a short-form video strategist. From a timed transcript, find the most viral, self-contained moments for vertical clips.
Return ONLY JSON: {"moments":[{"startSeconds":num,"endSeconds":num,"title":str,"scores":{"hook":0-100,"flow":0-100,"value":0-100,"trend":0-100},"emotion":str,"reason":str,"captionText":str}],"chapters":[{"startSeconds":num,"title":str}],"summary":str}.
Scoring rubric (each 0-100): hook = do the FIRST 3 seconds stop the scroll; flow = self-contained + coherent without outside context; value = the viewer learns or feels something; trend = rides a relatable or current theme.
Rules: up to ${maxMoments} moments. Each ${min}-${max}s, self-contained, starts ON a strong hook line. emotion = one word (funny|shocking|inspiring|informative|emotional|controversial). Timestamps are seconds within the FULL video (0..${Math.round(dur)}); THIS window covers ${Math.round(winStart)}s..${Math.round(winEnd)}s, so return timestamps in that range using the bracketed values shown. No prose, no markdown.
captionText: write a 1-line, scroll-stopping social caption SPECIFIC to what is actually said in THAT moment's transcript window (its point, payoff, emotion, or exact number/name spoken) — NOT a generic statement about the channel, niche, or product. <=150 chars, no hashtags. Good (a clip where the speaker says BTC broke 70k): "BTC just ripped past $70K and nobody saw it coming"; Bad (generic): "Tired of missing market moves? This changes everything."`;
  const user = `VIDEO DURATION: ${Math.round(dur)}s\nTHIS WINDOW: ${Math.round(winStart)}s..${Math.round(winEnd)}s\n\nTRANSCRIPT:\n${segText}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callClaudeJSON<{ moments?: unknown; chapters?: unknown; summary?: unknown }>({
        system, user, apiKey, maxTokens: 4000,
      });
      const moments = parseMoments(raw.moments, dur, min, max).slice(0, maxMoments);
      if (moments.length === 0) throw new Error("analysis produced zero moments");
      const chapters = Array.isArray(raw.chapters)
        ? (raw.chapters as Record<string, unknown>[])
            .filter((c) => typeof c.startSeconds === "number" && typeof c.title === "string")
            .map((c) => ({ startSeconds: clamp(c.startSeconds as number, 0, dur), title: String(c.title).slice(0, 80) }))
            .slice(0, 30)
        : [];
      return {
        moments,
        chapters,
        summary: typeof raw.summary === "string" ? raw.summary.slice(0, 500) : "",
      };
    } catch (err) {
      console.warn(`[clipAnalysis] window ${Math.round(winStart)}s attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return null;
}

/** Split segments into fixed-time windows so coverage is uniform across the whole
 *  video (NOT by char count, which would weight dense regions). A segment lands in
 *  window i where i = floor(seg.start / ANALYSIS_WINDOW_SECONDS). Empty windows are
 *  omitted. No overlap — the stitch already de-overlapped transcription. */
function buildTimeWindows(segments: Transcript["segments"], dur: number): Transcript["segments"][] {
  const total = dur || segments.at(-1)?.end || 0;
  const count = Math.max(1, Math.ceil(total / ANALYSIS_WINDOW_SECONDS));
  const buckets: Transcript["segments"][] = Array.from({ length: count }, () => []);
  for (const s of segments) {
    const idx = clamp(Math.floor(s.start / ANALYSIS_WINDOW_SECONDS), 0, count - 1);
    buckets[idx].push(s);
  }
  return buckets.filter((b) => b.length > 0);
}

/** Run window analyses with a bounded worker pool (no provider rate-limit storm).
 *  Returns results positionally aligned with `windows` (null = that window failed). */
async function analyzeWindowsBounded(
  windows: Transcript["segments"][],
  opts: { min: number; max: number; apiKey?: string; perWindowMax?: number },
  concurrency: number,
): Promise<(WindowResult | null)[]> {
  const dur = windows.at(-1)?.at(-1)?.end ?? 0;
  const results: (WindowResult | null)[] = new Array(windows.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= windows.length) return;
      results[idx] = await analyzeWindow(windows[idx], dur, opts);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, windows.length)) }, () => worker()),
  );
  return results;
}

/** Coverage guard: if any third of the video has ZERO accepted moments and we're
 *  still under maxMoments, backfill from that region's next-best (non-overlapping)
 *  candidate. Keeps whole-video span robust when one window underperforms. */
function coverageBackfill(
  accepted: AnalyzedMoment[],
  pool: AnalyzedMoment[],
  dur: number,
  maxMoments: number,
): AnalyzedMoment[] {
  if (dur <= 0) return accepted;
  const out = [...accepted];
  const third = dur / 3;
  const has = (lo: number, hi: number) => out.some((m) => m.startSeconds >= lo && m.startSeconds < hi);
  for (let t = 0; t < 3 && out.length < maxMoments; t++) {
    const lo = t * third;
    const hi = t === 2 ? dur + 1 : (t + 1) * third;
    if (has(lo, hi)) continue;
    const candidates = pool
      .filter((m) => m.startSeconds >= lo && m.startSeconds < hi && !out.includes(m))
      .sort((a, b) => b.viralScore - a.viralScore);
    for (const c of candidates) {
      const span = Math.max(1, c.endSeconds - c.startSeconds);
      const clash = out.some((a) => {
        const overlap = Math.min(a.endSeconds, c.endSeconds) - Math.max(a.startSeconds, c.startSeconds);
        return overlap > 0 && overlap / span > 0.5;
      });
      if (!clash) { out.push(c); break; }
    }
  }
  return out;
}

function parseMoments(raw: unknown, dur: number, min: number, max: number): AnalyzedMoment[] {
  if (!Array.isArray(raw)) return [];
  const out: AnalyzedMoment[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    let start = Number(m.startSeconds);
    let end = Number(m.endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = clamp(start, 0, Math.max(0, dur - 1));
    end = clamp(end, start + 1, dur || start + max);
    // Nudge toward the configured window without discarding the LLM's intent.
    if (end - start < min && dur > min) end = Math.min(dur, start + min);
    if (end - start > max) end = start + max;
    // Sub-scores (OpusClip rubric); overall = hook-weighted blend. Tolerate a
    // model that still returns a flat viralScore.
    const s = (m.scores ?? {}) as Record<string, unknown>;
    const sub = {
      hook: clamp(Math.round(Number(s.hook) || Number(m.viralScore) || 50), 0, 100),
      flow: clamp(Math.round(Number(s.flow) || Number(m.viralScore) || 50), 0, 100),
      value: clamp(Math.round(Number(s.value) || Number(m.viralScore) || 50), 0, 100),
      trend: clamp(Math.round(Number(s.trend) || Number(m.viralScore) || 50), 0, 100),
    };
    const overall = clamp(Math.round(0.4 * sub.hook + 0.2 * sub.flow + 0.2 * sub.value + 0.2 * sub.trend), 0, 100);
    out.push({
      startSeconds: Math.floor(start),
      endSeconds: Math.ceil(end),
      title: typeof m.title === "string" ? m.title.slice(0, 100) : "Highlight",
      viralScore: overall,
      scores: sub,
      emotion: typeof m.emotion === "string" ? m.emotion.slice(0, 24) : "informative",
      reason: typeof m.reason === "string" ? m.reason.slice(0, 240) : "",
      captionText: typeof m.captionText === "string" ? m.captionText.slice(0, 120) : "",
    });
  }
  return out.sort((a, b) => b.viralScore - a.viralScore);
}

function evenlySpaced(dur: number, min: number, max: number, count: number): AnalyzedMoment[] {
  const len = Math.min(max, Math.max(min, 30));
  const n = Math.max(1, Math.min(count, Math.floor((dur || len) / len)));
  const stride = (dur || len) / n;
  return Array.from({ length: n }, (_, i) => {
    const start = Math.floor(i * stride);
    return {
      startSeconds: start,
      endSeconds: Math.ceil(Math.min(dur || start + len, start + len)),
      title: `Clip ${i + 1}`,
      viralScore: 50,
      emotion: "informative",
      reason: "Evenly-spaced fallback (analysis unavailable).",
      captionText: "",
    };
  });
}
