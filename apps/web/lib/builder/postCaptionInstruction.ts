/**
 * Post Captions tool (Editor tab sidebar) — the ONE place the operator's
 * prompt + mood + language become the Smart Captions instruction.
 *
 * Used by BOTH:
 *  - /api/agents/post-caption/generate (the "Generate caption" button), and
 *  - the editor's auto-save into clip.captionstyle config (`descriptionPrompt`),
 *    which /api/social/post and the auto-post pipeline (run-task) read via
 *    resolveDescriptionInstruction.
 * Same composer on both sides = the caption the operator previews in the tool is
 * written by the same instruction every later automatic post uses.
 *
 * Pure (no server imports) so the client component can call it.
 */
export interface PostCaptionSettings { prompt?: string; mood?: string; language?: string }

export function composePostCaptionInstruction(s: PostCaptionSettings): string {
  const prompt = (s.prompt ?? "").trim().slice(0, 500);
  const mood = (s.mood ?? "").trim().slice(0, 60);
  const language = (s.language ?? "").trim().slice(0, 60);
  return [
    prompt,
    mood ? `Mood/tone: ${mood}.` : "",
    language ? `Write it in ${language}.` : "",
  ].filter(Boolean).join(" ");
}

/** Config keys the editor persists on the clip.captionstyle skill row, next to
 *  `descriptionPrompt` (the composed instruction the publish paths read). */
export const POST_CAPTION_CONFIG_KEYS = {
  prompt: "postCaptionPrompt",
  mood: "postCaptionMood",
  language: "postCaptionLanguage",
} as const;

export function readPostCaptionSettings(cfg: unknown): PostCaptionSettings {
  const c = (cfg && typeof cfg === "object" ? cfg : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : undefined);
  return {
    prompt: str(POST_CAPTION_CONFIG_KEYS.prompt),
    mood: str(POST_CAPTION_CONFIG_KEYS.mood),
    language: str(POST_CAPTION_CONFIG_KEYS.language),
  };
}
