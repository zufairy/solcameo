import { callClaudeJSON } from "./kie-claude";
import type { TranscriptWord } from "./clipTypes";

/**
 * Subtitle translation for burned captions (Editor tab → Captions → "Subtitle
 * language"). The spoken audio is transcribed in ITS language (captions.languageCode
 * pins/auto-detects that), then — when the operator picks a DIFFERENT subtitle
 * language — the transcript is translated here before the ASS render.
 *
 * Why not reuse transformCaptionWords (1 word in → 1 word out)? Translation
 * reorders and re-counts words (English "I like food" → Malay "Saya suka makanan"
 * happens to match, but Chinese/Japanese/Arabic never do), so a per-slot rewrite
 * produces gibberish word order under the karaoke highlight. Instead:
 *   1. group the transcript into short PHRASES (silence gaps / sentence ends / ≤8 words),
 *   2. translate each phrase as a unit (natural output, one LLM call for the clip),
 *   3. spread the translated tokens evenly over that phrase's ORIGINAL time span,
 * so the captions stay in sync with the speech at phrase granularity — which is
 * what a viewer actually perceives — and the existing karaoke/preset renderer
 * needs no changes.
 */

export interface Phrase { words: TranscriptWord[]; start: number; end: number }

const PHRASE_GAP_SEC = 0.6;
const PHRASE_MAX_WORDS = 8;
const SENTENCE_END_RE = /[.!?。！？…]["'”’)]*$/;

export function groupWordsIntoPhrases(words: TranscriptWord[]): Phrase[] {
  const phrases: Phrase[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    phrases.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > PHRASE_GAP_SEC) flush();
    cur.push(w);
    if (cur.length >= PHRASE_MAX_WORDS || SENTENCE_END_RE.test(w.word.trim())) flush();
  }
  flush();
  return phrases;
}

const NO_SPACE_SCRIPT_RE = /[぀-ヿ㐀-鿿가-힯฀-๿]/;

/** Split translated text into caption tokens. Whitespace languages split on
 *  spaces; scripts without word spacing (CJK/Thai) go through Intl.Segmenter so
 *  the karaoke highlight still advances instead of freezing on one giant token. */
export function tokenizeForCaptions(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const bySpace = trimmed.split(/\s+/).filter(Boolean);
  const hasSegmenter = typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function";
  const needsSegmenting = bySpace.some((t) => t.length > 3 && NO_SPACE_SCRIPT_RE.test(t));
  if (!hasSegmenter || !needsSegmenting) return bySpace;
  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const out: string[] = [];
  for (const tok of bySpace) {
    if (!NO_SPACE_SCRIPT_RE.test(tok)) { out.push(tok); continue; }
    const pieces = [...seg.segment(tok)].map((s) => s.segment.trim()).filter(Boolean);
    // Fold bare punctuation onto the previous piece so "。" never gets its own beat.
    for (const p of pieces) {
      if (out.length && !/[\p{L}\p{N}]/u.test(p)) out[out.length - 1] += p;
      else out.push(p);
    }
  }
  return out;
}

export function spreadTokensOverSpan(tokens: string[], start: number, end: number): TranscriptWord[] {
  if (tokens.length === 0) return [];
  const span = Math.max(0.05, end - start);
  const per = span / tokens.length;
  return tokens.map((word, i) => ({ word, start: start + i * per, end: i === tokens.length - 1 ? end : start + (i + 1) * per }));
}

export type TranslateFn = (phrases: string[], target: string, source?: string) => Promise<string[]>;

export interface TranslateCaptionsOpts {
  /** ISO 639-1 subtitle language ("ms", "en", "zh", …). */
  target: string;
  /** ISO 639-1 spoken language as detected/pinned by transcription. When it
   *  equals `target` the call is a no-op. Unknown → translate anyway. */
  source?: string;
  apiKey?: string;
  /** Injectable for tests; defaults to the Kie Gemini JSON route. */
  translate?: TranslateFn;
}

export interface TranslateCaptionsResult {
  words: TranscriptWord[];
  mode: "llm" | "skipped" | "failed";
  source?: string;
}

const LANG_NAMES: Record<string, string> = {
  en: "English", ms: "Malay (Bahasa Melayu)", id: "Indonesian (Bahasa Indonesia)", zh: "Chinese (Simplified)", ta: "Tamil",
  hi: "Hindi", ar: "Arabic", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", ja: "Japanese", ko: "Korean",
  th: "Thai", vi: "Vietnamese",
};
export const languageLabel = (code: string): string => LANG_NAMES[code] ?? code;

function normCode(raw?: string | null): string {
  const s = (raw ?? "").trim().toLowerCase();
  return s ? s.split(/[-_]/)[0] : "";
}

async function llmTranslate(phrases: string[], target: string, source?: string, apiKey?: string): Promise<string[]> {
  const system =
    "You are a professional subtitle translator for short-form video. Translate each caption phrase into the target language. " +
    "Keep the meaning, register and energy (slang stays slangy, hype stays hype). Keep numbers, names and brand names as-is. " +
    "Each output phrase must be SHORT and natural to read on screen — never longer than roughly 1.5x the source. " +
    'Return ONLY JSON { "phrases": [...] } with EXACTLY the same number of strings in the same order. Never merge, split, add or drop items.';
  const user =
    `TARGET LANGUAGE: ${languageLabel(target)} (${target})\n` +
    (source ? `SOURCE LANGUAGE: ${languageLabel(source)} (${source})\n` : "SOURCE LANGUAGE: detect from the text\n") +
    `\nPHRASES (${phrases.length}, in order):\n${JSON.stringify(phrases)}`;
  const out = await callClaudeJSON<{ phrases?: unknown }>({ system, user, apiKey, maxTokens: 4096 });
  const arr = Array.isArray(out?.phrases) ? out.phrases : null;
  if (!arr) throw new Error("translator returned no phrases array");
  return arr.map((p) => (typeof p === "string" ? p : String(p ?? "")));
}

/** Translate transcript words into `target`, keeping phrase-level timing.
 *  Never throws — a failure returns the ORIGINAL words with mode "failed" so the
 *  burn still ships captions (in the spoken language) rather than none. */
export async function translateCaptionWords(words: TranscriptWord[], opts: TranslateCaptionsOpts): Promise<TranslateCaptionsResult> {
  const target = normCode(opts.target);
  const source = normCode(opts.source) || undefined;
  if (!target || words.length === 0) return { words, mode: "skipped", source };
  if (source && source === target) return { words, mode: "skipped", source };
  const phrases = groupWordsIntoPhrases(words);
  const texts = phrases.map((p) => p.words.map((w) => w.word).join(" ").trim());
  const translate: TranslateFn = opts.translate ?? ((ph, t, s) => llmTranslate(ph, t, s, opts.apiKey));
  try {
    const translated = await translate(texts, target, source);
    if (translated.length !== texts.length) {
      console.warn(`[captionTranslate] expected ${texts.length} phrases, got ${translated.length} — keeping original words`);
      return { words, mode: "failed", source };
    }
    const out: TranscriptWord[] = [];
    phrases.forEach((p, i) => {
      const tokens = tokenizeForCaptions(translated[i]);
      // Empty translation for a phrase → keep the original words for that slot.
      if (tokens.length === 0) { out.push(...p.words); return; }
      out.push(...spreadTokensOverSpan(tokens, p.start, p.end));
    });
    return { words: out, mode: "llm", source };
  } catch (e) {
    console.warn("[captionTranslate] failed:", e instanceof Error ? e.message : e);
    return { words, mode: "failed", source };
  }
}
