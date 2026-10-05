export type AgentDescriptionInput = {
  name?: string | null;
  niche?: string | null;
  archetype?: string | null;
  agentType?: string | null;
  audience?: string | null;
  contentPillars?: string[] | null;
};

function clean(value: string | null | undefined, fallback: string, maxLength = 80): string {
  const normalized = (value ?? "")
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/[.!?]+/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!,;:\s]+$/g, "")
    .trim();
  const resolved = normalized || fallback;
  if (resolved.length <= maxLength) return resolved;
  const shortened = resolved.slice(0, maxLength + 1).replace(/\s+\S*$/, "").trim();
  return shortened || resolved.slice(0, maxLength).trim();
}

function cleanList(values?: string[] | null): string[] {
  return (values ?? [])
    .map((value) => clean(value, "", 28))
    .filter(Boolean)
    .slice(0, 3);
}

function joinNatural(values: string[]): string {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values[0]}, ${values[1]}, and ${values[2]}`;
}

/**
 * Canonical marketplace and builder description.
 *
 * Every agent follows the same contract: sentence one says who the agent is and
 * who it serves; sentence two says what it produces and how. The output is
 * deterministic, plain text, and contains no en/em dashes.
 */
export function formatAgentDescription(input: AgentDescriptionInput): string {
  const name = clean(input.name, "This agent", 42);
  const niche = clean(input.niche, "general interest", 72);
  const voice = clean(input.archetype, "clear and engaging", 42).toLowerCase();
  const audience = clean(input.audience, `people interested in ${niche}`, 82);
  const pillars = cleanList(input.contentPillars);
  const focus = pillars.length > 0 ? joinNatural(pillars) : niche;
  const type = (input.agentType ?? "influencer").toLowerCase();

  let description: string;
  if (type === "clipping" || type === "clipper") {
    description = `${name} is an AI clipper focused on ${niche}. It turns long videos into concise, high-retention social clips with a ${voice} style.`;
  } else if (type === "trader") {
    description = `${name} is an AI market analyst for ${audience}. It tracks ${focus} and explains opportunities with a ${voice} point of view.`;
  } else if (type === "worker") {
    description = `${name} is an AI specialist for ${audience}. It handles work across ${focus} with a ${voice} approach.`;
  } else {
    description = `${name} is an AI creator for ${audience}. They publish useful, entertaining content about ${focus} with a ${voice} voice.`;
  }

  return description.replace(/[\u2013\u2014]/g, ",");
}
