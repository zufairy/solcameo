import { mediaPackBase } from "@/lib/server/mediaPackBase";
import type { TranscriptWord } from "@/lib/server/clipTypes";
// Curated reaction SOUND-EFFECTS for the clip.reactionsfx skill. Each sound is
// hosted at REACTION_SFX_BASE_URL/<file>; that env MUST be set for the skill to
// emit audio. With no base URL, reactionSfxUrl() returns "" — the catalog floor
// then emits NO audio_overlay op (the render is unchanged), so the feature
// degrades gracefully instead of pointing ffmpeg at a missing input. Mirrors the
// gameplayPack pattern.

export interface ReactionSfxEntry {
  /** Stable id the inspector stores as config.sfxId; also the file stem. */
  id: string;
  /** Human label for the inspector dropdown. */
  label: string;
  /** Resolved absolute URL of the sfx file, or "" when the base env is unset. */
  url: string;
}

/** Filename for each sfx id at the hosting base (a map, not just `${id}.mp3`, so a
 *  future rename of the public file doesn't churn the id). */
const SFX_FILES: Record<string, { label: string; file: string }> = {
  "vine-boom": { label: "Vine Boom", file: "vine-boom.mp3" },
  "fah": { label: "Fah", file: "fah.mp3" },
  "bruh": { label: "Bruh", file: "bruh.mp3" },
  // Cinematic Impact pack — movie-trailer stings.
  "riser-hit": { label: "Riser Hit", file: "riser-hit.mp3" },
  "record-scratch": { label: "Record Scratch", file: "record-scratch.mp3" },
  "whoosh-impact": { label: "Whoosh Impact", file: "whoosh-impact.mp3" },
  // Cartoon Comedy pack — classic slapstick stings.
  "cartoon-boing": { label: "Cartoon Boing", file: "cartoon-boing.mp3" },
  "slide-whistle": { label: "Slide Whistle", file: "slide-whistle.mp3" },
  "cartoon-tada": { label: "Cartoon Ta-Da", file: "cartoon-tada.mp3" },
};

/** Join the env base with a filename, tolerating a trailing slash. Returns "" when
 *  no base is configured (caller treats that as "unavailable"). */
function joinBase(file: string): string {
  const base = mediaPackBase("REACTION_SFX_BASE_URL", "sfx");
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/${file}`;
}

/** Resolved URL for a reaction-sfx id, or "" if the id is unknown or the base env
 *  is unset. */
export function reactionSfxUrl(id: string): string {
  const entry = SFX_FILES[id];
  if (!entry) return "";
  return joinBase(entry.file);
}

/** The full sfx list, each url resolved against REACTION_SFX_BASE_URL (or ""). */
export const REACTION_SFX: ReactionSfxEntry[] = Object.entries(SFX_FILES).map(
  ([id, { label, file }]) => ({ id, label, url: joinBase(file) }),
);

/** Stable list of sfx ids — the inspector's dropdown values. */
export const REACTION_SFX_IDS = Object.keys(SFX_FILES);

/** Default sound when the inspector hasn't picked one. */
export const DEFAULT_REACTION_SFX_ID = "vine-boom";

/** Whether a reaction-sfx id is one of the curated set. */
export const isReactionSfxId = (id: unknown): id is string =>
  typeof id === "string" && id in SFX_FILES;

// ── Reaction SFX PACKS ──────────────────────────────────────────────────────
// A "pack" is a NAMED set of three reaction stings — one per emotion BUCKET
// (shock / funny / hype). The AI still auto-picks WHICH bucket fires from the
// moment's emotion; a pack only swaps the actual sound each bucket maps to. The
// inspector dropdown chooses the pack; a neutral moment still gets NO sting.
//
// TO ADD A PACK: append a REACTION_SFX_PACKS entry whose `stings` point at SFX
// file ids (keys of SFX_FILES), and upload those .mp3s to REACTION_SFX_BASE_URL.
// A brand-new sound also needs a matching SFX_FILES row (id → label + file).
// No other wiring — the dropdown, floor and fallback all read this registry.

/** The three emotion buckets a reaction sting maps to. Stable across packs so a
 *  pack swap keeps the same emotion→timing behavior. */
export type ReactionSfxBucket = "shock" | "funny" | "hype";
export const REACTION_SFX_BUCKETS: ReactionSfxBucket[] = ["shock", "funny", "hype"];

export interface ReactionSfxPack {
  /** Stable id the inspector stores as config.sfxPackId. */
  id: string;
  /** Human label for the inspector dropdown. */
  label: string;
  /** The SFX file id (a key of SFX_FILES) fired for each emotion bucket. */
  stings: Record<ReactionSfxBucket, string>;
}

/** Registered reaction-SFX packs. Seeded with the current "Gen Z Meme" set —
 *  identical to the pre-selector behavior (shock→vine-boom, funny→bruh,
 *  hype→fah). Append more here; each is one entry + three uploaded stings. */
export const REACTION_SFX_PACKS: ReactionSfxPack[] = [
  { id: "genz-meme", label: "Gen Z Meme", stings: { shock: "vine-boom", funny: "bruh", hype: "fah" } },
  { id: "cinematic-impact", label: "Cinematic Impact", stings: { shock: "riser-hit", funny: "record-scratch", hype: "whoosh-impact" } },
  { id: "cartoon-comedy", label: "Cartoon Comedy", stings: { shock: "cartoon-boing", funny: "slide-whistle", hype: "cartoon-tada" } },
];

/** Default pack = the pre-selector behavior. Un-configured / legacy nodes use it,
 *  so adding the selector is a no-op for existing graphs. */
export const DEFAULT_REACTION_SFX_PACK_ID = "genz-meme";

/** Whether a pack id is one of the registered set. Reads the live array so a
 *  test-registered throwaway pack (or a hot-added one) is recognized. */
export const isReactionSfxPackId = (id: unknown): id is string =>
  typeof id === "string" && REACTION_SFX_PACKS.some((p) => p.id === id);

/** Resolve a pack by id, falling back to the DEFAULT pack for an unknown/missing
 *  id (so a legacy node — or a stale id after a pack is removed — never breaks).
 *  Reads the live REACTION_SFX_PACKS array. */
export function reactionSfxPackById(id: string | undefined): ReactionSfxPack {
  return (id ? REACTION_SFX_PACKS.find((p) => p.id === id) : undefined)
    ?? REACTION_SFX_PACKS.find((p) => p.id === DEFAULT_REACTION_SFX_PACK_ID)
    ?? REACTION_SFX_PACKS[0];
}

/** Map an (AI-assigned) moment emotion to a reaction bucket, or null when the
 *  emotion is neutral (→ no sting is forced). One place for the emotion→bucket
 *  rules so the catalog floor and tests agree. */
export function reactionBucketForEmotion(emotion: string | undefined): ReactionSfxBucket | null {
  const e = (emotion ?? "").toLowerCase();
  if (/shock|controvers|surpris|wtf|crazy|insane/.test(e)) return "shock";
  if (/funny|fun|comed|laugh|meme|silly|awkward/.test(e)) return "funny";
  if (/inspir|hype|wow|epic|emotion|amaz/.test(e)) return "hype";
  return null;
}

/** Seconds-into-clip the sting targets, keyed by emotion BUCKET (not by the sting
 *  FILE) — so a new pack's differently-named files keep the right per-emotion
 *  timing instead of silently falling to the default. Clamped by the caller. */
export function reactionSfxTargetSec(bucket: ReactionSfxBucket): number {
  return bucket === "shock" ? 0.2 : bucket === "funny" ? 1.2 : 1.6;
}

// ── Sound Effect tool (Editor tab) — KEYWORD-based algo ─────────────────────
// clip.memeaudio (above) picks its bucket from an LLM-assigned moment emotion,
// which the Editor tab's manually-assembled clips (uploads, generations, hand-
// cut sources) never have. Same three-bucket model, same one-sting-per-clip
// philosophy, but the trigger is a WORD the clip's own transcript actually
// says — the first match wins (in spoken order), so the sting lands on the
// exact moment that earned it instead of a fixed fraction of the clip.

/** Bucket-triggering words, matched against a single cleaned (lowercased,
 *  punctuation-stripped) transcript word. Casual UGC/short-form vocabulary —
 *  broad enough to catch real speech, anchored (^...$) so "wait" doesn't also
 *  match inside "waiting" and misfire. */
const KEYWORD_TRIGGERS: Record<ReactionSfxBucket, RegExp> = {
  shock: /^(wait|what|whoa+|omg|oml|no+|nooo+|stop|wtf|seriously|insane|crazy|shut ?up)$/i,
  funny: /^(lol|lmao|lmfao|haha+|hilarious|funny|dead|bruh|bro)$/i,
  hype: /^(fire|amazing|incredible|wow|epic|goat|yes+|lesgo|letsgo|W)$/i,
};
/** Checked in this order — a word matching an earlier bucket wins ties (e.g.
 *  "wow" only ever means hype; ordering only matters for words that could
 *  plausibly straddle two lists, which the anchored regexes above avoid, but
 *  keeping a fixed order makes the result deterministic regardless of object
 *  key iteration). */
const BUCKET_CHECK_ORDER: ReactionSfxBucket[] = ["shock", "funny", "hype"];

export interface SfxKeywordMatch {
  bucket: ReactionSfxBucket;
  /** Seconds into the clip (word-relative, i.e. clip-local if the caller
   *  already offset `words` to start at 0 — see overlay-burn's usage). */
  atSec: number;
  /** The actual word that triggered it, for logging/diagnostics. */
  word: string;
}

/** Scan a transcript for the FIRST word matching any bucket's trigger list, in
 *  spoken order. Returns null when nothing matches — a clip with no trigger
 *  word gets NO sting, same "never force it" philosophy as the emotion path.
 *  Pure — no I/O, unit-testable. */
export function pickSfxFromKeywords(words: TranscriptWord[]): SfxKeywordMatch | null {
  for (const w of words) {
    const clean = w.word.trim().replace(/[^\p{L}']/gu, "").toLowerCase();
    if (!clean) continue;
    for (const bucket of BUCKET_CHECK_ORDER) {
      if (KEYWORD_TRIGGERS[bucket].test(clean)) return { bucket, atSec: Math.max(0, w.start), word: clean };
    }
  }
  return null;
}
