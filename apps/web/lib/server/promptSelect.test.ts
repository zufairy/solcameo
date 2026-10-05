// @vitest-environment node
import { describe, it, expect } from "vitest";
import { keywordFallback } from "./promptSelect";
import type { Transcript } from "./clipTypes";

const transcript: Transcript = {
  durationSeconds: 120,
  words: [],
  segments: [
    { start: 5, end: 10, text: "welcome to the show" },
    { start: 40, end: 48, text: "let's talk about pricing and money" },
    { start: 90, end: 96, text: "pricing mistakes founders make" },
  ],
};

describe("promptSelect keywordFallback", () => {
  it("builds windows around segments matching the prompt terms", () => {
    const out = keywordFallback(transcript, "find moments about pricing", 15, 30, 120);
    expect(out.length).toBeGreaterThan(0);
    // First match window must contain the segment at 40-48s.
    expect(out[0].startSeconds).toBeLessThanOrEqual(44);
    expect(out[0].endSeconds).toBeGreaterThanOrEqual(44);
    expect(out[0].reason).toContain("pricing");
  });

  it("returns empty when nothing matches", () => {
    expect(keywordFallback(transcript, "quantum sailing", 15, 30, 120)).toEqual([]);
  });

  it("ignores short stop-words in the prompt", () => {
    expect(keywordFallback(transcript, "go to it at", 15, 30, 120)).toEqual([]);
  });
});
