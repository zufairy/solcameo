/** Canonical union of the two historical vocabularies:
 *  lib/builder/videoStyles.ts VIDEO_STYLES (8) and
 *  lib/server/creativeDirector.ts VIDEO_FORMATS (9). */
export const VIDEO_FORMATS: Array<{ id: string; label: string; aliases: string[] }> = [
  { id: "talking_head", label: "Talking head", aliases: ["talking head", "to camera"] },
  { id: "commercial", label: "Commercial / ad", aliases: ["ad", "tv ad", "advert"] },
  { id: "ootd", label: "Outfit / OOTD", aliases: ["ootd", "outfit"] },
  { id: "vlog", label: "Vlog", aliases: ["day in life vlog"] },
  { id: "tutorial", label: "Tutorial", aliases: ["how-to", "howto"] },
  { id: "ugc_review", label: "UGC review", aliases: ["unboxing", "review"] },
  { id: "cinematic_broll", label: "Cinematic b-roll", aliases: ["broll", "atmospheric"] },
  { id: "asmr", label: "ASMR", aliases: ["satisfying"] },
  { id: "storytelling", label: "Storytelling", aliases: ["story"] },
  { id: "pov", label: "POV", aliases: ["point of view"] },
  { id: "listicle", label: "Listicle", aliases: ["top 5", "top list"] },
  { id: "day_in_life", label: "Day in the life", aliases: ["day-in-life"] },
  { id: "reaction", label: "Reaction", aliases: ["react"] },
  { id: "hot_take", label: "Hot take", aliases: ["rant", "opinion"] },
  { id: "b_roll_voiceover", label: "B-roll voiceover", aliases: ["voiceover montage"] },
];

const BY_KEY = new Map<string, string>();
for (const f of VIDEO_FORMATS) {
  BY_KEY.set(f.id, f.id);
  BY_KEY.set(f.label.toLowerCase(), f.id);
  for (const a of f.aliases) BY_KEY.set(a.toLowerCase(), f.id);
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Map any style/format/alias/free-text into a canonical id. Unknown → custom:<slug>. */
export function resolveFormatId(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) return "talking_head";
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (BY_KEY.has(raw.toLowerCase())) return BY_KEY.get(raw.toLowerCase())!;
  if (BY_KEY.has(normalized)) return BY_KEY.get(normalized)!;
  return `custom:${slug(raw)}`;
}
