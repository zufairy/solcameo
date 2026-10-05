import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import {
  decideEpisodeIntent,
  buildEpisodeBrief,
  choosePremise,
  avoidList,
  type EpisodeBrief,
  type EpisodeRecord,
  type SeriesConfig,
} from "@/lib/server/episodePlanner";

/**
 * SERIES MODE run flow — persona + memory in, an episode brief (and its KIE
 * reference images) out.
 *
 * The order matters and is the whole point:
 *   1. READ THE MEMORY (past episodes) before writing anything.
 *   2. DECIDE the intent from that memory — continue a hanging thread, or start
 *      something self-contained.
 *   3. ASK the model for premises that fit THE PERSONA, handing it the premises it
 *      may not repeat.
 *   4. REJECT reruns locally. The model is not trusted to remember; the planner is.
 *   5. Hand the brief + the cast's locked design frames to the existing video
 *      pipeline, which already carries them into the KIE prompts.
 */

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** How many candidate premises to ask for in one call. More is not better — the
 *  model repeats itself within a single response, so breadth comes from the avoid
 *  list, not from asking for twenty. */
const CANDIDATE_COUNT = 4;

export interface PersonaContext {
  name: string;
  /** The visual-identity block already used by the video pipeline. */
  personaKernel?: string;
  characterBible?: string;
  niche?: string;
  /** Content pillars — the fallback theme rotation when every candidate reruns. */
  pillars?: string[];
  /** The agent's own memories, newest/most important first. */
  memories?: string[];
}

/** True when this agent's persona is configured to run an episodic show. */
export function seriesEnabled(series: SeriesConfig | undefined | null): boolean {
  return !!series?.enabled && (!!series.premise?.trim() || (series.cast?.length ?? 0) > 0);
}

/** Read the show's memory. Returns [] when Convex is unavailable — a missing memory
 *  degrades into "everything is a fresh episode", never into a failed render. */
export async function loadEpisodes(mintAddress: string, limit = 12): Promise<EpisodeRecord[]> {
  if (!CONVEX_URL || !mintAddress) return [];
  try {
    const rows = await new ConvexHttpClient(CONVEX_URL).query(api.seriesEpisodes.recent, { mintAddress, limit });
    return (rows ?? []).map((r: { number: number; premise: string; ending?: string; openThreads?: string[]; cliffhanger?: boolean; createdAt: number }) => ({
      number: r.number,
      premise: r.premise,
      ending: r.ending,
      openThreads: r.openThreads,
      cliffhanger: r.cliffhanger,
      createdAt: r.createdAt,
    }));
  } catch (e) {
    console.warn(`[series] episode memory unavailable, treating as a fresh start: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/**
 * Ask the model for premise candidates that fit the persona and are NOT reruns.
 *
 * The avoid list is stated as a hard constraint AND enforced afterwards by the
 * planner, because a model told "don't repeat these" still will.
 */
async function generateCandidates(args: {
  persona: PersonaContext;
  series: SeriesConfig;
  intent: string;
  thread?: string;
  lastEnding?: string;
  avoid: string[];
}): Promise<string[]> {
  const { persona, series, intent, thread, lastEnding, avoid } = args;
  const system =
    "You are the show-runner for a short-form animated series. You write premises only — " +
    "one sentence each, concrete, visual, and playable in under a minute. No titles, no numbering, no commentary.";
  const user = [
    `SHOW: ${series.premise?.trim() || "an ongoing character series"}`,
    series.world?.trim() ? `WORLD: ${series.world.trim()}` : "",
    `LEAD CHARACTER: ${persona.name}${persona.characterBible ? ` — ${persona.characterBible.slice(0, 400)}` : ""}`,
    (series.cast?.length ?? 0) > 1
      ? `OTHER CAST: ${series.cast!.slice(1).map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(", ")}`
      : "",
    persona.memories?.length ? `WHAT THE CHARACTER REMEMBERS:\n${persona.memories.slice(0, 5).map((m) => `- ${m}`).join("\n")}` : "",
    intent === "continue" && thread
      ? `THIS EPISODE CONTINUES THE STORY. Unresolved: ${thread}${lastEnding ? `\nThe last episode ended: ${lastEnding}` : ""}\nPay this off — do not restate it, move it forward.`
      : "THIS EPISODE IS SELF-CONTAINED. A viewer who has seen nothing else must follow it.",
    avoid.length
      ? `ALREADY MADE — a premise that repeats any of these is unusable:\n${avoid.map((a) => `- ${a}`).join("\n")}`
      : "",
    `Return ONLY JSON: { "premises": [${Array.from({ length: CANDIDATE_COUNT }, () => '"..."').join(", ")}] }`,
  ].filter(Boolean).join("\n\n");

  try {
    const out = (await callClaudeJSON<{ premises?: unknown }>({ system, user, maxTokens: 500 })) ?? null;
    const list = Array.isArray(out?.premises) ? out!.premises : [];
    return list.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim());
  } catch (e) {
    console.warn(`[series] premise generation failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

export interface PlannedEpisode extends EpisodeBrief {
  /** Rejected-as-rerun count + fallback use, for the run log. */
  rerunRejected: number;
  usedFallback: boolean;
}

/**
 * Plan the next episode: read the memory, decide the intent, get a non-repeating
 * premise, and assemble the brief the renderer and KIE prompts are built from.
 *
 * `operatorPrompt` short-circuits generation entirely — a prompted episode is the
 * operator's premise verbatim.
 */
export async function planNextEpisode(args: {
  mintAddress: string;
  persona: PersonaContext;
  series: SeriesConfig;
  operatorPrompt?: string;
}): Promise<PlannedEpisode> {
  const episodes = await loadEpisodes(args.mintAddress);
  const decision = decideEpisodeIntent({ episodes, operatorPrompt: args.operatorPrompt });

  let premise = (args.operatorPrompt ?? "").trim();
  let rerunRejected = 0;
  let usedFallback = false;

  if (!premise) {
    const candidates = await generateCandidates({
      persona: args.persona,
      series: args.series,
      intent: decision.intent,
      thread: decision.thread,
      lastEnding: decision.continues?.ending,
      avoid: avoidList(episodes),
    });
    const chosen = choosePremise({
      candidates,
      episodes,
      // Persona pillars are the theme rotation: when every candidate is a rerun,
      // reaching for the pillar we haven't touched in longest is still on-persona.
      themes: args.series.themes?.length ? args.series.themes : args.persona.pillars,
    });
    premise = chosen.premise;
    rerunRejected = chosen.rerunRejected;
    usedFallback = chosen.usedFallback;
    // Nothing usable came back at all — fall back to the show's own premise rather
    // than rendering an empty brief.
    if (!premise) premise = args.series.premise?.trim() || `${args.persona.name} has a bad day`;
  }

  const brief = buildEpisodeBrief({ series: args.series, episodes, decision, premise });
  return { ...brief, rerunRejected, usedFallback };
}

/**
 * Extract what the finished script left behind, so the NEXT episode can continue it.
 * Best-effort: a failure records the episode with no threads, which simply means the
 * next one starts fresh.
 */
export async function extractContinuity(scriptText: string): Promise<{ ending?: string; openThreads: string[]; cliffhanger: boolean }> {
  const text = (scriptText ?? "").trim();
  if (!text) return { openThreads: [], cliffhanger: false };
  try {
    const out = (await callClaudeJSON<{ ending?: unknown; openThreads?: unknown; cliffhanger?: unknown }>({
      system: "You summarize a short video script for series continuity. Answer only with JSON.",
      user: `SCRIPT:\n${text.slice(0, 2000)}\n\nReturn ONLY JSON:\n{ "ending": "<one sentence: how it ends>", "openThreads": ["<anything left unresolved>"], "cliffhanger": <true only if it deliberately ends unresolved> }`,
      maxTokens: 400,
    })) ?? null;
    return {
      ending: typeof out?.ending === "string" ? out.ending.trim() : undefined,
      openThreads: Array.isArray(out?.openThreads)
        ? out!.openThreads.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim()).slice(0, 3)
        : [],
      cliffhanger: out?.cliffhanger === true,
    };
  } catch (e) {
    console.warn(`[series] continuity extraction failed: ${e instanceof Error ? e.message : e}`);
    return { openThreads: [], cliffhanger: false };
  }
}

/** Append the episode to the show's memory. Best-effort — a lost write means the
 *  next episode may re-pick a premise, which is recoverable; a thrown error here
 *  would lose an already-rendered video, which is not. */
export async function recordEpisode(args: {
  mintAddress: string;
  brief: EpisodeBrief;
  continuity: { ending?: string; openThreads: string[]; cliffhanger: boolean };
  taskId?: string;
  videoUrl?: string;
}): Promise<number | null> {
  if (!CONVEX_URL) return null;
  try {
    const res = await new ConvexHttpClient(CONVEX_URL).mutation(api.seriesEpisodes.record, {
      mintAddress: args.mintAddress,
      premise: args.brief.topic.replace(/^EP\d+:\s*/, ""),
      intent: args.brief.intent,
      ending: args.continuity.ending,
      openThreads: args.continuity.openThreads,
      cliffhanger: args.continuity.cliffhanger,
      cast: args.brief.cast.map((c) => c.name),
      taskId: args.taskId,
      videoUrl: args.videoUrl,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    return res?.number ?? null;
  } catch (e) {
    console.warn(`[series] could not record the episode: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
