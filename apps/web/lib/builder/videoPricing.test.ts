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
    expect(pickableVideoEngine("veo3-fast")).toBe("seedance-v2");
  });
});
