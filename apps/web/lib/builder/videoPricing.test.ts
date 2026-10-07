import { describe, expect, it } from "vitest";
import { RETAIL_MARKUP, retailUsd } from "@/lib/pricing/retail";
import { getVideoEngine, videoCostForLength, videoLengthOptions } from "./agentTypes";
import { kieProviderCostUsd } from "./kieVideoPricing";

describe("video pricing carries a 15% markup everywhere", () => {
  it("uses 15% as the one retail markup", () => {
    expect(RETAIL_MARKUP).toBe(1.15);
    expect(retailUsd(1)).toBe(1.15);
  });
  it("prices a Kie engine at the provider's exact price plus 15%", () => {
    const provider = kieProviderCostUsd("grok-imagine-15", 10, "720p")!;
    expect(videoCostForLength(getVideoEngine("grok-imagine-15"), 10, "720p")).toBeCloseTo(provider * 1.15, 6);
  });
  it("prices Higgsfield Seedance per second at the list rate plus 15%", () => {
    expect(videoCostForLength(getVideoEngine("hf-seedance-2"), 10)).toBeCloseTo(10 * 0.3024 * 1.15, 6);
    expect(videoCostForLength(getVideoEngine("hf-seedance-25"), 10)).toBeCloseTo(10 * 0.4622 * 1.15, 6);
  });
  it("offers a length for every engine, so the price shown is for a length that is sent", () => {
    expect(videoLengthOptions("hf-seedance-2")).toEqual([5, 8, 10, 15]);
    expect(videoLengthOptions("hf-seedance-25")).toEqual([5, 8, 10, 15, 20, 30]);
    expect(videoLengthOptions("grok-imagine-15")).toEqual([6, 10, 15, 20, 30]);
  });
});

describe("engine pickers show the engine that is priced and rendered", async () => {
  const { pickableVideoEngine, selectableVideoEngines } = await import("./agentTypes");
  it("never returns an engine the dropdown does not list", () => {
    const ids = selectableVideoEngines().map((e) => e.id);
    for (const preferred of [undefined, "veo3-fast", "kling-v3", "nonsense", "grok-imagine-15", "hf-seedance-2"]) {
      expect(ids).toContain(pickableVideoEngine(preferred));
    }
  });
  it("keeps a saved engine that users can pick, and replaces a hidden one", () => {
    expect(pickableVideoEngine("grok-imagine-15")).toBe("grok-imagine-15");
    expect(pickableVideoEngine("veo3-fast")).toBe("grok-imagine-15");
    expect(pickableVideoEngine(undefined)).toBe("grok-imagine-15");
  });
});

/**
 * Every row below is copied from Kie's live pricing feed (api.kie.ai/client/v1/model-pricing/page, the data behind
 * kie.ai/pricing), read 2026-10-08, "no video input" rows because the render only ever sends images. If Kie reprices a model
 * this fails, which is the point: the price shown and charged must follow Kie's list price.
 */
describe("Kie prices match kie.ai/pricing, per engine, quality and length", () => {
  // [engine, quality, seconds, Kie credits for the whole video]
  const ROWS: Array<[string, "480p" | "720p" | "1080p" | "4k", number, number]> = [
    ["grok-imagine-15", "480p", 10, 24], ["grok-imagine-15", "720p", 10, 45], ["grok-imagine-15", "720p", 15, 67.5], ["grok-imagine-15", "720p", 30, 135],
    ["seedance-v2", "480p", 5, 95], ["seedance-v2", "720p", 5, 205], ["seedance-v2", "720p", 10, 410], ["seedance-v2", "720p", 15, 615],
    ["seedance-1-5-pro", "720p", 8, 28], ["seedance-1-5-pro", "1080p", 8, 60],
    ["gemini-omni", "720p", 4, 63], ["gemini-omni", "720p", 6, 84], ["gemini-omni", "1080p", 8, 105], ["gemini-omni", "720p", 10, 126],
    ["gemini-omni", "4k", 4, 147], ["gemini-omni", "4k", 10, 210],
    ["veo3-fast", "720p", 8, 60], ["veo3-fast", "1080p", 8, 65], ["veo3-fast", "4k", 8, 180],
    ["kling-v3", "720p", 5, 70], ["kling-v3", "1080p", 5, 90],
  ];
  for (const [engine, quality, seconds, credits] of ROWS) {
    it(`${engine} ${quality} ${seconds}s is ${credits} credits, plus 15% for the customer`, () => {
      expect(kieProviderCostUsd(engine, seconds, quality)).toBeCloseTo(credits * 0.005, 6);
      expect(videoCostForLength(getVideoEngine(engine as never), seconds, quality)).toBeCloseTo(credits * 0.005 * 1.15, 6);
    });
  }
  it("price grows with the chosen length (dynamic on time)", () => {
    for (const engine of ["grok-imagine-15", "seedance-v2", "seedance-1-5-pro"] as const) {
      const prices = videoLengthOptions(engine).map((s) => videoCostForLength(getVideoEngine(engine), s, "720p"));
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
      expect(new Set(prices).size).toBe(prices.length);
    }
  });
});
