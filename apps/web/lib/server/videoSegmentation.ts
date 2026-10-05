import { SPEAKING_WORDS_PER_SEC } from "../builder/agentTypes";
import type { StoryBeat } from "./kie-video-pipeline";

/**
 * Realistic on-screen seconds for one beat, from how long its spoken line takes
 * at the shared speaking rate. Floors at 2s; silent beats (no voiceover) get 3s.
 */
export function beatSecondsFromVoiceover(voiceover: string): number {
  const words = (voiceover ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 3;
  return Math.max(2, Math.ceil(words / SPEAKING_WORDS_PER_SEC));
}

/**
 * Pack beats into time windows of ≤ `clipSeconds` each (one rendered clip per
 * window). Each clip is rendered at a FIXED `clipSeconds` length, so a window
 * must never hold more spoken seconds than the clip can deliver — otherwise the
 * tail of the line is cut off and the stitched video "looks unfinished".
 *
 * Walks beats in order, accumulating spoken seconds. Closes the current window
 * before adding a beat that would push it past `clipSeconds`, starting a new
 * clip instead of overflowing. Never exceeds `maxWindows` — once on the last
 * allowed window, any remaining beats fold into it (the caller sizes
 * `maxWindows` from the script's length so this fold-and-truncate path is only
 * hit at the global max-duration cap).
 *
 * Crucially it NEVER pads or duplicates: if the beats only fill K < maxWindows
 * windows, it returns K windows. The caller renders exactly that many clips.
 */
export function packBeatsIntoWindows(
  beats: StoryBeat[],
  clipSeconds = 8,
  maxWindows = 8,
): StoryBeat[][] {
  if (beats.length === 0) return [];
  const cap = Math.max(1, maxWindows);

  const windows: StoryBeat[][] = [];
  let current: StoryBeat[] = [];
  let acc = 0;

  for (const b of beats) {
    const onLastAllowedWindow = windows.length === cap - 1;
    const s = beatSecondsFromVoiceover(b.voiceover);
    // A clip can only speak `clipSeconds` of words. Close this window before a
    // beat that would overflow it, so every clip can finish its line in full.
    const wouldOverflow = acc + s > clipSeconds;
    // Scene-aware break: a planner-marked scene change (`newScene`) starts its
    // own window whenever the current one already holds a meaningful chunk
    // (≥40% of the clip) — one rendered clip = one scene, so a location cut
    // lands ON a clip boundary instead of glitching mid-take. A tiny current
    // window still absorbs the beat (padding a 2s orphan clip is worse).
    const sceneBreak = b.newScene === true && acc >= clipSeconds * 0.4;

    if (current.length > 0 && (wouldOverflow || sceneBreak) && !onLastAllowedWindow) {
      windows.push(current);
      current = [];
      acc = 0;
    }
    current.push(b);
    acc += s;
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

// ─── Grok Imagine extend planning ────────────────────────────────────────────
// A Grok video > 15s is NOT rendered as independent stitched takes anymore; it is
// a base clip continued forward with Kie's native grok-imagine/extend. This plans
// the time windows for that chain: a first BASE window (≤15s), then EXTEND windows
// whose count/size scale with the video's length (per-window continuation prompts).

/** Longest first (base) Grok clip before an extend chain kicks in. */
export const GROK_BASE_MAX_SECONDS = 15;
/** Target seconds each grok-imagine/extend step adds — matches Kie's actual
 *  per-extend ceiling (15s, same as the base clip's own cap; see the
 *  min(15, …) clamp on generateGrokExtended's window size, and the sibling
 *  Recreate-feature constant GROK_CHAIN_EXTEND_MAX_SECONDS). Was previously
 *  10 with no documented reason, which packed a 30s video as base 15s +
 *  extend 10s + extend 5s (3 Kie calls) instead of the clean base 15s +
 *  extend 15s (2 calls) Kie actually supports — more calls means more
 *  latency and more chances for one extend step to fail. Window count still
 *  scales with the remaining length: a 45s video now gets 2 extends
 *  (15s+15s) instead of 3, a 25s video still gets 1 (10s, unchanged since
 *  10s already fit under both caps). */
export const GROK_EXTEND_MAX_SECONDS = 15;
/** A Grok video longer than this switches from single-take/stitch to the extend chain. */
export const GROK_EXTEND_THRESHOLD_SECONDS = 15;

/**
 * Split beats into a BASE window (≤ GROK_BASE_MAX_SECONDS) and a list of EXTEND
 * windows for the grok-imagine/extend chain. The base is the first coherent ≤15s
 * chunk (always ≥1 beat); the remaining beats are packed into ≤GROK_EXTEND_MAX_SECONDS
 * windows — so the number of extend steps grows with the video's length. Never pads
 * or duplicates: a short remainder yields fewer (or zero) extend windows.
 */
export function planGrokExtendWindows(
  beats: StoryBeat[],
  baseMaxSeconds = GROK_BASE_MAX_SECONDS,
  extendMaxSeconds = GROK_EXTEND_MAX_SECONDS,
): { base: StoryBeat[]; extendWindows: StoryBeat[][] } {
  if (beats.length === 0) return { base: [], extendWindows: [] };

  const base: StoryBeat[] = [];
  let acc = 0;
  let i = 0;
  for (; i < beats.length; i++) {
    const s = beatSecondsFromVoiceover(beats[i].voiceover);
    // Always take at least one beat; then stop before a beat that would overflow
    // the base window so the base clip can speak its lines in full.
    if (base.length > 0 && acc + s > baseMaxSeconds) break;
    base.push(beats[i]);
    acc += s;
  }

  const rest = beats.slice(i);
  const extendWindows = rest.length > 0
    ? packBeatsIntoWindows(rest, extendMaxSeconds, rest.length)
    : [];
  return { base, extendWindows };
}

/**
 * Total spoken/on-screen seconds a window occupies — used as the RENDER
 * duration requested from Kie for that clip (Grok's extend_times, base
 * duration). Computed from the window's TOTAL word count, not by summing each
 * beat's individually-floored duration (beatSecondsFromVoiceover floors every
 * beat to a minimum of 2s, which compounds across several short beats into a
 * requested duration well beyond what the words actually take to say). Asking
 * a video model to fill MORE seconds than it has script for is exactly what
 * makes it pad by repeating/looping the line — the "video looks like it's
 * repeating" symptom. Floors ONCE for the whole window instead.
 */
export function windowSeconds(window: StoryBeat[]): number {
  const words = window.reduce((n, b) => n + (b.voiceover ?? "").trim().split(/\s+/).filter(Boolean).length, 0);
  if (words === 0) return 3;
  return Math.max(3, Math.ceil(words / SPEAKING_WORDS_PER_SEC));
}

export interface VoicePersona {
  agentName: string;
  agentNiche: string;
  agentArchetype?: string;
  language?: string;
  /** Optional explicit voice hint from the persona questionnaire. */
  voiceArchetype?: string;
  /** Optional personality dials (0-100) used to pick energy/warmth. */
  personality?: { warmth?: number; humor?: number; authority?: number; boldness?: number };
}

const WPM = Math.round(SPEAKING_WORDS_PER_SEC * 60); // 150

/**
 * One canonical voice descriptor, derived once per render and embedded verbatim
 * in every clip prompt so Veo reproduces the SAME voice across generate +
 * extends. Pure + deterministic. Always returns a complete descriptor.
 */
export function buildVoiceProfile(p: VoicePersona): string {
  const lang = (p.language ?? "English").trim() || "English";
  // NATIVE speaker of the script's language — the old "light ${lang}-accented
  // English" phrasing directed an ENGLISH voice, so a Malay script came out with
  // a guessed (usually Indonesian) accent. Malay gets a hard dialect lock:
  // Malaysian Bahasa Melayu and Indonesian are different languages to a TTS ear,
  // and engines default to Indonesian without this.
  const isMalay = /malay|melayu|bahasa m/i.test(lang) && !/indones/i.test(lang);
  const accent = /english/i.test(lang)
    ? "neutral clear accent"
    : isMalay
      ? "native MALAYSIAN Malay voice (Bahasa Melayu Malaysia) — everyday colloquial Malaysian pronunciation, rhythm and intonation, the way people actually speak in Malaysia; ABSOLUTELY NOT an Indonesian accent, not Indonesian pronunciation, not Bahasa Indonesia"
      : `native ${lang} speaker's voice with authentic ${lang} pronunciation`;

  const authority = p.personality?.authority ?? 55;
  const warmth = p.personality?.warmth ?? 60;
  const boldness = p.personality?.boldness ?? 55;

  const pitch = authority >= 65 ? "lower-pitched" : authority <= 40 ? "higher-pitched" : "mid-pitched";
  const tone = warmth >= 60 ? "warm and friendly" : warmth <= 35 ? "cool and measured" : "even, approachable";
  const energy = boldness >= 65 ? "high-energy, punchy" : boldness <= 35 ? "calm, steady" : "upbeat, confident";

  const archetype = (p.voiceArchetype || p.agentArchetype || "expert creator").toString();

  // FRONT-LOADED lock line: callers on a tight prompt budget (extend calls,
  // over-length fallback tiers) truncate this string from the END — the old
  // ordering put "never re-cast the voice" and the language lock LAST, so
  // exactly the two sentences that keep a long/multi-clip video's voice
  // consistent were the first thing any truncation cut. A short render never
  // hit this (everything fit); a long one (2+ Grok extend windows) silently
  // lost the lock on every extend prompt — the reported "voice changes after
  // the second clip" bug. This sentence alone is a complete, standalone
  // instruction, so it still works even if everything after it is trimmed.
  const lockLine = `SAME VOICE AS CLIP 1 — do not change gender, pitch, accent, or language between clips.` +
    (/english/i.test(lang) ? "" : ` Speak entirely in ${lang}, every word, no English mixed in.`);

  return (
    `VOICE — IDENTICAL IN EVERY CLIP. ${lockLine} ` +
    `Voice: a ${pitch}, ${tone} ${archetype} voice with a ${accent}, ` +
    `speaking at a natural ~${WPM} wpm (words per minute), ${energy} delivery.`
  );
}
