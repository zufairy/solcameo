// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeFillerRanges, keepRanges, remapTime, remapWords } from "./fillerCut";

const W = (word: string, start: number, end: number) => ({ word, start, end });

describe("fillerCut", () => {
  const words = [
    W("So", 10.0, 10.2), W("um,", 10.3, 10.7), W("here", 10.8, 11.0), W("is", 11.0, 11.2),
    W("the", 11.2, 11.4), W("uh", 11.5, 11.9), W("point.", 12.0, 12.4),
    W("You", 13.0, 13.2), W("know,", 13.2, 13.5), W("it", 13.6, 13.8), W("works.", 13.8, 14.2),
  ];

  it("finds core fillers (um/uh) inside the clip window, clip-relative + padded", () => {
    const cuts = computeFillerRanges(words, 10, 15);
    expect(cuts.length).toBe(2);
    expect(cuts[0].start).toBeCloseTo(0.27, 2); // 10.3-10 - pad
    expect(cuts[0].end).toBeCloseTo(0.73, 2);
    expect(cuts[1].start).toBeCloseTo(1.47, 2);
  });

  it("aggressive mode also cuts 'you know' bigrams", () => {
    const cuts = computeFillerRanges(words, 10, 15, true);
    expect(cuts.length).toBe(3);
    const last = cuts[2];
    expect(last.start).toBeCloseTo(2.97, 2); // "You" 13.0 → rel 3.0 - pad
    expect(last.end).toBeCloseTo(3.53, 2);   // "know," 13.5 → rel 3.5 + pad
  });

  it("keepRanges is the exact complement", () => {
    const cuts = [{ start: 1, end: 2 }, { start: 4, end: 4.5 }];
    expect(keepRanges(cuts, 6)).toEqual([
      { start: 0, end: 1 }, { start: 2, end: 4 }, { start: 4.5, end: 6 },
    ]);
  });

  it("remapTime collapses removed spans; words inside cuts are dropped", () => {
    const cuts = [{ start: 1, end: 2 }];
    expect(remapTime(0.5, cuts)).toBe(0.5);
    expect(remapTime(3, cuts)).toBe(2);     // 1s removed before t=3
    expect(remapTime(1.5, cuts)).toBe(1);   // inside cut → snaps to cut start
    const remapped = remapWords([W("keep", 0.2, 0.6), W("um", 1.2, 1.8), W("after", 2.5, 3.0)], cuts);
    expect(remapped.map((w) => w.word)).toEqual(["keep", "after"]);
    expect(remapped[1].start).toBeCloseTo(1.5, 5);
  });

  it("no fillers → no cuts", () => {
    expect(computeFillerRanges([W("clean", 0, 1), W("speech", 1, 2)], 0, 2)).toEqual([]);
  });
});
