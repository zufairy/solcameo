// Shared text-completion caller. Google Gemini direct is primary; Kie's
// OpenAI-shaped Gemini route is retained as the fallback.
//
// Was: Claude Haiku/Sonnet via `https://api.kie.ai/claude/v1/messages`, with a
// Gemini failover bolted on for when Anthropic's passthrough went dark (EVERY
// claude-* model answering `HTTP 500 {"error":{"message":"Internal error,
// please try again later"}}` while Gemini kept serving 200s on the same key).
// That outage was frequent enough — and the wasted Claude attempt + retry slow
// enough — that Gemini is now the PRIMARY (and only) brain for every caller in
// this file: clip edit planner, captions, storyboards, agent tasks, avatar
// gen, everything. Function names (`callClaudeText`/`callClaudeJSON`/
// `extractClaudeJson`) are kept as-is so no caller needs to change.
//
// Pure `fetch` + timers only, so it is safe to bundle inside the Convex video
// action as well as the Next.js routes.

import { geminiChat, type GeminiMessage } from "./geminiFast";

// NOTE on slugs (verified live 2026-08-18): Kie's OpenAI-compat path serves
// Gemini 3.6 Flash ONLY as "gemini-3-6-flash-openai" — bare "gemini-3-6-flash"
// 422s on chat/completions (it exists only on Kie's native
// `/gemini/v1/models/...:generateContent` route). "gemini-3-flash" also still
// works as an older fallback. The endpoint is derived from the model slug, so a
// KIE_GEMINI_MODEL env override reroutes both together.
const KIE_GEMINI_MODEL = process.env.KIE_GEMINI_MODEL?.trim() || "gemini-3-6-flash-openai";
const KIE_GEMINI_COMPLETIONS = `https://api.kie.ai/${KIE_GEMINI_MODEL}/v1/chat/completions`;

function kieKey(): string {
  return process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";
}

/** Strip ```json fences then brace-walk to the first complete JSON object.
 *  If the first balanced object fails to parse, keep scanning for a LATER
 *  `{...}` that does parse (rescues "prose then JSON" / multi-object output)
 *  instead of bailing on the first failure. */
export function extractClaudeJson(raw: string): Record<string, unknown> | null {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  try { const v = JSON.parse(s); if (v && typeof v === "object") return v as Record<string, unknown>; } catch { /* fall through */ }
  let scanFrom = 0;
  for (;;) {
    const start = s.indexOf("{", scanFrom);
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false, endIdx = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx < 0) return null; // unbalanced from here on — nothing more to try
    const candidate = s.slice(start, endIdx + 1).replace(/,(\s*[}\]])/g, "$1");
    try { const v = JSON.parse(candidate); if (v && typeof v === "object") return v as Record<string, unknown>; } catch { /* try next */ }
    scanFrom = start + 1; // skip past this `{` and look for a later object
  }
}

/** One-shot Gemini 3.6 Flash text completion. Retries once on a transient 5xx.
 *  `apiKey` lets callers running outside Next (e.g. the Convex render action,
 *  whose env has no KIE_API_KEY) forward the key explicitly. */
// Time-box each request so a hung Kie connection can't wedge the caller (e.g. an
// agent task stuck on "generating"). 45s per attempt is ample for Flash.
const CLAUDE_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Gemini 3.6 Flash on the OpenAI-shaped Kie route — the ONE brain every
 *  caller in this file uses. `model` lets a caller override (mirrors the old
 *  Claude-model override), otherwise defaults to KIE_GEMINI_MODEL. */
/** A second, independently-routed slug that keeps serving when the primary passthrough
 *  has an upstream episode (the file-header pattern: one model's route 5xx/524s
 *  for a stretch while another keeps answering 200 on the same key). */
const KIE_GEMINI_FALLBACK_MODEL = process.env.KIE_GEMINI_FALLBACK_MODEL?.trim() || "gemini-3-flash";

/** Transient upstream failure — worth retrying / failing over. Covers real
 *  HTTP 5xx AND Kie's HTTP-200-with-{"code":524/500,...} body shape (the
 *  "Kie Gemini error 524: Internal error" that used to throw with NO retry). */
function isTransientGeminiError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /HTTP 5\d\d|error 5\d\d|error 524|Internal error|Server Error|abort|network|unreachable|empty content|(?:HTTP|error) 422|channel is not supported|model (?:is )?not supported/i.test(msg);
}

async function callGeminiTextOnce(params: { system: string; user: string; maxTokens?: number; apiKey: string }, model: string, maxAttempts: number): Promise<string> {
  // Kie routes per-model in the URL path — a caller's model override must
  // change the endpoint too, not just the body's `model`.
  const url = model === KIE_GEMINI_MODEL ? KIE_GEMINI_COMPLETIONS : `https://api.kie.ai/${model}/v1/chat/completions`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          // +1024 thinking headroom: Gemini 3.6 Flash's reasoning tokens count
          // against max_tokens, and a tight caller budget can be consumed
          // entirely by thinking → empty content.
          max_tokens: (params.maxTokens ?? 1500) + 1024,
          messages: [
            { role: "system", content: params.system },
            { role: "user", content: params.user },
          ],
        }),
      }, CLAUDE_TIMEOUT_MS);
    } catch (e) {
      // Network failure / abort-on-timeout — retryable.
      lastErr = e;
      if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    }
    if (!res.ok) {
      const text = await res.text();
      if (res.status >= 500 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 700 * attempt));
        continue;
      }
      throw new Error(`Kie Gemini HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json().catch(() => ({}))) as any;
    if (data?.error) throw new Error(typeof data.error === "string" ? data.error : (data.error.message ?? "Kie Gemini error"));
    // Kie's "bad request" shape has no `error` field at all — e.g. an unsupported
    // model slug answers `{"code":422,"msg":"..."}`. A body-level 5xx/524 is the
    // SAME transient upstream hiccup as an HTTP 5xx (Kie just wraps it in a 200)
    // — retry it here instead of throwing on the first sight.
    if (data?.code && data.code !== 200) {
      const err = new Error(`Kie Gemini error ${data.code}: ${data.msg ?? "unknown"}`);
      if (data.code >= 500 && attempt < maxAttempts) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 700 * attempt));
        continue;
      }
      throw err;
    }
    const text = String(data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "").trim();
    if (!text) throw new Error("Kie Gemini returned empty content");
    return text;
  }
  throw lastErr instanceof Error ? lastErr : new Error("Kie Gemini unreachable");
}

async function callGeminiText(params: { system: string; user: string; maxTokens?: number; apiKey: string; model?: string }): Promise<string> {
  const model = params.model?.trim() || KIE_GEMINI_MODEL;
  try {
    return await callGeminiTextOnce(params, model, 3);
  } catch (e) {
    // ENGINE FAILOVER: when the caller didn't pin a model and the failure class
    // is transient (5xx / body-524 / timeout / empty), the primary slug's route
    // is likely mid-episode — the differently-routed fallback slug usually
    // keeps serving on the same key. One extra shot, clearly logged.
    const pinned = !!params.model?.trim() && params.model.trim() !== KIE_GEMINI_MODEL;
    if (!pinned && model !== KIE_GEMINI_FALLBACK_MODEL && isTransientGeminiError(e)) {
      console.warn(`[kie-claude] ${model} failed transiently (${e instanceof Error ? e.message.slice(0, 140) : e}) — failing over to ${KIE_GEMINI_FALLBACK_MODEL}`);
      return await callGeminiTextOnce(params, KIE_GEMINI_FALLBACK_MODEL, 2);
    }
    throw e;
  }
}

export async function callClaudeText(params: { system: string; user: string; maxTokens?: number; apiKey?: string; model?: string }): Promise<string> {
  const direct = await geminiChat([
    { role: "system", content: params.system },
    { role: "user", content: params.user },
  ], {
    // Direct Gemini counts reasoning against max_tokens. Preserve the caller's
    // answer budget while leaving room for minimal internal reasoning.
    maxTokens: params.maxTokens ? params.maxTokens + 512 : undefined,
    timeoutMs: 12_000,
    maxPasses: 1,
    reasoningEffort: "minimal",
    tag: "shared-text",
  });
  if (direct?.text) return direct.text;

  const apiKey = params.apiKey?.trim() || kieKey();
  if (!apiKey) throw new Error("Text generation is temporarily unavailable");
  return callGeminiText({ ...params, apiKey });
}

/** Official Gemini completion parsed as JSON, with Kie Gemini as fallback. */
export async function callClaudeJSON<T = Record<string, unknown>>(params: { system: string; user: string; maxTokens?: number; apiKey?: string; model?: string }): Promise<T> {
  const messages: GeminiMessage[] = [
    { role: "system", content: params.system },
    { role: "user", content: params.user },
  ];
  const direct = await geminiChat(messages, {
    maxTokens: params.maxTokens ? params.maxTokens + 512 : undefined,
    timeoutMs: 12_000,
    maxPasses: 1,
    reasoningEffort: "minimal",
    tag: "shared-json",
  });
  if (direct?.text) {
    const directObj = extractClaudeJson(direct.text);
    if (directObj) return directObj as T;
    console.warn(`[gemini:shared-json] ${direct.model} returned non-JSON — using Kie fallback`);
  }

  const apiKey = params.apiKey?.trim() || kieKey();
  if (!apiKey) throw new Error("Text generation is temporarily unavailable");
  const text = await callGeminiText({ ...params, apiKey });
  const obj = extractClaudeJson(text);
  if (obj) return obj as T;
  throw new Error(`non-JSON response (got: ${text.slice(0, 120)})`);
}

/**
 * Gemini 3.6 Flash vision call (OpenAI-shaped Kie route with `image_url` content
 * blocks). Used to UNDERSTAND a video's content when there's no transcript — the
 * operator's Ask-Hook/Auto-Hook wants the hook to match what's actually on screen,
 * and an uploaded main-content video has no script to read. `images` are data:
 * URLs (base64 JPEG), which Gemini natively accepts. Best-effort: callers treat
 * any throw as "no visual context" and fall back to text-only generation.
 */
export async function callGeminiVision(params: {
  system: string;
  user: string;
  /** Data URLs (data:image/jpeg;base64,...) of representative frames. */
  images: string[];
  maxTokens?: number;
  apiKey?: string;

}): Promise<string> {
  if (!params.images.length) throw new Error("callGeminiVision: no images");

  const content: Exclude<GeminiMessage["content"], string> = [
    { type: "text", text: params.user },
    ...params.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  const direct = await geminiChat([
    { role: "system", content: params.system },
    { role: "user", content },
  ], {
    maxTokens: params.maxTokens ? params.maxTokens + 512 : undefined,
    timeoutMs: 20_000,
    maxPasses: 1,
    reasoningEffort: "minimal",
    tag: "shared-vision",
  });
  if (direct?.text) return direct.text;

  const apiKey = params.apiKey?.trim() || kieKey();
  if (!apiKey) throw new Error("Visual analysis is temporarily unavailable");
  // Gemini 3.6 Flash is a THINKING model: on complex images its reasoning
  // tokens count against max_tokens, and a tight caller budget (e.g. 400) can
  // be fully consumed by thinking → HTTP 200 with EMPTY content ("Kie Gemini
  // vision returned empty"). Give every request thinking headroom on top of the
  // caller's answer budget, and retry once with double the budget (then once on
  // the older non-thinking fallback model) before giving up.
  const answerBudget = params.maxTokens ?? 400;
  const attempt = async (model: string, maxTokens: number): Promise<string> => {
    const url = model === KIE_GEMINI_MODEL ? KIE_GEMINI_COMPLETIONS : `https://api.kie.ai/${model}/v1/chat/completions`;
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: params.system },
            { role: "user", content },
          ],
        }),
      },
      CLAUDE_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kie Gemini vision HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json().catch(() => ({}))) as any;
    if (data?.error) throw new Error(typeof data.error === "string" ? data.error : (data.error.message ?? "Kie Gemini vision error"));
    // Kie's "bad request" shape is HTTP 200 + {code,msg} with NO error field —
    // surface it as the config/problem it is instead of "returned empty".
    if (data?.code && data.code !== 200) throw new Error(`Kie Gemini vision error ${data.code}: ${data.msg ?? "unknown"}`);
    const first = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    const raw = first?.message?.content ?? first?.text ?? "";
    // Some providers return content as an array of typed parts.
    const text = (Array.isArray(raw)
      ? raw.map((part: unknown) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text ?? "");
          return "";
        }).join("")
      : String(raw ?? "")
    ).trim();
    return text;
  };

  let text = "";
  let lastErr: unknown;
  const tries: Array<[string, number]> = [
    [KIE_GEMINI_MODEL, answerBudget + 1024],
    [KIE_GEMINI_MODEL, answerBudget * 2 + 2048],
    ["gemini-3-flash", answerBudget + 512],
  ];
  for (const [model, budget] of tries) {
    try {
      text = await attempt(model, budget);
      if (text) return text;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  throw new Error("Kie Gemini vision returned empty");
}

/**
 * Gemini 3.6 Flash WHOLE-VIDEO understanding — sends the source video itself
 * (as a `video_url` content block, the OpenAI-shaped analogue of `image_url`)
 * rather than one still frame per scene. Gemini is natively multimodal over
 * video, so this lets it watch the full clip — motion, pacing, dialogue timing,
 * and how scenes connect — instead of inferring a story from disconnected
 * frames. Best-effort: callers catch the throw and fall back to a text-only
 * summary stitched from the per-scene frame descriptions.
 */
export async function callGeminiVideoVision(params: {
  system: string;
  user: string;
  videoUrl: string;
  maxTokens?: number;
  apiKey?: string;
}): Promise<string> {
  const apiKey = params.apiKey?.trim() || kieKey();
  if (!apiKey) throw new Error("KIE_API_KEY not configured");

  const content = [
    { type: "text", text: params.user },
    { type: "video_url", video_url: { url: params.videoUrl } },
  ];
  const maxTokens = (params.maxTokens ?? 500) + 1024;
  const res = await fetchWithTimeout(
    KIE_GEMINI_COMPLETIONS,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: KIE_GEMINI_MODEL,
        stream: false,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content },
        ],
      }),
    },
    60_000,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kie Gemini video HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json().catch(() => ({}))) as any;
  if (data?.error) throw new Error(typeof data.error === "string" ? data.error : (data.error.message ?? "Kie Gemini video error"));
  if (data?.code && data.code !== 200) throw new Error(`Kie Gemini video error ${data.code}: ${data.msg ?? "unknown"}`);
  const first = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  const raw = first?.message?.content ?? first?.text ?? "";
  const text = (Array.isArray(raw)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? raw.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("")
    : String(raw ?? "")
  ).trim();
  if (!text) throw new Error("Kie Gemini video returned empty content");
  return text;
}
