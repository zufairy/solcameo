import { callClaudeJSON } from "./kie-claude";
import { brainToPromptBlock, type AgentBrain } from "./agentBrain";
import { pickTargetSeconds, resolveDurationRange, type DurationRange } from "../builder/agentTypes";
import { VIDEO_FORMATS as VIDEO_FORMAT_DEFS, resolveFormatId } from "../builder/videoFormats";

/** Canonical allowed format ids — sourced from the unified lib/builder/videoFormats
 *  registry (union of VIDEO_STYLES + this module's historical format list).
 *  Kept as `VIDEO_FORMATS` for backward compatibility with existing imports/tests. */
export const VIDEO_FORMATS = VIDEO_FORMAT_DEFS.map((f) => f.id) as readonly string[];
const ALLOWED_FORMAT_IDS = VIDEO_FORMATS;
export type VideoFormat = string;

export interface CreativeBrief {
  format: VideoFormat;
  angle: string;
  topic: string;
  structureNotes: string;
  visualTreatment: string;
}

export interface DirectorPersona {
  name: string;
  niche: string;
  archetype?: string;
  voiceArchetype?: string;
  language?: string;
  contentPillars: string[];
  videoFormats: string[];
}

/** Deterministic fallback — rotate to a fresh format and a content-pillar topic. */
export function fallbackBrief(args: {
  niche: string; contentPillars: string[]; videoFormats: string[]; lastFormat?: string;
}): CreativeBrief {
  const pool = (args.videoFormats.length ? args.videoFormats : [...ALLOWED_FORMAT_IDS])
    .filter((f) => f !== args.lastFormat);
  const format = pool[0] ?? ALLOWED_FORMAT_IDS.find((f) => f !== args.lastFormat) ?? "storytelling";
  const topic = args.contentPillars[0] ?? `${args.niche} insight`;
  return {
    format,
    angle: `A fresh ${format} take on ${topic}`,
    topic,
    structureNotes: `Structure the beats for a ${format} video.`,
    visualTreatment: `On-brand ${args.niche} setting, natural lighting, scroll-stopping framing.`,
  };
}

/**
 * Pick a DISTINCT video format + plot for this render, grounded in the persona's
 * taste (videoFormats) + brain, and different from recent videos. LLM-driven;
 * falls back to a deterministic rotation if the model is unavailable.
 */
export async function planCreativeBrief(args: {
  persona: DirectorPersona;
  brain: AgentBrain;
  recentFormats: string[];
  seedTopic?: string;
  apiKey?: string;
  /** When this video promotes a paid campaign: brand + brief + crawled website. */
  campaignContext?: string;
  /** Random variation token so repeated runs pick a DIFFERENT angle each time. */
  nonce?: string;
}): Promise<CreativeBrief> {
  const { persona, brain, recentFormats } = args;
  const lastFormat = recentFormats[0];

  const campaignBlock = args.campaignContext
    ? `\n\nPAID CAMPAIGN — THIS VIDEO PROMOTES THE BUSINESS BELOW. Understand the product from the crawled website, then choose a format + angle whose SOLE job is to make viewers want this product. Optimize to CONVERT: a scroll-stopping hook tied to the product's benefit, a clear value proposition, and an explicit call-to-action. The angle MUST be about this brand/product, not a generic ${persona.niche} take.\n${args.campaignContext.slice(0, 2500)}`
    : "";

  const system = `You are the creative director for an AI influencer on Vello. Choose ONE concrete video FORMAT and a fresh plot for the next short-form video. ${args.campaignContext ? "This is a PAID CAMPAIGN — the plot must sell the campaign's product and be optimized for conversion. " : ""}Reply with ONLY a JSON object — no prose, no code fences.`;
  const user = `CREATOR: ${persona.name} — ${persona.archetype ?? "creator"} in the ${persona.niche} niche, ${persona.voiceArchetype ?? "expert"} voice${persona.language ? `, posts in ${persona.language}` : ""}.
CONTENT PILLARS: ${persona.contentPillars.join(", ") || "(none)"}
PREFERRED FORMATS (the operator's taste — choose within these when possible): ${persona.videoFormats.join(", ") || "(any)"}
RECENT VIDEO FORMATS (do NOT repeat these): ${recentFormats.join(", ") || "(none yet)"}
${args.seedTopic ? `REQUESTED TOPIC: ${args.seedTopic}\n` : ""}
${brainToPromptBlock(brain)}${campaignBlock}

Allowed formats: ${ALLOWED_FORMAT_IDS.join(", ")}.
${args.nonce ? `VARIATION TOKEN: ${args.nonce} — use this only to DIVERSIFY: pick a fresh, different angle/hook/setting than you would by default; never output the token.\n` : ""}Pick a format that fits the creator's preferred formats AND is different from the recent ones above. ${args.campaignContext ? "Ground the angle in the campaign's product + crawled business info above, and design it to convert — but vary the creative angle each time." : "Invent a SPECIFIC fresh angle/plot grounded in the knowledge + skills + pillars."} Return ONLY:
{ "format": "one of the allowed formats", "angle": "the specific creative angle/plot", "topic": "concise topic", "structureNotes": "how the beats should flow for this format", "visualTreatment": "setting, camera, energy, aesthetic" }`;

  try {
    const raw = await callClaudeJSON<Partial<CreativeBrief>>({ system, user, maxTokens: 700, apiKey: args.apiKey });
    // Normalize the model's returned format against the canonical registry —
    // known ids/aliases resolve to their canonical id; anything else is
    // promoted to a first-class `custom:<slug>` format rather than rejected.
    const format = typeof raw.format === "string" && raw.format.trim()
      ? resolveFormatId(raw.format)
      : undefined;
    if (format && format !== lastFormat && typeof raw.topic === "string" && raw.topic.trim()) {
      return {
        format,
        angle: String(raw.angle ?? `${format} on ${raw.topic}`).slice(0, 240),
        topic: String(raw.topic).slice(0, 120),
        structureNotes: String(raw.structureNotes ?? "").slice(0, 400),
        visualTreatment: String(raw.visualTreatment ?? "").slice(0, 400),
      };
    }
  } catch { /* fall through */ }

  return fallbackBrief({
    niche: persona.niche, contentPillars: persona.contentPillars,
    videoFormats: persona.videoFormats, lastFormat,
  });
}

/**
 * Agentic director entrypoint: pick a fresh creative brief AND a concrete target
 * length within the agent's duration range. Both generation paths call this so a
 * video's FORMAT, ANGLE, VISUAL TREATMENT, and LENGTH all vary per render —
 * driven by the agent's memory (brain) + settings — instead of a static template.
 *
 * `targetSeconds` comes from `pickTargetSeconds` (format-leaning + nonce jitter)
 * so the length tracks the format and never lands outside the agent's range.
 */
export async function planVideoCreative(args: {
  persona: DirectorPersona;
  brain: AgentBrain;
  recentFormats: string[];
  durationRange?: { min?: number; max?: number };
  seedTopic?: string;
  apiKey?: string;
  campaignContext?: string;
  nonce?: string;
}): Promise<{ brief: CreativeBrief; targetSeconds: number; range: DurationRange }> {
  const range = resolveDurationRange(args.durationRange?.min, args.durationRange?.max);
  const brief = await planCreativeBrief(args);
  const targetSeconds = pickTargetSeconds(brief.format, range, args.nonce ?? brief.angle);
  return { brief, targetSeconds, range };
}
