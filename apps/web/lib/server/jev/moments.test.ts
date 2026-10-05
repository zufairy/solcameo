import { describe, expect, it } from "vitest";
import { bm25Scores, buildWindows, heuristicInterest, isGenericQuery, lexicalShortlist, resegment, pickNonOverlapping, rankCandidates, titleFromText, topK, type Candidate } from "./moments";

const segs = [
  { start: 0, end: 10, text: "Welcome back to the show." },
  { start: 10, end: 22, text: "Today we talk about money." },
  { start: 22, end: 35, text: "I lost ten thousand dollars on crypto." },
  { start: 35, end: 50, text: "Here is what I learned from it." },
  { start: 50, end: 70, text: "Never invest what you cannot lose." },
];

const cand = (id: number, start: number, end: number, simRank: number, jev: number | null): Candidate => ({
  id, start, end, text: "", sim: 0, simRank, jev,
});

describe("buildWindows", () => {
  it("emits windows on segment boundaries within [min, max]", () => {
    const w = buildWindows(segs, 20, 40);
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) {
      expect(x.end - x.start).toBeGreaterThanOrEqual(20);
      expect(x.end - x.start).toBeLessThanOrEqual(40);
      expect(segs.some((s) => s.start === x.start)).toBe(true);
      expect(segs.some((s) => s.end === x.end)).toBe(true);
    }
  });

  it("skips empty and invalid segments", () => {
    expect(buildWindows([{ start: 5, end: 1, text: "x" }, { start: 0, end: 30, text: " " }], 10, 60)).toEqual([]);
  });

  // Parity with the reference repo's core.py scenes(): `return segs or [(0.0, dur)]`
  // — a scene splitter NEVER returns empty. buildWindows must not either.
  it("falls back to the whole span as one window when nothing fits [minLen, maxLen] (short video)", () => {
    const w = buildWindows([{ start: 0, end: 12, text: "Too short for a 20s window." }], 20, 60);
    expect(w).toEqual([{ id: 0, start: 0, end: 12, text: "Too short for a 20s window." }]);
  });

  it("falls back to fixed maxLen slices when only giant multi-minute provider segments exist", () => {
    const giant = [
      { start: 0, end: 240, text: "first giant block of speech content here padded out" },
      { start: 240, end: 480, text: "second giant block continues the conversation onward" },
    ];
    const w = buildWindows(giant, 20, 60);
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toEqual({ id: 0, start: 0, end: 60, text: expect.any(String) });
    for (const x of w) expect(x.end - x.start).toBeLessThanOrEqual(60);
    // covers the full span, no gaps
    expect(w.at(-1)!.end).toBe(480);
  });

  it("stays empty when there is nothing to slice", () => {
    expect(buildWindows([], 20, 60)).toEqual([]);
  });
});

describe("bm25Scores", () => {
  it("ranks the window that mentions the query terms first", () => {
    const docs = ["we talk about the weather", "I lost money on crypto dollars", "welcome to the show"];
    expect(topK(bm25Scores("losing money crypto", docs), 1)).toEqual([1]);
  });
});

describe("rankCandidates", () => {
  it("orders by Jev score, unscored keep retriever order below scored", () => {
    const r = rankCandidates([cand(0, 0, 1, 1, null), cand(1, 0, 1, 2, 0.2), cand(2, 0, 1, 3, 0.9), cand(3, 0, 1, 4, null)]);
    expect(r.map((c) => c.id)).toEqual([2, 1, 0, 3]);
  });
});

describe("pickNonOverlapping", () => {
  it("drops overlapping lower-ranked windows", () => {
    const p = pickNonOverlapping([cand(0, 10, 40, 1, 0.9), cand(1, 30, 60, 2, 0.8), cand(2, 60, 90, 3, 0.7)], 5);
    expect(p.map((c) => c.id)).toEqual([0, 2]);
  });
});

describe("titleFromText", () => {
  it("truncates at a word with an ellipsis", () => {
    expect(titleFromText("one two three four", 2)).toBe("one two…");
    expect(titleFromText("short one", 5)).toBe("short one");
  });
});

describe("resegment", () => {
  it("splits long provider segments at sentence ends and pauses using word timings", () => {
    const words = Array.from({ length: 30 }, (_, i) => ({
      word: i % 10 === 9 ? `w${i}.` : `w${i}`, start: i + (i >= 20 ? 3 : 0), end: i + 0.8 + (i >= 20 ? 3 : 0),
    }));
    const out = resegment(words, [{ start: 0, end: 240, text: "one giant segment" }]);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.every((s) => s.end - s.start <= 9)).toBe(true);
  });

  it("keeps provider segments when there are too few words", () => {
    const segs = [{ start: 0, end: 30, text: "x" }];
    expect(resegment([{ word: "a", start: 0, end: 1 }], segs)).toBe(segs);
  });
});

describe("lexicalShortlist", () => {
  it("keeps lexical hits first, then spreads the rest across the whole video", () => {
    const scores = Array.from({ length: 100 }, (_, i) => (i === 70 ? 2 : 0));
    const s = lexicalShortlist(scores, 5);
    expect(s[0]).toBe(70);
    expect(new Set(s).size).toBe(5);
    expect(Math.max(...s.slice(1))).toBeGreaterThan(50); // not just the opening windows
  });

  it("returns every window when there are fewer than k", () => {
    expect(lexicalShortlist([0, 1, 0], 10).sort()).toEqual([0, 1, 2]);
  });
});

describe("isGenericQuery", () => {
  it("is true for vibe-only queries with no named content", () => {
    for (const q of ["best moments", "highlights", "the good parts", "find best moment", "top clips"]) {
      expect(isGenericQuery(q)).toBe(true);
    }
  });

  it("is false once a query names something specific", () => {
    for (const q of ["someone talking about money", "a funny moment where people laugh", "crypto losses"]) {
      expect(isGenericQuery(q)).toBe(false);
    }
  });
});

describe("heuristicInterest", () => {
  it("scores an emphatic, concrete line higher than a flat one", () => {
    const flat = "we walked around for a while and looked at things";
    const strong = "I never expected to lose $50,000 in one day — honestly, it was shocking!";
    expect(heuristicInterest(strong)).toBeGreaterThan(heuristicInterest(flat));
  });
});
