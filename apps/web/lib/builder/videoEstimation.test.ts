import { describe, expect, it } from "vitest";
import {
  SPEAKING_WORDS_PER_SEC,
  MAX_VIDEO_SECONDS,
  estimateSecondsFromScript,
  maxClipForModel,
} from "./agentTypes";

describe("estimateSecondsFromScript", () => {
  it("uses the speaking rate of 2.5 words/sec", () => {
    // 25 words / 2.5 = 10s
    const text = Array.from({ length: 25 }, () => "word").join(" ");
    expect(estimateSecondsFromScript(text)).toBe(10);
  });

  it("rounds partial seconds up", () => {
    // 26 words / 2.5 = 10.4 -> 11
    const text = Array.from({ length: 26 }, () => "word").join(" ");
    expect(estimateSecondsFromScript(text)).toBe(11);
  });

  it("floors empty/whitespace input to the minimum clip length (5s)", () => {
    expect(estimateSecondsFromScript("")).toBe(5);
    expect(estimateSecondsFromScript("   \n  ")).toBe(5);
  });

  it("floors very short scripts to 5s", () => {
    // 3 words / 2.5 = 1.2 -> 2, but floored to 5
    expect(estimateSecondsFromScript("hello there friend")).toBe(5);
  });

  it("caps at the 60s ceiling no matter how long the script", () => {
    const text = Array.from({ length: 500 }, () => "word").join(" ");
    expect(estimateSecondsFromScript(text)).toBe(MAX_VIDEO_SECONDS);
    expect(MAX_VIDEO_SECONDS).toBe(60);
  });

  it("exposes the speaking rate constant", () => {
    expect(SPEAKING_WORDS_PER_SEC).toBe(2.5);
  });

  it("collapses irregular whitespace when counting words", () => {
    // 25 words separated by mixed whitespace -> still 10s
    const text = "word\n word\tword   word ".repeat(0) +
      Array.from({ length: 25 }, () => "word").join("\n\t  ");
    expect(estimateSecondsFromScript(text)).toBe(10);
  });
});

describe("maxClipForModel", () => {
  it("maps all Veo slugs to 8s", () => {
    expect(maxClipForModel("veo3")).toBe(8);
    expect(maxClipForModel("veo3_fast")).toBe(8);
    expect(maxClipForModel("veo3-fast")).toBe(8);
    expect(maxClipForModel("veo3_lite")).toBe(8);
  });

  it("maps Seedance slugs to 15s", () => {
    expect(maxClipForModel("bytedance/seedance-2")).toBe(15);
    expect(maxClipForModel("bytedance/seedance-2-fast")).toBe(15);
    expect(maxClipForModel("seedance-v2")).toBe(15);
  });

  it("defaults unknown models to the conservative 8s clip", () => {
    expect(maxClipForModel("some-future-model")).toBe(8);
    expect(maxClipForModel("")).toBe(8);
  });
});
