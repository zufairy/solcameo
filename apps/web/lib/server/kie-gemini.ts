// Gemini 3.5 Flash via Kie's native Gemini endpoint, with Google Search grounding.
//
// Used for the BEST copy — the video script (copywriting) and the storyboard /
// video-prompt generation — because Gemini 3.5 Flash can search online and writes
// strong, current copy. Pure `fetch` + timers only, so it is safe in both Next
// routes and the Convex runtime.
//
// Endpoint shape (per Kie docs):
//   POST https://api.kie.ai/gemini/v1/models/gemini-3-5-flash:streamGenerateContent
//   body: { contents: [{ role, parts: [{ text }] }], tools: [{ googleSearch: {} }],
//           generationConfig: { thinkingConfig }, stream }
//   response: candidates[].content.parts[].text (streamed — we aggregate all chunks)

import { extractClaudeJson } from "./kie-claude";

const KIE_GEMINI_35 = "https://api.kie.ai/gemini/v1/models/gemini-3-5-flash:streamGenerateContent";
const GEMINI_TIMEOUT_MS = 60_000; // search grounding can add a little latency

function kieKey(apiKey?: string): string {
  return apiKey?.trim() || process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Pull all model-output text out of a Gemini response — handles a single JSON
 *  object, a JSON array of chunks, or an SSE/NDJSON stream. Skips `thought` parts. */
export function extractGeminiText(raw: string): string {
  let out = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pushFromObj = (obj: any) => {
    const cands = obj?.candidates;
    if (!Array.isArray(cands)) return;
    for (const c of cands) {
      const parts = c?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const p of parts) {
        if (typeof p?.text === "string" && !p?.thought) out += p.text;
      }
    }
  };

  // 1) Whole body is JSON (object or array of chunks).
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) v.forEach(pushFromObj);
    else pushFromObj(v);
    if (out.trim()) return out.trim();
  } catch { /* fall through to line-by-line */ }

  // 2) SSE (`data: {...}`) or NDJSON — parse each line.
  for (const line of raw.split(/\r?\n/)) {
    const s = line.replace(/^data:\s*/i, "").trim();
    if (!s || s === "[DONE]") continue;
    try { pushFromObj(JSON.parse(s)); } catch { /* ignore non-JSON lines */ }
  }
  return out.trim();
}

/** Shared request+retry core for the Gemini 3.5 Flash endpoint — returns the
 *  raw response body so callers can extract text and/or grounding sources
 *  from the same request instead of firing it twice. */
async function requestGemini35Raw(params: { system?: string; user: string; apiKey?: string; search?: boolean }): Promise<string> {
  const key = kieKey(params.apiKey);
  if (!key) throw new Error("KIE_API_KEY not configured");
  const text = params.system ? `${params.system}\n\n${params.user}` : params.user;
  const body = {
    contents: [{ role: "user", parts: [{ text }] }],
    ...(params.search === false ? {} : { tools: [{ googleSearch: {} }] }),
    generationConfig: { thinkingConfig: { includeThoughts: false, thinkingLevel: "low" } },
    stream: false,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchWithTimeout(KIE_GEMINI_35, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, GEMINI_TIMEOUT_MS);
    if (!res.ok) {
      const errText = await res.text();
      if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
      throw new Error(`Kie Gemini 3.5 HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const raw = await res.text();
    if (extractGeminiText(raw) || attempt >= 2) return raw;
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error("Kie Gemini 3.5 unreachable");
}

/** One-shot Gemini 3.5 Flash text completion (Google Search grounding on by
 *  default). `system` is folded into the user turn (this endpoint takes
 *  user/model roles only). Retries once on a transient 5xx. */
export async function callGemini35Text(params: {
  system?: string;
  user: string;
  apiKey?: string;
  /** Google Search grounding — on by default (current, fact-grounded copy). */
  search?: boolean;
}): Promise<string> {
  const raw = await requestGemini35Raw(params);
  const textOut = extractGeminiText(raw);
  if (!textOut) throw new Error("Kie Gemini 3.5 returned empty content");
  return textOut;
}


/** Gemini 3.5 Flash completion parsed as a JSON object. */
export async function callGemini35JSON<T = Record<string, unknown>>(params: {
  system?: string;
  user: string;
  apiKey?: string;
  search?: boolean;
}): Promise<T> {
  const text = await callGemini35Text(params);
  const obj = extractClaudeJson(text);
  if (!obj) throw new Error(`Kie Gemini 3.5 returned no parseable JSON (got: ${text.slice(0, 120)})`);
  return obj as T;
}

// ─── Gemini 3.1 Pro (OpenAI-compatible chat completions) ──────────────────────
// Heavier reasoning model — used for the self-organizing memory consolidation
// (read everything, merge + prune). OpenAI shape: choices[0].message.content.

const KIE_GEMINI_31_PRO = "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions";
const GEMINI_PRO_TIMEOUT_MS = 120_000; // high reasoning effort can take a while

/** One-shot Gemini 3.1 Pro text completion. `search` enables Google Search
 *  grounding (off by default — memory consolidation is internal). */
export async function callGemini31Pro(params: {
  system?: string;
  user: string;
  apiKey?: string;
  search?: boolean;
}): Promise<string> {
  const key = kieKey(params.apiKey);
  if (!key) throw new Error("KIE_API_KEY not configured");
  const messages = [
    ...(params.system ? [{ role: "system", content: params.system }] : []),
    { role: "user", content: params.user },
  ];
  const body: Record<string, unknown> = {
    messages,
    stream: false,
    include_thoughts: false,
    reasoning_effort: "high",
    ...(params.search ? { tools: [{ type: "function", function: { name: "googleSearch" } }] } : {}),
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchWithTimeout(KIE_GEMINI_31_PRO, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, GEMINI_PRO_TIMEOUT_MS);
    if (!res.ok) {
      const errText = await res.text();
      if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      throw new Error(`Kie Gemini 3.1 Pro HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json().catch(() => ({}))) as any;
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p: { text?: string }) => p?.text ?? "").join("")
        : "";
    if (text.trim()) return text.trim();
    if (attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
    throw new Error("Kie Gemini 3.1 Pro returned empty content");
  }
  throw new Error("Kie Gemini 3.1 Pro unreachable");
}
