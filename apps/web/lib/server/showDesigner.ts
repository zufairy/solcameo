// Show Designer — pitch stage. Turns the builder's raw description (plus any
// dropped reference images) into 3 concrete show pitches, each with a
// style-frame image prompt so the builder judges the LOOK before any video
// money is spent (images are ~100x cheaper than video).
import { callClaudeJSON } from "./kie-claude";
import { ARCHETYPES, getArchetype } from "../builder/showArchetypes";

export interface ShowPitch {
  name: string;
  premise: string;
  archetype: string;
  formatKinds: string[];
  sampleIdeas: Array<{ headline: string; angle: string }>;
  styleFramePrompt: string;
}

export function buildPitchPrompt(args: {
  concept: string;
  agent: { name: string; niche: string; archetype?: string; description?: string; language?: string };
  hasRefImages: boolean;
  /** Builder's explicit video-type choice — locks all pitches to this archetype. */
  archetypeHint?: string;
}): { system: string; user: string } {
  const { concept, agent, hasRefImages } = args;
  const hinted = getArchetype(args.archetypeHint);
  const system = `You are a showrunner pitching short-form video shows for an autonomous AI creator. Given the builder's raw description, pitch 3 DISTINCT show concepts they could run — different tones/angles, not three phrasings of one idea. Reply with ONLY a JSON object, no fences, no commentary.`;
  const user = `CREATOR: ${agent.name} — ${agent.niche} niche.${agent.description ? ` ${agent.description.slice(0, 200)}` : ""}${agent.language ? ` Language: ${agent.language}.` : ""}

BUILDER'S DESCRIPTION (what's in their head — honor it, don't replace it):
"${concept.trim().slice(0, 1500)}"
${hasRefImages ? `\nThe builder attached reference images of the look/person they want. Your styleFramePrompt should describe a frame CONSISTENT with provided reference images (the image model receives them).\n` : ""}
For each of the 3 pitches:
- "name": a short show name.
- "premise": 2-3 sentences — what the show IS.
- "archetype": ${hinted ? `MUST be "${hinted.id}" for ALL 3 pitches — the builder chose this type. Vary tone/angle/world, not the type. Craft rules for this type: ${hinted.pitchHint}` : `EXACTLY one of: ${ARCHETYPES.map((a) => a.id).join(", ")}. Apply that type's craft (e.g. cartoons need recurring gags + readable silhouettes; talking-head needs a first-line payoff hook; UGC product needs handheld authenticity).`}
- "formatKinds": 1-3 format kinds fitting the archetype.
- "sampleIdeas": exactly 3 example episodes, each { "headline", "angle" } — concrete, scroll-stopping.
- "styleFramePrompt": ONE image-generation prompt for a single frame that shows this show's exact visual style (character, setting, art style, mood, 9:16 vertical). This is what sells the pitch visually.

Return ONLY: { "pitches": [ { "name": "...", "premise": "...", "archetype": "...", "formatKinds": ["..."], "sampleIdeas": [ { "headline": "...", "angle": "..." } ], "styleFramePrompt": "..." } ] }`;
  return { system, user };
}

/** Validate + default raw LLM pitches. Exported for tests. */
export function coercePitches(raw: unknown): ShowPitch[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: ShowPitch[] = [];
  for (const item of arr) {
    if (out.length >= 3) break;
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    const premise = String(r.premise ?? "").trim();
    if (!name || !premise) continue;
    const archetype = getArchetype(String(r.archetype ?? "").trim()) ? String(r.archetype).trim() : "custom";
    const arch = getArchetype(archetype)!;
    const formatKinds = Array.isArray(r.formatKinds)
      ? (r.formatKinds as unknown[]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 3)
      : [];
    const sampleIdeas = Array.isArray(r.sampleIdeas)
      ? (r.sampleIdeas as unknown[]).map((s) => {
          const m = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
          return { headline: String(m.headline ?? "").trim().slice(0, 160), angle: String(m.angle ?? "").trim().slice(0, 500) };
        }).filter((s) => s.headline && s.angle).slice(0, 3)
      : [];
    out.push({
      name: name.slice(0, 80),
      premise: premise.slice(0, 600),
      archetype,
      formatKinds: formatKinds.length ? formatKinds : [...arch.defaultFormats],
      sampleIdeas,
      styleFramePrompt: String(r.styleFramePrompt ?? "").trim().slice(0, 800)
        || `${premise.slice(0, 200)} — one 9:16 vertical frame showing this show's visual style`,
    });
  }
  return out;
}

export async function generatePitches(args: {
  concept: string;
  agent: { name: string; niche: string; archetype?: string; description?: string; language?: string };
  hasRefImages: boolean;
  archetypeHint?: string;
  apiKey?: string;
}): Promise<ShowPitch[]> {
  const { system, user } = buildPitchPrompt(args);
  try {
    const raw = await callClaudeJSON<{ pitches?: unknown }>({ system, user, maxTokens: 2400, apiKey: args.apiKey });
    return coercePitches(raw?.pitches);
  } catch (e) {
    console.warn("[showDesigner] pitch LLM failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
