import { callClaudeText } from "@/lib/server/kie-claude";

export interface PersonaKernelInput {
  agentName: string;
  agentNiche?: string;
  agentArchetype?: string;
  voiceArchetype?: string;
  characterBible?: string;
  aesthetic?: string;
  traits?: string[];
  catchphrase?: string;
  personality?: { warmth?: number; humor?: number; authority?: number; boldness?: number };
  brandColor?: string;
  colorGrade?: string;
  cameraStyle?: string;
  energy?: string;
  settings?: string[];
  memories?: Array<{ kind: string; summary: string; importance: number }>;
}

/** Map the 4 personality dials to a short energy descriptor. */
function energyDescriptor(p?: PersonaKernelInput["personality"], energyHint?: string): string {
  if (energyHint) return energyHint;
  const humor = p?.humor ?? 50;
  const boldness = p?.boldness ?? 50;
  const authority = p?.authority ?? 50;
  if (boldness >= 75 && humor >= 60) return "high-energy, frenetic, explosive delivery";
  if (authority >= 75 && boldness < 60) return "commanding, measured, authoritative presence";
  if (humor >= 70) return "playful, upbeat, expressive";
  if (authority >= 60) return "confident, poised, deliberate";
  return "natural, grounded, conversational";
}

/** Assemble a compact persona visual-identity block from structured fields. Deterministic. */
export function buildPersonaKernelDeterministic(input: PersonaKernelInput): string {
  const bible = (input.characterBible ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const traits = (input.traits ?? []).slice(0, 4).join(", ");
  const topMemories = (input.memories ?? [])
    .slice()
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 2)
    .map((m) => m.summary.trim())
    .filter(Boolean);
  const settings = (input.settings ?? []).slice(0, 3).join("; ");

  const lines = [
    `CHARACTER IDENTITY — a FICTIONAL, ORIGINAL character (not a real, famous, or recognizable public figure); keep this character and their world consistent in EVERY frame:`,
    `• Who: ${input.agentName}${input.agentNiche ? ` — ${input.agentNiche} creator` : ""}${input.voiceArchetype ? ` (${input.voiceArchetype} voice)` : ""}.`,
    bible ? `• Look & wardrobe: ${bible}` : "",
    input.aesthetic ? `• Aesthetic: ${input.aesthetic}.` : "",
    input.brandColor || input.colorGrade
      ? `• Palette / grade: ${[input.brandColor, input.colorGrade].filter(Boolean).join(", ")}.`
      : "",
    `• Energy & camera: ${energyDescriptor(input.personality, input.energy)}${input.cameraStyle ? `; ${input.cameraStyle} camera` : ""}.`,
    settings ? `• Recurring world/settings: ${settings}.` : "",
    traits ? `• Traits: ${traits}.` : "",
    input.catchphrase ? `• Signature line/tic: "${input.catchphrase}".` : "",
    topMemories.length ? `• Continuity notes: ${topMemories.join(" ")}` : "",
  ].filter(Boolean);

  return lines.join("\n").slice(0, 1200);
}

const KERNEL_SYSTEM =
  "You distill an AI creator's persona into a compact VISUAL IDENTITY KERNEL used to keep every generated video clip on-brand. Output 6-9 terse bullet lines covering: who they are, exact look/wardrobe, aesthetic, palette/grade, energy & camera signature, recurring settings/props, and any signature visual tic. No preamble, no markdown fences. Under 180 words.";

// Process-level kernel cache. The kernel is a pure distillation of the JSON
// payload below — same inputs, same kernel — yet it was re-generated (one full
// LLM round-trip) on EVERY video render of the same unchanged agent. Keyed by
// the exact request payload, so any persona/memory change naturally misses and
// regenerates. Railway runs a long-lived Node process, so this holds across
// renders; a restart just repopulates lazily.
const kernelCache = new Map<string, string>();
const KERNEL_CACHE_MAX = 500;

/** LLM-distilled kernel (Haiku) with a deterministic fallback when unavailable. */
export async function buildPersonaKernel(
  input: PersonaKernelInput,
  opts?: { apiKey?: string },
): Promise<string> {
  const deterministic = buildPersonaKernelDeterministic(input);
  try {
    const user = JSON.stringify({
      name: input.agentName,
      niche: input.agentNiche,
      archetype: input.agentArchetype,
      voice: input.voiceArchetype,
      characterBible: (input.characterBible ?? "").slice(0, 900),
      aesthetic: input.aesthetic,
      traits: input.traits,
      catchphrase: input.catchphrase,
      personality: input.personality,
      brandColor: input.brandColor,
      colorGrade: input.colorGrade,
      cameraStyle: input.cameraStyle,
      settings: input.settings,
      memories: (input.memories ?? []).slice(0, 3).map((m) => m.summary),
    });
    const cached = kernelCache.get(user);
    if (cached) return cached;
    const text = await callClaudeText({ system: KERNEL_SYSTEM, user, apiKey: opts?.apiKey });
    const trimmed = (text ?? "").trim();
    if (trimmed.length > 40) {
      const kernel = trimmed.slice(0, 1200);
      if (kernelCache.size >= KERNEL_CACHE_MAX) {
        const oldest = kernelCache.keys().next().value;
        if (oldest !== undefined) kernelCache.delete(oldest);
      }
      kernelCache.set(user, kernel);
      return kernel;
    }
    return deterministic;
  } catch {
    return deterministic;
  }
}
