// lib/builder/scriptDirective.ts
// Pure parser: turn a chat message into a target video length + leftover
// refinement. No React/Convex deps so it is trivially unit-testable.
import { MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS } from "./agentTypes";

export const SCRIPT_LENGTH_STEPS = [8, 16, 24, 32, 48, 60] as const;

export interface ScriptDirective {
  isLengthEdit: boolean; // message is about changing the script length
  seconds: number;       // resolved target, clamped to [MIN, MAX]
  refinement: string;    // remaining user text (may be "")
}

const clamp = (n: number) =>
  Math.max(MIN_VIDEO_SECONDS, Math.min(MAX_VIDEO_SECONDS, Math.round(n)));

function nearestStepIndex(seconds: number): number {
  let best = 0;
  for (let i = 1; i < SCRIPT_LENGTH_STEPS.length; i++) {
    if (Math.abs(SCRIPT_LENGTH_STEPS[i] - seconds) < Math.abs(SCRIPT_LENGTH_STEPS[best] - seconds)) best = i;
  }
  return best;
}

export function parseScriptDirective(text: string, currentSeconds: number): ScriptDirective {
  const t = (text ?? "").toLowerCase();
  let matched: RegExp | null = null;
  let seconds: number | null = null;

  // ── Absolute durations (checked first) ──
  const minutesNum = t.match(/\b(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  const secondsNum = t.match(/\b(\d{1,3})\s*(?:s|sec|secs|second|seconds)\b/);
  const oneMinute = /\b(?:one|1)\s+minute\b/.test(t);
  const halfMinute = /\bhalf a minute\b/.test(t);

  if (secondsNum) { seconds = clamp(parseInt(secondsNum[1], 10)); matched = /\b\d{1,3}\s*(?:s|sec|secs|second|seconds)\b/; }
  else if (minutesNum) { seconds = clamp(parseFloat(minutesNum[1]) * 60); matched = /\b\d+(?:\.\d+)?\s*(?:m|min|mins|minute|minutes)\b/; }
  else if (oneMinute) { seconds = 60; matched = /\b(?:one|1)\s+minute\b/; }
  else if (halfMinute) { seconds = 30; matched = /\bhalf a minute\b/; }

  // ── Relative direction (only when no absolute number) ──
  let relativeMatched = false;
  if (seconds === null) {
    const up = /\b(longer|extend|more)\b/.test(t);
    const down = /\b(shorter|less|trim)\b/.test(t);
    if (up || down) {
      relativeMatched = true;
      const jump = /\b(way|much|a lot|lot)\b/.test(t) ? 2 : 1;
      const idx = nearestStepIndex(currentSeconds);
      const nextIdx = up
        ? Math.min(SCRIPT_LENGTH_STEPS.length - 1, idx + jump)
        : Math.max(0, idx - jump);
      seconds = SCRIPT_LENGTH_STEPS[nextIdx];
    }
  }

  const isLengthEdit = seconds !== null;
  if (!isLengthEdit) return { isLengthEdit: false, seconds: clamp(currentSeconds), refinement: text?.trim() ?? "" };

  // Strip the matched length phrase from the message to get the refinement.
  let refinement = text ?? "";
  if (matched) refinement = refinement.replace(new RegExp(matched.source, "i"), " ");
  if (relativeMatched) refinement = refinement.replace(/\b(way|much|a lot|lot|longer|shorter|extend|more|less|trim)\b/gi, " ");
  refinement = refinement.replace(/\b(make it|version|long|please)\b/gi, " ").replace(/\s+/g, " ").trim();

  return { isLengthEdit: true, seconds: seconds as number, refinement };
}
