import { describe, expect, it } from "vitest";
import {
  beatSecondsFromVoiceover,
  buildVoiceProfile,
  packBeatsIntoWindows,
  planGrokExtendWindows,
  windowSeconds,
} from "./videoSegmentation";
import type { StoryBeat } from "./kie-video-pipeline";

function beat(index: number, words: number): StoryBeat {
  return {
    index,
    scene: `scene ${index}`,
    voiceover: Array.from({ length: words }, () => "w").join(" "),
    camera: "static",
    seconds: 0,
  };
}

describe("beatSecondsFromVoiceover", () => {
  it("derives seconds from word count at 2.5 wps, floor 2", () => {
    expect(beatSecondsFromVoiceover("")).toBe(3);
    expect(beatSecondsFromVoiceover("one two")).toBe(2);
    expect(beatSecondsFromVoiceover(Array.from({ length: 20 }, () => "w").join(" "))).toBe(8);
  });
});

describe("packBeatsIntoWindows", () => {
  it("packs ~20-word beats into one 8s window each", () => {
    const beats = [beat(1, 20), beat(2, 20), beat(3, 20)];
    const windows = packBeatsIntoWindows(beats, 8, 3);
    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.length === 1)).toBe(true);
  });

  it("groups short beats so each window approaches 8s", () => {
    const beats = [beat(1, 10), beat(2, 10), beat(3, 10), beat(4, 10)];
    const windows = packBeatsIntoWindows(beats, 8, 4);
    expect(windows.length).toBe(2);
    expect(windows[0]).toHaveLength(2);
  });

  it("returns FEWER windows than requested when content is short — never duplicates", () => {
    const beats = [beat(1, 20), beat(2, 20)];
    const windows = packBeatsIntoWindows(beats, 8, 4);
    expect(windows.length).toBe(2);
    const allIndexes = windows.flat().map((b) => b.index);
    expect(new Set(allIndexes).size).toBe(allIndexes.length);
  });

  it("caps at maxWindows, folding overflow into the last window", () => {
    const beats = Array.from({ length: 10 }, (_, i) => beat(i + 1, 20));
    const windows = packBeatsIntoWindows(beats, 8, 2);
    expect(windows.length).toBe(2);
    expect(windows.flat()).toHaveLength(10);
  });

  it("single beat → single window", () => {
    expect(packBeatsIntoWindows([beat(1, 20)], 8, 4)).toHaveLength(1);
  });

  // REGRESSION: a clip is rendered at a fixed `clipSeconds` length, so a window
  // must NEVER hold more spoken seconds than the clip can deliver — otherwise the
  // tail of the line is cut and the video "looks unfinished / cropped". The old
  // packer allowed up to clipSeconds*1.25 (10s) of words into an 8s clip.
  it("never packs more than clipSeconds of speech into one window", () => {
    // 12-word beats ≈ 5s each. Two of them (~10s) must NOT share one 8s clip.
    const beats = [beat(1, 12), beat(2, 12), beat(3, 12)];
    const windows = packBeatsIntoWindows(beats, 8, 4);
    for (const w of windows) {
      const secs = w.reduce((n, b) => n + beatSecondsFromVoiceover(b.voiceover), 0);
      expect(secs).toBeLessThanOrEqual(8);
    }
  });

  it("covers every beat across windows when given enough window headroom", () => {
    // 8 beats ≈ 5s each = ~40s of speech; with a generous cap the packer must
    // emit enough windows that no window overflows AND no beat is dropped.
    const beats = Array.from({ length: 8 }, (_, i) => beat(i + 1, 12));
    const windows = packBeatsIntoWindows(beats, 8, 8);
    expect(windows.flat()).toHaveLength(8);
    for (const w of windows) {
      const secs = w.reduce((n, b) => n + beatSecondsFromVoiceover(b.voiceover), 0);
      expect(secs).toBeLessThanOrEqual(8);
    }
  });

  it("no beat object appears in two windows (no-duplication invariant)", () => {
    const beats = Array.from({ length: 7 }, (_, i) => beat(i + 1, 15));
    const windows = packBeatsIntoWindows(beats, 8, 4);
    const seen = new Set<number>();
    for (const w of windows) for (const b of w) {
      expect(seen.has(b.index)).toBe(false);
      seen.add(b.index);
    }
  });
});

describe("planGrokExtendWindows", () => {
  // A 20-word beat ≈ 8s at 2.5 wps; a 10-word beat ≈ 4s.
  it("empty beats → empty plan", () => {
    expect(planGrokExtendWindows([])).toEqual({ base: [], extendWindows: [] });
  });

  it("a ≤15s script is all base, no extend windows", () => {
    // two 4s beats = 8s ≤ 15s.
    const { base, extendWindows } = planGrokExtendWindows([beat(1, 10), beat(2, 10)]);
    expect(base).toHaveLength(2);
    expect(extendWindows).toHaveLength(0);
  });

  it("base never exceeds 15s and always takes ≥1 beat", () => {
    // 4s beats: 4+8+12 = 12 ≤ 15; adding a 4th (16) would overflow → base = 3 beats.
    const beats = Array.from({ length: 6 }, (_, i) => beat(i + 1, 10));
    const { base } = planGrokExtendWindows(beats);
    expect(windowSeconds(base)).toBeLessThanOrEqual(15);
    expect(base.length).toBeGreaterThanOrEqual(1);
  });

  it("a single overlong first beat still becomes the base (≥1 beat guarantee)", () => {
    // one 40-word beat ≈ 16s > 15 → base is that single beat, no extends.
    const { base, extendWindows } = planGrokExtendWindows([beat(1, 40)]);
    expect(base).toHaveLength(1);
    expect(extendWindows).toHaveLength(0);
  });

  it("extend-window count scales with remaining length (each ≤10s)", () => {
    // five 8s beats = 40s. base takes the first (16s would overflow) → base = 1 beat.
    // remaining four 8s beats pack one-per-window (2×8=16>10) → 4 extend windows.
    const beats = Array.from({ length: 5 }, (_, i) => beat(i + 1, 20));
    const { base, extendWindows } = planGrokExtendWindows(beats);
    expect(base).toHaveLength(1);
    expect(extendWindows).toHaveLength(4);
    for (const w of extendWindows) expect(windowSeconds(w)).toBeLessThanOrEqual(10);
  });

  it("a 30s script packs as base ~15s + ONE ~15s extend, not 15+10+5", () => {
    // Four 7s beats (17 words @ 2.5wps, ceil) = 28s total. Base takes the
    // first two (14s, ≤15 cap); the remaining two (14s) must now pack into a
    // SINGLE extend window (15s cap), not split into 10s+~4s the way the old
    // 10s-cap did — a ~30s Grok video should be exactly 2 Kie calls (base +
    // one continuation), matching Kie's real per-extend ceiling.
    const beats = Array.from({ length: 4 }, (_, i) => beat(i + 1, 17));
    const { base, extendWindows } = planGrokExtendWindows(beats);
    expect(base).toHaveLength(2);
    expect(windowSeconds(base)).toBeLessThanOrEqual(15);
    expect(extendWindows).toHaveLength(1);
    expect(windowSeconds(extendWindows[0])).toBeLessThanOrEqual(15);
  });

  it("never drops or duplicates a beat across base + extends", () => {
    const beats = Array.from({ length: 9 }, (_, i) => beat(i + 1, 15));
    const { base, extendWindows } = planGrokExtendWindows(beats);
    const all = [...base, ...extendWindows.flat()].map((b) => b.index);
    expect(all.sort((a, b) => a - b)).toEqual(beats.map((b) => b.index));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("buildVoiceProfile", () => {
  const base = { agentName: "Aiko", agentNiche: "finance" };

  it("is deterministic for the same input", () => {
    expect(buildVoiceProfile(base)).toBe(buildVoiceProfile(base));
  });

  it("includes an explicit identical-across-clips instruction and a pace", () => {
    const p = buildVoiceProfile(base);
    expect(p).toMatch(/identical in every clip/i);
    expect(p).toMatch(/150 wpm|words per minute/i);
  });

  it("reflects language as an accent cue", () => {
    const p = buildVoiceProfile({ ...base, language: "Malay" });
    expect(p.toLowerCase()).toContain("malay");
  });

  it("returns a complete descriptor even with empty persona", () => {
    expect(buildVoiceProfile({ agentName: "", agentNiche: "" }).length).toBeGreaterThan(40);
  });
});
