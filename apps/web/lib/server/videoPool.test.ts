import { describe, it, expect } from "vitest";
import { pickFromPool, overlapScore, keywords, untranscribed, toPool } from "./videoPool";

const hook = (url: string, transcript?: string) => ({ url, ...(transcript ? { transcript } : {}) });

describe("keywords", () => {
  it("drops stop words and short tokens", () => {
    expect([...keywords("This is the price of it")]).toEqual(["price"]);
  });

  it("keeps domain words a stop list would be tempted to eat", () => {
    const k = keywords("buy now, the price drops");
    expect(k.has("buy")).toBe(true);
    expect(k.has("price")).toBe(true);
    expect(k.has("drops")).toBe(true);
  });

  it("is empty for empty input", () => {
    expect(keywords(undefined).size).toBe(0);
    expect(keywords("  ").size).toBe(0);
  });
});

describe("overlapScore", () => {
  it("normalizes by the SMALLER set so a short on-topic hook beats a rambling one", () => {
    const clip = keywords("pricing tiers and discount for annual billing");
    const tight = keywords("pricing discount");                       // 2/2 on topic
    const rambling = keywords("pricing " + "weather sports cooking travel music movies".repeat(3));
    expect(overlapScore(clip, tight)).toBeGreaterThan(overlapScore(clip, rambling));
  });

  it("is 0 when either side is empty", () => {
    expect(overlapScore(new Set(), keywords("anything"))).toBe(0);
  });
});

describe("pickFromPool", () => {
  it("returns null for an empty pool — caller treats the app as not installed", () => {
    expect(pickFromPool({ pool: [] })).toBeNull();
    expect(pickFromPool({ pool: [hook("   ")] })).toBeNull();
  });

  it("picks the transcript that matches the clip's topic", () => {
    const res = pickFromPool({
      pool: [
        hook("a.mp4", "today we are cooking pasta with garlic"),
        hook("b.mp4", "the pricing tiers and how much the discount saves you"),
      ],
      clipText: "let me explain our pricing and the annual discount",
    });
    expect(res).toMatchObject({ url: "b.mp4", reason: "match" });
    expect(res!.score).toBeGreaterThan(0);
  });

  it("falls back to CYCLING when nothing clears the match threshold", () => {
    const pool = [hook("a.mp4", "cooking pasta"), hook("b.mp4", "car maintenance")];
    const clipText = "quarterly revenue growth in enterprise accounts";
    expect(pickFromPool({ pool, clipText, index: 0 })).toMatchObject({ url: "a.mp4", reason: "cycle" });
    expect(pickFromPool({ pool, clipText, index: 1 })).toMatchObject({ url: "b.mp4", reason: "cycle" });
    expect(pickFromPool({ pool, clipText, index: 2 })).toMatchObject({ url: "a.mp4", reason: "cycle" });
  });

  it("cycles when the pool has no transcripts yet (first run, nothing cached)", () => {
    const pool = [hook("a.mp4"), hook("b.mp4"), hook("c.mp4")];
    expect(pickFromPool({ pool, clipText: "anything at all", index: 4 })!.url).toBe("b.mp4");
  });

  // Every upload airing is the point of cycling — a random pick would let one video
  // repeat while another never runs.
  it("covers the whole pool across successive outputs", () => {
    const pool = [hook("a.mp4"), hook("b.mp4"), hook("c.mp4")];
    const picked = [0, 1, 2, 3, 4, 5].map((index) => pickFromPool({ pool, index })!.url);
    expect(new Set(picked)).toEqual(new Set(["a.mp4", "b.mp4", "c.mp4"]));
  });

  it("normalizes a negative index instead of throwing", () => {
    const pool = [hook("a.mp4"), hook("b.mp4")];
    expect(pickFromPool({ pool, index: -1 })!.url).toBe("b.mp4");
  });

  it("a single-item pool always returns that item", () => {
    expect(pickFromPool({ pool: [hook("only.mp4")], clipText: "unrelated", index: 7 }))
      .toMatchObject({ url: "only.mp4" });
  });

  it("resolves a tie to upload order", () => {
    const pool = [hook("a.mp4", "pricing discount"), hook("b.mp4", "pricing discount")];
    expect(pickFromPool({ pool, clipText: "pricing discount" })!.url).toBe("a.mp4");
  });
});

describe("untranscribed / toPool", () => {
  it("lists only the entries still missing a transcript", () => {
    expect(untranscribed([hook("a.mp4", "words"), hook("b.mp4")])).toEqual(["b.mp4"]);
  });

  it("builds pool items from stored urls, attaching known transcripts", () => {
    expect(toPool([" a.mp4 ", "", "b.mp4"], { "a.mp4": "hello" })).toEqual([
      { url: "a.mp4", transcript: "hello" },
      { url: "b.mp4" },
    ]);
  });

  it("tolerates a missing/undefined stored value", () => {
    expect(toPool(undefined)).toEqual([]);
  });
});
