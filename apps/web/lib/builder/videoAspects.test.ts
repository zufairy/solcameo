import { describe, expect, it } from "vitest";
import { aspectFor, aspectsForEngine } from "./videoAspects";

describe("video aspects", () => {
  it("offers square only on engines that can render it", () => {
    expect(aspectsForEngine("grok-imagine-15").map((a) => a.value)).toEqual(["9:16", "16:9", "1:1"]);
    expect(aspectsForEngine("seedance-v2").map((a) => a.value)).toContain("1:1");
    expect(aspectsForEngine("veo3-fast").map((a) => a.value)).toEqual(["9:16", "16:9"]);
    expect(aspectsForEngine("gemini-omni").map((a) => a.value)).toEqual(["9:16", "16:9"]);
  });
  it("keeps the pick when the engine supports it, else falls back to portrait", () => {
    expect(aspectFor("grok-imagine-15", "16:9")).toBe("16:9");
    expect(aspectFor("veo3-fast", "1:1")).toBe("9:16");
    expect(aspectFor("veo3-fast", "nonsense")).toBe("9:16");
    expect(aspectFor(undefined, undefined)).toBe("9:16");
  });
});
