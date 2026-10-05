import { callClaudeJSON } from "./kie-claude";

export type HookTextResult = { text: string; mode: "llm" | "fallback" };

// Used when the operator left the prompt box empty — the LLM still writes the
// hook (not the naive "first 6 words of the caption" truncation), it just has no
// steering instruction beyond "make it good, from THIS clip's own content."
const AUTO_INSTRUCTION =
  "No specific instruction was given — read the clip caption and write the single " +
  "strongest, most scroll-stopping hook for THIS clip's actual content (a real " +
  "curiosity gap, a surprising claim, or a stakes-first line) — never a generic " +
  "or filler opener, and never just the caption's own opening words verbatim.";

/**
 * Write the Auto Hook overlay line from the operator's prompt-box idea + the clip's
 * caption. Mirrors titleTransform, but tuned for an ON-VIDEO hook overlay: a very
 * short, curiosity-gap line (max ~7 words) that stops the scroll. Runs the LLM
 * whenever an API key is available — an operator instruction steers it further,
 * but its absence no longer skips generation (that used to fall straight to the
 * deterministic caption-truncation, which is why two clips whose caption text
 * started the same way burned an IDENTICAL hook — a real per-clip LLM read of
 * each clip's own content can't collide like that). Falls back to the
 * deterministic caption-derived hook only if the LLM call itself fails or no key
 * is configured. Hard-capped to an overlay-safe length.
 */
export async function transformHookText(
  captionText: string,
  prompt: string,
  fallback: string,
  apiKey: string,
  /** The operator's Auto Hook language dropdown (e.g. "Spanish"), if set.
   *  Takes priority over the caption-mirroring default below — previously
   *  this function had no language input at all, so the caption's own
   *  language was the only signal, and it silently lost to the LLM's own
   *  bias toward English whenever the caption was short/ambiguous. */
  language?: string,
): Promise<HookTextResult> {
  const instruction = prompt.trim();
  const lang = (language ?? "").trim();
  if (apiKey) {
    try {
      const system =
        "You write ONE ultra-short, scroll-stopping HOOK line overlaid on the first " +
        "seconds of a short-form video. Given the clip's caption and an operator " +
        "instruction, return a curiosity-gap hook of MAX 7 words that fits the clip and " +
        "the instruction. No hashtags, no quotes, no emojis. " +
        (lang
          // Explicit operator language pick — this is the intended output
          // language, full stop, unless the instruction itself overrides it.
          ? `Write the hook in ${lang}, unless the instruction explicitly names a different language. `
          // No explicit pick: fall back to the old LANGUAGE LOCK behavior —
          // the caption is the clip's own transcript text, so a Malay clip
          // must not get an English hook burned over it by default.
          : "Write the hook in the SAME LANGUAGE as the clip caption, unless the instruction explicitly names a different language. ") +
        'Return ONLY JSON { "text": "..." }.';
      const user = `INSTRUCTION: ${instruction || AUTO_INSTRUCTION}\n\nCLIP CAPTION: ${captionText || "(none)"}`;
      const out = await callClaudeJSON<{ text?: unknown }>({ system, user, apiKey });
      if (out && typeof out.text === "string" && out.text.trim()) {
        return { text: out.text.trim().replace(/^["']|["']$/g, "").slice(0, 50), mode: "llm" };
      }
    } catch (e) {
      console.warn("[hookTransform] LLM failed:", e instanceof Error ? e.message : e);
    }
  }
  return { text: fallback, mode: "fallback" };
}
