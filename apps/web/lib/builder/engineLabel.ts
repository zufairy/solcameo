/** Friendly engine name from a Kie model slug ("grok-imagine/image-to-video" → "Grok Imagine"). Unknown slugs show their first path segment, cleaned up. */
export function engineLabel(slug: string | null | undefined): string {
  const s = (slug ?? "").toLowerCase();
  if (!s) return "AI video";
  if (s.includes("genjutsu") || s.startsWith("hf:gj")) return "Genjutsu";
  if (s.includes("grok")) return "Grok Imagine";
  if (s.includes("gemini-omni")) return "Gemini Omni";
  if (s.includes("veo")) return "Veo 3.1";
  if (s.includes("seedance")) return "Seedance";
  if (s.includes("kling")) return "Kling";
  const stem = s.split("/")[0].replace(/[-_:]+/g, " ").trim();
  return stem ? stem.replace(/\b\w/g, (c) => c.toUpperCase()) : "AI video";
}
