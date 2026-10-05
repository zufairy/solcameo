import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Transcript } from "./clipTypes";

// Mock the single LLM caller so we can control per-window responses + count calls.
const callClaudeJSON = vi.fn();
vi.mock("./kie-claude", () => ({
  callClaudeJSON: (...args: unknown[]) => callClaudeJSON(...args),
}));

// Import AFTER the mock is registered.
import { analyzeTranscript, ANALYSIS_VERSION, ANALYSIS_WINDOW_SECONDS } from "./clipAnalysis";

/** Build a transcript whose joined segText is guaranteed to exceed the 45k
 *  single-call budget, so analyzeTranscript takes the WINDOWED path. We pad each
 *  segment's text so the total is large while keeping segments spread across the
 *  full duration. */
function longTranscript(durationSeconds: number, segmentEvery = 30): Transcript {
  const segments = [];
  const pad = "lorem ipsum dolor sit amet consectetur ".repeat(20); // ~780 chars/segment
  for (let t = 0; t < durationSeconds; t += segmentEvery) {
    segments.push({ start: t, end: Math.min(durationSeconds, t + segmentEvery), text: `segment at ${t}s ${pad}` });
  }
  return { durationSeconds, segments, words: [] };
}

beforeEach(() => {
  callClaudeJSON.mockReset();
});

describe("analyzeTranscript — short fast path", () => {
  it("uses ONE LLM call and returns moments unchanged for a short transcript", async () => {
    const transcript: Transcript = {
      durationSeconds: 120,
      segments: [{ start: 0, end: 120, text: "a short talk about shipping fast" }],
      words: [],
    };
    callClaudeJSON.mockResolvedValue({
      moments: [
        { startSeconds: 5, endSeconds: 35, title: "Hook", scores: { hook: 90, flow: 80, value: 70, trend: 60 }, emotion: "informative", reason: "r", captionText: "c" },
      ],
      chapters: [],
      summary: "s",
    });
    const out = await analyzeTranscript(transcript, { apiKey: "k" });
    expect(callClaudeJSON).toHaveBeenCalledTimes(1);
    expect(out.version).toBe(ANALYSIS_VERSION);
    expect(out.moments).toHaveLength(1);
    expect(out.moments[0].title).toBe("Hook");
  });

  it("falls back to evenly-spaced when the short-path LLM fails twice", async () => {
    const transcript: Transcript = {
      durationSeconds: 120,
      segments: [{ start: 0, end: 120, text: "talk" }],
      words: [],
    };
    callClaudeJSON.mockRejectedValue(new Error("503"));
    const out = await analyzeTranscript(transcript, { apiKey: "k" });
    expect(callClaudeJSON).toHaveBeenCalledTimes(2); // 2 attempts, one window
    expect(out.moments.length).toBeGreaterThan(0);
  });

  it("prunes a near-duplicate window on the single-call path too (the 'clips look identical' bug)", async () => {
    const transcript: Transcript = {
      durationSeconds: 120,
      segments: [{ start: 0, end: 120, text: "a short talk about shipping fast" }],
      words: [],
    };
    // Asked for 2 moments; the LLM re-picks the same beat twice (>50% overlap)
    // instead of admitting the source only has one strong moment.
    callClaudeJSON.mockResolvedValue({
      moments: [
        { startSeconds: 10, endSeconds: 35, title: "Best", scores: { hook: 95, flow: 90, value: 90, trend: 90 }, emotion: "informative", reason: "r", captionText: "c" },
        { startSeconds: 14, endSeconds: 38, title: "Best again", scores: { hook: 85, flow: 80, value: 80, trend: 80 }, emotion: "informative", reason: "r", captionText: "c" },
      ],
      chapters: [],
      summary: "s",
    });
    const out = await analyzeTranscript(transcript, { apiKey: "k", maxMoments: 2 });
    expect(out.moments).toHaveLength(1);
    expect(out.moments[0].title).toBe("Best");
  });
});

describe("analyzeTranscript — long windowed path", () => {
  it("yields moments BEYOND the first window (spanning the whole video)", async () => {
    const dur = 4 * 3600; // 4h → ~10 windows of 1500s
    const transcript = longTranscript(dur);
    expect(transcript.segments.map((s) => `[${s.start}-${s.end}] ${s.text}`).join("\n").length).toBeGreaterThan(45000);

    // Each window: return one moment positioned in the MIDDLE of that window using
    // the window's real bracketed timestamps (the test reads the user prompt to find
    // the window range, mimicking what the LLM would do).
    callClaudeJSON.mockImplementation(async (arg: { user: string }) => {
      const m = arg.user.match(/THIS WINDOW: (\d+)s\.\.(\d+)s/);
      const winStart = m ? Number(m[1]) : 0;
      const winEnd = m ? Number(m[2]) : 60;
      const mid = Math.floor((winStart + winEnd) / 2);
      // Score later windows HIGHER so a naive top-N by score would still keep them —
      // proves coverage isn't just "first window wins".
      const score = 50 + Math.min(40, Math.floor(winStart / 600));
      return {
        moments: [
          { startSeconds: mid, endSeconds: mid + 40, title: `win@${winStart}`, scores: { hook: score, flow: score, value: score, trend: score }, emotion: "informative", reason: "r", captionText: "c" },
        ],
        chapters: [{ startSeconds: winStart, title: `chap@${winStart}` }],
        summary: `sum@${winStart}`,
      };
    });

    const out = await analyzeTranscript(transcript, { apiKey: "k" });

    // More than one window analyzed.
    expect(callClaudeJSON.mock.calls.length).toBeGreaterThan(1);
    expect(out.version).toBe(ANALYSIS_VERSION);

    // CRITICAL: at least one returned moment starts AFTER the first window's end.
    const beyondFirst = out.moments.filter((mm) => mm.startSeconds >= ANALYSIS_WINDOW_SECONDS);
    expect(beyondFirst.length).toBeGreaterThan(0);

    // Moments span well past the buggy first-45k-chars region: the latest moment is
    // deep into the back half of the video.
    const latest = Math.max(...out.moments.map((mm) => mm.startSeconds));
    expect(latest).toBeGreaterThan(dur / 2);

    // Ordering contract preserved: viralScore desc.
    for (let i = 1; i < out.moments.length; i++) {
      expect(out.moments[i - 1].viralScore).toBeGreaterThanOrEqual(out.moments[i].viralScore);
    }
    // Scores attached on every moment (downstream genreScore depends on this).
    out.moments.forEach((mm) => expect(mm.scores).toBeTruthy());
  });

  it("falls back to evenly-spaced when EVERY window fails", async () => {
    const dur = 2 * 3600;
    const transcript = longTranscript(dur);
    callClaudeJSON.mockRejectedValue(new Error("rate limited"));
    const out = await analyzeTranscript(transcript, { apiKey: "k" });
    expect(out.moments.length).toBeGreaterThan(0);
    // evenly-spaced spans the whole video → has moments past the first window.
    const latest = Math.max(...out.moments.map((mm) => mm.startSeconds));
    expect(latest).toBeGreaterThan(ANALYSIS_WINDOW_SECONDS);
  });

  it("de-overlaps moments from adjacent windows (no >50% duplicate spans)", async () => {
    const dur = 3 * ANALYSIS_WINDOW_SECONDS; // exactly 3 windows
    const transcript = longTranscript(dur);
    // Every window returns the SAME absolute timestamp region (forces overlap),
    // so the merge must keep just one of the near-duplicates.
    callClaudeJSON.mockResolvedValue({
      moments: [
        { startSeconds: 100, endSeconds: 140, title: "dup", scores: { hook: 80, flow: 80, value: 80, trend: 80 }, emotion: "informative", reason: "r", captionText: "c" },
      ],
      chapters: [],
      summary: "s",
    });
    const out = await analyzeTranscript(transcript, { apiKey: "k" });
    const at100 = out.moments.filter((mm) => mm.startSeconds === 100);
    expect(at100.length).toBe(1);
  });
});
