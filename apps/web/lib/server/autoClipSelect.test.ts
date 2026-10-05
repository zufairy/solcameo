import { describe, test, expect } from "vitest";
import {
  pickNextAutoClipSource,
  autoClipKey,
  chooseAutoClip,
  type AutoClipCandidate,
} from "./autoClipSelect";

const A: AutoClipCandidate = {
  campaignId: "cA",
  title: "A",
  sources: [
    { sourceUrl: "u1", name: "1" },
    { sourceUrl: "u2", name: "2" },
  ],
};
const B: AutoClipCandidate = {
  contentRewardId: "rB",
  title: "B",
  sources: [{ sourceUrl: "u3", name: "3" }],
};

describe("autoClipKey", () => {
  test("uses campaignId when present", () => {
    expect(autoClipKey("cA", undefined, "u1")).toBe("cA|u1");
  });
  test("falls back to contentRewardId when campaignId absent", () => {
    expect(autoClipKey(undefined, "rB", "u3")).toBe("rB|u3");
  });
  test("empty campaign key when neither id present (bare source)", () => {
    expect(autoClipKey(undefined, undefined, "u9")).toBe("|u9");
  });
});

describe("pickNextAutoClipSource", () => {
  test("returns the first candidate's first source when nothing is clipped", () => {
    const got = pickNextAutoClipSource([A, B], new Set());
    expect(got).toEqual({ campaignId: "cA", contentRewardId: undefined, sourceUrl: "u1", title: "A" });
  });

  test("skips a clipped source, picks the next in the SAME campaign", () => {
    const clipped = new Set([autoClipKey("cA", undefined, "u1")]);
    expect(pickNextAutoClipSource([A], clipped)?.sourceUrl).toBe("u2");
  });

  test("moves to the next candidate once all of A's sources are clipped", () => {
    const clipped = new Set([autoClipKey("cA", undefined, "u1"), autoClipKey("cA", undefined, "u2")]);
    const got = pickNextAutoClipSource([A, B], clipped);
    expect(got).toEqual({ campaignId: undefined, contentRewardId: "rB", sourceUrl: "u3", title: "B" });
  });

  test("returns null when every candidate source is already clipped", () => {
    const clipped = new Set([
      autoClipKey("cA", undefined, "u1"),
      autoClipKey("cA", undefined, "u2"),
      autoClipKey(undefined, "rB", "u3"),
    ]);
    expect(pickNextAutoClipSource([A, B], clipped)).toBeNull();
  });

  test("returns null for empty candidates", () => {
    expect(pickNextAutoClipSource([], new Set())).toBeNull();
  });
});

describe("chooseAutoClip", () => {
  const base = { candidates: [A], clippedKeys: new Set<string>(), spendableUsdc: 100, dailyRemainingUsdc: 100, estCostUsdc: 0.5 };

  test("no un-clipped source → skip:no_new (never charges)", () => {
    const clippedKeys = new Set([autoClipKey("cA", undefined, "u1"), autoClipKey("cA", undefined, "u2")]);
    expect(chooseAutoClip({ ...base, clippedKeys })).toEqual({ skip: "no_new" });
  });

  test("spendable below est cost → skip:insufficient_funds", () => {
    expect(chooseAutoClip({ ...base, spendableUsdc: 0.1 })).toEqual({ skip: "insufficient_funds" });
  });

  test("daily remaining below est cost → skip:cap", () => {
    expect(chooseAutoClip({ ...base, dailyRemainingUsdc: 0.1 })).toEqual({ skip: "cap" });
  });

  test("affordable + un-clipped → returns the selected source", () => {
    const choice = chooseAutoClip(base);
    expect(choice).toEqual({ source: { campaignId: "cA", contentRewardId: undefined, sourceUrl: "u1", title: "A" } });
  });

  test("insufficient_funds is checked BEFORE cap (broke agent reports funds, not cap)", () => {
    expect(chooseAutoClip({ ...base, spendableUsdc: 0.1, dailyRemainingUsdc: 0.1 })).toEqual({ skip: "insufficient_funds" });
  });

  test("no cap (Infinity remaining) never trips the cap branch", () => {
    const choice = chooseAutoClip({ ...base, dailyRemainingUsdc: Number.POSITIVE_INFINITY });
    expect(choice).toEqual({ source: { campaignId: "cA", contentRewardId: undefined, sourceUrl: "u1", title: "A" } });
  });
});
