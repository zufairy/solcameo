import { describe, expect, it } from "vitest";
import { rankCandidates, scoreCandidate, type Candidate } from "./renderStudioClips";

const mk = (o: Partial<Candidate>): Candidate => ({ provider: "pexels", id: "x", title: "t", url: "https://v/" + Math.random(), duration: 10, width: 1080, height: 1920, rank: 0, query: "q", ...o });
const portrait = { width: 1080, height: 1920 };

describe("clip ranking", () => {
  it("prefers orientation that fits the canvas", () => {
    expect(scoreCandidate(mk({}), portrait)).toBeGreaterThan(scoreCandidate(mk({ width: 1920, height: 1080 }), portrait));
  });
  it("penalises tiny clips and low resolution", () => {
    expect(scoreCandidate(mk({ duration: 1 }), portrait)).toBeLessThan(scoreCandidate(mk({ duration: 8 }), portrait));
    expect(scoreCandidate(mk({ width: 360, height: 640 }), portrait)).toBeLessThan(scoreCandidate(mk({}), portrait));
  });
  it("dedupes by url, sorts best first and limits", () => {
    const a = mk({ url: "https://v/a", rank: 3 }), b = mk({ url: "https://v/b", rank: 0 }), dup = mk({ url: "https://v/b", rank: 9 });
    const out = rankCandidates([a, b, dup], portrait, 2);
    expect(out.map((c) => c.url)).toEqual(["https://v/b", "https://v/a"]);
  });
  it("ranks keyless Wikimedia below keyed providers", () => {
    expect(scoreCandidate(mk({ provider: "wikimedia" }), portrait)).toBeLessThan(scoreCandidate(mk({}), portrait));
  });
});
