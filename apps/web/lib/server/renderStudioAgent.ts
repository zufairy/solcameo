// Render Studio agent: turns a chat request into a validated, self-checked
// composition, and ALWAYS answers the user (a clarifying reply, a refusal, or
// the finished video; never a bare error for a model that talked instead of
// coding).
//
// Loop: [find footage] -> write -> static check -> real Chromium run (errors)
// -> visual review (full rewrites only) -> repair. Every step is streamed.
//
// Cost control: model routing (cheap model for small edits, Opus for creative
// work, auto-escalation if the cheap model fumbles), patch-style edits, compact
// context, short history, prompt caching when the gateway supports it, and a
// visual review only after full rewrites.
//
// Brain: Claude Opus via Kie's Anthropic-compatible /claude/v1/messages route
// (streaming), with the shared Gemini text caller as automatic fallback.

import { callClaudeText, callGeminiVision } from "@/lib/server/kie-claude";
import {
  applyReply, assetLines, BRAND_ASSETS, currentSection, hasCode, isSmallEdit, parseReply, systemPrompt, userPrompt, wantsFootage,
  type ParsedReply,
} from "@/lib/render-studio/agentProtocol";
import { clampComposition, validateComposition, type Asset, type Composition } from "@/lib/render-studio/compose";
import { captureStills } from "@/lib/server/renderStudioRender";
import { planQueries, providersConfigured, searchFootage, toAsset } from "@/lib/server/renderStudioClips";

export type AgentEvent =
  | { type: "status"; text: string; step: string }
  | { type: "progress"; section: string; chars: number }
  | { type: "clips"; assets: Asset[]; queries: string[] }
  | { type: "comp"; comp: Composition; note?: string }
  | { type: "done"; comp: Composition; summary: string; plan: string; checks: string[]; changed: boolean; model: string }
  | { type: "error"; message: string };

export type StudioModel = "auto" | "opus" | "fast";

const KIE_MESSAGES = process.env.RENDER_STUDIO_KIE_URL?.trim() || "https://api.kie.ai/claude/v1/messages";
const OPUS_CHAIN = (process.env.RENDER_STUDIO_MODELS?.split(",").map((s) => s.trim()).filter(Boolean)
  ?? ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
const LLM_TIMEOUT_MS = 170_000;
const parked = new Map<string, number>();
let cacheControlOk = true;

function kieKey(): string {
  return process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";
}

/** Reads an Anthropic-style SSE stream (also tolerates OpenAI-style chunks and plain JSON). */
export async function readClaudeResponse(res: Response, onDelta: (full: string) => void): Promise<string> {
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("event-stream") || !res.body) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return extractText(data);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let j: Record<string, unknown> & { delta?: { text?: string }; choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string }; type?: string };
      try { j = JSON.parse(payload); } catch { continue; }
      if (j.type === "error" || j.error) throw new Error(j.error?.message ?? "stream error");
      const piece = j.delta?.text ?? j.choices?.[0]?.delta?.content ?? "";
      if (piece) { full += piece; onDelta(full); }
    }
  }
  return full;
}

function extractText(data: Record<string, unknown>): string {
  const content = data.content as Array<{ type?: string; text?: string }> | undefined;
  if (Array.isArray(content)) return content.map((c) => c.text ?? "").join("");
  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  if (choices?.[0]?.message?.content) return String(choices[0].message.content);
  const code = Number(data.code);
  if (code && code !== 200) throw new Error(`Kie error ${code}: ${String(data.msg ?? "unknown")}`);
  return "";
}

async function callOpus(system: string, user: string, maxTokens: number, onDelta: (full: string) => void, signal?: AbortSignal): Promise<{ text: string; model: string }> {
  const key = kieKey();
  if (!key) throw new Error("KIE_API_KEY missing");
  let lastErr: unknown;
  const now = Date.now();
  const chain = OPUS_CHAIN.filter((m) => (parked.get(m) ?? 0) <= now);
  for (const model of chain.length ? chain : OPUS_CHAIN) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LLM_TIMEOUT_MS);
    signal?.addEventListener("abort", () => ctl.abort(), { once: true });
    try {
      // Prompt caching: the system prompt is identical across turns. If the gateway rejects the
      // cache_control field we drop it for this process and retry plain.
      for (const cached of cacheControlOk ? [true, false] : [false]) {
        const res = await fetch(KIE_MESSAGES, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model, max_tokens: maxTokens, stream: true,
            system: cached ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
            messages: [{ role: "user", content: user }],
          }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          const body = (await res.text().catch(() => "")).slice(0, 200);
          if (cached && res.status === 400 && /cache|system|array|type/i.test(body)) { cacheControlOk = false; continue; }
          if (res.status === 404 || res.status === 400 || res.status === 422) parked.set(model, Date.now() + 10 * 60_000);
          throw new Error(`HTTP ${res.status} ${body}`);
        }
        const text = (await readClaudeResponse(res, onDelta)).trim();
        if (!text) throw new Error("empty reply");
        return { text, model };
      }
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Unknown/unsupported slug (Kie answers these as HTTP 4xx or a 200 {code:4xx} body): skip it for a while.
      if (/\b4\d\d\b|not supported|invalid model|unknown model/i.test(msg)) parked.set(model, Date.now() + 10 * 60_000);
      console.warn(`[render-studio] ${model} failed:`, msg);
      if (signal?.aborted) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Opus unavailable");
}

async function think(useOpus: boolean, system: string, user: string, maxTokens: number, onDelta: (full: string) => void, signal?: AbortSignal): Promise<{ text: string; model: string }> {
  if (useOpus) {
    try { return await callOpus(system, user, maxTokens, onDelta, signal); } catch (e) {
      console.warn("[render-studio] Opus chain failed, falling back to Gemini:", e instanceof Error ? e.message : e);
    }
  }
  try {
    return { text: await callClaudeText({ system, user, maxTokens }), model: "fast" };
  } catch (e) {
    // The cheap model is down: never strand the user, fall through to Opus.
    if (useOpus) throw e;
    console.warn("[render-studio] fast model failed, using Opus:", e instanceof Error ? e.message : e);
    return await callOpus(system, user, Math.max(maxTokens, 8_000), onDelta, signal);
  }
}

export interface RunInput {
  comp: Composition | null;
  engine: Composition["engine"];
  aspect: { width: number; height: number };
  prompt: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  model: StudioModel;
  review: boolean;
  /** True once the user has changed the starter (drives routing). */
  touched: boolean;
  /** Clips the user attached in the studio. */
  attached: Asset[];
  origin: string;
  agent?: { agentName?: string; avatarUrl?: string };
  signal?: AbortSignal;
}

function blank(engine: Composition["engine"], a: { width: number; height: number }): Composition {
  return clampComposition({ engine, title: "Untitled", width: a.width, height: a.height, fps: 30, duration: 8, html: "", css: "", js: "" });
}

/** Assets the agent may use this turn: brand, user's attached clips, anything already in the comp. */
function mergeAssets(...lists: Array<Asset[] | undefined>): Asset[] {
  const seen = new Set<string>(); const out: Asset[] = [];
  for (const l of lists) for (const a of l ?? []) if (!seen.has(a.url)) { seen.add(a.url); out.push(a); }
  return out.slice(0, 16);
}

export async function runStudioAgent(input: RunInput, emit: (e: AgentEvent) => void): Promise<void> {
  const system = systemPrompt(input.engine, input.agent);
  const start = input.comp ? clampComposition(input.comp) : blank(input.engine, input.aspect);
  let base: Composition = start;
  const checks: string[] = [];
  let plan = "", summary = "", usedModel = "";

  // ── 1. footage: find stock clips online when the brief calls for them ──
  let assets = mergeAssets(BRAND_ASSETS(input.origin), input.attached, start.assets);
  const attachedVideos = input.attached.filter((a) => a.kind === "video").length;
  const asksToSearch = /\b(find|search|stock|online|more clips|get me|source)\b/i.test(input.prompt);
  const isQuestion = /\?\s*$/.test(input.prompt.trim()) && !asksToSearch;
  if (!isQuestion && wantsFootage(input.prompt) && (attachedVideos < 2 || asksToSearch)) {
    emit({ type: "status", text: "Finding footage online", step: "clips" });
    try {
      const queries = await planQueries(input.prompt);
      const found = (await searchFootage(queries, input.aspect, 6)).map(toAsset);
      if (found.length) {
        assets = mergeAssets(assets, found);
        emit({ type: "clips", assets: found, queries });
        checks.push(`Found ${found.length} clips (${providersConfigured().join(", ")})`);
      }
    } catch { /* footage search is best-effort; the agent still builds with motion graphics */ }
  }
  base = { ...base, assets: mergeAssets(input.attached, start.assets, assets.filter((a) => a.source === "stock")) };

  // ── 2. model routing ──
  const small = isSmallEdit(input.prompt, input.comp, input.touched);
  const wantOpus = input.model === "opus" || (input.model === "auto" && !small);
  const maxTokens = small ? 5_000 : 14_000;

  const write = async (user: string, label: string, opus: boolean): Promise<{ comp: Composition; parsed: ParsedReply; failed: string[]; raw: string }> => {
    emit({ type: "status", text: label, step: "write" });
    const r = await think(opus, system, user, maxTokens, (full) => emit({ type: "progress", section: currentSection(full), chars: full.length }), input.signal);
    usedModel = r.model;
    const parsed = parseReply(r.text);
    if (!hasCode(parsed)) return { comp: base, parsed, failed: [], raw: r.text };
    const applied = applyReply(base, parsed);
    return { comp: applied.comp, parsed, failed: applied.failedPatches, raw: r.text };
  };

  const prompt0 = userPrompt(base, input.prompt, input.history, assets);
  let first = await write(prompt0, "Working on it", wantOpus);
  // The cheap model fumbled (no code, or its patches did not apply): escalate once to Opus.
  if (!wantOpus && input.model === "auto" && (!hasCode(first.parsed) || first.failed.length) && !(first.parsed.prose && !hasCode(first.parsed) && first.parsed.prose.endsWith("?"))) {
    emit({ type: "status", text: "Bringing in Opus", step: "write" });
    first = await write(prompt0, "Bringing in Opus", true);
  }

  // ── 3. conversational answer (no code): still a real reply ──
  if (!hasCode(first.parsed)) {
    const text = first.parsed.summary || first.parsed.prose || "I did not get a usable answer from the model that time. Please try again, or say it differently.";
    emit({ type: "done", comp: base, summary: text, plan: "", checks, changed: false, model: usedModel });
    return;
  }

  let comp = first.comp, failed = first.failed;
  if (!comp.js.trim() && !comp.html.trim()) {
    emit({ type: "done", comp: base, summary: first.parsed.summary || first.parsed.prose || "That edit did not apply to the current video, so nothing changed. Tell me again what to adjust.", plan: "", checks, changed: false, model: usedModel });
    return;
  }
  plan = first.parsed.plan ?? "";
  summary = first.parsed.summary ?? first.parsed.prose?.slice(0, 280) ?? "Here is your video. Press play to preview it, or tell me what to change.";
  const fullRewrite = first.parsed.js !== undefined && first.parsed.patches.length === 0;
  emit({ type: "comp", comp });

  // ── 4. verify + repair ──
  const MAX_REPAIRS = 2;
  for (let round = 0; round <= MAX_REPAIRS; round++) {
    const issues: string[] = [...failed.map((f) => `patch did not match exactly once: ${f}`), ...validateComposition(comp)];
    let stills: Buffer[] = [];
    if (!issues.length) {
      emit({ type: "status", text: "Test-running the composition", step: "check" });
      try {
        const dur = comp.duration;
        const r = await captureStills(comp, [0, dur * 0.3, dur * 0.65, Math.max(0, dur - 0.15)]);
        stills = r.frames;
        const runtime = r.errors.filter((e) => !/favicon|Failed to load resource|net::ERR/i.test(e));
        if (runtime.length) issues.push(...runtime.slice(0, 4).map((e) => `runtime error: ${e}`));
        else checks.push("Runs cleanly at 4 sampled frames");
      } catch (e) {
        checks.push("Render check skipped (browser unavailable)");
        console.warn("[render-studio] stills failed:", e instanceof Error ? e.message : e);
        break;
      }
    }
    // Visual QA only after a full rewrite: patches are small and already ran clean.
    if (!issues.length && input.review && fullRewrite && stills.length === 4 && round === 0) {
      emit({ type: "status", text: "Reviewing frames like a director", step: "review" });
      try {
        const verdict = await callGeminiVision({
          system: "You are a strict motion-design QA reviewer. You see 4 frames (start, 30%, 65%, end) of one short video. Video clip areas appear black in this preview; ignore them. Reply ONLY JSON: {\"ok\":boolean,\"issues\":[string]}. Flag only real defects: text cut off or outside the frame, overlapping or unreadable text, low contrast, an empty frame, elements stuck off-screen. No style nitpicks.",
          user: `Brief: "${input.prompt.slice(0, 240)}". Review.`,
          images: stills.map((b) => `data:image/jpeg;base64,${b.toString("base64")}`),
          maxTokens: 250,
        });
        const j = JSON.parse(verdict.slice(verdict.indexOf("{"), verdict.lastIndexOf("}") + 1)) as { ok?: boolean; issues?: string[] };
        if (j.ok === false && j.issues?.length) issues.push(...j.issues.slice(0, 3).map((s) => `visual: ${s}`));
        else checks.push("Visual review passed");
      } catch { checks.push("Visual review skipped"); }
    }
    if (!issues.length) break;
    if (round === MAX_REPAIRS) { checks.push(`Unresolved: ${issues[0].slice(0, 80)}`); break; }
    emit({ type: "status", text: `Fixing ${issues.length} issue${issues.length > 1 ? "s" : ""}`, step: "repair" });
    base = comp;
    const fixed = await write(
      userPrompt(comp, `Fix these problems, change nothing else. Use <patch> blocks.\n- ${issues.join("\n- ")}`, [], assets),
      "Fixing issues",
      wantOpus || round > 0,
    );
    if (!hasCode(fixed.parsed)) { checks.push(`Unresolved: ${issues[0].slice(0, 80)}`); break; }
    comp = fixed.comp; failed = fixed.failed;
    plan = fixed.parsed.plan ?? plan;
    emit({ type: "comp", comp, note: "Fixed" });
  }

  emit({ type: "done", comp, summary: summary || "Here is your video. Press play to preview it, or tell me what to change.", plan, checks, changed: true, model: usedModel });
}

export { assetLines };
