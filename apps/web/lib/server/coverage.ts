import { maxClipForModel } from "@/lib/builder/agentTypes";
import { GROK_BASE_MAX_SECONDS, GROK_EXTEND_MAX_SECONDS } from "@/lib/server/videoSegmentation";

export type CoverageStep =
  | { kind: "generate"; seconds: number }
  | { kind: "extend"; seconds: number };

export interface CoveragePlan {
  engine: string;
  strategy: "single" | "stitch" | "native-extend";
  steps: CoverageStep[];
  totalSeconds: number;
}

/** Which engines support native frame-continuous extend vs. must be stitched. */
function extendMode(engine: string): "veo" | "grok" | "stitch" {
  if (/veo/i.test(engine)) return "veo";
  if (/grok/i.test(engine)) return "grok";
  return "stitch"; // seedance, kling, gemini
}

function total(steps: CoverageStep[]): number {
  return steps.reduce((a, s) => a + s.seconds, 0);
}

export function planCoverage(durationSeconds: number, engine: string): CoveragePlan {
  const dur = Math.max(1, Math.round(durationSeconds));
  const clip = Math.max(4, maxClipForModel(engine));
  const mode = extendMode(engine);

  if (dur <= clip && mode !== "grok") {
    return { engine, strategy: "single", steps: [{ kind: "generate", seconds: dur }], totalSeconds: dur };
  }

  if (mode === "veo") {
    const steps: CoverageStep[] = [{ kind: "generate", seconds: clip }];
    let covered = clip;
    while (covered < dur) {
      steps.push({ kind: "extend", seconds: clip });
      covered += clip;
    }
    return { engine, strategy: "native-extend", steps, totalSeconds: total(steps) };
  }

  if (mode === "grok") {
    // NOTE: `planGrokExtendWindows` in videoSegmentation.ts operates on
    // `StoryBeat[]` (script beats with voiceover text), not a raw duration in
    // seconds, and returns `{ base: StoryBeat[]; extendWindows: StoryBeat[][] }`
    // — it can't be called with a plain number here. This mirrors its window
    // sizing (base ≤ GROK_BASE_MAX_SECONDS, each extend ≤ GROK_EXTEND_MAX_SECONDS)
    // directly in terms of seconds, reusing its exported caps.
    if (dur <= GROK_BASE_MAX_SECONDS) {
      const steps: CoverageStep[] = [{ kind: "generate", seconds: dur }];
      return { engine, strategy: "single", steps, totalSeconds: total(steps) };
    }

    const steps: CoverageStep[] = [{ kind: "generate", seconds: GROK_BASE_MAX_SECONDS }];
    let covered = GROK_BASE_MAX_SECONDS;
    while (covered < dur) {
      const seconds = Math.min(GROK_EXTEND_MAX_SECONDS, dur - covered);
      steps.push({ kind: "extend", seconds });
      covered += seconds;
    }
    return { engine, strategy: "native-extend", steps, totalSeconds: total(steps) };
  }

  // stitch engines (seedance/kling/gemini): clamp each generated clip to the cap
  const steps: CoverageStep[] = [];
  let covered = 0;
  while (covered < dur) {
    const seconds = Math.min(clip, dur - covered) < 4 ? Math.min(clip, 4) : Math.min(clip, dur - covered);
    steps.push({ kind: "generate", seconds });
    covered += seconds;
  }
  return { engine, strategy: "stitch", steps, totalSeconds: total(steps) };
}
