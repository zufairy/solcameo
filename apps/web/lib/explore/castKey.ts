/** Mention token for a display name, shared by the prompt box and the server so they always agree. */
export const castToken = (name: string) => name.replace(/\s+/g, "").replace(/[^\w-]/g, "") || "agent";

/**
 * Higgsfield receives the cast as an ordered list of images and a prompt that names people with @Token. Nothing in
 * the request ties the two together, so we say it outright: "@Luna is image 1, @Kai is image 2". Every cast image
 * is named once, in image order, and every token the prompt mentions is bound to its picture.
 */
export function withCastKey(prompt: string, tokens: unknown, imageCount: number, mode: "motion-transfer" | "object-swap" = "motion-transfer"): string {
  const clean = (Array.isArray(tokens) ? tokens : []).map((t) => (typeof t === "string" ? t.replace(/[^\w-]/g, "").slice(0, 40) : "")).slice(0, imageCount);
  const base = prompt.replace(/\s*Cast images:.*$/is, "").trim();
  if (!clean.length || clean.some((t) => !t)) return base;
  const key = clean.map((t, i) => `@${t} = image ${i + 1}`).join(", ");
  const lead = base ? base : clean.length === 1 ? `Replace the subject with @${clean[0]}.` : `Replace the people with ${clean.map((t) => `@${t}`).join(" and ")}, in order.`;
  const rule = mode === "object-swap" ? "Keep each @name's face and look exactly as in its image." : "Keep each @name's face, hair and look exactly as in its image.";
  return `${lead} Cast images: ${key}. ${rule}`.slice(0, 4000);
}
