import { callClaudeJSON } from "./kie-claude";
import type { Transcript, ClipConfig } from "./clipTypes";
import type { AnalyzedMoment } from "./clipAnalysis";

/**
 * Prompt-to-Clip: steer moment selection with an operator prompt ("find every
 * moment about pricing"). LLM picks matching windows from the timed transcript
 * (and existing analysis candidates); a deterministic keyword fallback keeps
 * the skill working when the LLM is down.
 */
export async function selectMomentsByPrompt(args: {
  transcript: Transcript;
  prompt: string;
  config: ClipConfig;
  candidates?: AnalyzedMoment[];
  apiKey?: string;
}): Promise<AnalyzedMoment[]> {
  const { transcript, prompt, config, candidates = [] } = args;
  const dur = transcript.durationSeconds || transcript.segments.at(-1)?.end || 0;
  const { min, max } = config.clipLength;

  const segText = transcript.segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n")
    .slice(0, 12000);
  const candText = candidates
    .slice(0, 10)
    .map((c) => `- ${c.startSeconds}-${c.endSeconds}s "${c.title}" (★${c.viralScore})`)
    .join("\n");

  const system = `You select video moments MATCHING AN OPERATOR'S REQUEST from a timed transcript.
Return ONLY JSON: {"moments":[{"startSeconds":num,"endSeconds":num,"title":str,"viralScore":0-100,"emotion":str,"reason":str,"captionText":str}]}.
Rules: ONLY moments that match the request (empty array if none match). Each ${min}-${max}s, self-contained, ranked most-relevant first. viralScore reflects relevance+virality. Timestamps within 0..${Math.round(dur)}. No prose.`;
  const user = `OPERATOR REQUEST: "${prompt}"\n\nEXISTING CANDIDATES (may reuse/adjust):\n${candText || "(none)"}\n\nTRANSCRIPT:\n${segText}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callClaudeJSON<{ moments?: unknown }>({ system, user, apiKey: args.apiKey, maxTokens: 2500 });
      const moments = parse(raw.moments, dur, min, max);
      if (moments.length > 0) return moments;
      // A legitimate "nothing matches" → fall through to keyword check; if that
      // also finds nothing the caller keeps the default ranking.
      break;
    } catch (e) {
      console.warn(`[promptSelect] attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return keywordFallback(transcript, prompt, min, max, dur);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function parse(raw: unknown, dur: number, min: number, max: number): AnalyzedMoment[] {
  if (!Array.isArray(raw)) return [];
  const out: AnalyzedMoment[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    let start = Number(m.startSeconds);
    let end = Number(m.endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = clamp(start, 0, Math.max(0, dur - 1));
    end = clamp(end, start + 1, dur || start + max);
    if (end - start < min && dur > min) end = Math.min(dur, start + min);
    if (end - start > max) end = start + max;
    out.push({
      startSeconds: Math.floor(start),
      endSeconds: Math.ceil(end),
      title: typeof m.title === "string" ? m.title.slice(0, 100) : "Requested moment",
      viralScore: clamp(Math.round(Number(m.viralScore) || 60), 0, 100),
      emotion: typeof m.emotion === "string" ? m.emotion.slice(0, 24) : "informative",
      reason: typeof m.reason === "string" ? m.reason.slice(0, 240) : "Matches the operator prompt.",
      captionText: typeof m.captionText === "string" ? m.captionText.slice(0, 120) : "",
    });
  }
  return out;
}

/** Deterministic fallback: windows around transcript segments that contain the
 *  prompt's significant words. */
export function keywordFallback(transcript: Transcript, prompt: string, min: number, max: number, dur: number): AnalyzedMoment[] {
  const terms = prompt.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  if (terms.length === 0) return [];
  const hits = transcript.segments.filter((s) => {
    const lc = s.text.toLowerCase();
    return terms.some((t) => lc.includes(t));
  });
  const windows: { start: number; end: number }[] = [];
  for (const h of hits) {
    const mid = (h.start + h.end) / 2;
    const want = Math.min(max, Math.max(min, 20));
    const start = clamp(Math.floor(mid - want / 2), 0, Math.max(0, dur - want));
    const w = { start, end: Math.min(dur || start + want, start + want) };
    const last = windows[windows.length - 1];
    if (last && w.start < last.end) last.end = Math.max(last.end, w.end);
    else windows.push(w);
  }
  return windows.slice(0, 5).map((w, i) => ({
    startSeconds: w.start,
    endSeconds: Math.ceil(w.end),
    title: `Match ${i + 1}: "${terms[0]}"`,
    viralScore: 60,
    emotion: "informative",
    reason: `Transcript mentions ${terms.join(", ")} here.`,
    captionText: "",
  }));
}
