import { describe, it, expect } from "vitest";
import { __test } from "./kie-video-pipeline";
import type { StoryBeat } from "./kie-video-pipeline";

// Gemini Omni multi-clip renders are joined with HARD CUTS (independent takes,
// no video_list continuation — that replayed the previous clip's tail and made
// the script play twice). The per-segment prompt must therefore frame clips 2+
// as a deliberate JUMP CUT (no greeting/restart, no repeated lines), while
// frame-chained engines keep the seamless-continuation framing.

const beat = (i: number, vo: string): StoryBeat => ({
  index: i, scene: `scene ${i}`, voiceover: vo, camera: "static", seconds: 8,
});

const args = () => ({
  agentName: "Ava", agentNiche: "beauty", avatarUrl: "https://x/a.png",
  topic: "t", hook: "h", scriptText: "s",
});

describe("gemini omni jump-cut continuation", () => {
  it("clip 2+ on gemini-omni uses the jump-cut block, not seamless continuation", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = __test.buildSegmentPrompt(args() as any, [beat(2, "second line")], 1, 2, "voice", beat(1, "first line spoken already"), 8, { engine: "gemini-omni" });
    expect(p).toContain("JUMP-CUT CONTINUATION");
    expect(p).toContain("HARD CUT");
    expect(p).not.toContain("SEAMLESS CONTINUATION");
    // Mid-flow rule: no re-greeting on later clips.
    expect(p).toContain("Do NOT open with a greeting");
    // No-repeat cue still carries the previous window's tail words.
    expect(p).toContain("already spoken — do NOT repeat");
  });

  it("clip 2+ on a frame-chained engine keeps the seamless framing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = __test.buildSegmentPrompt(args() as any, [beat(2, "second line")], 1, 2, "voice", beat(1, "first line"), 8, { engine: "veo" });
    expect(p).toContain("SEAMLESS CONTINUATION");
    expect(p).not.toContain("JUMP-CUT CONTINUATION");
  });

  it("first clip gets no continuation block on either engine", () => {
    for (const engine of ["gemini-omni", "veo"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = __test.buildSegmentPrompt(args() as any, [beat(1, "first line")], 0, 2, "voice", undefined, 8, { engine });
      expect(p).not.toContain("JUMP-CUT CONTINUATION");
      expect(p).not.toContain("SEAMLESS CONTINUATION");
    }
  });
});
