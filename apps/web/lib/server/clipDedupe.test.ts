import { describe, it, expect } from "vitest";
import { dedupeOverlappingInOrder, dedupeOverlappingMoments } from "./clipMomentSelector";

// Real prod rows from one job: same start, slightly different end → both posted.
const m = (s: number, e: number, score = 50, title = "x") => ({ startSeconds: s, endSeconds: e, viralScore: score, title });

describe("clip duplicate guards", () => {
  it("drops same-start near-identical windows (483-516 vs 483-521)", () => {
    const out = dedupeOverlappingInOrder([m(483, 516, 70, "a"), m(483, 521, 60, "b"), m(744, 783), m(744, 786), m(218, 260)]);
    expect(out.map((x) => [x.startSeconds, x.endSeconds])).toEqual([[483, 516], [744, 783], [218, 260]]);
  });
  it("keeps the caller's order (prompt/feel ranking) and adjacent non-overlapping clips", () => {
    const out = dedupeOverlappingInOrder([m(300, 330), m(0, 30), m(30, 60), m(310, 340)]);
    expect(out.map((x) => x.startSeconds)).toEqual([300, 0, 30]);
  });
  it("score-ranked variant keeps the stronger of two duplicates", () => {
    const out = dedupeOverlappingMoments([m(483, 516, 40), m(483, 521, 90)]);
    expect(out).toHaveLength(1);
    expect(out[0].endSeconds).toBe(521);
  });
});
