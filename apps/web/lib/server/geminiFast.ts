/**
 * Fast chat via Google's Gemini API directly (OpenAI-compatible endpoint).
 *
 * Kie resells Gemini but queues every request (~30s to first token); direct is
 * ~2s. Every chat surface (builder copilot, agent/control-panel chat, the site
 * help widget) goes through here first and only falls back to Kie when EVERY
 * model below is unavailable.
 *
 * Models are tried in order. Quotas are per model — on the free tier a model
 * can run out (429 "exceeded your current quota") while its siblings still
 * answer — so a model that 429s/503s is parked for Google's suggested retry
 * window and the next one is used instead, without wasting a call on it.
 *
 * Env:
 *   GEMINI_API_KEY      required
 *   GEMINI_CHAT_MODELS  optional comma list overriding the order below
 *   GEMINI_CHAT_MODEL   optional single model tried first (legacy)
 */

export const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim() ?? "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// The preview Flash route currently answers directly on this account; other
// models are fallback options when their capacity is available.
// Keep the verified low-latency production route first. Preview/thinking
// routes can consume a small response budget internally and return HTTP 200
// with empty content; they remain useful fallbacks with larger budgets.
const DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-3.6-flash"];
type ReasoningEffort = "minimal" | "low" | "medium" | "high";

function configuredModels(): string[] {
  const list = process.env.GEMINI_CHAT_MODELS?.split(",").map((m) => m.trim()).filter(Boolean);
  if (list?.length) return [...new Set([...list, ...DEFAULT_MODELS])];
  const first = process.env.GEMINI_CHAT_MODEL?.trim();
  return first ? [first, ...DEFAULT_MODELS.filter((m) => m !== first)] : DEFAULT_MODELS;
}

const parkedUntil = new Map<string, number>();

function retryDelayMs(): number {
  const now = Date.now();
  const waits = configuredModels().map((model) => (parkedUntil.get(model) ?? 0) - now).filter((ms) => ms > 0);
  return Math.min(10_000, Math.max(800, waits.length ? Math.min(...waits) : 800));
}

/** Models to try now, in order (parked ones skipped — unless all are parked,
 *  then try them anyway rather than failing outright). */
export function geminiModelChain(): string[] {
  const all = configuredModels();
  const now = Date.now();
  const live = all.filter((m) => (parkedUntil.get(m) ?? 0) <= now);
  return live.length ? live : all;
}

/** Park a model after a quota / overload reply. Honours Google's "retry in Ns". */
function park(model: string, status: number, body: string) {
  const hinted = Number(body.match(/retry in ([\d.]+)s/i)?.[1]);
  const ms = Number.isFinite(hinted) && hinted > 0
    ? Math.min(hinted * 1000, 60 * 60_000)
    : status === 429 ? 10 * 60_000 : 60_000;
  parkedUntil.set(model, Date.now() + ms);
  console.warn(`[gemini] ${model} ${status} — parked for ${Math.round(ms / 1000)}s`);
}

export type GeminiMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

function request(model: string, messages: GeminiMessage[], opts: { stream?: boolean; maxTokens?: number; reasoningEffort?: ReasoningEffort }, signal: AbortSignal) {
  return fetch(GEMINI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GEMINI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning_effort: opts.reasoningEffort ?? "minimal",
      ...(opts.stream ? { stream: true } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      messages,
    }),
    signal,
  });
}

async function noteFailure(model: string, res: Response, tag?: string) {
  const body = await res.text().catch(() => "");
  if (res.status === 429 || res.status === 503) {
    park(model, res.status, body);
    const detail = (() => { try { return JSON.parse(body)?.error?.message; } catch { return ""; } })();
    if (detail) console.warn(`[gemini${tag ? `:${tag}` : ""}] ${model}: ${String(detail).replace(/\s+/g, " ").slice(0, 180)}`);
  } else {
    console.warn(`[gemini${tag ? `:${tag}` : ""}] ${model} HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
}

/** Non-streaming reply. Returns null when no Gemini model could answer
 *  (caller falls back to Kie). */
export async function geminiChat(
  messages: GeminiMessage[],
  opts: { maxTokens?: number; timeoutMs?: number; firstModelTimeoutMs?: number; maxModels?: number; maxPasses?: number; models?: string[]; reasoningEffort?: ReasoningEffort; tag?: string } = {},
): Promise<{ text: string; model: string } | null> {
  if (!GEMINI_KEY) return null;
  let transientFailure = false;
  for (let pass = 0; pass < (opts.maxPasses ?? 2); pass++) {
    if (pass > 0) {
      if (!transientFailure) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs()));
    }
    const available = geminiModelChain();
    const ordered = opts.models?.length
      ? [...new Set([...opts.models, ...available])].filter((model) => available.includes(model))
      : available;
    for (const [index, model] of ordered.slice(0, opts.maxModels ?? Infinity).entries()) {
      try {
        const timeoutMs = index === 0 ? opts.firstModelTimeoutMs ?? opts.timeoutMs : opts.timeoutMs;
        const res = await request(model, messages, { maxTokens: opts.maxTokens, reasoningEffort: opts.reasoningEffort }, AbortSignal.timeout(timeoutMs ?? 15_000));
        if (!res.ok) { transientFailure ||= res.status === 429 || res.status === 503; await noteFailure(model, res, opts.tag); continue; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json().catch(() => null)) as any;
        const content = data?.choices?.[0]?.message?.content;
        const text = (typeof content === "string" ? content
          : Array.isArray(content) ? content.map((part: { text?: string }) => part?.text ?? "").join("")
          : Array.isArray(data?.candidates?.[0]?.content?.parts)
            ? data.candidates[0].content.parts.map((part: { text?: string }) => part?.text ?? "").join("")
            : "").trim();
        if (text) {
          console.info(`[gemini${opts.tag ? `:${opts.tag}` : ""}] direct reply from ${model}`);
          return { text, model };
        }
        console.warn(`[gemini${opts.tag ? `:${opts.tag}` : ""}] ${model} returned empty content`);
      } catch (e) {
        console.warn(`[gemini${opts.tag ? `:${opts.tag}` : ""}] ${model} failed: ${e instanceof Error ? e.message : e}`);
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
          transientFailure = true;
          parkedUntil.set(model, Date.now() + 60_000);
        }
      }
    }
  }
  return null;
}

/** Streaming: returns the first model's OK response (SSE body) or null. The
 *  timeout only bounds time-to-headers; the body then streams freely. */
export async function openGeminiStream(
  messages: GeminiMessage[],
  opts: { timeoutMs?: number; tag?: string } = {},
): Promise<{ res: Response; model: string } | null> {
  if (!GEMINI_KEY) return null;
  let transientFailure = false;
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      if (!transientFailure) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs()));
    }
    for (const model of geminiModelChain()) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
      try {
        const res = await request(model, messages, { stream: true }, ctrl.signal);
        clearTimeout(timer);
        if (res.ok && res.body) return { res, model };
        transientFailure ||= res.status === 429 || res.status === 503;
        await noteFailure(model, res, opts.tag);
      } catch (e) {
        clearTimeout(timer);
        console.warn(`[gemini${opts.tag ? `:${opts.tag}` : ""}] ${model} stream failed: ${e instanceof Error ? e.message : e}`);
        if (e instanceof Error && e.name === "AbortError") {
          transientFailure = true;
          parkedUntil.set(model, Date.now() + 60_000);
        }
      }
    }
  }
  return null;
}
