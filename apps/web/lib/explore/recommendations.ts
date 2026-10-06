import type { ReferenceVideo } from "./feed";

const themes: Array<[RegExp, string[]]> = [
  [/dance|dancer|choreograph|music|singer|singing|rap|musician/i, ["dance", "performance", "music", "stage", "concert"]],
  [/fashion|beauty|model|style|makeup|outfit/i, ["lifestyle", "fashion", "outfit", "walk", "pose"]],
  [/fitness|sport|athlet|workout|gym|fight|action/i, ["action", "sport", "run", "fight", "jump", "training"]],
  [/comedy|funny|humor|humour|meme|playful/i, ["comedy", "funny", "absurd", "meme", "prank"]],
  [/travel|food|chef|cooking|daily|lifestyle/i, ["lifestyle", "travel", "food", "cooking", "street"]],
  [/gaming|gamer|fantasy|anime|cosplay/i, ["action", "fantasy", "anime", "cosplay", "game"]],
];
const ignore = new Set(["their", "about", "with", "from", "this", "that", "have", "agent", "name", "persona", "character", "influencer", "personality", "description", "niche"]);

/** Stable content matching: persona words and related themes against the actual reference metadata. */
export function referenceAffinity(item: ReferenceVideo, persona: string): number {
  // Blueprint JSON includes numeric trait keys (for example humor); only values describe the persona.
  try {
    const values = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(values) : value && typeof value === "object" ? Object.values(value).flatMap(values) : [];
    persona = values(JSON.parse(persona)).join(" ");
  } catch { /* plain-text persona */ }
  if (!persona.trim()) return 0;
  const text = `${item.title} ${item.description} ${item.category} ${item.prompt ?? ""}`.toLowerCase();
  const words = [...new Set(persona.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter(word => !ignore.has(word));
  let score = words.reduce((sum, word) => sum + (text.includes(word) ? 3 : 0), 0);
  for (const [pattern, related] of themes) {
    if (pattern.test(persona)) score += related.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  }
  return score;
}
