import { describe, it, expect, vi } from "vitest";
import {
  selectClipMoments, expandMomentsToCount, dedupeOverlappingMoments,
  shouldCrossVideoFill, selectCrossVideoFill, fillFromPoolStart,
  retimeStitchedWords, retimeStitchedSegments, snapEndToWordBoundary,
  snapStartToSegmentBoundary, snapEndToSegmentBoundary, distinctGapMoments,
} from "./clipMomentSelector";
import type { Transcript, ClipConfig, ClipMoment, TranscriptWord } from "./clipTypes";

const transcript: Transcript = {
  durationSeconds: 120,
  segments: [{ start: 0, end: 120, text: "a long talk about shipping startups fast" }],
  words: [],
};
const config: ClipConfig = {
  clipLength: { min: 20, max: 40 }, maxClipsPerSource: 2, captionsOn: true,
  captionStyle: { mode: "karaoke", fontColor: "#fff", fontSize: 48, position: "bottom" },
  hookStyle: "cold_open", platforms: ["tiktok"], autoPost: true,
};

describe("selectClipMoments", () => {
  it("returns the LLM moments, clamped to maxClipsPerSource", async () => {
    const callJSON = vi.fn().mockResolvedValue({ moments: [
      { startSeconds: 5, endSeconds: 30, title: "Hook", reason: "strong open", viralScore: 90, captionText: "Ship fast" },
      { startSeconds: 60, endSeconds: 88, title: "Lesson", reason: "insight", viralScore: 80, captionText: "Do less" },
      { startSeconds: 95, endSeconds: 119, title: "Extra", reason: "ok", viralScore: 50, captionText: "Bonus" },
    ] });
    const out = await selectClipMoments(transcript, config, { callJSON });
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Hook");
    expect(out[0].viralScore).toBeGreaterThanOrEqual(out[1].viralScore);
  });

  it("drops out-of-bounds windows after clamping and floors sub-min windows to min", async () => {
    const callJSON = vi.fn().mockResolvedValue({ moments: [
      // start past duration -> both clamp to 120 -> end<=start -> dropped (not a silent end<start render).
      { startSeconds: 200, endSeconds: 230, title: "OOB", reason: "hallucinated", viralScore: 99, captionText: "" },
      // 5s window is under config.clipLength.min (20) -> floored to min so it can't render a 5s clip.
      { startSeconds: 40, endSeconds: 45, title: "TooShort", reason: "tiny", viralScore: 70, captionText: "Short" },
    ] });
    const out = await selectClipMoments(transcript, config, { callJSON });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("TooShort");
    expect(out[0].startSeconds).toBe(40);
    expect(out[0].endSeconds - out[0].startSeconds).toBe(20);
  });

  it("degrades to evenly-spaced clips when the LLM fails on every attempt", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("503"));
    const out = await selectClipMoments(transcript, config, { callJSON });
    // 3 attempts (was 2) — kie-claude.ts now fails Claude→Gemini over INSIDE a
    // single callJSON, so a caller-level retry loop is only needed for both
    // brains striking out together; one extra attempt before the generic
    // fallback meaningfully cuts how often a real source lands on it.
    expect(callJSON).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(2);
    expect(out[0].endSeconds - out[0].startSeconds).toBe(20);
    out.forEach((m) => { expect(m.startSeconds).toBeGreaterThanOrEqual(0); expect(m.endSeconds).toBeLessThanOrEqual(120); });
  });

  it("prunes a near-duplicate window instead of returning two near-identical clips (the 'looks identical' bug)", async () => {
    // Asked for 2 clips; the LLM re-picks the SAME beat twice with slightly
    // shifted bounds (>50% overlap) instead of admitting there's only one
    // strong moment. Without de-overlap both would render as the same footage.
    const callJSON = vi.fn().mockResolvedValue({ moments: [
      { startSeconds: 10, endSeconds: 35, title: "Best moment", reason: "strong", viralScore: 95, captionText: "A" },
      { startSeconds: 14, endSeconds: 38, title: "Best moment (again)", reason: "strong", viralScore: 90, captionText: "A2" },
      { startSeconds: 70, endSeconds: 95, title: "Genuinely different", reason: "distinct", viralScore: 60, captionText: "B" },
    ] });
    const out = await selectClipMoments(transcript, { ...config, maxClipsPerSource: 2 }, { callJSON });
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.title)).toEqual(["Best moment", "Genuinely different"]);
  });
});

describe("dedupeOverlappingMoments", () => {
  it("keeps the higher-scored of two windows overlapping >50% of the weaker one's span", () => {
    const pool = [
      { startSeconds: 0, endSeconds: 20, viralScore: 90 },
      { startSeconds: 5, endSeconds: 22, viralScore: 70 }, // overlaps [5,20] = 15s of its own 17s span (>50%)
    ];
    expect(dedupeOverlappingMoments(pool)).toEqual([pool[0]]);
  });

  it("keeps both when overlap is <=50% of the weaker one's span", () => {
    const pool = [
      { startSeconds: 0, endSeconds: 20, viralScore: 90 },
      { startSeconds: 18, endSeconds: 40, viralScore: 70 }, // overlaps 2s of its own 22s span (<50%)
    ];
    expect(dedupeOverlappingMoments(pool)).toHaveLength(2);
  });

  it("keeps completely non-overlapping windows regardless of score order", () => {
    const pool = [
      { startSeconds: 50, endSeconds: 70, viralScore: 40 },
      { startSeconds: 0, endSeconds: 20, viralScore: 95 },
    ];
    expect(dedupeOverlappingMoments(pool)).toHaveLength(2);
  });

  it("empty pool -> empty result", () => {
    expect(dedupeOverlappingMoments([])).toEqual([]);
  });
});

describe("expandMomentsToCount", () => {
  const cfg: ClipConfig = {
    clipLength: { min: 20, max: 60 }, maxClipsPerSource: 3, captionsOn: true,
    captionStyle: { mode: "karaoke", fontColor: "#fff", fontSize: 48, position: "bottom" },
    hookStyle: "cold_open", platforms: ["tiktok"], autoPost: false,
  };
  // Distinct moments with a 50s span (> min 20) so length variations genuinely differ.
  const mkMoments = (n: number): ClipMoment[] =>
    Array.from({ length: n }, (_, i) => ({
      startSeconds: i * 100, endSeconds: i * 100 + 50,
      title: `M${i}`, reason: "", viralScore: 100 - i, captionText: `cap ${i}`,
    }));
  // Effective render knobs for a clip (v0/pristine falls back to the run config).
  const eff = (m: ReturnType<typeof expandMomentsToCount>[number]) => ({
    hook: m.variation?.hookStyle ?? cfg.hookStyle,
    cap: `${m.variation?.captionStyle.mode ?? cfg.captionStyle.mode}/${m.variation?.captionStyle.position ?? cfg.captionStyle.position}`,
    crop: m.variation?.reframeMode ?? "crop",
    len: m.endSeconds - m.startSeconds,
  });

  it("N < M → top-N distinct moments, unchanged, no override", () => {
    const out = expandMomentsToCount(mkMoments(6), 3, cfg);
    expect(out).toHaveLength(3);
    out.forEach((m, i) => {
      expect(m.variationIndex).toBe(0);
      expect(m.variation).toBeUndefined();
      expect(m.title).toBe(`M${i}`);
      expect([m.startSeconds, m.endSeconds]).toEqual([i * 100, i * 100 + 50]);
    });
  });

  it("N === M → all M distinct moments unchanged (no variations)", () => {
    const out = expandMomentsToCount(mkMoments(4), 4, cfg);
    expect(out).toHaveLength(4);
    out.forEach((m) => expect(m.variation).toBeUndefined());
  });

  it("N=60, M=6 → 60 clips, 10 variations per moment, pristine cut first", () => {
    const out = expandMomentsToCount(mkMoments(6), 60, cfg);
    expect(out).toHaveLength(60);
    for (let mi = 0; mi < 6; mi++) {
      const group = out.filter((m) => m.momentIndex === mi);
      expect(group).toHaveLength(10);
      expect(group[0].variationIndex).toBe(0);
      expect(group[0].variation).toBeUndefined();       // pristine strongest cut
      group.slice(1).forEach((m) => expect(m.variation).toBeDefined());
    }
  });

  it("rotates hook/caption/length/crop across a moment's variations", () => {
    const out = expandMomentsToCount(mkMoments(1), 6, cfg); // 1 moment → 6 variations
    expect(out).toHaveLength(6);
    expect(new Set(out.map((m) => eff(m).hook)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(out.map((m) => eff(m).cap)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(out.map((m) => eff(m).crop)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(out.map((m) => eff(m).len)).size).toBeGreaterThanOrEqual(2);
  });

  it("distributes the remainder so the total is EXACTLY N (strongest get the extra)", () => {
    const out = expandMomentsToCount(mkMoments(6), 20, cfg); // base 3, remainder 2
    expect(out).toHaveLength(20);
    const counts = Array.from({ length: 6 }, (_, mi) => out.filter((m) => m.momentIndex === mi).length);
    expect(counts).toEqual([4, 4, 3, 3, 3, 3]);
  });

  it("keeps every variation window within the source + configured length band", () => {
    const out = expandMomentsToCount(mkMoments(3), 30, cfg);
    out.forEach((m) => {
      const len = m.endSeconds - m.startSeconds;
      expect(len).toBeGreaterThanOrEqual(cfg.clipLength.min);
      expect(len).toBeLessThanOrEqual(cfg.clipLength.max);
      expect(m.startSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  it("labels the pristine cut plainly and variations with · vN", () => {
    const out = expandMomentsToCount(mkMoments(2), 6, cfg); // base 3 each
    const g0 = out.filter((m) => m.momentIndex === 0);
    expect(g0.map((m) => m.variationLabel)).toEqual(["Moment 1", "Moment 1 · v2", "Moment 1 · v3"]);
  });

  it("empty pool → empty result", () => {
    expect(expandMomentsToCount([], 10, cfg)).toEqual([]);
  });
});

// ── CROSS-VIDEO FILL (fill-short) ────────────────────────────────────────────

const fillCfg: ClipConfig = {
  clipLength: { min: 20, max: 40 }, maxClipsPerSource: 1, captionsOn: true,
  captionStyle: { mode: "karaoke", fontColor: "#fff", fontSize: 48, position: "bottom" },
  hookStyle: "cold_open", platforms: ["tiktok"], autoPost: false,
};
const mkTranscript = (dur: number): Transcript => ({
  durationSeconds: dur,
  segments: [{ start: 0, end: dur, text: "some words here" }],
  words: [],
});

describe("shouldCrossVideoFill (trigger predicate)", () => {
  it("engages when the source is shorter than one min-length clip", () => {
    expect(shouldCrossVideoFill(8, fillCfg)).toBe(true);   // 8s < min 20
  });
  it("does NOT engage for a long-enough source", () => {
    expect(shouldCrossVideoFill(20, fillCfg)).toBe(false); // exactly min → full clip fits
    expect(shouldCrossVideoFill(120, fillCfg)).toBe(false);
  });
  it("does NOT engage for a zero/invalid duration", () => {
    expect(shouldCrossVideoFill(0, fillCfg)).toBe(false);
    expect(shouldCrossVideoFill(NaN, fillCfg)).toBe(false);
  });
});

describe("fillFromPoolStart (deterministic fallback)", () => {
  it("takes from the START of each member until `need` is filled", () => {
    const pool = [
      { sourceUrl: "s1", transcript: mkTranscript(10) },
      { sourceUrl: "s2", transcript: mkTranscript(30) },
    ];
    const out = fillFromPoolStart(pool, 25);
    expect(out).toEqual([
      { sourceUrl: "s1", start: 0, end: 10 },
      { sourceUrl: "s2", start: 0, end: 15 }, // trimmed to the remaining 15s
    ]);
  });
  it("skips empty members and stops once satisfied", () => {
    const pool = [
      { sourceUrl: "empty", transcript: mkTranscript(0) },
      { sourceUrl: "s2", transcript: mkTranscript(30) },
    ];
    expect(fillFromPoolStart(pool, 12)).toEqual([{ sourceUrl: "s2", start: 0, end: 12 }]);
  });
});

describe("selectCrossVideoFill", () => {
  const primary = { sourceUrl: "primary", transcript: mkTranscript(8) };
  const pool = [
    { sourceUrl: "sib1", transcript: mkTranscript(30) },
    { sourceUrl: "sib2", transcript: mkTranscript(30) },
  ];

  it("leads with the WHOLE primary, then fills to ≈ targetLen (LLM path)", async () => {
    const callJSON = vi.fn().mockResolvedValue({ fill: [{ poolIndex: 0, startSeconds: 4, endSeconds: 16 }] });
    const out = await selectCrossVideoFill(primary, pool, 20, { callJSON });
    // primary is ALWAYS first, spanning the whole short source.
    expect(out.subSegments[0]).toEqual({ sourceUrl: "primary", start: 0, end: 8 });
    expect(out.subSegments).toHaveLength(2);
    expect(out.subSegments[1]).toEqual({ sourceUrl: "sib1", start: 4, end: 16 });
    // total ≈ target (8 + 12 = 20).
    expect(out.totalLen).toBeCloseTo(20, 3);
  });

  it("trims the final fill window so the total doesn't overshoot the target", async () => {
    const callJSON = vi.fn().mockResolvedValue({ fill: [{ poolIndex: 0, startSeconds: 0, endSeconds: 100 }] });
    const out = await selectCrossVideoFill(primary, pool, 20, { callJSON });
    expect(out.subSegments[1]).toEqual({ sourceUrl: "sib1", start: 0, end: 12 }); // need = 20-8 = 12
    expect(out.totalLen).toBeCloseTo(20, 3);
  });

  it("falls back to deterministic pool-start fill when the LLM fails", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("503"));
    const out = await selectCrossVideoFill(primary, pool, 20, { callJSON });
    expect(out.subSegments[0].sourceUrl).toBe("primary");
    expect(out.subSegments[1]).toEqual({ sourceUrl: "sib1", start: 0, end: 12 });
    expect(out.totalLen).toBeCloseTo(20, 3);
  });

  it("never re-uses the primary as a pool member, and returns lead-only when no usable pool", async () => {
    const callJSON = vi.fn().mockResolvedValue({ fill: [] });
    const out = await selectCrossVideoFill(primary, [{ sourceUrl: "primary", transcript: mkTranscript(30) }], 20, { callJSON });
    expect(out.subSegments).toEqual([{ sourceUrl: "primary", start: 0, end: 8 }]);
  });
});

describe("retimeStitchedWords (caption offset math)", () => {
  it("shifts each sub-segment's words by the cumulative prior duration, clamped + dropping out-of-window", () => {
    const out = retimeStitchedWords([
      { start: 0, end: 8, words: [{ word: "a", start: 1, end: 2 }, { word: "b", start: 7, end: 7.5 }] },
      { start: 5, end: 17, words: [
        { word: "before", start: 2, end: 3 },   // outside [5,17] → dropped
        { word: "c", start: 6, end: 7 },
        { word: "d", start: 16, end: 16.5 },
      ] },
    ]);
    expect(out).toEqual([
      { word: "a", start: 1, end: 2 },       // offset 0
      { word: "b", start: 7, end: 7.5 },
      { word: "c", start: 9, end: 10 },      // (6-5)+8, (7-5)+8
      { word: "d", start: 19, end: 19.5 },   // (16-5)+8, (16.5-5)+8
    ]);
  });
});

describe("retimeStitchedSegments (edit-planning window offset math)", () => {
  it("shifts segments by the cumulative prior duration", () => {
    const out = retimeStitchedSegments([
      { start: 0, end: 8, segments: [{ start: 0, end: 8, text: "primary" }] },
      { start: 10, end: 22, segments: [{ start: 10, end: 22, text: "sibling" }] },
    ]);
    expect(out).toEqual([
      { start: 0, end: 8, text: "primary" },
      { start: 8, end: 20, text: "sibling" }, // (10-10)+8 .. (22-10)+8
    ]);
  });
});

describe("snapEndToWordBoundary (mid-word cut fix)", () => {
  // "the ship is fast today and that's the whole point." — a sentence spanning
  // 8-14.8s, each word a distinct span so a target time can straddle one.
  const words: TranscriptWord[] = [
    { word: "the", start: 8.0, end: 8.3 },
    { word: "ship", start: 8.3, end: 8.7 },
    { word: "is", start: 8.7, end: 8.9 },
    { word: "fast", start: 8.9, end: 9.4 },      // target 9.1 lands mid-word here
    { word: "today", start: 9.4, end: 10.0 },
    { word: "and", start: 10.0, end: 10.2 },
    { word: "that's", start: 10.2, end: 10.6 },
    { word: "the", start: 10.6, end: 10.8 },
    { word: "whole", start: 10.8, end: 11.1 },
    { word: "point.", start: 11.1, end: 11.6 },
    // next sentence, well past a gap
    { word: "Next", start: 13.0, end: 13.4 },
  ];

  it("extends a mid-word cut to the end of the word/sentence when it fits within bounds", () => {
    // 9.1s lands inside "fast" (8.9-9.4) — should extend to the sentence end
    // (11.6, "point.") since that's within maxEnd(+grace) and a real gap follows.
    const end = snapEndToWordBoundary(words, 9.1, { minEnd: 8.5, maxEnd: 12 });
    expect(end).toBe(11.6);
  });

  it("only finishes the word (not the whole sentence) when the sentence end would overflow maxEnd", () => {
    // maxEnd=9.6 leaves no room to reach 11.6, but "fast" itself (ends 9.4) fits
    // within maxEnd+grace(1.5) — so it finishes the word, not the sentence.
    const end = snapEndToWordBoundary(words, 9.1, { minEnd: 8.5, maxEnd: 9.6 });
    expect(end).toBe(9.4);
  });

  it("still finishes the word when the overflow is within the grace window", () => {
    // maxEnd=9.0 — finishing "fast" (9.4) overflows by 0.4s which is within
    // grace(1.5), so it still finishes the word rather than cutting early.
    const end = snapEndToWordBoundary(words, 9.1, { minEnd: 8.0, maxEnd: 9.0 });
    expect(end).toBe(9.4);
  });

  it("snaps BACKWARD to the previous word's end when finishing would overflow past the grace window", () => {
    // maxEnd=7.0 — finishing "fast" (9.4) would overflow by 2.4s, past grace(1.5)
    // — snap back to the end of the previous complete word ("is", ends 8.9)
    // instead of cutting "fast" mid-word.
    const end = snapEndToWordBoundary(words, 9.1, { minEnd: 8.0, maxEnd: 7.0 });
    expect(end).toBe(8.9);
  });

  it("leaves the target alone when it already lands cleanly on a real SENTENCE end", () => {
    // 12.0 falls in the gap after "point." (11.6, sentence-final) — already a
    // complete thought, nothing to extend to.
    const end = snapEndToWordBoundary(words, 12.0, { minEnd: 8, maxEnd: 14 });
    expect(end).toBe(12.0);
  });

  // A separate list with a genuine micro-PAUSE (not wall-to-wall words) after
  // a non-sentence-final word, so a target time can land in a real gap that
  // is NOT already a complete thought — the actual "ends with no context" bug.
  const pausedWords: TranscriptWord[] = [
    { word: "today", start: 9.4, end: 10.0 },
    { word: "and", start: 10.0, end: 10.15 }, // ends here — a breath follows
    { word: "that's", start: 10.5, end: 10.9 },
    { word: "the", start: 10.9, end: 11.1 },
    { word: "whole", start: 11.1, end: 11.4 },
    { word: "point.", start: 11.4, end: 11.9 },
  ];

  it("still extends a TIME-CLEAN cut that lands mid-THOUGHT (the 'ends with no context' bug)", () => {
    // 10.2 falls in the pause right after "and" (ends 10.15) — a clean word
    // boundary (no word straddles it), but "...today and" is not a finished
    // thought. Must still reach forward to the real sentence end ("point.",
    // 11.9), not stop here just because no word straddles the exact cut time.
    const end = snapEndToWordBoundary(pausedWords, 10.2, { minEnd: 9, maxEnd: 12.5 });
    expect(end).toBe(11.9);
  });

  it("leaves a clean mid-thought cut alone when the sentence end is unreachable within budget", () => {
    // Same 10.2 mid-thought cut, but maxEnd=9.5 leaves no room (even with
    // grace(1.5), 9.5+1.5=11 < 11.9) to reach the sentence end — stays
    // word-safe rather than blowing the budget.
    const end = snapEndToWordBoundary(pausedWords, 10.2, { minEnd: 8, maxEnd: 9.5 });
    expect(end).toBe(10.2);
  });

  it("is a no-op with no words", () => {
    expect(snapEndToWordBoundary([], 9.1, { minEnd: 8, maxEnd: 12 })).toBe(9.1);
  });
});

// ── Phrase snapping + distinct gap fill (the "15 clips, 5 identical" bug) ──
const phrases = Array.from({ length: 60 }, (_, i) => ({ start: i * 10, end: i * 10 + 9.5, text: `phrase ${i} words here` }));

describe("snapStartToSegmentBoundary", () => {
  it("moves a mid-phrase start back to the phrase start", () => {
    expect(snapStartToSegmentBoundary(phrases, 104)).toBe(100);
  });
  it("starts on the next phrase when landing in a pause", () => {
    expect(snapStartToSegmentBoundary(phrases, 109.8)).toBe(110);
  });
  it("is a no-op without segments", () => {
    expect(snapStartToSegmentBoundary([], 42)).toBe(42);
  });
});

describe("snapEndToSegmentBoundary", () => {
  it("finishes the phrase the cut lands in when it fits", () => {
    expect(snapEndToSegmentBoundary(phrases, 133, { minEnd: 110, maxEnd: 140 })).toBe(139.5);
  });
  it("backs up to the previous phrase end when finishing overflows", () => {
    expect(snapEndToSegmentBoundary(phrases, 133, { minEnd: 110, maxEnd: 131 })).toBe(129.5);
  });
});

describe("distinctGapMoments", () => {
  const existing: ClipMoment[] = [
    { startSeconds: 100, endSeconds: 140, title: "A", reason: "", viralScore: 90, captionText: "" },
    { startSeconds: 300, endSeconds: 340, title: "B", reason: "", viralScore: 80, captionText: "" },
  ];
  it("returns the requested count of windows that never overlap the picks or each other", () => {
    const extra = distinctGapMoments(existing, 8, phrases, { min: 20, max: 40 });
    expect(extra).toHaveLength(8);
    const all = [...existing, ...extra].sort((a, b) => a.startSeconds - b.startSeconds);
    for (let i = 1; i < all.length; i++) expect(all[i].startSeconds).toBeGreaterThanOrEqual(all[i - 1].endSeconds);
    expect(new Set(extra.map((m) => m.startSeconds)).size).toBe(8);
    for (const m of extra) {
      expect(m.endSeconds - m.startSeconds).toBeGreaterThanOrEqual(20);
      expect(m.title).not.toMatch(/^Clip \d+$/);
    }
  });
  it("starts and ends every window on phrase boundaries", () => {
    const starts = new Set(phrases.map((p) => p.start));
    const ends = new Set(phrases.map((p) => p.end));
    for (const m of distinctGapMoments([], 5, phrases, { min: 20, max: 40 })) {
      expect(starts.has(m.startSeconds)).toBe(true);
      expect(ends.has(m.endSeconds)).toBe(true);
    }
  });
});
