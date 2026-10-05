import { describe, it, expect } from "vitest";
import { CLIP_GENRES, CLIP_GENRE_BY_ID, genreScore } from "./clipGenres";

describe("clipGenres", () => {
  it("every genre's weights sum to 1", () => {
    for (const g of CLIP_GENRES) {
      const sum = g.weights.hook + g.weights.flow + g.weights.value + g.weights.trend;
      expect(sum, g.id).toBeCloseTo(1, 5);
    }
  });

  it("ids are unique and include auto", () => {
    expect(new Set(CLIP_GENRES.map((g) => g.id)).size).toBe(CLIP_GENRES.length);
    expect(CLIP_GENRE_BY_ID.auto).toBeDefined();
  });

  it("auto keeps the moment's own viralScore", () => {
    const m = { viralScore: 77, scores: { hook: 0, flow: 0, value: 0, trend: 0 } };
    expect(genreScore(m, "auto")).toBe(77);
  });

  it("re-weights sub-scores per genre", () => {
    // Pure-hook moment: sports (hook .5) must score it higher than educational (hook .25).
    const m = { viralScore: 50, scores: { hook: 100, flow: 0, value: 0, trend: 0 } };
    expect(genreScore(m, "sports")).toBe(50);
    expect(genreScore(m, "educational")).toBe(25);
    // Pure-value moment: the order flips.
    const v = { viralScore: 50, scores: { hook: 0, flow: 0, value: 100, trend: 0 } };
    expect(genreScore(v, "educational")).toBeGreaterThan(genreScore(v, "sports"));
  });

  it("falls back to viralScore when sub-scores are missing (live-selector moments)", () => {
    expect(genreScore({ viralScore: 64 }, "sports")).toBe(64);
    expect(genreScore({ viralScore: 64 }, "not-a-genre")).toBe(64);
  });

  it("re-ranking changes order for genre-fit moments", () => {
    const hooky = { viralScore: 60, scores: { hook: 90, flow: 30, value: 20, trend: 60 } };
    const valuey = { viralScore: 70, scores: { hook: 30, flow: 60, value: 95, trend: 20 } };
    const byMarketing = [hooky, valuey].sort((a, b) => genreScore(b, "marketing") - genreScore(a, "marketing"));
    expect(byMarketing[0]).toBe(valuey); // value-weighted genre promotes the value moment
    const bySports = [hooky, valuey].sort((a, b) => genreScore(b, "sports") - genreScore(a, "sports"));
    expect(bySports[0]).toBe(hooky);
  });
});
