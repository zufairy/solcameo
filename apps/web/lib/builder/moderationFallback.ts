import { VIDEO_ENGINES } from "./agentTypes";

/**
 * When a video engine's content filter rejects a render, the face must not be dropped to get past it: the same references go
 * to the next engine instead. No hosted engine is filter-free, but they differ a lot in how they treat a real face, so each
 * rejection hands the job to the next one in this order until one accepts it. Engines that cannot make the requested length in
 * one take are skipped. The order favours engines that take a reference photo as the first frame and are known to be the most
 * tolerant of realistic faces, with the strict first-party ones last.
 */
export const MODERATION_LADDER = [
  "hf:gxv",                    // Grok Imagine on Higgsfield: same model, a different (usually looser) filter layer
  "kwaivgi/kling-v3",          // Kling: image-to-video that keeps realistic faces
  "hf:sd20",                   // Seedance 2.0 on Higgsfield
  "bytedance/seedance-2",      // Seedance 2.0 on Kie
  "gemini-omni-video",         // Gemini Omni
  "bytedance/seedance-1.5-pro",
] as const;

/** A rejection by the engine's own safety / policy filter (as opposed to a broken request or a busy server). */
export function isModerationError(message: string | undefined | null): boolean {
  return /moderation|content (?:polic|filter|safety)|safety (?:polic|filter|check)|policy violation|violates?\b.*polic|sensitive content|nsfw|flagged|prominent|public figure|celebrit|real[- ]?person|likeness|rejected by (?:content|safety)|blocked by/i.test(message ?? "");
}

export function parseTried(raw: string | undefined | null): string[] {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

/** The next engine to try for this job, or null when the ladder is used up. `tried` includes the engine that just failed. */
export function nextFallbackEngine(args: { current: string; tried: string[]; seconds: number; hasHiggsfield: boolean }): { kieModel: string; label: string } | null {
  const done = new Set([...args.tried, args.current]);
  for (const model of MODERATION_LADDER) {
    if (done.has(model)) continue;
    if (model.startsWith("hf:") && !args.hasHiggsfield) continue;
    const engine = VIDEO_ENGINES.find((e) => e.kieModel === model);
    if (!engine || (engine.maxClipSeconds ?? 0) < Math.min(args.seconds, 10)) continue;
    return { kieModel: model, label: engine.label };
  }
  return null;
}
