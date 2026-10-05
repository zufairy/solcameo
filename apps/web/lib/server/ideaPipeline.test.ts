import { describe, it, expect } from "vitest";
import { selectIdea, freshnessDecay, type SelectableIdea } from "./ideaPipeline";

const now = Date.now();
const base = { status: "proposed", source: "evergreen", createdAt: now, score: 50 };

describe("freshnessDecay", () => {
  it("is 1 for non-news", () => {
    expect(freshnessDecay({ ...base }, now)).toBe(1);
  });
  it("decays news linearly to 0 at expiry", () => {
    const idea = { ...base, source: "news", createdAt: now - 12 * 3600_000, expiresAt: now + 12 * 3600_000 };
    expect(freshnessDecay(idea, now)).toBeCloseTo(0.5, 1);
    expect(freshnessDecay({ ...idea, expiresAt: now - 1 }, now)).toBe(0);
  });
});

describe("selectIdea", () => {
  it("approved beats any score", () => {
    const picked = selectIdea([
      { _id: "a", ...base, score: 99 },
      { _id: "b", ...base, status: "approved", score: 10, createdAt: now - 1000 },
    ] as SelectableIdea[]);
    expect(picked?._id).toBe("b");
  });
  it("oldest approved wins (FIFO)", () => {
    const picked = selectIdea([
      { _id: "new", ...base, status: "approved", createdAt: now },
      { _id: "old", ...base, status: "approved", createdAt: now - 5000 },
    ] as SelectableIdea[]);
    expect(picked?._id).toBe("old");
  });
  it("otherwise max score × decay; expired news never wins", () => {
    const picked = selectIdea([
      { _id: "stale", ...base, source: "news", score: 100, createdAt: now - 25 * 3600_000, expiresAt: now - 3600_000 },
      { _id: "ok", ...base, score: 60 },
    ] as SelectableIdea[]);
    expect(picked?._id).toBe("ok");
  });
  it("null on empty", () => {
    expect(selectIdea([])).toBeNull();
  });
});

import { applySelectionGuards } from "./ideaPipeline";

describe("applySelectionGuards", () => {
  const mk = (id: string, over: Record<string, unknown> = {}) =>
    ({ _id: id, status: "proposed", source: "evergreen", score: 50, createdAt: now, intent: "entertain", ...over });
  it("blocks consecutive promo unless nothing else", () => {
    const pool = [mk("p", { intent: "promo", score: 99 }), mk("e", { score: 40 })];
    expect(applySelectionGuards(pool as never, { lastProducedIntent: "promo", campaignBudgetLeft: 1 }).map((i: { _id: string }) => i._id)).toEqual(["e"]);
    // only promo left → allowed through
    expect(applySelectionGuards([mk("p", { intent: "promo" })] as never, { lastProducedIntent: "promo", campaignBudgetLeft: 1 })).toHaveLength(1);
  });
  it("drops campaign ideas when the daily brand budget is spent", () => {
    const pool = [mk("c", { intent: "promo", campaignId: "x" }), mk("e")];
    expect(applySelectionGuards(pool as never, { lastProducedIntent: "value", campaignBudgetLeft: 0 }).map((i: { _id: string }) => i._id)).toEqual(["e"]);
    expect(applySelectionGuards(pool as never, { lastProducedIntent: "value", campaignBudgetLeft: 1 })).toHaveLength(2);
  });
});
