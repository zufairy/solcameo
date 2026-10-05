import { keywords, overlapScore } from "@/lib/server/videoPool";

/**
 * Light stemmer for premise comparison.
 *
 * "blob eats the last snack" and "the blob ate all the snacks again" are the SAME
 * episode to a viewer, but a raw keyword match sees `eats`/`ate` and `snack`/`snacks`
 * as four distinct words and lets the rerun through. Folding plurals and common verb
 * endings is what makes the novelty gate actually catch a reworded repeat. Kept local
 * rather than pushed into the shared scorer, whose behaviour other callers rely on.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Stemmed content words — the unit premise similarity is measured in. */
function premiseWords(text: string | undefined | null): Set<string> {
  return new Set([...keywords(text)].map(stem));
}

/**
 * SERIES MODE — the planner that decides what an episodic agent makes next.
 *
 * An agent whose persona is a cartoon/animated character runs a SHOW, not a feed of
 * unrelated clips. Two things follow from that, and this module owns both:
 *
 *  1. CONTINUITY. When the last episode left a thread hanging, the next one should
 *     pay it off — but a series that only ever continues becomes an unwatchable
 *     serial for anyone arriving mid-feed, so continuations are capped and a payoff
 *     forces a fresh premise next.
 *  2. NOVELTY. The autonomy loop previously picked a topic with `pickRandom(topics)`,
 *     which is exactly how an agent ends up posting the same premise twice. Every
 *     candidate here is scored against the premises already made and rejected when
 *     it is a rerun.
 *
 * Everything is PURE: episodes and persona in, a decision out. The LLM call that
 * writes the actual premise lives in the caller, which passes candidates back here
 * to be accepted or rejected. That keeps the rules testable and cheap.
 */

/** One past episode, as recorded after its video rendered. */
export interface EpisodeRecord {
  number: number;
  /** The one-line premise that drove the episode. */
  premise: string;
  /** How it ended — seeds the next episode's recap when continuing. */
  ending?: string;
  /** Unresolved threads the next episode can pay off. */
  openThreads?: string[];
  /** True when the episode deliberately ended unresolved. */
  cliffhanger?: boolean;
  createdAt?: number;
}

/** A character in the show. `refImages` are its locked design-sheet frames. */
export interface CastMember {
  name: string;
  /** "lead", "rival", "sidekick" — free text, used in the prompt. */
  role?: string;
  /** What the operator described; also what the design sheet was generated from. */
  designPrompt?: string;
  refImages?: string[];
}

export interface SeriesConfig {
  enabled?: boolean;
  /** The show's standing premise ("two aliens running a failing space diner"). */
  premise?: string;
  /** Where it takes place — carried into every episode for a consistent world. */
  world?: string;
  cast?: CastMember[];
  /** Recurring themes to rotate through when there is no thread to continue. */
  themes?: string[];
}

export type EpisodeIntent = "prompted" | "continue" | "fresh";

export interface IntentDecision {
  intent: EpisodeIntent;
  /** The thread being paid off (continue only). */
  thread?: string;
  /** The episode being continued (continue only). */
  continues?: EpisodeRecord;
  /** Why the planner chose this — surfaced in the run log so the show is legible. */
  reason: string;
}

/**
 * Cap on back-to-back continuations. Three keeps an arc satisfying while
 * guaranteeing a self-contained entry point at least every fourth episode — which
 * is what a viewer arriving from a feed actually needs.
 */
export const MAX_CONSECUTIVE_CONTINUATIONS = 3;

/** Newest-first view of the episode log, defensive about unsorted input. */
function newestFirst(episodes: readonly EpisodeRecord[]): EpisodeRecord[] {
  return [...episodes].sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
}

/**
 * How many of the most recent episodes were continuations — approximated by a run
 * of episodes that each ended on a cliffhanger. A run at the cap forces a reset.
 */
function continuationRun(sorted: readonly EpisodeRecord[]): number {
  let run = 0;
  for (const ep of sorted) {
    if (ep.cliffhanger) run++;
    else break;
  }
  return run;
}

/**
 * Decide what the next episode should be. An operator prompt always wins — the
 * point of series mode is that the agent runs itself, not that it overrules you.
 */
export function decideEpisodeIntent(args: {
  episodes: readonly EpisodeRecord[];
  operatorPrompt?: string;
  maxContinuations?: number;
}): IntentDecision {
  const prompt = (args.operatorPrompt ?? "").trim();
  if (prompt) return { intent: "prompted", reason: "operator prompted this episode" };

  const sorted = newestFirst(args.episodes ?? []);
  const last = sorted[0];
  if (!last) return { intent: "fresh", reason: "first episode of the series" };

  const threads = (last.openThreads ?? []).map((t) => t.trim()).filter(Boolean);
  const cap = args.maxContinuations ?? MAX_CONSECUTIVE_CONTINUATIONS;
  const run = continuationRun(sorted);

  if (threads.length === 0) return { intent: "fresh", reason: "nothing left unresolved" };
  if (!last.cliffhanger) return { intent: "fresh", reason: "the last episode resolved itself" };
  if (run >= cap) {
    return { intent: "fresh", reason: `${run} cliffhangers in a row — starting a self-contained episode` };
  }
  return {
    intent: "continue",
    thread: threads[0],
    continues: last,
    reason: `paying off: ${threads[0]}`,
  };
}

/** Premises the planner must not repeat, newest first. */
export function avoidList(episodes: readonly EpisodeRecord[], limit = 12): string[] {
  return newestFirst(episodes).slice(0, limit).map((e) => e.premise).filter(Boolean);
}

/**
 * Reject a candidate premise that reruns an earlier one.
 *
 * Scored on stemmed content-word overlap, not string equality — "blob eats the last
 * snack" and "the blob ate all the snacks" are the same episode to a viewer even
 * though no string comparison would say so.
 *
 * The threshold is deliberately not tighter than half: a recurring cast means every
 * premise in the series shares the character names, so a low bar would flag every
 * new episode as a rerun of the last one.
 */
export function isRerun(candidate: string, priorPremises: readonly string[], threshold = 0.5): boolean {
  const cand = premiseWords(candidate);
  if (cand.size === 0) return false; // nothing to judge — let the caller proceed
  return priorPremises.some((prior) => overlapScore(cand, premiseWords(prior)) >= threshold);
}

/**
 * Fallback when repeated candidates keep coming back as reruns: the theme used
 * longest ago. Degrading into "something we haven't done in a while" is honest;
 * shipping a duplicate is not.
 */
export function leastRecentlyUsedTheme(
  themes: readonly string[],
  episodes: readonly EpisodeRecord[],
): string | undefined {
  const clean = themes.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return undefined;
  const sorted = newestFirst(episodes);
  // Rank each theme by how recently an episode mentioned it; never-used wins.
  let best: { theme: string; lastUsed: number } | undefined;
  for (const theme of clean) {
    const themeWords = premiseWords(theme);
    const idx = sorted.findIndex((ep) => overlapScore(themeWords, premiseWords(ep.premise)) >= 0.34);
    const lastUsed = idx === -1 ? Number.POSITIVE_INFINITY : sorted.length - idx;
    if (!best || lastUsed > best.lastUsed) best = { theme, lastUsed };
  }
  return best?.theme;
}

/**
 * Cast for one episode, capped at the video model's reference ceiling.
 *
 * Veo's REFERENCE_2_VIDEO lock takes at most 3 images, and each character needs one
 * for its identity to hold — so a bigger cast rotates through episodes instead of
 * crowding a single shot and losing every likeness at once. The lead (first entry)
 * is always present, which is what makes it a series rather than an anthology.
 */
export function pickCastForEpisode(cast: readonly CastMember[], episodeNumber: number, max = 3): CastMember[] {
  const usable = cast.filter((c) => c && c.name?.trim());
  if (usable.length <= max) return [...usable];
  const [lead, ...rest] = usable;
  const picked = [lead];
  // Rotate the supporting cast by episode number so everyone gets screen time and
  // the pairing changes week to week.
  for (let i = 0; i < max - 1; i++) {
    picked.push(rest[(episodeNumber + i) % rest.length]);
  }
  return picked;
}

export interface EpisodeBrief {
  episodeNumber: number;
  intent: EpisodeIntent;
  /** Short label used as the task/topic line. */
  topic: string;
  /** The full creative brief handed to the script writer + KIE prompt builder. */
  brief: string;
  /** Spoken recap that opens a continuation, if any. */
  recapLine?: string;
  cast: CastMember[];
  /** Reference frames for the identity lock, in cast order (≤3). */
  refImages: string[];
  reason: string;
}

/**
 * Assemble the brief the script writer and KIE prompts are built from.
 *
 * Persona FIRST: the show's premise, world and cast are the frame, and the episode
 * is one beat inside it. That ordering is deliberate — a brief that leads with the
 * episode idea produces videos that drift away from the character.
 */
export function buildEpisodeBrief(args: {
  series: SeriesConfig;
  episodes: readonly EpisodeRecord[];
  decision: IntentDecision;
  /** The premise for THIS episode (operator's prompt, or the accepted candidate). */
  premise: string;
}): EpisodeBrief {
  const { series, episodes, decision } = args;
  const episodeNumber = (newestFirst(episodes)[0]?.number ?? 0) + 1;
  const cast = pickCastForEpisode(series.cast ?? [], episodeNumber);
  const premise = args.premise.trim();

  const recapLine = decision.intent === "continue" && decision.continues?.ending
    ? `Last time: ${decision.continues.ending.trim()}`
    : undefined;

  const castBlock = cast.length
    ? cast.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}${c.designPrompt ? ` — ${c.designPrompt}` : ""}`).join("\n")
    : "- (single character — the agent's own persona)";

  const brief = [
    `SERIES: ${series.premise?.trim() || "an ongoing character series"}`,
    series.world?.trim() ? `WORLD: ${series.world.trim()}` : "",
    `CAST IN THIS EPISODE:\n${castBlock}`,
    `EPISODE ${episodeNumber} — ${decision.intent === "continue" ? "CONTINUES the last episode" : decision.intent === "prompted" ? "operator-prompted" : "self-contained"}`,
    decision.thread ? `THREAD TO PAY OFF: ${decision.thread}` : "",
    recapLine ? `OPEN WITH A ONE-LINE RECAP: ${recapLine}` : "",
    `PREMISE: ${premise}`,
    // The show's look is locked by the character references; saying so in words too
    // keeps the script writer from calling for shots the medium can't hold.
    "Keep every character exactly on-model with its reference design — same medium, same colours, no restyling.",
    "End on a beat that either lands a joke or opens ONE new thread; never end mid-sentence.",
  ].filter(Boolean).join("\n");

  return {
    episodeNumber,
    intent: decision.intent,
    topic: `EP${episodeNumber}: ${premise.slice(0, 90)}`,
    brief,
    recapLine,
    cast,
    refImages: cast.flatMap((c) => (c.refImages ?? []).slice(0, 1)).filter(Boolean).slice(0, 3),
    reason: decision.reason,
  };
}

/**
 * Accept the first candidate that is not a rerun, else fall back to the
 * least-recently-used theme, else the last candidate. Never returns empty when
 * given anything usable — the caller always has an episode to make.
 */
export function choosePremise(args: {
  candidates: readonly string[];
  episodes: readonly EpisodeRecord[];
  themes?: readonly string[];
  threshold?: number;
}): { premise: string; rerunRejected: number; usedFallback: boolean } {
  const prior = avoidList(args.episodes);
  let rejected = 0;
  for (const c of args.candidates) {
    const cand = (c ?? "").trim();
    if (!cand) continue;
    if (!isRerun(cand, prior, args.threshold)) return { premise: cand, rerunRejected: rejected, usedFallback: false };
    rejected++;
  }
  const theme = leastRecentlyUsedTheme(args.themes ?? [], args.episodes);
  if (theme) return { premise: theme, rerunRejected: rejected, usedFallback: true };
  const last = [...args.candidates].reverse().find((c) => (c ?? "").trim());
  return { premise: (last ?? "").trim(), rerunRejected: rejected, usedFallback: true };
}
