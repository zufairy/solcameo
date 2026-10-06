import { generatePostCaption } from "@/lib/server/captionTransform";

/** Playbook the caption writer follows. Tuned for X, where the first line decides the scroll. */
const INSTRUCTION = [
  "Write a viral X (Twitter) caption for a short AI character video, in the character's own voice.",
  "Line one is a scroll-stopping hook: curiosity, a bold claim about the scene, or a relatable moment. No generic openers.",
  "Then at most one short line that adds context or tension, and end with a question or invitation so people reply.",
  "Use 2 to 3 relevant hashtags (one broad, one niche), at most one emoji, no links, no @mentions of real people.",
  "Under 240 characters. English unless the character clearly speaks another language. Never promise returns or give financial advice.",
].join(" ");

export async function writeViralCaption(opts: { name: string; niche?: string; bio?: string; referenceTitle: string; scene?: string }): Promise<string> {
  const basis = [
    `Character: ${opts.name}${opts.niche ? ` (${opts.niche})` : ""}`,
    opts.bio ? `About them: ${opts.bio.slice(0, 220)}` : "",
    `Video: a recreation of "${opts.referenceTitle}"`,
    opts.scene ? `Scene direction: ${opts.scene.slice(0, 260)}` : "",
  ].filter(Boolean).join("\n");
  const caption = await generatePostCaption({ instruction: INSTRUCTION, basis });
  if (caption) return caption.slice(0, 270);
  // Fallback keeps the post going when the writer is unavailable.
  return `${opts.name} just pulled this off. Would you watch the next one?`.slice(0, 270);
}
