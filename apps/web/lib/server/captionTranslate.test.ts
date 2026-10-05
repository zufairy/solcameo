import { describe, it, expect } from "vitest";
import { groupWordsIntoPhrases, spreadTokensOverSpan, translateCaptionWords, tokenizeForCaptions } from "@/lib/server/captionTranslate";
import type { TranscriptWord } from "@/lib/server/clipTypes";

const w = (word: string, start: number, end: number): TranscriptWord => ({ word, start, end });

describe("groupWordsIntoPhrases", () => {
  it("splits on long silences and sentence-ending punctuation", () => {
    const words = [w("hello", 0, 0.3), w("world.", 0.3, 0.6), w("next", 0.7, 1), w("bit", 2.5, 2.8)];
    const phrases = groupWordsIntoPhrases(words);
    expect(phrases.map((p) => p.words.map((x) => x.word).join(" "))).toEqual(["hello world.", "next", "bit"]);
    expect(phrases[0].start).toBe(0);
    expect(phrases[0].end).toBe(0.6);
  });
  it("caps phrase length so one run-on never becomes a single giant caption", () => {
    const words = Array.from({ length: 20 }, (_, i) => w(`w${i}`, i * 0.2, i * 0.2 + 0.2));
    const phrases = groupWordsIntoPhrases(words);
    expect(phrases.length).toBeGreaterThan(1);
    for (const p of phrases) expect(p.words.length).toBeLessThanOrEqual(8);
  });
});

describe("spreadTokensOverSpan", () => {
  it("distributes tokens evenly over the phrase span, contiguous", () => {
    const out = spreadTokensOverSpan(["satu", "dua", "tiga"], 1, 2.5);
    expect(out).toHaveLength(3);
    expect(out[0].start).toBe(1);
    expect(out[2].end).toBeCloseTo(2.5, 6);
    expect(out[1].start).toBeCloseTo(out[0].end, 6);
  });
});

describe("tokenizeForCaptions", () => {
  it("whitespace-splits latin text and segments CJK without spaces", () => {
    expect(tokenizeForCaptions("saya suka makan")).toEqual(["saya", "suka", "makan"]);
    const zh = tokenizeForCaptions("我喜欢吃饭");
    expect(zh.length).toBeGreaterThan(1);
    expect(zh.join("")).toBe("我喜欢吃饭");
  });
});

describe("translateCaptionWords", () => {
  const words = [w("I", 0, 0.2), w("like", 0.2, 0.5), w("food.", 0.5, 0.9), w("Very", 1.5, 1.8), w("much", 1.8, 2.1)];
  it("no-op when the target matches the spoken language", async () => {
    const r = await translateCaptionWords(words, { target: "en", source: "en", translate: async () => { throw new Error("must not call"); } });
    expect(r.mode).toBe("skipped");
    expect(r.words).toBe(words);
  });
  it("translates per phrase and keeps each phrase inside its original time window", async () => {
    const r = await translateCaptionWords(words, {
      target: "ms",
      source: "en",
      translate: async (phrases) => phrases.map((p) => (p.startsWith("I") ? "Saya suka makanan." : "Sangat banyak sekali")),
    });
    expect(r.mode).toBe("llm");
    const first = r.words.slice(0, 3);
    expect(first.map((x) => x.word)).toEqual(["Saya", "suka", "makanan."]);
    expect(first[0].start).toBe(0);
    expect(first[2].end).toBeCloseTo(0.9, 6);
    const second = r.words.slice(3);
    expect(second.map((x) => x.word)).toEqual(["Sangat", "banyak", "sekali"]);
    expect(second[0].start).toBe(1.5);
    expect(second[2].end).toBeCloseTo(2.1, 6);
  });
  it("falls back to the original words when the translator fails or miscounts", async () => {
    const bad = await translateCaptionWords(words, { target: "ms", translate: async () => ["only one"] });
    expect(bad.mode).toBe("failed");
    expect(bad.words).toBe(words);
    const threw = await translateCaptionWords(words, { target: "ms", translate: async () => { throw new Error("boom"); } });
    expect(threw.mode).toBe("failed");
  });
});
