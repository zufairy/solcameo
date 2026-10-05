/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath, runWithMonoFallback, runWithDiscardCorruptFallback } from "@/lib/server/ffmpegBin";
// Resolved binary (not the raw ffmpeg-static export — the dev bundler can
// rewrite that path into .next where no binary exists).
const ffmpegPath = resolveFfmpegPath();
import { ConvexHttpClient } from "convex/browser";
import { requireInternalOrUserAuth, requireOwnerWithSiws, requireSiwsSession } from "@/lib/server/requireAuth";
import { streamFetchToFile } from "@/lib/server/downloader";
import { isDriveUrl, downloadFromDriveToFile, getDriveModifiedTime } from "@/lib/server/driveDownload";
import { meterAgentService } from "@/lib/economy/meterAgentService";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { extractClaudeJson } from "@/lib/server/kie-claude";
import { sourceKey, sourceContentChanged } from "@/lib/server/sourceKey";
import { analyzeTranscript, ANALYSIS_VERSION } from "@/lib/server/clipAnalysis";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
// String refs so this works before the transcriptCache schema is deployed (calls
// just throw → caught → cache disabled). No _generated/api dependency.
const CACHE_GET = makeFunctionReference<"query">("transcriptCache:getByKey");
const CACHE_PUT = makeFunctionReference<"mutation">("transcriptCache:put");

// Transcription via Kie.ai Gemini 3 Flash (multimodal) — standardized on Kie, no
// OpenAI dependency. Same OpenAI-compatible endpoint/shape as /api/analyze-images.
// NOTE: LLM-derived timestamps are best-effort (approximate) compared with a
// dedicated STT like Whisper, so clip cut points / caption timing are rougher.
const KIE_GEMINI = "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions";
const KIE_KEY = process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";

// LANGUAGE FIDELITY (the Malay bug): an LLM STT left to its own devices happily
// TRANSLATES non-English speech into English, or transliterates Malay into
// Indonesian/English spelling — so the burned captions read as words nobody said.
// Both prompts below forbid that explicitly and make the model report the language
// it heard, which the caller then PINS across every later chunk (see reqLanguage).
const STT_SYSTEM =
  "You are a precise, multilingual speech-to-text engine. Transcribe the supplied audio VERBATIM in the language actually spoken and return ONLY a JSON object — no prose, no markdown fences. " +
  "NEVER translate, localise, or transliterate: Malay stays Malay, Indonesian stays Indonesian, Tamil stays Tamil, code-switched speech keeps each language exactly as spoken. " +
  "Write the language's normal orthography and diacritics. Never paraphrase, summarise, correct grammar, or clean up filler words. " +
  "Only transcribe SPOKEN human speech. If the audio contains background music, singing, song lyrics, or instrumental, IGNORE it entirely — never transcribe lyrics, humming, or singing. Words must only ever be speech a person actually said.";
const STT_USER_BASE =
  'Transcribe this audio. Return ONLY JSON: {"language": "<ISO 639-1 code of the spoken language>", "duration": <seconds number>, "segments": [{"start": <s>, "end": <s>, "text": "..."}], "words": [{"word": "...", "start": <s>, "end": <s>}]}. ' +
  "All timestamps are seconds from the start (0). Break segments at natural sentence/pause boundaries. Include every spoken word in \"words\" with its best-estimate timing. " +
  "The transcript MUST be in the spoken language — do NOT translate it to English. " +
  "Transcribe ONLY spoken speech. Skip any music, singing, or song lyrics in the audio — do not transcribe them as words. " +
  "If there is no speech, return {\"duration\":0,\"segments\":[],\"words\":[]}.";

/** Gemini user prompt, with the language PINNED when we already know it (from an
 *  operator setting or from the first chunk's detection) — a long source must not
 *  drift language chunk-to-chunk. */
function sttUserPrompt(languageCode?: string): string {
  const lang = normalizeLanguageCode(languageCode);
  if (!lang) return STT_USER_BASE;
  return `${STT_USER_BASE}\n\nThe spoken language is "${lang}" (${languageName(lang)}). Transcribe in THAT language only — never translate or switch orthography.`;
}

/** ISO-639-1/3 with optional region, e.g. "ms", "id", "zh-Hans". Anything else
 *  (a prose sentence, an empty string) is rejected so it can't poison a request. */
function normalizeLanguageCode(raw?: string | null): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(v) ? v : "";
}

/** Human label for the few languages worth naming to the model; the bare code is
 *  a fine fallback (the model knows the ISO table). */
function languageName(code: string): string {
  const table: Record<string, string> = {
    ms: "Malay / Bahasa Melayu", id: "Indonesian / Bahasa Indonesia", en: "English",
    ta: "Tamil", zh: "Chinese", hi: "Hindi", ar: "Arabic", es: "Spanish",
    pt: "Portuguese", fr: "French", de: "German", ja: "Japanese", ko: "Korean", th: "Thai", vi: "Vietnamese",
  };
  return table[code.split("-")[0]] ?? code;
}

/** Operator/deployment default when a request doesn't pin one — set
 *  CLIP_STT_LANGUAGE=ms on a Malay-only channel to skip auto-detect entirely. */
const DEFAULT_STT_LANGUAGE = normalizeLanguageCode(process.env.CLIP_STT_LANGUAGE);

// Below this Scribe self-reported confidence the detection is a coin-flip between
// close neighbours (the ms/id pair is the classic one), so we re-run ONCE with the
// language pinned instead of shipping half-Indonesian Malay captions.
const LANG_CONFIDENCE_FLOOR = 0.65;

// Wall-clock ceiling for a single ffmpeg invocation. Under the 300s maxDuration
// so a hung audio extraction is SIGKILLed (freeing the pinned CPU core on the
// long-lived Railway process) before the request itself is force-terminated.
const FFMPEG_WALL_MS = 280_000;

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = ""; proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 8000) e = e.slice(-8000); });
    // Wall-clock kill: SIGKILL a hung run, then reject (propagates into the
    // outer finally{ rm(workDir) }). Cleared on close/error so a normal exit
    // never fires it.
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); fn(); };
    const wall = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      settle(() => reject(new Error(`ffmpeg killed: exceeded ${FFMPEG_WALL_MS}ms wall clock. ${e.slice(-400)}`)));
    }, FFMPEG_WALL_MS);
    proc.on("error", (err) => settle(() => reject(err)));
    proc.on("close", (c) => settle(() => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${e.slice(-400)}`)))));
  });
}

// Kie has shipped several upstream response envelopes — accept any of them.
function extractContent(data: any): string {
  const candidates = [
    data?.choices?.[0]?.message?.content,
    data?.choices?.[0]?.text,
    Array.isArray(data?.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts.map((p: { text?: string }) => p?.text ?? "").join("")
      : "",
    data?.candidates?.[0]?.output ?? data?.candidates?.[0]?.text,
    data?.output_text ?? data?.text ?? data?.message,
    Array.isArray(data?.content) ? data.content.map((c: { text?: string }) => c?.text ?? "").join("") : "",
  ];
  return candidates.map((v) => (typeof v === "string" ? v.trim() : "")).find((s) => s.length > 0) ?? "";
}

function probeDuration(bin: string, path: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0);
    });
    proc.on("error", () => resolve(0));
  });
}

type Seg = { start: number; end: number; text: string };
type Word = { word: string; start: number; end: number };

// ── ElevenLabs Scribe (primary STT) ───────────────────────────────────────────
// Real speech-to-text with native word-level timestamps + audio-event tags
// (music/laughter), so NO timeline-rescale/synthesize/chunk hacks are needed and
// caption timing is accurate. Handles full-length audio in one call.
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY?.trim() || "";

// `Intl.Segmenter` (Node built-in, no dependency) word-segments TEXT so a caption
// synthesized from a segment (no native word timings — the Gemini-fallback path)
// still breaks into several timed tokens on scripts that write with no spaces
// (CJK, Thai, …) instead of ONE glued "word" covering the whole segment span —
// see the caller. Falls back to a plain whitespace split when Segmenter is
// unavailable (very old runtimes) so this can never throw.
function splitLangAware(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (typeof Intl === "undefined" || typeof (Intl as { Segmenter?: unknown }).Segmenter !== "function") {
    return trimmed.split(/\s+/).filter(Boolean);
  }
  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const out: string[] = [];
  for (const { segment, isWordLike } of seg.segment(trimmed)) {
    if (isWordLike && segment.trim()) out.push(segment.trim());
  }
  return out.length > 0 ? out : trimmed.split(/\s+/).filter(Boolean);
}

/** Group word-timed tokens into sentence-ish segments for the moment selector. */
function wordsToSegments(words: Word[]): Seg[] {
  const segs: Seg[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    segs.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.word).join(" ").replace(/\s+([,.!?;:])/g, "$1") });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const endsSentence = /[.!?]$/.test(words[i].word);
    const bigGap = i + 1 < words.length && words[i + 1].start - words[i].end > 0.8;
    if (endsSentence || bigGap || cur.length >= 16) flush();
  }
  flush();
  return segs;
}

/**
 * MUSIC-AWARE CAPTION SOURCE (the "captions show the background music" bug).
 *
 * The transcript behind the burned captions must be the video's SPOKEN audio only —
 * never the lyrics of a music bed baked into the source (Veo-generated videos carry
 * their own music/ambience; an uploaded main video may have a licensed song). ElevenLabs
 * Scribe already tags these spans when `tag_audio_events` is on: it returns `(music)` /
 * `(singing)` audio-event tokens WITH timestamps. We keep those windows and drop every
 * transcribed word that overlaps one, so a backing track can never leak its words into
 * the captions (and the "whatever language the main video speaks, captions match" rule
 * holds — the remaining words are exactly the speech).
 */
type MusicWindow = { start: number; end: number };

/** True when a word's spoken span overlaps a music/singing window. */
function overlapsMusic(w: Word, music: MusicWindow[]): boolean {
  return music.some((m) => w.start < m.end && w.end > m.start);
}

/** Drop words that fall inside any tagged music/singing window. */
function dropMusicWords(words: Word[], music: MusicWindow[]): Word[] {
  if (music.length === 0) return words;
  const kept = words.filter((w) => !overlapsMusic(w, music));
  // AI-generated TTS/lip-synced speech (Kie/Veo/Grok voices) reads as
  // song-like/melodic more often than real human speech, which Scribe's
  // audio-event tagger sometimes misreads as "(music)"/"(singing)" covering
  // the ENTIRE track — not a real music bed under real dialogue. Blindly
  // trusting that tag then zeroed out a full, correct transcript, which is
  // exactly what forced the caller to fall back to synthesizeWordsFromScript's
  // evenly-spaced guess (the actual "captions not transcribing correctly /
  // word-sync drift" symptom reported for AI-UGC videos). A genuine
  // music-only clip has few or no real spoken words to begin with; getting
  // a full, real transcript back and THEN discarding all of it is the
  // signature of this false-positive, so that specific case keeps the real
  // words instead of discarding them.
  if (kept.length === 0 && words.length > 0) {
    console.warn(`[transcribe-clip] music/singing tag would have dropped ALL ${words.length} transcribed words — treating as a misclassified AI voice track, keeping the real transcript instead`);
    return words;
  }
  if (kept.length !== words.length) {
    console.warn(`[transcribe-clip] dropped ${words.length - kept.length} of ${words.length} words overlapping a tagged music/singing window — keeping only spoken speech for captions`);
  }
  return kept;
}

/** Normalize a list of audio-event tokens Scribe returns into music windows. */
function musicWindowsFromEvents(toks: { type?: string; text?: string; start?: number; end?: number }[]): MusicWindow[] {
  const out: MusicWindow[] = [];
  for (const t of toks) {
    if (t.type !== "audio_event") continue;
    // "(music)" / "(singing)" / "(song)" — the timestamps bound the span.
    if (!/\(music|singing|song\)/.test(String(t.text ?? ""))) continue;
    if (typeof t.start === "number" && typeof t.end === "number" && t.end > t.start) {
      out.push({ start: t.start, end: t.end });
    }
  }
  return out;
}

async function elevenLabsOnce(bytes: Buffer, languageCode?: string): Promise<{ segments: Seg[]; words: Word[]; duration: number; audioEvents: number; music: MusicWindow[]; language: string; languageProbability: number }> {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("tag_audio_events", "true"); // (music)/(laughter) etc. — emotion/energy signal
  // LANGUAGE: omitted = Scribe auto-detects (and may switch mid-file, or land on a
  // near-neighbour such as Indonesian for Malay). Passing it pins the decoder to
  // one language for the whole file — which is what makes Malay captions come back
  // as Malay instead of an Indonesian-flavoured approximation.
  const pinned = normalizeLanguageCode(languageCode);
  if (pinned) form.append("language_code", pinned);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), "audio.mp3");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 280_000);
  let data: { text?: string; language_code?: string; language_probability?: number; words?: { text: string; start: number; end: number; type?: string }[] };
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_KEY },
      body: form,
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`elevenlabs STT HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    data = await r.json();
  } finally {
    clearTimeout(timer);
  }
  const toks = Array.isArray(data.words) ? data.words : [];
  const music = musicWindowsFromEvents(toks);
  const words: Word[] = toks
    .filter((w) => (w.type ?? "word") === "word" && typeof w.start === "number" && typeof w.end === "number" && typeof w.text === "string")
    .map((w) => ({ word: w.text.trim(), start: w.start, end: w.end }))
    .filter((w) => w.word.length > 0);
  const audioEvents = toks.filter((w) => w.type === "audio_event").length;
  // THE FIX: keep only spoken speech. Scribe tagged the music/singing spans, so words
  // inside them are lyrics — dropping them keeps the caption source = the video's own
  // speech in whatever language it speaks (the music bed can never leak words).
  const spokenWords = dropMusicWords(words, music);
  return {
    segments: wordsToSegments(spokenWords), words: spokenWords, duration: spokenWords.at(-1)?.end ?? 0, audioEvents, music,
    // What Scribe says it heard. `pinned` wins when we forced it (the response
    // echoes it anyway, but be explicit rather than trusting the echo).
    language: pinned || normalizeLanguageCode(data.language_code),
    languageProbability: typeof data.language_probability === "number" ? data.language_probability : (pinned ? 1 : 0),
  };
}

// True HTTP/transport errors are transient → retry. The 0-words result is
// DETERMINISTIC for a given audio (music-only / silent / non-speech) → never
// retried here; the caller decides whether to fall back to KIE.
async function transcribeWithElevenLabs(audioPath: string, languageCode?: string): Promise<{ segments: Seg[]; words: Word[]; duration: number; audioEvents: number; music: MusicWindow[]; language: string; languageProbability: number }> {
  const bytes = await readFile(audioPath);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const first = await elevenLabsOnce(bytes, languageCode);
      // LOW-CONFIDENCE AUTO-DETECT → re-run PINNED to what it detected. In auto
      // mode Scribe can drift between close languages across a file (Malay ↔
      // Indonesian is the standard confusion), which is exactly the "wrong words,
      // right timing" caption. One pinned pass makes the whole file decode as a
      // single language. Skipped when the caller already pinned one.
      if (!normalizeLanguageCode(languageCode) && first.language && first.languageProbability > 0 && first.languageProbability < LANG_CONFIDENCE_FLOOR) {
        console.warn(`[transcribe-clip] elevenlabs language ${first.language} @ ${first.languageProbability.toFixed(2)} confidence — re-running pinned to ${first.language}`);
        try {
          const pinnedRun = await elevenLabsOnce(bytes, first.language);
          if (pinnedRun.words.length > 0) return pinnedRun;
        } catch (e) {
          console.warn(`[transcribe-clip] pinned re-run failed, keeping auto-detect result: ${e instanceof Error ? e.message : e}`);
        }
      }
      return first;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[transcribe-clip] elevenlabs attempt ${attempt + 1}/2 failed: ${msg}`);
      // A billing/auth rejection is DETERMINISTIC — the account's invoice is unpaid
      // or the key is wrong. Retrying just burns 1.5s before the same 401; fail fast
      // so the KIE fallback starts immediately, and say what to fix.
      if (/HTTP 40(1|2|3)\b/.test(msg) || /payment_issue|missing_permissions|invalid_api_key/i.test(msg)) {
        throw new Error(`elevenlabs rejected the key (${msg.slice(0, 160)}) — check the ElevenLabs account's billing/invoice and ELEVENLABS_API_KEY scopes`);
      }
      if (attempt < 1) await new Promise((rs) => setTimeout(rs, 1500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`elevenlabs failed: ${String(lastErr)}`);
}

/** One Gemini STT call for one audio chunk; parses + salvages the JSON. */
async function transcribeChunk(audioB64: string, languageCode?: string): Promise<{ segments: Seg[]; words: Word[]; duration: number; language: string }> {
  const controller = new AbortController();
  // 240s: real transcribes of multi-minute chunks take 80-100s+; an earlier
  // 120s cap aborted them mid-flight, silently killing captions downstream.
  const timer = setTimeout(() => controller.abort(), 240_000);
  let data: any;
  try {
    const stt = await fetch(KIE_GEMINI, {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gemini-3-6-flash-openai",
        stream: false,
        include_thoughts: false,
        // Word-level JSON easily exceeds default output caps — without this the
        // JSON gets truncated mid-array and the whole transcript was lost.
        max_tokens: 32000,
        messages: [
          { role: "system", content: STT_SYSTEM },
          {
            role: "user",
            content: [
              { type: "input_audio", input_audio: { data: audioB64, format: "mp3" } },
              { type: "text", text: sttUserPrompt(languageCode) },
            ],
          },
        ],
      }),
    });
    if (!stt.ok) throw new Error(`Kie Gemini STT HTTP ${stt.status}: ${(await stt.text()).slice(0, 200)}`);
    data = await stt.json();
  } finally {
    clearTimeout(timer);
  }
  if (data?.error) throw new Error(`kie-gemini STT error: ${data.error.message ?? data.error}`);
  // Kie wraps upstream failures in an HTTP-200 {code,msg} envelope (e.g.
  // {"code":524,"msg":"对话失败: HTTP 403"} when rate-limited) — surface it as a
  // real error instead of "no parseable JSON". Loosened: accept a string/number
  // `code` (don't require `typeof === number`), and don't require empty content —
  // a non-200 code with a `msg` is an upstream failure even if some text leaked.
  if (data?.code != null && Number(data.code) !== 200 && data.msg) {
    throw new Error(`kie-gemini error ${data.code}: ${String(data.msg).slice(0, 160)}`);
  }

  const content = extractContent(data);
  // Refusal / prose detection: the model returned non-empty text that contains no
  // JSON object at all (e.g. "I'm sorry, I can't transcribe this audio."). Surface
  // the actual refusal text instead of the generic "no parseable JSON".
  if (content && content.indexOf("{") < 0) {
    throw new Error(`kie-gemini returned prose/refusal, not JSON: ${JSON.stringify(content.slice(0, 160))}`);
  }
  let parsed = content ? extractClaudeJson(content) : null;
  if (!parsed && content) {
    // Salvage a truncated response: cut at the last complete object and balance
    // the brackets — keep every segment/word before the cut instead of nothing.
    const start = content.indexOf("{");
    const lastObj = content.lastIndexOf("}");
    if (start >= 0 && lastObj > start) {
      let candidate = content.slice(start, lastObj + 1);
      let opens = 0, opensSq = 0, inStr = false, esc = false;
      for (const ch of candidate) {
        if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === "{") opens++;
        else if (ch === "}") opens--;
        else if (ch === "[") opensSq++;
        else if (ch === "]") opensSq--;
      }
      candidate += "]".repeat(Math.max(0, opensSq)) + "}".repeat(Math.max(0, opens));
      try { parsed = JSON.parse(candidate.replace(/,(\s*[}\]])/g, "$1")); } catch { /* unrecoverable */ }
      if (parsed) console.warn("[transcribe-clip] salvaged truncated transcript JSON");
    }
  }
  if (!parsed) {
    const envKeys = Object.keys(data ?? {}).join(",");
    const contentHead = content.slice(0, 160);
    const rawHead = JSON.stringify(data ?? {}).slice(0, 240);
    // Log the FULL detail (head+tail+raw) for deep debugging…
    console.warn(
      `[transcribe-clip] unparseable response. content head: ${content.slice(0, 200)} … tail: ${content.slice(-120)} | envelope keys: ${envKeys} | raw: ${JSON.stringify(data ?? {}).slice(0, 300)}`,
    );
    // …and put the diagnostic essentials INTO the thrown error so the run log
    // (which only surfaces the message) names the provider + shows the real shape.
    throw new Error(
      `kie-gemini returned no parseable JSON (contentLen=${content.length}, envelopeKeys=[${envKeys}], contentHead=${JSON.stringify(contentHead)}, raw=${rawHead})`,
    );
  }

  const segments: Seg[] = Array.isArray((parsed as any).segments)
    ? (parsed as any).segments
        .filter((s: any) => typeof s?.start === "number" && typeof s?.end === "number" && typeof s?.text === "string")
        .map((s: any) => ({ start: s.start, end: s.end, text: String(s.text).trim() }))
    : [];
  let words: Word[] = Array.isArray((parsed as any).words)
    ? (parsed as any).words
        .filter((w: any) => typeof w?.start === "number" && typeof w?.end === "number" && typeof w?.word === "string")
        .map((w: any) => ({ word: String(w.word), start: w.start, end: w.end }))
    : [];
  // Salvaged/truncated responses often keep segments but lose the words array.
  // Karaoke captions need word timings — synthesize by spreading each segment's
  // text evenly across its span. `splitLangAware` (not a raw whitespace split)
  // so CJK/Thai/etc — which write with no spaces between words — still break
  // into several word-timed tokens instead of ONE giant "word" spanning the
  // whole segment: that glued blob is what made burned captions look "stuck"
  // on a single sentence for the entire clip (one Dialogue event, its End time
  // way out at the segment's end) instead of advancing.
  if (words.length === 0 && segments.length > 0) {
    words = segments.flatMap((s) => {
      const parts = splitLangAware(s.text);
      if (parts.length === 0) return [];
      const step = (s.end - s.start) / parts.length;
      return parts.map((word, i) => ({ word, start: s.start + i * step, end: s.start + (i + 1) * step }));
    });
    if (words.length > 0) console.warn(`[transcribe-clip] synthesized ${words.length} word timings from segments`);
  }
  const duration = typeof (parsed as any).duration === "number" ? (parsed as any).duration : segments.at(-1)?.end ?? 0;
  // The model's own read of the spoken language — pinned into every LATER chunk of
  // the same source so a long video can't drift language (and translate) halfway.
  const language = normalizeLanguageCode(languageCode) || normalizeLanguageCode(String((parsed as any).language ?? ""));
  return { segments, words, duration, language };
}

/** Rescale a chunk's compressed/hallucinated timeline to its real duration,
 *  then shift everything by the chunk's offset in the source. */
function rebaseChunk(r: { segments: Seg[]; words: Word[] }, offsetSec: number, chunkDur: number): { segments: Seg[]; words: Word[] } {
  const maxT = Math.max(r.segments.at(-1)?.end ?? 0, r.words.at(-1)?.end ?? 0);
  const k = chunkDur > 5 && maxT > 0 && maxT < chunkDur * 0.6 ? chunkDur / maxT : 1;
  if (k !== 1) console.warn(`[transcribe-clip] chunk@${offsetSec}s timeline compressed (${maxT.toFixed(0)}s vs ${chunkDur.toFixed(0)}s) — rescaled ×${k.toFixed(1)}`);
  return {
    segments: r.segments.map((s) => ({ ...s, start: s.start * k + offsetSec, end: s.end * k + offsetSec })),
    words: r.words.map((w) => ({ ...w, start: w.start * k + offsetSec, end: w.end * k + offsetSec })),
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  let body: {
    sourceUrl?: string; audioUrl?: string; campaignSource?: boolean; campaignId?: string;
    billing?: { mintAddress?: string; sessionId?: string; runId?: string; step?: string };
    // Chunked transcription (action-level fan-out, see convex/clipJobs.ts step 2):
    // `range` = transcribe ONLY this audio window and return SLICE-LOCAL timestamps
    //   (0 = window start); the ACTION offsets+stitches them. A range request is
    //   range-agnostic: it NEVER reads/writes the cache and NEVER runs analysis.
    // `cacheOnly` = probe the master cache for a HIT WITHOUT transcribing (so the
    //   action can reuse a warm 4h transcript free instead of fanning out).
    // `stitchedCachePut` = the action hands back its fully stitched+analyzed
    //   transcript so the route (the one place that owns sourceKey + cache writes,
    //   which need node:crypto unavailable in the Convex V8 isolate) caches it once.
    range?: { start?: number; end?: number };
    cacheOnly?: boolean;
    stitchedCachePut?: { segments?: Seg[]; words?: Word[]; analysis?: unknown; durationSeconds?: number; provider?: string; language?: string };
    /** PIN the spoken language (ISO 639-1, e.g. "ms" for Malay) instead of letting
     *  the provider auto-detect. The chunked caller detects on chunk 1 and pins the
     *  rest, so every window of one source decodes as the same language. */
    languageCode?: string;
    /** Transcript only — skip the LLM moment analysis on a cache MISS (the JEV
     *  dev lab picks moments itself). A miss is then NOT cached, so the LLM
     *  clip path never reads a row with no analysis. A HIT is served as usual. */
    skipAnalysis?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const sourceUrl = String(body.sourceUrl ?? "");
  if (!sourceUrl) return NextResponse.json({ error: "sourceUrl required" }, { status: 400 });
  // A `range` request transcribes a single slice with SLICE-LOCAL timestamps; the
  // action stitches+analyzes+caches. So a range request must SKIP cache read, the
  // per-slice analyze, AND the cache store — all keyed off this one flag.
  const isRange = !!(body.range && Number.isFinite(body.range.start) && Number.isFinite(body.range.end) && (body.range.end as number) > (body.range.start as number));
  // Explicit pin wins; else the deployment default; else auto-detect ("").
  const reqLanguage = normalizeLanguageCode(body.languageCode) || DEFAULT_STT_LANGUAGE;

  // Auth gate for user (Bearer) callers — internal cron callers skip. Billed to an
  // agent → require the SIWS-proven owner; ad-hoc (no mintAddress) → SIWS session only.
  if (!auth.internal) {
    const billedMint = body.billing?.mintAddress?.trim();
    if (billedMint && CONVEX_URL) {
      const owner = await new ConvexHttpClient(CONVEX_URL).query(api.influencers.getByMintServer, {
        mintAddress: billedMint, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
      // null (unknown mint) → undefined → ownership check denies, as intended.
      const ownershipError = requireOwnerWithSiws(auth, owner ?? undefined);
      if (ownershipError) return ownershipError;
    } else {
      const siwsError = requireSiwsSession(auth);
      if (siwsError) return siwsError;
    }
  }
  if (!ELEVENLABS_KEY && !KIE_KEY) return NextResponse.json({ ok: false, error: "No STT key set (ELEVENLABS_API_KEY or KIE_API_KEY)" }, { status: 503 });
  if (!ffmpegPath) return NextResponse.json({ error: "ffmpeg unavailable" }, { status: 500 });

  // Cache key = the ORIGINAL video identity (so the same video maps to one row),
  // even though the audio is fetched from a possibly-different already-downloaded
  // URL (audioUrl, e.g. the Convex storage copy).
  const key = sourceKey(sourceUrl);
  const audioSrc = String(body.audioUrl ?? sourceUrl);
  // A Drive-hosted source can be REPLACED IN PLACE (same fileId/link, new bytes —
  // Drive's "Manage versions -> Upload new version") with NO change to sourceUrl,
  // so `key` above stays identical too. modifiedTime is the only signal the
  // content changed; fetch it up front (cheap, metadata-only) so the cache
  // lookup below can detect a stale row instead of silently returning the old
  // video's transcript against the new bytes forever (H08/BUG-031). Best-effort:
  // undefined (non-Drive source, no auth, or any failure) falls back to the
  // pre-fix behavior via sourceContentChanged's "unknown -> not stale" rule.
  // `let` because a MISS re-downloads via downloadFromDriveToFile below, whose
  // own return is the freshest value actually observed and wins if present.
  let freshModifiedTime = isDriveUrl(sourceUrl) ? await getDriveModifiedTime(sourceUrl) : undefined;
  // Cache POLICY (user-decided 2026-08-18, supersedes the campaign-only rule):
  // EVERY source caches. The same video must never be transcribed twice — each
  // re-transcribe is a real ElevenLabs credit spend, and the Drive
  // replace-in-place staleness check (sourceContentChanged above) already
  // covers the one legitimate "same URL, new bytes" case. Opt out only via the
  // explicit CLIP_CACHE_NONE=1 dev override.
  const cacheable = process.env.CLIP_CACHE_NONE !== "1";
  const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;

  // ── STITCHED CACHE WRITE (action → route) ── The Convex action fans out range
  // requests, stitches+analyzes the full transcript in the V8 isolate (which has
  // no node:crypto, so it cannot compute sourceKey or own the cache write), then
  // POSTs the finished transcript here for the route to cache ONCE. No transcribe,
  // no analyze — just store. Mirrors the cache-store block below.
  if (body.stitchedCachePut) {
    if (!(convex && cacheable)) return NextResponse.json({ ok: true, stored: false, reason: "cache disabled (not a campaign source / no convex)" });
    const sp = body.stitchedCachePut;
    const sSegments = Array.isArray(sp.segments) ? sp.segments : [];
    const sWords = Array.isArray(sp.words) ? sp.words : [];
    if (sSegments.length === 0) return NextResponse.json({ ok: false, error: "stitchedCachePut: empty segments" }, { status: 400 });
    try {
      const uploadUrl = (await convex.mutation(api.clipStorage.generateUploadUrl, {})) as string;
      const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments: sSegments, words: sWords }) });
      const { storageId } = (await up.json()) as { storageId: string };
      await convex.mutation(CACHE_PUT, {
        authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
        sourceKey: key, version: ANALYSIS_VERSION, durationSeconds: Number(sp.durationSeconds ?? 0),
        transcriptStorageId: storageId, analysis: sp.analysis ?? null, provider: String(sp.provider ?? "kie-gemini"), createdAt: Date.now(),
        ...(normalizeLanguageCode(sp.language) ? { language: normalizeLanguageCode(sp.language) } : {}),
        ...(freshModifiedTime ? { sourceModifiedTime: freshModifiedTime } : {}),
      });
      console.warn(`[transcribe-clip] stitched cache STORE ${key} (${sSegments.length} segments)`);
      return NextResponse.json({ ok: true, stored: true });
    } catch (e) {
      console.warn(`[transcribe-clip] stitched cache store skipped: ${e instanceof Error ? e.message : e}`);
      return NextResponse.json({ ok: true, stored: false, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── MASTER CACHE lookup ── transcribe + analyze ONCE per video, reused by
  // every agent. Graceful: if the transcriptCache table/functions aren't
  // deployed yet, the query throws → caught → treated as a miss. SKIPPED for a
  // `range` request (the action owns caching for the multi-chunk path).
  if (convex && cacheable && !isRange) {
    try {
      const cached = (await convex.query(CACHE_GET, { sourceKey: key })) as
        | { version: number; durationSeconds: number; transcriptUrl: string | null; analysis: unknown; provider: string; language?: string | null; sourceModifiedTime?: string | null }
        | null;
      // A Drive replace-in-place (H08/BUG-031) keeps the same sourceKey but bumps
      // modifiedTime — treat that as a miss even though `version` still matches,
      // instead of serving the old video's transcript against the new bytes.
      const stale = !!cached && sourceContentChanged(cached.sourceModifiedTime, freshModifiedTime);
      if (cached && cached.version === ANALYSIS_VERSION && cached.transcriptUrl && !stale) {
        const tr = (await (await fetch(cached.transcriptUrl)).json()) as { segments: Seg[]; words: Word[] };
        console.warn(`[transcribe-clip] cache HIT ${key} (skipped transcribe + analyze)`);
        return NextResponse.json({ ok: true, cached: true, durationSeconds: cached.durationSeconds, segments: tr.segments, words: tr.words, analysis: cached.analysis, provider: cached.provider, language: cached.language ?? reqLanguage ?? "" });
      }
      if (stale) console.warn(`[transcribe-clip] cache STALE ${key} — Drive source replaced (modifiedTime ${cached?.sourceModifiedTime} -> ${freshModifiedTime}) — re-transcribing`);
    } catch { /* cache not deployed / unreachable → miss, transcribe below */ }
    // cacheOnly probe: the action only wants to know HIT vs miss without paying to
    // transcribe. Reaching here = no usable HIT above → report a miss; the action
    // then fans out the chunked transcribe. (Falls through to transcribe otherwise.)
    if (body.cacheOnly) return NextResponse.json({ ok: true, miss: true });
  } else if (body.cacheOnly) {
    // cacheOnly with caching disabled (non-campaign source, no convex) → miss.
    return NextResponse.json({ ok: true, miss: true });
  }

  // ── METER (cache misses only — a cache HIT above returns before this and
  // stays $0). The meter now runs AFTER a confirmed non-empty transcript (below)
  // so a failed/empty STT call is never billed; the idemKey makes a client retry
  // of the same run-step free instead of double-billed. Runs without a billing
  // object (draft agents, local dev) stay unmetered but are logged so free-tier
  // volume is visible.
  const workDir = await mkdtemp(join(tmpdir(), "vello-stt-"));
  try {
    // SSRF-guarded + size-capped. CRITICAL here: the fetched bytes are sent to the
    // STT provider and the transcript TEXT is returned to the caller, so a raw
    // fetch was an internal-response exfiltration channel.
    //
    // Google Drive `sourceUrl`s are web *viewer* pages
    // (drive.google.com/file/d/<id>/view), NOT media URLs — a plain HTTP GET
    // returns the Drive HTML interstitial, which ffmpeg turns into empty audio and
    // then "transcription returned no parseable JSON". Route Drive sources through
    // the Drive-aware downloader (service-account / API-key / public fallback,
    // size-capped) exactly like /api/video/download does. This is the campaign
    // pre-transcribe path: campaignSources builds every URL via driveFileUrl(),
    // and the campaign pre-transcribe POSTs that raw sourceUrl with no audioUrl.
    const srcPath = join(workDir, "src.mp4");
    if (isDriveUrl(audioSrc)) {
      // Stream the Drive source straight to disk (2GB cap) — a campaign Drive video
      // can be 1GB+, which the RAM-buffered downloadFromDrive (500MB) would reject.
      // Mirrors the clip-download path (downloadFromDriveToFile + MAX_DOWNLOAD_BYTES=2GB).
      // Capture the modifiedTime THIS download actually observed (H08/BUG-031) —
      // no longer discarded — so the cache row we store below records what was
      // really just transcribed, for the NEXT run's staleness check.
      const dl = await downloadFromDriveToFile(audioSrc, srcPath, 2 * 1024 * 1024 * 1024);
      if (dl.modifiedTime) freshModifiedTime = dl.modifiedTime;
    } else {
      // Editor runs can reuse a full stored video. Stream it with the same
      // redirect/host checks and 2GB cap as Drive, without a huge RAM buffer.
      await streamFetchToFile(audioSrc, srcPath, { maxBytes: 2 * 1024 * 1024 * 1024 });
    }

    // Extract mono 16kHz mp3 for STT. ElevenLabs handles full-length audio, so
    // no 20-min cap on that path; the KIE fallback keeps the cap.
    const audioPath = join(workDir, "audio.mp3");
    const elevenLabs = ELEVENLABS_KEY.length > 0;
    // runWithMonoFallback: a source with an unlabeled multichannel layout (e.g. 32
    // channels) can't be downmixed by `-ac 1` — retry with the first channel.
    // runWithDiscardCorruptFallback: one damaged AAC frame anywhere in the source
    // (e.g. "TNS filter order 16 is greater than maximum 12") otherwise aborts
    // decoding the WHOLE source and kills the entire clip run — retry tolerating
    // bad frames instead of treating one as fatal. Composed outer→inner so either
    // failure mode gets its own targeted retry.
    await runWithDiscardCorruptFallback(
      (a) => runWithMonoFallback((aa) => runFfmpeg(ffmpegPath, aa), a),
      ["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", ...(elevenLabs ? [] : ["-t", "1200"]), audioPath],
    );

    // RANGE: trim the extracted audio to the requested window and transcribe ONLY
    // that slice. Re-encode (NOT -c copy) so the slice starts cleanly at t=0 with
    // sound timestamps — the returned segments/words are SLICE-LOCAL (0 = window
    // start) and the action offsets them. A range request never caps the slice
    // (the action's 12-min windows are already well under any provider limit).
    let sttPath = audioPath;
    if (isRange) {
      const rStart = Number(body.range!.start);
      const rEnd = Number(body.range!.end);
      const rangePath = join(workDir, "range.mp3");
      // Same corrupt-frame tolerance as the full-source extract above: a bad
      // AAC frame landing inside THIS window's slice otherwise aborts the
      // whole chunk (the "transcription failed for chunk N/M" error), even
      // though the source already survived one discardcorrupt pass upstream.
      await runWithDiscardCorruptFallback(
        (a) => runWithMonoFallback((aa) => runFfmpeg(ffmpegPath, aa), a),
        ["-y", "-ss", String(rStart), "-t", String(rEnd - rStart), "-i", audioPath, "-ac", "1", "-ar", "16000", "-b:a", "64k", rangePath],
      );
      sttPath = rangePath;
      console.warn(`[transcribe-clip] range ${rStart.toFixed(0)}-${rEnd.toFixed(0)}s → slice-local transcribe`);
    }
    const totalDur = await probeDuration(ffmpegPath, sttPath);
    // Empty/zero-duration audio means the source URL returned something that is
    // not a playable video (e.g. a Drive/HTML viewer page, a 0-byte file, or a
    // wrong mime). Fail with a diagnosable message instead of feeding empty audio
    // to STT and surfacing a confusing "no parseable JSON" downstream.
    if (!(totalDur > 0)) {
      throw new Error(
        `source produced no audio (extracted 0s) — the source URL likely returned a web page, not a video. src=${key}`,
      );
    }

    let segments: Seg[]; let words: Word[]; let durationSeconds: number; let provider: string; let language = reqLanguage;

    type Stt = { segments: Seg[]; words: Word[]; durationSeconds: number; language: string };

    // DETERMINISTIC "the audio is music, not speech" signal. Scribe tagged music/
    // singing windows but found zero spoken words → the video is a backing track
    // (or the whole video is a song). Falling back to KIE there would TRANSCRIBE
    // THE LYRICS as captions — the exact "captions show the background music" bug.
    // This marker makes the caller skip the cross-fallback and return NO captions.
    class MusicOnlyError extends Error {
      readonly result: Stt;
      constructor(result: Stt) {
        super("audio is music/singing with no spoken words — returning no captions");
        this.name = "MusicOnlyError";
        this.result = result;
      }
    }

    // ── PROVIDER RUNNERS ── Each returns a non-empty transcript or THROWS a
    // provider-named, diagnosable error. Defined as closures so they can be
    // composed for cross-fallback below (primary → other) when both keys exist.

    // ElevenLabs Scribe — one call, real word timings + audio events. A
    // 0-words result is deterministic for that audio (music/silent/non-speech);
    // the throw says so instead of the old misleading "no parseable JSON".
    const runElevenLabs = async (): Promise<Stt> => {
      const t0 = Date.now();
      const r = await transcribeWithElevenLabs(sttPath, reqLanguage);
      console.warn(`[transcribe-clip] elevenlabs: ${Math.round(totalDur)}s audio → ${r.words.length} words, ${r.segments.length} segments, ${r.audioEvents} audio events, lang=${r.language || "?"}${r.languageProbability ? `@${r.languageProbability.toFixed(2)}` : ""}${reqLanguage ? " (pinned)" : ""} in ${Math.round((Date.now() - t0) / 1000)}s`);
      if (r.segments.length === 0 || r.words.length === 0) {
        // Scribe tagged music/singing windows AND found no speech → the audio IS a
        // backing track/song. This is a SUCCESS (no captions — the fix, not a bug);
        // signal it distinctly so the caller does NOT fall back to KIE (which would
        // transcribe the lyrics into captions). Genuinely silent/unknown audio has
        // no music windows → falls through as the plain named error → KIE fallback.
        if (r.music.length > 0) {
          throw new MusicOnlyError({ segments: r.segments, words: r.words, durationSeconds: totalDur || r.duration, language: r.language });
        }
        throw new Error(
          `elevenlabs returned no speech words (words=${r.words.length}, segments=${r.segments.length}, audioEvents=${r.audioEvents}, audio=${Math.round(totalDur)}s) — likely music-only/silent/non-speech audio, not a parse failure`,
        );
      }
      return { segments: r.segments, words: r.words, durationSeconds: totalDur || r.duration, language: r.language };
    };

    // KIE Gemini, chunked. Long audio in one request reliably fails (oversized
    // base64 payload / truncated word list), so chunk at ~4 min, transcribe
    // SEQUENTIALLY (parallel trips Kie's rate limit), and rebase each chunk's
    // timestamps by its offset. Carries the LAST per-chunk error into the
    // aggregate throw so the run log shows the real upstream cause.
    const runKie = async (): Promise<Stt> => {
      const CHUNK = 240;
      const chunkCount = totalDur > CHUNK + 60 ? Math.ceil(totalDur / CHUNK) : 1;
      const chunks: { offset: number; dur: number; b64: string }[] = [];
      if (chunkCount === 1) {
        chunks.push({ offset: 0, dur: totalDur, b64: (await readFile(sttPath)).toString("base64") });
      } else {
        for (let i = 0; i < chunkCount; i++) {
          const offset = i * CHUNK;
          const dur = Math.min(CHUNK, totalDur - offset);
          const chunkPath = join(workDir, `chunk${i}.mp3`);
          await runFfmpeg(ffmpegPath, ["-y", "-ss", String(offset), "-t", String(dur), "-i", sttPath, "-c", "copy", chunkPath]);
          chunks.push({ offset, dur, b64: (await readFile(chunkPath)).toString("base64") });
        }
        console.warn(`[transcribe-clip] ${Math.round(totalDur)}s audio → ${chunkCount} chunks`);
      }
      const partials: ({ segments: Seg[]; words: Word[] } | null)[] = new Array(chunks.length).fill(null);
      let lastErr: unknown = null;
      // Language, resolved ONCE. Chunk 1 either gets the caller's pin or reports what
      // it heard; every later chunk is pinned to that. Without this, chunk 3 of a
      // Malay video could decide it was Indonesian (or "helpfully" translate to
      // English) and the stitched captions switch language mid-clip.
      let chunkLanguage = reqLanguage;
      for (let i = 0; i < chunks.length; i++) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await transcribeChunk(chunks[i].b64, chunkLanguage);
            if (!chunkLanguage && r.language) {
              chunkLanguage = r.language;
              if (chunks.length > 1) console.warn(`[transcribe-clip] kie-gemini detected language ${chunkLanguage} on chunk 1 — pinning it for the remaining ${chunks.length - 1} chunk(s)`);
            }
            partials[i] = rebaseChunk(r, chunks[i].offset, chunks[i].dur);
            break;
          } catch (e) {
            lastErr = e;
            console.warn(`[transcribe-clip] kie chunk ${i + 1}/${chunks.length} attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : e}`);
            if (attempt < 2) await new Promise((rs) => setTimeout(rs, 5000 * (attempt + 1)));
          }
        }
      }
      const okChunks = partials.filter(Boolean) as { segments: Seg[]; words: Word[] }[];
      if (okChunks.length === 0) {
        throw new Error(`kie-gemini: all ${chunks.length} chunk(s) failed — last: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
      }
      const segs = okChunks.flatMap((r) => r.segments).sort((a, b) => a.start - b.start);
      const wds = okChunks.flatMap((r) => r.words).sort((a, b) => a.start - b.start);
      if (segs.length === 0 || wds.length === 0) {
        throw new Error(`kie-gemini: ${okChunks.length}/${chunks.length} chunk(s) parsed but yielded an empty transcript (segments=${segs.length}, words=${wds.length})`);
      }
      return { segments: segs, words: wds, durationSeconds: totalDur || segs.at(-1)?.end || 0, language: chunkLanguage };
    };

    // ── PRIMARY + CROSS-FALLBACK ── Primary = ElevenLabs IFF its key is set,
    // else KIE. When BOTH keys are configured, the primary's failure falls
    // through to the other before failing the run. This rescues e.g. music-heavy
    // audio where Scribe finds no words but Gemini can transcribe sparse speech
    // (and vice-versa for a KIE rate-limit/refusal). On total failure the throw
    // names both providers' messages.
    const haveKie = KIE_KEY.length > 0;
    if (elevenLabs) {
      try {
        const r = await runElevenLabs();
        segments = r.segments; words = r.words; durationSeconds = r.durationSeconds; provider = "elevenlabs"; language = r.language || language;
      } catch (elErr) {
        // Music-only audio (Scribe tagged music/singing, zero speech words) is a
        // legit EMPTY result, not a failure: the video speaks no captions, so we
        // return none — and do NOT fall back to KIE, which would burn the song's
        // lyrics as captions (the very bug we're fixing).
        if (elErr instanceof MusicOnlyError) {
          console.warn(`[transcribe-clip] elevenlabs: audio is music/singing with no spoken words — skipping captions (no KIE fallback, which would transcribe lyrics)`);
          const r = elErr.result;
          segments = r.segments; words = r.words; durationSeconds = r.durationSeconds; provider = "elevenlabs"; language = r.language || language;
        } else if (!haveKie) {
          throw elErr;
        } else {
          console.warn(`[transcribe-clip] elevenlabs failed, falling back to kie-gemini: ${elErr instanceof Error ? elErr.message : elErr}`);
          try {
            const r = await runKie();
            segments = r.segments; words = r.words; durationSeconds = r.durationSeconds; provider = "kie-gemini"; language = r.language || language;
          } catch (kieErr) {
            throw new Error(`transcription failed — elevenlabs: ${elErr instanceof Error ? elErr.message : String(elErr)}; kie-gemini: ${kieErr instanceof Error ? kieErr.message : String(kieErr)}`);
          }
        }
      }
    } else {
      // KIE-primary only happens when ELEVENLABS_KEY is unset (provider choice is
      // keyed off that key), so there is no ElevenLabs to fall back to here. The
      // 503 guard above guarantees KIE_KEY is set in this branch.
      const r = await runKie();
      segments = r.segments; words = r.words; durationSeconds = r.durationSeconds; provider = "kie-gemini"; language = r.language || language;
    }

    // ── RANGE EARLY-RETURN ── A range request returns its SLICE-LOCAL transcript
    // (timestamps relative to the window, 0 = window start) and stops here: NO
    // meter (the action charges skills once per job), NO analyze (meaningless on a
    // slice — the action analyzes the full stitched transcript), NO cache write
    // (the action owns the single full-transcript cache row). The action offsets
    // these timestamps by the window start and stitches across chunks.
    if (isRange) {
      // `language` rides along so the ACTION can pin it on every remaining window
      // (see convex/clipJobs.ts) — one source, one language, no mid-video drift.
      return NextResponse.json({ ok: true, range: true, durationSeconds, segments, words, provider, language });
    }

    // ── METER (after a confirmed non-empty transcript from either provider, so a
    // failed/empty STT is never billed). ──
    if (body.billing?.mintAddress) {
      const b = body.billing;
      const idemKey = b.runId && b.step ? `${b.runId}:${b.step}` : undefined;
      const metered = await meterAgentService(b.mintAddress!, "transcription", 1, idemKey);
      if (!metered.ok) {
        return NextResponse.json({ ok: false, error: metered.reason ?? "needs_funding", billing: metered }, { status: 402 });
      }
    } else {
      console.warn(`[clip-billing] unmetered transcribe-clip (no billing identity) src=${key}`);
    }

    if (body.skipAnalysis) {
      return NextResponse.json({ ok: true, cached: false, durationSeconds, segments, words, analysis: null, provider, language });
    }

    // ── One-time ANALYSIS: ranked viral moments + emotion (the "metadata") ──
    const analysis = await analyzeTranscript({ segments, words, durationSeconds }, { apiKey: KIE_KEY });

    // ── Store in the master cache (graceful: skipped if table not deployed) ──
    // Never cache an LLM-failure fallback: it would serve content-blind "Clip N"
    // slices to every later run of this video until the version bumps.
    if (convex && cacheable && !analysis.fallback) {
      try {
        const uploadUrl = (await convex.mutation(api.clipStorage.generateUploadUrl, {})) as string;
        const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments, words }) });
        const { storageId } = (await up.json()) as { storageId: string };
        await convex.mutation(CACHE_PUT, {
          authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
          sourceKey: key, version: ANALYSIS_VERSION, durationSeconds,
          transcriptStorageId: storageId, analysis, provider, createdAt: Date.now(),
          ...(language ? { language } : {}),
          ...(freshModifiedTime ? { sourceModifiedTime: freshModifiedTime } : {}),
        });
        console.warn(`[transcribe-clip] cache STORE ${key} (${provider}, lang=${language || "?"}, ${analysis.moments.length} moments)`);
      } catch (e) {
        console.warn(`[transcribe-clip] cache store skipped (table not deployed?): ${e instanceof Error ? e.message : e}`);
      }
    }

    return NextResponse.json({ ok: true, cached: false, durationSeconds, segments, words, analysis, provider, language });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
