import { callClaudeJSON } from "./kie-claude";
import type { Transcript, ClipConfig, ClipMoment, CaptionStyle, TranscriptWord, TranscriptSegment } from "./clipTypes";

type CallJSON = (args: { system: string; user: string; apiKey?: string }) => Promise<unknown>;

export interface SelectDeps { callJSON?: CallJSON; apiKey?: string; /** Content genre hint ("auto" = none). */ genre?: string; }

/**
 * Snap a clip's END off an exact-time cut onto a REAL word boundary — the clip
 * lands on "...and that's why" not "...and that's wh-". Every clip window in
 * this file used to be picked purely by TIME (LLM-guessed seconds, or an even
 * fraction of the range), so the cut landed wherever the clock said regardless
 * of whether a word was mid-syllable there — the reported bug.
 *
 * Prefers extending FORWARD to finish the current word, and — for "full
 * context" — the current SENTENCE if one ends within a few seconds and still
 * fits `maxEnd` (+ a small grace window). Only pulls the end BACKWARD (to the
 * end of the previous complete word) when finishing would overflow the max
 * bound by more than that grace — so the clip stays close to the requested
 * length either way, it just never stops mid-word.
 *
 * IMPORTANT: a time-clean cut (landing in a natural pause, no word straddling
 * it) is NOT automatically "done" — that used to short-circuit here and accept
 * it as-is, which is the "video always ends cut off, no context" bug: a pause
 * after "...and then" or "...but the thing is" is a perfectly clean WORD
 * boundary and a completely unfinished THOUGHT. So a clean cut still gets the
 * same sentence-completion attempt as a mid-word one, UNLESS it's already
 * resting on real sentence-final punctuation (nothing to gain by extending).
 *
 * Pure + deterministic. A no-op only when there are no words spoken by
 * `targetEnd` at all.
 */
export function snapEndToWordBoundary(
  words: TranscriptWord[],
  targetEnd: number,
  bounds: { minEnd: number; maxEnd: number },
): number {
  const { minEnd, maxEnd } = bounds;
  if (words.length === 0) return targetEnd;
  const GRACE_SEC = 1.5; // overflow past maxEnd we'll accept to finish a word/sentence
  const SENTENCE_REACH_SEC = 4; // how far past the anchor we'll chase a sentence-final word
  const GAP_SEC = 1.2; // a pause this long between words means "different thought" — stop there
  const isSentenceFinal = (w: string) => /[.!?]["')\]]?$/.test(w.trim());

  const sorted = [...words].sort((a, b) => a.start - b.start);
  const straddleIdx = sorted.findIndex((w) => w.start < targetEnd && w.end > targetEnd);
  const cleanCut = straddleIdx === -1;

  // Anchor: the word straddling targetEnd (mid-word cut), or — for a
  // time-clean cut — the last word that had already finished by targetEnd.
  let anchorIdx = straddleIdx;
  if (cleanCut) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].end <= targetEnd) { anchorIdx = i; break; }
    }
  }
  if (anchorIdx === -1) return targetEnd; // nothing spoken yet by this point
  const anchor = sorted[anchorIdx];

  // Already resting on real sentence-final punctuation with no mid-word
  // straddle — a genuinely complete thought. Nothing to gain by extending.
  if (cleanCut && isSentenceFinal(anchor.word)) return targetEnd;

  // Tier 1: reach for the end of the SENTENCE (full context), walking forward
  // through consecutive words (no >GAP_SEC pause) until sentence punctuation or
  // the reach cap.
  let sentenceEnd = anchor.end;
  for (let i = anchorIdx; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.start - sentenceEnd > GAP_SEC) break;
    sentenceEnd = w.end;
    if (isSentenceFinal(w.word)) break;
    if (sentenceEnd - anchor.end > SENTENCE_REACH_SEC) { sentenceEnd = anchor.end; break; }
  }
  if (sentenceEnd > anchor.end && sentenceEnd <= maxEnd + GRACE_SEC) return Math.max(minEnd, sentenceEnd);

  // A time-clean cut with no reachable sentence end: it's already word-safe,
  // nothing further to fix without blowing the budget — leave it.
  if (cleanCut) return targetEnd;

  // Tier 2: the sentence doesn't fit — just finish the current (straddled) WORD.
  if (anchor.end <= maxEnd + GRACE_SEC) return Math.max(minEnd, anchor.end);

  // Tier 3: even finishing the word overflows past grace — snap BACKWARD to
  // the previous complete word's end instead of cutting this one mid-way.
  for (let i = anchorIdx - 1; i >= 0; i--) {
    if (sorted[i].end <= targetEnd && sorted[i].end >= minEnd) return sorted[i].end;
  }
  // No earlier word fits the floor either — finishing the word (even over
  // budget) beats stopping mid-syllable.
  return anchor.end;
}

function evenlySpaced(transcript: Transcript, config: ClipConfig): ClipMoment[] {
  const len = config.clipLength.min;
  const n = Math.max(1, Math.min(config.maxClipsPerSource, Math.floor(transcript.durationSeconds / len)));
  const stride = transcript.durationSeconds / n;
  return Array.from({ length: n }, (_, i) => {
    const start = Math.round(i * stride);
    const rawEnd = Math.min(transcript.durationSeconds, start + len);
    const end = snapEndToWordBoundary(transcript.words, rawEnd, { minEnd: start + 1, maxEnd: transcript.durationSeconds });
    return { startSeconds: start, endSeconds: end, title: `Clip ${i + 1}`, reason: "auto-segmented (LLM unavailable)", viralScore: 50, captionText: "" };
  });
}

/**
 * Greedy interval pruning: accept candidates in viralScore-desc (start-asc
 * tiebreak) order, dropping any that overlap an already-accepted candidate by
 * more than 50% of ITS OWN span. Without this, an LLM asked for more moments
 * than a source genuinely has tends to re-pick the same strong beat with
 * slightly shifted bounds (or duplicate it outright) to hit the count — those
 * clips then render as visually identical "different" moments, which is
 * exactly the bug this fixes. Shared by both the cached clipAnalysis.ts path
 * and this file's live selectClipMoments path so neither can let a
 * near-duplicate window through un-pruned.
 */
export function dedupeOverlappingMoments<T extends { startSeconds: number; endSeconds: number; viralScore: number }>(pool: T[]): T[] {
  const ranked = [...pool].sort((a, b) => b.viralScore - a.viralScore || a.startSeconds - b.startSeconds);
  const accepted: T[] = [];
  for (const m of ranked) {
    const span = Math.max(1, m.endSeconds - m.startSeconds);
    const clash = accepted.some((a) => {
      const overlap = Math.min(a.endSeconds, m.endSeconds) - Math.max(a.startSeconds, m.startSeconds);
      return overlap > 0 && overlap / span > 0.5;
    });
    if (!clash) accepted.push(m);
  }
  return accepted;
}

/** Like dedupeOverlappingMoments but keeps the CALLER'S order (a prompt- or
 *  feel-steered ranking must not be reshuffled by score): walk in order and keep
 *  a moment only if it doesn't overlap an already-kept one by >50% of the
 *  shorter window. Prevents two near-identical clips (same start, a few seconds
 *  different end) from both being cut and posted. */
export function dedupeOverlappingInOrder<T extends { startSeconds: number; endSeconds: number }>(pool: T[]): T[] {
  const kept: T[] = [];
  for (const m of pool) {
    const clash = kept.some((k) => {
      const overlap = Math.min(k.endSeconds, m.endSeconds) - Math.max(k.startSeconds, m.startSeconds);
      const span = Math.max(1, Math.min(k.endSeconds - k.startSeconds, m.endSeconds - m.startSeconds));
      return overlap > 0 && overlap / span > 0.5;
    });
    if (!clash) kept.push(m);
  }
  return kept;
}

function parseMoments(raw: unknown, config: ClipConfig, durationSeconds: number, words: TranscriptWord[]): ClipMoment[] | null {
  const arr = (raw as { moments?: unknown })?.moments;
  if (!Array.isArray(arr)) return null;
  const { min, max } = config.clipLength;
  const moments = arr
    .map((m): ClipMoment | null => {
      const o = m as Record<string, unknown>;
      if (typeof o.startSeconds !== "number" || typeof o.endSeconds !== "number" || o.endSeconds <= o.startSeconds) return null;
      const start = Math.max(0, Math.min(durationSeconds, o.startSeconds));
      let end = Math.max(0, Math.min(durationSeconds, o.endSeconds));
      // Re-validate AFTER clamping: a hallucinated out-of-bounds window can collapse to end<=start. Drop it.
      if (end <= start) return null;
      // Nudge toward the configured window without discarding the model's intent.
      if (end - start < min && durationSeconds > min) end = Math.min(durationSeconds, start + min);
      if (end - start > max) end = start + max;
      // Finish the word/sentence the time-based cut landed on, instead of
      // chopping it — bounded by the configured max (+ small grace) so length
      // stays close to what was asked for.
      end = snapEndToWordBoundary(words, end, { minEnd: start + min, maxEnd: Math.min(durationSeconds, start + max) });
      const score = Number(o.viralScore ?? 50);
      return {
        startSeconds: start,
        endSeconds: end,
        title: String(o.title ?? "Clip").slice(0, 80), reason: String(o.reason ?? "").slice(0, 200),
        viralScore: Math.max(0, Math.min(100, Number.isFinite(score) ? score : 50)),
        captionText: String(o.captionText ?? "").slice(0, 200),
      };
    })
    .filter((m): m is ClipMoment => m !== null);
  if (moments.length === 0) return null;
  const deduped = dedupeOverlappingMoments(moments);
  return deduped.sort((a, b) => b.viralScore - a.viralScore).slice(0, config.maxClipsPerSource);
}

export async function selectClipMoments(transcript: Transcript, config: ClipConfig, deps: SelectDeps = {}): Promise<ClipMoment[]> {
  const callJSON: CallJSON = deps.callJSON ?? (callClaudeJSON as unknown as CallJSON);
  // Genre hint (Source node): steers what "viral" means for this content type
  // on the live-selection path. (The cached-analysis path re-weights sub-scores
  // instead — see plan-moments.)
  const genreHint = deps.genre && deps.genre !== "auto" ? ` The content genre is ${deps.genre} — judge virality by what performs for that genre.` : "";
  const system = `You are a short-form clip producer. From a transcript, pick the ${config.maxClipsPerSource} MOST viral standalone moments.${genreHint}
Rules: each clip ${config.clipLength.min}-${config.clipLength.max}s long; must be self-contained; ${config.hookStyle === "cold_open" ? "start ON the most gripping line (cold open)" : "include one line of setup then the payoff"}.
captionText: write a 1-line, scroll-stopping social caption SPECIFIC to what is actually said in THAT moment's transcript window (its point, payoff, emotion, or exact number/name spoken) — NOT a generic statement about the channel, niche, or product. <=150 chars, no hashtags. Good (a clip where the speaker says BTC broke 70k): "BTC just ripped past $70K and nobody saw it coming"; Bad (generic): "Tired of missing market moves? This changes everything."
Return ONLY JSON: {"moments":[{"startSeconds":number,"endSeconds":number,"title":string,"reason":string,"viralScore":0-100,"captionText":string}]}. You are a headless JSON API, not an interactive assistant — never reply with meta-commentary about your own mode/capabilities/permissions; output ONLY the JSON object, nothing else.`;
  const user = `SOURCE DURATION: ${transcript.durationSeconds}s\n\nTRANSCRIPT (timed segments):\n${transcript.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n").slice(0, 7000)}`;

  // 3 attempts (was 2): callJSON (kie-claude.ts) already fails over Claude→Gemini
  // INSIDE a single attempt now (including on a 200-but-non-JSON "Ask mode" style
  // reply), so a failure reaching this loop means BOTH brains struck out on that
  // attempt — worth one more try before degrading to the generic evenly-spaced
  // fallback (which is what burns a literal "Clip 1"/"Clip 2" as the hook text).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callJSON({ system, user, apiKey: deps.apiKey });
      const parsed = parseMoments(raw, config, transcript.durationSeconds, transcript.words);
      if (parsed) return parsed;
    } catch (err) {
      console.warn(`[clipMomentSelector] attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return evenlySpaced(transcript, config);
}

// ───────────────────────────────────────────────────────────────────────────
// Selectable clip count via per-moment VARIATIONS
// ───────────────────────────────────────────────────────────────────────────
// A source only yields ~M DISTINCT strong moments (analysis de-overlaps windows
// >50%, so a 20-min talk has ~6-7). When the operator asks for a count N > M we
// DON'T pad with weaker distinct moments — we REUSE each strong moment as several
// visually distinct clips ("the same content, many ways"). Each variation is the
// same [start,end] window (or a shorter sub-cut of it) rendered with a different
// edit-plan config: a rotated hook style, caption look, cut length, and crop mode.

/** The config knobs a single moment's variation rotates through. Merged over the
 *  run config on the render path (hook/caption via ClipConfig, reframe applied to
 *  the reframe op) so each variation renders a genuinely different clip. */
export interface MomentVariation {
  /** cold_open vs context_first — how the clip opens (steers the hook framing). */
  hookStyle: ClipConfig["hookStyle"];
  /** Subtitle look for THIS variation (karaoke/line + rotated position). */
  captionStyle: CaptionStyle;
  /** crop (fill 9:16) vs pad (fit) for the reframe op — different framing. */
  reframeMode: "crop" | "pad";
}

/** A clip to render: a ClipMoment plus which source moment + variation it is. */
export interface ExpandedClipMoment extends ClipMoment {
  /** Rank index of the SOURCE moment this clip derives from (0 = strongest). */
  momentIndex: number;
  /** Variation number within the source moment (0 = the pristine strongest cut). */
  variationIndex: number;
  /** UI label: "Moment 3" (v0, pristine) or "Moment 3 · v2" (variationIndex 1). */
  variationLabel: string;
  /** Deterministic seed (momentIndex*100 + variationIndex) — same clip re-renders
   *  identically across retries/re-runs. */
  variationSeed: number;
  /** Per-clip render config for a variation. OMITTED for the pristine cut
   *  (variationIndex 0) so it renders byte-identically to the pre-feature path. */
  variation?: MomentVariation;
}

// Knob cycles. Kept short + independent so ANY moment with >=2 variations gets a
// distinct value on every knob (the 2/2/3-length cycles guarantee >=2 distinct
// values across the first few variations), and the 7-length band keeps lengths
// out of phase so higher variation counts don't collapse to duplicates.
const HOOK_STYLES = ["cold_open", "context_first"] as const;
const CAPTION_MODES = ["karaoke", "line"] as const;
const CAPTION_POSITIONS = ["bottom", "top", "center"] as const;
const REFRAME_MODES = ["crop", "pad"] as const;
/** Length fractions across the [min, cut-ceiling] band. Index 0 is only hit by the
 *  pristine cut, which ignores this (keeps the analyzer's own window). v>=1 pick a
 *  distinct shorter/longer SUB-length of the SAME window. */
const LENGTH_FRACS = [1.0, 0.5, 0.85, 0.35, 0.7, 0.2, 0.95];

const variationLabel = (mi: number, vi: number) =>
  vi === 0 ? `Moment ${mi + 1}` : `Moment ${mi + 1} · v${vi + 1}`;

/** Deterministic knobs for the v-th variation (v>=1) of a moment. */
function variationFor(config: ClipConfig, v: number): MomentVariation {
  return {
    hookStyle: HOOK_STYLES[v % HOOK_STYLES.length],
    captionStyle: {
      ...config.captionStyle,
      mode: CAPTION_MODES[v % CAPTION_MODES.length],
      position: CAPTION_POSITIONS[v % CAPTION_POSITIONS.length],
    },
    reframeMode: REFRAME_MODES[v % REFRAME_MODES.length],
  };
}

/** The v-th variation's cut window: a sub-length of the SAME content, kept within
 *  [clipLength.min, min(clipLength.max, original span)] so the downstream length
 *  clamp is a no-op. Anchored at the moment start. The raw fraction-of-range end
 *  is picked purely by time (that's the point — distinct-length variations), so
 *  it's snapped onto the nearest word boundary before returning: "based on the
 *  time" for the length, but never stopping mid-word. */
function windowForVariation(m: ClipMoment, config: ClipConfig, v: number, words: TranscriptWord[]): { startSeconds: number; endSeconds: number } {
  const start = m.startSeconds;
  const origLen = Math.max(1, m.endSeconds - start);
  const lo = Math.max(1, config.clipLength.min);
  const hi = Math.max(lo, config.clipLength.max);
  const ceil = Math.max(lo, Math.min(hi, origLen)); // never past the moment's own end
  const frac = LENGTH_FRACS[v % LENGTH_FRACS.length];
  const len = Math.round(lo + (ceil - lo) * frac);
  const rawEnd = start + Math.max(lo, Math.min(ceil, len));
  const end = snapEndToWordBoundary(words, rawEnd, { minEnd: start + lo, maxEnd: start + ceil });
  return { startSeconds: start, endSeconds: end };
}

/**
 * Expand M ranked, de-overlapped moments into EXACTLY `targetCount` clips.
 *
 *  - targetCount <= M → the top-`targetCount` DISTINCT moments, one clip each
 *    (unchanged behavior; every clip is a pristine cut with no config override).
 *  - targetCount  > M → clone each moment into ⌈N/M⌉ VARIATIONS, distributing the
 *    remainder so the strongest moments get the extra variation first and the total
 *    is EXACTLY targetCount. Variation 0 of every moment is the pristine strongest
 *    cut; variations 1.. rotate the hook / caption / length / crop knobs.
 *
 * Pure + deterministic (no I/O) so it is trivially unit-testable and cache-safe.
 */
export function expandMomentsToCount(
  moments: ClipMoment[],
  targetCount: number,
  config: ClipConfig,
  words: TranscriptWord[] = [],
): ExpandedClipMoment[] {
  const N = Math.max(1, Math.floor(targetCount || 1));
  const M = moments.length;
  if (M === 0) return [];

  const tag = (m: ClipMoment, mi: number, vi: number): ExpandedClipMoment => ({
    ...m,
    momentIndex: mi,
    variationIndex: vi,
    variationLabel: variationLabel(mi, vi),
    variationSeed: mi * 100 + vi,
    // vi 0 = the pristine strongest cut → NO override, original window (identical
    // to the pre-feature path). vi>=1 = a rotated variation of the same content.
    ...(vi === 0 ? {} : { variation: variationFor(config, vi), ...windowForVariation(m, config, vi, words) }),
  });

  // Enough distinct moments → top-N distinct, one clip each (today's behavior).
  if (N <= M) return moments.slice(0, N).map((m, i) => tag(m, i, 0));

  // N > M → fill to N via per-moment variations. base = ⌊N/M⌋ each; the first
  // `remainder` (strongest) moments get one extra so the total is EXACTLY N.
  const base = Math.floor(N / M);
  const remainder = N % M;
  const out: ExpandedClipMoment[] = [];
  for (let mi = 0; mi < M; mi++) {
    const count = base + (mi < remainder ? 1 : 0);
    for (let vi = 0; vi < count; vi++) out.push(tag(moments[mi], mi, vi));
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// CROSS-VIDEO FILL (fill-short): assemble ONE full clip from a short source +
// sibling-video moments. Engaged ONLY when a source is genuinely too short to
// yield a full-length clip; the DEFAULT single-video path is untouched.
// ───────────────────────────────────────────────────────────────────────────

/** An ordered sub-window of the assembled clip, in its OWN source's absolute
 *  seconds. subSegments[0] is the PRIMARY lead; the rest fill from the pool. */
export interface FillSubSegment { sourceUrl: string; start: number; end: number; }

/** A candidate source + its transcript (the primary, or a pool sibling). */
export interface CrossFillSource { sourceUrl: string; transcript: Transcript; }

/** The ordered assembly result: primary lead first, then pool fill. */
export interface AssembledFill {
  subSegments: FillSubSegment[];
  totalLen: number;
  targetLen: number;
}

/**
 * TRIGGER PREDICATE: engage cross-video fill iff this source is too SHORT to
 * yield even ONE full (min-length) clip on its own. Long-enough sources return
 * false → the default single-video path runs byte-for-byte unchanged. Pure.
 */
export function shouldCrossVideoFill(sourceDurationSeconds: number, config: ClipConfig): boolean {
  const min = Math.max(1, config.clipLength?.min ?? 1);
  return Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds > 0 && sourceDurationSeconds < min;
}

/**
 * DETERMINISTIC fallback fill (also the shape parseFill validates against): take
 * from the START of each pool member, in order, until `need` seconds are filled.
 * Pure — the LLM-down path and the unit tests both rely on this exact behavior.
 */
export function fillFromPoolStart(pool: CrossFillSource[], need: number): FillSubSegment[] {
  const out: FillSubSegment[] = [];
  let remaining = need;
  for (const p of pool) {
    if (remaining <= 0.5) break;
    const dur = Math.max(0, p.transcript?.durationSeconds || 0);
    if (dur <= 0.5) continue;
    const take = Math.min(dur, remaining);
    out.push({ sourceUrl: p.sourceUrl, start: 0, end: +take.toFixed(3) });
    remaining -= take;
  }
  return out;
}

const fillSegText = (t: Transcript): string =>
  (t.segments ?? []).map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n").slice(0, 2500);

/** Validate the LLM's ordered fill windows against the pool, accumulating up to
 *  `need` (trimming the final window so we don't overshoot). Bounded to 6 fills —
 *  this is fill-SHORT, not an arbitrary montage. */
function parseFill(raw: unknown, pool: CrossFillSource[], need: number): FillSubSegment[] {
  const arr = (raw as { fill?: unknown })?.fill;
  if (!Array.isArray(arr)) return [];
  const out: FillSubSegment[] = [];
  let acc = 0;
  for (const item of arr) {
    if (acc >= need - 0.5 || out.length >= 6) break;
    const o = item as Record<string, unknown>;
    const pi = Number(o.poolIndex);
    if (!Number.isInteger(pi) || pi < 0 || pi >= pool.length) continue;
    const dur = Math.max(0, pool[pi].transcript?.durationSeconds || 0);
    const start = Math.max(0, Math.min(dur, Number(o.startSeconds)));
    let end = Math.max(0, Math.min(dur, Number(o.endSeconds)));
    if (!(end > start)) continue;
    const remaining = need - acc;
    if (end - start > remaining) end = start + remaining; // trim the last window to land ≈ need
    if (end - start < 0.5) continue;
    out.push({ sourceUrl: pool[pi].sourceUrl, start: +start.toFixed(3), end: +end.toFixed(3) });
    acc += end - start;
  }
  return out;
}

/**
 * Select an ORDERED list of sub-segments that assemble a full ~targetLen clip:
 * the WHOLE short primary leads, then fill from pool siblings (preferring topical
 * continuity) until the total reaches targetLen. LLM-driven with a deterministic
 * fallback (fillFromPoolStart) so an LLM outage still produces a valid assembly.
 *
 * Pure except for the single LLM call (injectable via deps.callJSON for tests).
 * The primary is ALWAYS subSegments[0]; total ≈ targetLen; never a pool-only clip.
 */
export async function selectCrossVideoFill(
  primary: CrossFillSource,
  pool: CrossFillSource[],
  targetLen: number,
  deps: SelectDeps = {},
): Promise<AssembledFill> {
  const callJSON: CallJSON = deps.callJSON ?? (callClaudeJSON as unknown as CallJSON);
  const primaryLen = Math.max(0.5, primary.transcript?.durationSeconds || 0);
  const lead: FillSubSegment = { sourceUrl: primary.sourceUrl, start: 0, end: +primaryLen.toFixed(3) };
  const need = Math.max(0, targetLen - primaryLen);
  // Only siblings with real content are fillable (never re-use the primary).
  const usablePool = pool.filter((p) => p.sourceUrl !== primary.sourceUrl && (p.transcript?.durationSeconds || 0) > 0.5);
  if (need <= 0.5 || usablePool.length === 0) {
    return { subSegments: [lead], totalLen: +primaryLen.toFixed(3), targetLen };
  }

  let fills: FillSubSegment[] = [];
  const genreHint = deps.genre && deps.genre !== "auto" ? ` The content genre is ${deps.genre}.` : "";
  const system = `You assemble ONE short-form clip by continuing a SHORT primary video with moments from sibling videos in the same collection.${genreHint}
The primary is too short on its own. Pick an ORDERED list of fill windows from the POOL that flow naturally after the primary and together add ~${Math.round(need)}s (so the whole clip reaches ~${Math.round(targetLen)}s). Prefer topical continuity and the strongest sibling moments; lead with the most related. Keep each window self-contained.
Return ONLY JSON: {"fill":[{"poolIndex":number,"startSeconds":number,"endSeconds":number}]}.`;
  const user = `PRIMARY (${Math.round(primaryLen)}s):\n${fillSegText(primary.transcript)}\n\nPOOL (fill from these):\n${usablePool.map((p, i) => `[${i}] (${Math.round(p.transcript.durationSeconds)}s)\n${fillSegText(p.transcript)}`).join("\n\n")}`;
  try {
    const raw = await callJSON({ system, user, apiKey: deps.apiKey });
    fills = parseFill(raw, usablePool, need);
  } catch (err) {
    console.warn(`[selectCrossVideoFill] LLM failed, using deterministic fill:`, err instanceof Error ? err.message : err);
  }
  if (fills.length === 0) fills = fillFromPoolStart(usablePool, need);

  const subSegments = [lead, ...fills];
  const totalLen = subSegments.reduce((s, x) => s + (x.end - x.start), 0);
  return { subSegments, totalLen: +totalLen.toFixed(3), targetLen };
}

/**
 * Re-time per-sub-segment caption WORDS onto the concatenated clip timeline: each
 * sub-segment's words (in that source's absolute seconds) are shifted to be
 * 0-based and pushed forward by the CUMULATIVE duration of all prior sub-segments.
 * Words outside their sub-window are dropped; each is clamped to its window. Pure
 * (the load-bearing offset math for stitched captions — shared by renderStitchedClip).
 */
export function retimeStitchedWords(
  inputs: { start: number; end: number; words?: TranscriptWord[] }[],
): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let offset = 0;
  for (const seg of inputs) {
    const dur = Math.max(0, seg.end - seg.start);
    for (const w of seg.words ?? []) {
      if (w.end <= seg.start || w.start >= seg.end) continue; // outside this sub-window
      const s = Math.max(0, Math.min(dur, w.start - seg.start)) + offset;
      const e = Math.max(0, Math.min(dur, w.end - seg.start)) + offset;
      if (e > s) out.push({ word: w.word, start: +s.toFixed(3), end: +e.toFixed(3) });
    }
    offset += dur;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Phrase-boundary snapping + distinct gap fill (complete, non-duplicate clips)
// ───────────────────────────────────────────────────────────────────────────

const bySegStart = (segments: TranscriptSegment[]) => [...segments].sort((a, b) => a.start - b.start);

/**
 * Move a clip START onto the beginning of the transcript segment (an STT phrase)
 * it lands inside, so the clip opens on the first word of a thought instead of
 * mid-sentence. The LLM only sees segment-level timestamps and starts used to be
 * a raw floor(), so clips routinely opened half-way through a line. Reaches back
 * at most 8s; failing that, forward to the next phrase within 3s. Pure.
 */
export function snapStartToSegmentBoundary(segments: TranscriptSegment[], start: number): number {
  if (!segments?.length) return start;
  const MAX_BACK_SEC = 8;
  const MAX_FWD_SEC = 3;
  const sorted = bySegStart(segments);
  const inside = sorted.find((s) => s.start <= start && s.end > start);
  if (inside && start - inside.start <= MAX_BACK_SEC) return inside.start;
  const next = sorted.find((s) => s.start >= start);
  return next && next.start - start <= MAX_FWD_SEC ? next.start : start;
}

/**
 * Move a clip END onto the end of the phrase it lands inside (finish the thought)
 * when that fits the max bound (+ small grace); otherwise pull it back to the end
 * of the previous complete phrase if that still honors minEnd. A cut already in a
 * pause between phrases is left alone. Complements snapEndToWordBoundary, which
 * relies on sentence punctuation that many STT outputs don't emit. Pure.
 */
export function snapEndToSegmentBoundary(
  segments: TranscriptSegment[],
  end: number,
  bounds: { minEnd: number; maxEnd: number },
): number {
  if (!segments?.length) return end;
  const GRACE_SEC = 1.5;
  const REACH_SEC = 8;
  const sorted = bySegStart(segments);
  const inside = sorted.find((s) => s.start < end && s.end > end);
  if (!inside) return end;
  if (inside.end - end <= REACH_SEC && inside.end <= bounds.maxEnd + GRACE_SEC) return Math.max(bounds.minEnd, inside.end);
  const prev = [...sorted].reverse().find((s) => s.end <= inside.start + 0.01);
  if (prev && prev.end >= bounds.minEnd) return prev.end;
  return end;
}

/**
 * Up to `need` ADDITIONAL moments that don't overlap `existing` at all, built from
 * whole transcript phrases (start on a phrase start, end on a phrase end, length
 * within clipLength) and spread across the video. Used when the AI returned fewer
 * distinct moments than the operator asked for — replacing the old per-moment
 * "variations", which all started on the SAME second and rendered as identical
 * clips. Title = the opening words of the window (never a "Clip N" placeholder). Pure.
 */
export function distinctGapMoments(
  existing: ClipMoment[],
  need: number,
  segments: TranscriptSegment[],
  clipLength: { min: number; max: number },
): ClipMoment[] {
  if (need <= 0 || !segments?.length) return [];
  const lo = Math.max(1, clipLength.min);
  const hi = Math.max(lo, clipLength.max);
  const target = Math.min(hi, Math.max(lo, Math.round((lo + hi) / 2)));
  const sorted = bySegStart(segments);
  const taken: [number, number][] = existing.map((m) => [m.startSeconds, m.endSeconds]);
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => Math.min(b, e) - Math.max(a, s) > 0);

  const candidates: ClipMoment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i].start;
    let e = sorted[i].end;
    let j = i;
    const texts = [sorted[i].text];
    while (e - s < target && j + 1 < sorted.length && sorted[j + 1].end - s <= hi) {
      j++;
      e = sorted[j].end;
      texts.push(sorted[j].text);
    }
    if (e - s < lo || e - s > hi + 1.5 || overlaps(s, e)) continue;
    const title = texts.join(" ").trim().split(/\s+/).slice(0, 8).join(" ").slice(0, 80);
    candidates.push({
      startSeconds: s,
      endSeconds: e,
      title: title || "Highlight",
      reason: "additional distinct moment (no overlap with the AI picks)",
      viralScore: 40,
      captionText: "",
    });
    taken.push([s, e]);
    i = j; // next candidate starts after this window
  }
  if (candidates.length <= need) return candidates;
  const step = candidates.length / need;
  return Array.from({ length: need }, (_, k) => candidates[Math.floor(k * step)]);
}

/** Segment twin of retimeStitchedWords (same cumulative-offset math) — used to
 *  build the stitched `window` the edit-planner reads. Pure. */
export function retimeStitchedSegments(
  inputs: { start: number; end: number; segments?: TranscriptSegment[] }[],
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let offset = 0;
  for (const seg of inputs) {
    const dur = Math.max(0, seg.end - seg.start);
    for (const s of seg.segments ?? []) {
      if (s.end <= seg.start || s.start >= seg.end) continue;
      const st = Math.max(0, Math.min(dur, s.start - seg.start)) + offset;
      const en = Math.max(0, Math.min(dur, s.end - seg.start)) + offset;
      if (en > st) out.push({ start: +st.toFixed(3), end: +en.toFixed(3), text: s.text });
    }
    offset += dur;
  }
  return out;
}
