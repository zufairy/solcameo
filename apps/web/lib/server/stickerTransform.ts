import { callClaudeJSON } from "./kie-claude";

export interface StickerTextResult {
  text: string;
  mode: "llm" | "fallback";
}

/**
 * Context-aware Viral Sticker text. When the operator gives a steer
 * (stickerPrompt, e.g. "announce joining the $$$ trend"), an LLM writes a short
 * ALL-CAPS sticker line grounded in THIS clip's caption. Otherwise (or on any LLM
 * failure) it returns the deterministic `fallback` (a punchy phrase already
 * derived from the clip caption) — so the sticker is ALWAYS context-aware and
 * always renders. Pure fetch (callClaudeJSON) → safe in the Convex action too.
 */
export async function transformStickerText(
  captionText: string,
  prompt: string,
  fallback: string,
  apiKey: string,
): Promise<StickerTextResult> {
  const instruction = prompt.trim();
  if (instruction && apiKey) {
    try {
      const system =
        "You write ONE short punchy on-screen STICKER line for a short-form video " +
        "(like an Instagram/TikTok story text sticker). Given the clip's caption and an " +
        "operator instruction, return a 2-5 word ALL-CAPS phrase that fits the clip and the " +
        'instruction (e.g. instruction "announce joining the $$$ trend" → "JOINING THE $$$ TREND"). ' +
        'Return ONLY JSON { "text": "..." }.';
      const user = `INSTRUCTION: ${instruction}\n\nCLIP CAPTION: ${captionText || "(none)"}`;
      const out = await callClaudeJSON<{ text?: unknown }>({ system, user, apiKey });
      if (out && typeof out.text === "string" && out.text.trim()) {
        return { text: out.text.trim().toUpperCase().slice(0, 40), mode: "llm" };
      }
    } catch (e) {
      console.warn("[stickerTransform] LLM failed:", e instanceof Error ? e.message : e);
    }
  }
  return { text: fallback, mode: "fallback" };
}
