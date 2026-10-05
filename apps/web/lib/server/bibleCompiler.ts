// Compiles a free-form show concept into a structured ShowBible via the shared
// JSON LLM helper. The model fills EVERY field with concrete, non-empty values
// derived from the concept + persona — the Ideas engine and script generator
// read the result verbatim.
import { callClaudeJSON } from "./kie-claude";
import { normalizeShowBible, type ShowBible } from "../builder/showBible";
import { ARCHETYPES, getArchetype } from "../builder/showArchetypes";

export interface BibleCompilerAgent {
  name: string;
  niche: string;
  archetype?: string;
  description?: string;
  language?: string;
}

export function buildBibleCompilerPrompt(args: {
  concept: string;
  existing?: ShowBible | null;
  agent: BibleCompilerAgent;
}): { system: string; user: string } {
  const { concept, existing, agent } = args;
  const system = `You are a showrunner who turns a creator's concept into a structured "show bible" for an autonomous short-form video agent. The bible drives EVERY future video: ideas, scripts, visuals, durations. Fill every field with specific, concrete values — never empty arrays, never placeholders. Reply with ONLY a JSON object, no fences, no commentary.`;
  const user = `CREATOR: ${agent.name} — ${agent.archetype ?? "creator"} in the ${agent.niche} niche.${agent.description ? ` ${agent.description.slice(0, 300)}` : ""}${agent.language ? ` Content language: ${agent.language}.` : ""}

OPERATOR'S SHOW CONCEPT (compile THIS into the bible):
"${concept.trim().slice(0, 1500)}"
${existing ? `\nEXISTING BIBLE (the operator is refining it — keep what still fits, change what the concept asks to change):\n${JSON.stringify(existing).slice(0, 3000)}\n` : ""}
RULES
- "archetype": the show's type — EXACTLY one of: ${ARCHETYPES.map((a) => a.id).join(", ")}. Pick the closest match to the concept (stylized/animated → cartoon-series or anime-series; a real host on camera → talking-head; no on-screen host → faceless).
- "format.kinds": 1-3 distinct show formats this concept supports (e.g. "news-react", "skit", "explainer", "cartoon-episode", "vlog"). Rotation between them is automatic.
- "cast": recurring character(s) with a LOCKED visualIdentity description (used to keep them consistent across videos). Real-person/talking-head shows get one host entry.
- "visualWorld.settings": 3-6 DIFFERENT locations/backdrops to rotate — never a single room.
- "contentEngine.newsQueries": if the concept involves current events/news/trends, 2-5 live web-search queries that would find TODAY's material; else [].
- "contentEngine.evergreenPools": 3-6 topic pools that never go stale.
- "variationAxes.hookStyles": 3-5 opening-hook styles. "variationAxes.structures": 3-5 named narrative shapes (e.g. "problem-twist-verdict").
- "cadence.perFormatDuration": a {min,max} seconds range PER format kind, each within 10-60s, matched to the format (reaction/commentary longer, skits shorter).
- "contentMix": percent split of the show's ideas — "entertain" (pure watchability), "value" (teach/inform), "promo" (product/brand moments, kept native to the persona). Sums to 100. An influencer audience churns on hard sell — promo stays small (5-20) unless the concept is explicitly a product channel.
- "videoStyles": 2-4 NAMED, deliberately DIFFERENT video recipes the show rotates through (the director's rotation unit). Each pins one format kind + one structure + one hookStyle + a {min,max} duration; "weight" = how often it renders relative to the others (1-3). Styles must feel like different shows-within-the-show (e.g. "Street interview" vs "Hot take"), not re-labels of the same look.

Return ONLY this JSON:
{
  "premise": "one-paragraph show concept",
  "archetype": "one of the ids above",
  "format": { "kinds": ["..."] },
  "cast": [ { "name": "...", "role": "...", "visualIdentity": "..." } ],
  "visualWorld": { "style": "...", "settings": ["..."], "moods": ["..."] },
  "voice": { "tone": "...", "language": "${agent.language ?? "English"}", "catchphrases": ["..."] },
  "contentEngine": { "newsQueries": ["..."], "evergreenPools": ["..."], "seriesArcs": false },
  "contentMix": { "entertain": 60, "value": 30, "promo": 10 },
  "variationAxes": { "hookStyles": ["..."], "structures": ["..."], "cameraTreatments": ["..."] },
  "cadence": { "perFormatDuration": { "<format-kind>": { "min": 30, "max": 45 } }, "postsPerDay": 1 },
  "videoStyles": [ { "id": "street-interview", "name": "Street interview", "format": "<format-kind>", "structure": "...", "hookStyle": "...", "durationSec": { "min": 20, "max": 35 }, "weight": 2 } ]
}`;
  return { system, user };
}

export async function compileShowBible(args: {
  concept: string;
  existing?: ShowBible | null;
  agent: BibleCompilerAgent;
  apiKey?: string;
}): Promise<ShowBible | null> {
  const { system, user } = buildBibleCompilerPrompt(args);
  try {
    const raw = await callClaudeJSON<Record<string, unknown>>({ system, user, maxTokens: 2000, apiKey: args.apiKey });
    // Locked visual refs are the builder's approved LOOK — a text recompile must
    // never drop them. Archetype falls back to the existing one when the model
    // omits or hallucinates it (normalizeShowBible drops unknown ids).
    const bible = normalizeShowBible({
      ...raw,
      compiledFrom: args.concept.trim(),
      visualRefs: (raw as { visualRefs?: unknown }).visualRefs ?? args.existing?.visualRefs,
      archetype: (raw as { archetype?: unknown }).archetype ?? args.existing?.archetype,
    });
    // Episodic archetypes run as a continuing show: the agent carries threads
    // across episodes (ideation reads seriesEpisodes' open threads).
    if (bible && getArchetype(bible.archetype)?.episodic) bible.contentEngine.seriesArcs = true;
    return bible;
  } catch (e) {
    console.warn("[bibleCompiler] compile failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
