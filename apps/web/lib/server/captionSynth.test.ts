import { describe, it, expect } from "vitest";
import { synthesizeWordsFromScript } from "@/lib/server/captionSynth";

describe("synthesizeWordsFromScript (caption fallback when STT is empty)", () => {
  it("distributes every word evenly across the clip with a lead-in", () => {
    const words = synthesizeWordsFromScript("one two three four", 10);
    expect(words).toHaveLength(4);
    expect(words[0].start).toBeGreaterThan(0);
    expect(words[3].end).toBeLessThanOrEqual(10);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeCloseTo(words[i - 1].end, 6);
  });
  it("empty script or zero duration → no words", () => {
    expect(synthesizeWordsFromScript("", 10)).toEqual([]);
    expect(synthesizeWordsFromScript("hello", 0)).toEqual([]);
  });
});
