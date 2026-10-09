import { ALERT_CAPTION_INSTRUCTION } from "../marketingCaption";
import { callClaudeJSON } from "./kie-claude";
import { sanitizeYoutubeTitle } from "../youtubeTitle";
import type { TranscriptWord } from "./clipTypes";

export interface CaptionTransformResult {
  /** Same length + order as the input so per-word timings stay aligned. */
  words: TranscriptWord[];
  /** How the instruction was actually applied — so the caller can report it
   *  truthfully instead of always claiming a full rewrite:
   *   - "llm": the AI editor rewrote the text per the prompt;
   *   - "lowercase"/"uppercase": deterministic casing fallback (LLM unavailable);
   *   - "none": nothing applied (no LLM + a non-casing instruction, or no words). */
  mode: "llm" | "lowercase" | "uppercase" | "none";
}

/**
 * Smart Captions (clip.captionstyle): rewrite caption words to follow the
 * operator's freeform instruction (translate / change casing / add emojis /
 * rephrase). Falls back to a deterministic casing transform when the LLM is
 * unavailable / returns a bad shape, and reports which path was taken via `mode`.
 */
export async function transformCaptionWords(
  words: TranscriptWord[],
  prompt: string,
  apiKey: string,
): Promise<CaptionTransformResult> {
  const instruction = prompt.trim();
  const texts = words.map((w) => w.word);
  if (texts.length === 0 || !instruction) return { words, mode: "none" };
  if (apiKey) {
    try {
      const system =
        "You rewrite short-form video CAPTIONS to follow one operator instruction. " +
        // Without this, a "make it punchy" style instruction on Malay captions came
        // back quietly Englished — the words no longer match the audio.
        "KEEP THE ORIGINAL LANGUAGE of the words unless the instruction explicitly asks to translate. " +
        "You are given the caption words IN ORDER as a JSON array. Apply the instruction " +
        "(e.g. translate to another language, change casing, add emojis, rephrase to slang). " +
        'Return ONLY JSON { "words": [...] } with EXACTLY the same number of items in the same order — ' +
        "each the transformed text for that slot, so the on-screen word timing stays aligned. " +
        "Keep each item a short caption token (1-3 words). Never add or drop array items.";
      const user = `INSTRUCTION: ${instruction}\n\nCAPTION WORDS (${texts.length}, in order):\n${JSON.stringify(texts)}`;
      const out = await callClaudeJSON<{ words?: unknown }>({ system, user, apiKey });
      const arr = Array.isArray(out?.words) ? out.words : null;
      if (arr && arr.length === texts.length) {
        return { words: words.map((w, i) => ({ ...w, word: typeof arr[i] === "string" && arr[i] ? String(arr[i]) : w.word })), mode: "llm" };
      }
      console.warn(`[captionTransform] returned ${arr ? arr.length : "non-array"} items for ${texts.length} words — using fallback`);
    } catch (e) {
      console.warn("[captionTransform] LLM failed:", e instanceof Error ? e.message : e);
    }
  }
  // Deterministic fallback so casing instructions still apply without the LLM.
  const p = instruction.toLowerCase();
  if (/lower|small\s*caps|lowercase/.test(p)) return { words: words.map((w) => ({ ...w, word: w.word.toLowerCase() })), mode: "lowercase" };
  if (/upper|all\s*caps|uppercase|caps\s*lock/.test(p)) return { words: words.map((w) => ({ ...w, word: w.word.toUpperCase() })), mode: "uppercase" };
  return { words, mode: "none" };
}

export interface CaptionTextResult {
  text: string;
  mode: "llm" | "lowercase" | "uppercase" | "none";
}

/**
 * Smart Captions (clip.captionstyle): resolve which instruction (if any) should
 * drive the POST DESCRIPTION rewrite, now that the node separates "on-video
 * subtitles" (captionPrompt — untouched) from an optional, distinct
 * "post description" control. A non-empty `descriptionPrompt` always wins (the
 * operator explicitly wrote a separate instruction for the description). When
 * it's empty, fall back to reusing the subtitle instruction (`captionPrompt`)
 * IF `descFromCaption` is true — which it defaults to (`?? true`) so existing
 * configs saved before this split keep their current behavior. An empty result
 * means "don't rewrite the description" (caller falls back to the clip's own
 * transcript text).
 */
export function resolveDescriptionInstruction(cfg: {
  captionPrompt?: string;
  descriptionPrompt?: string;
  descFromCaption?: boolean;
}, opts?: { installed?: boolean }): string {
  const descriptionPrompt = (cfg.descriptionPrompt ?? "").trim();
  if (descriptionPrompt) return descriptionPrompt;
  const reuseCaption = cfg.descFromCaption ?? true;
  const captionPrompt = reuseCaption ? (cfg.captionPrompt ?? "").trim() : "";
  if (captionPrompt) return captionPrompt;
  // INSTALLED BUT UNCONFIGURED: the operator added Smart Captions and expects
  // written captions, so an empty prompt must not mean "do nothing" — that is what
  // left posts carrying the clip's placeholder title ("Clip 2") as their caption.
  // Fall back to a persona-driven default; a typed prompt still wins outright.
  return opts?.installed ? SMART_CAPTION_DEFAULT_INSTRUCTION : "";
}

/** Used when Smart Captions is installed with no prompt typed. */
export const SMART_CAPTION_DEFAULT_INSTRUCTION =
  "Write the post caption in the agent's own voice and language: one natural line about what this clip shows, no hashtags, no quotes, no preamble.";

// The placeholder rules live in a PURE module so the client gallery can apply the
// same rule the publish path does without pulling the LLM client into the browser.
export { isPlaceholderClipTitle, meaningfulBasis } from "@/lib/clip/placeholderTitle";

/**
 * Smart Captions for the POST DESCRIPTION: rewrite a single caption STRING (the
 * social-post text) to follow the operator's instruction — so a clip posted with
 * a "translate to Malay" caption prompt also gets a Malay post description, not
 * just Malay burned-in captions. Sentence-level (no timing); deterministic casing
 * fallback when the LLM is unavailable. Reuses the same callClaudeJSON infra so it
 * is safe to call from the Convex auto-post action.
 */
/**
 * Smart Captions POST-CAPTION GENERATOR: write a fresh social-post description
 * from the operator's persona instruction, using the clip's own content as the
 * basis. Unlike transformCaptionText (which rewrites an existing caption and
 * strips nothing), this is the "compose the post copy" step used at publish time
 * (Post Now / manual posting). It RESPECTS the instruction fully — language, tone,
 * length, @mentions and #hashtags the persona asks for — so a persona like
 * "hype tone in Malay, tag @brand, add 3 hashtags" produces exactly that. Returns
 * "" (caller keeps its fallback) on empty instruction or LLM failure. `apiKey`
 * optional — falls back to the KIE env key when running inside Next.
 */
export async function generatePostCaption(opts: { instruction: string; basis?: string; apiKey?: string }): Promise<string> {
  const instruction = (opts.instruction ?? "").trim();
  if (!instruction) return "";
  try {
    const system =
      "You write the SOCIAL CAPTION (the post description) for a short-form video clip. " +
      "Follow the operator's instruction EXACTLY for language, tone, length, @mentions and #hashtags. " +
      "Write it native and ready to publish: no preamble, no 'Caption:' label, no surrounding quotes. " +
      ALERT_CAPTION_INSTRUCTION + " " +
      "If the instruction does not ask for hashtags, do not add any. Keep it under 300 characters. " +
      'Return ONLY JSON { "caption": "..." }.';
    const user =
      `OPERATOR INSTRUCTION (governs language, tone, length, mentions, hashtags):\n${instruction.slice(0, 700)}\n` +
      (opts.basis && opts.basis.trim()
        ? `\nWHAT THE CLIP IS ABOUT (base the caption on THIS, do not invent facts):\n${opts.basis.trim().slice(0, 600)}\n`
        : "") +
      `\nReturn ONLY JSON { "caption": "..." }`;
    const out = await callClaudeJSON<{ caption?: unknown }>({ system, user, apiKey: opts.apiKey });
    const cap = out && typeof out.caption === "string" ? out.caption.trim() : "";
    return cap.replace(/^["']+|["']+$/g, "").slice(0, 300);
  } catch (e) {
    console.warn("[captionTransform] generatePostCaption failed:", e instanceof Error ? e.message : e);
    return "";
  }
}

/**
 * High-converting SHORT YouTube title (guaranteed ≤ 100 chars) in the agent's
 * voice, derived from the already-written post caption. YouTube rejects titles
 * over 100 chars with a 400 that fails the ENTIRE cross-post, and the social
 * caption is usually longer than that — so a video post to YouTube needs a
 * distinct, shortened title.
 *
 * Behaviour:
 *  - A caption that's already ≤ 100 chars and em-dash-free is used as-is (no LLM
 *    call — fast path for short captions).
 *  - Otherwise an LLM writes a punchy click-worthy title in the SAME language and
 *    persona/voice, with NO em/en dashes (the operator never wants them).
 *  - Every path — including any LLM failure — returns through sanitizeYoutubeTitle,
 *    so the result is ALWAYS ≤ 100 chars and dash-free, never empty-on-nonempty-input.
 * `apiKey` optional (falls back to the KIE env key inside Next).
 */
export async function generateYoutubeTitle(opts: {
  caption: string;
  persona?: string;
  language?: string;
  apiKey?: string;
}): Promise<string> {
  const base = (opts.caption ?? "").trim();
  if (!base) return "";
  // Fast path: already short + clean → no LLM needed.
  if (base.length <= 100 && !/[—–]/.test(base)) return sanitizeYoutubeTitle(base);
  try {
    const system =
      "You write ONE short, high-converting YouTube title for a short-form video. " +
      "HARD RULES: maximum 100 characters; a single line; no surrounding quotes; no hashtags; " +
      "NEVER use an em dash or en dash (— or –) — use a comma or period instead. " +
      "Match the creator's voice/persona and keep the SAME language as the caption. " +
      "Make it click-worthy but honest — lead with the hook. " +
      'Return ONLY JSON { "title": "..." }.';
    const user =
      (opts.persona ? `CREATOR PERSONA / VOICE:\n${opts.persona.slice(0, 400)}\n\n` : "") +
      (opts.language ? `LANGUAGE (write the title in this language): ${opts.language}\n\n` : "") +
      `POST CAPTION (base the title on THIS, same language, do not invent facts):\n${base.slice(0, 600)}\n\n` +
      `Return ONLY JSON { "title": "..." }`;
    const out = await callClaudeJSON<{ title?: unknown }>({ system, user, apiKey: opts.apiKey });
    const raw = out && typeof out.title === "string" ? out.title.replace(/^["']+|["']+$/g, "") : "";
    const clean = sanitizeYoutubeTitle(raw);
    return clean || sanitizeYoutubeTitle(base); // never regress to empty on non-empty input
  } catch (e) {
    console.warn("[captionTransform] generateYoutubeTitle failed:", e instanceof Error ? e.message : e);
    return sanitizeYoutubeTitle(base);
  }
}

export async function transformCaptionText(text: string, prompt: string, apiKey: string): Promise<CaptionTextResult> {
  const instruction = prompt.trim();
  const src = text.trim();
  if (!src || !instruction) return { text, mode: "none" };
  if (apiKey) {
    try {
      const system =
        "You rewrite a short social-post caption to follow ONE operator instruction " +
        "(e.g. translate to another language, change casing, add emojis, rephrase to slang). " +
        'Keep it ONE short line, no hashtags, no quotes. Return ONLY JSON { "text": "..." }.';
      const user = `INSTRUCTION: ${instruction}\n\nCAPTION: ${src}`;
      const out = await callClaudeJSON<{ text?: unknown }>({ system, user, apiKey });
      if (out && typeof out.text === "string" && out.text.trim()) {
        return { text: out.text.trim(), mode: "llm" };
      }
      console.warn("[captionTransform] description transform returned no string — using fallback");
    } catch (e) {
      console.warn("[captionTransform] description LLM failed:", e instanceof Error ? e.message : e);
    }
  }
  const lp = instruction.toLowerCase();
  if (/lower|small\s*caps|lowercase/.test(lp)) return { text: text.toLowerCase(), mode: "lowercase" };
  if (/upper|all\s*caps|uppercase|caps\s*lock/.test(lp)) return { text: text.toUpperCase(), mode: "uppercase" };
  return { text, mode: "none" };
}
