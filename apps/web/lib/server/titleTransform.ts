import { callClaudeJSON } from "./kie-claude";

export type TitleTextResult = { text: string; mode: "llm" | "fallback" };

/**
 * Write the Hook Title Card slate text from the operator's prompt-box idea + the
 * clip's caption. Mirrors stickerTransform: when the operator typed an instruction
 * (and an API key is available) the LLM writes a tight curiosity-gap headline that
 * fits BOTH the clip and the instruction; otherwise we fall back to the
 * deterministic caption-derived hook. Case is preserved (the chosen title template
 * decides ALL-CAPS at burn time), and it's hard-capped to a slate-safe length.
 *
 * `vibe` is the chosen template's default steer (e.g. "A shocking BREAKING-style
 * headline") — used to flavour the prompt so, say, the Newspaper template reads
 * like a headline even when the operator's instruction is terse.
 */
export async function transformTitleText(
  captionText: string,
  prompt: string,
  vibe: string,
  fallback: string,
  apiKey: string,
): Promise<TitleTextResult> {
  const instruction = prompt.trim();
  const caption = (captionText ?? "").trim();
  // Generate whenever there's an API key AND something to work from — a prompt OR the
  // clip's caption. This means the slate ALWAYS opens on a punchy, clip-RELATED hook
  // (written from the clip's content), not the crude first-few-words fallback. The
  // operator's prompt, when present, steers the angle.
  if (apiKey && (instruction || caption)) {
    try {
      const system =
        "You write ONE short, scroll-stopping TITLE-CARD headline for a short-form video " +
        "(the opening slate before the clip plays). From the clip's caption and the desired " +
        "style — plus an optional operator instruction — return a punchy curiosity-gap headline " +
        "of MAX 8 words that is clearly ABOUT this clip (never generic). No hashtags, no quotes, " +
        'no emojis. Return ONLY JSON { "text": "..." }.';
      const user = `STYLE: ${vibe}\n${instruction ? `INSTRUCTION: ${instruction}\n` : ""}CLIP CAPTION: ${caption || "(none)"}`;
      const out = await callClaudeJSON<{ text?: unknown }>({ system, user, apiKey });
      if (out && typeof out.text === "string" && out.text.trim()) {
        return { text: out.text.trim().replace(/^["']|["']$/g, "").slice(0, 60), mode: "llm" };
      }
    } catch (e) {
      console.warn("[titleTransform] LLM failed:", e instanceof Error ? e.message : e);
    }
  }
  return { text: fallback, mode: "fallback" };
}
