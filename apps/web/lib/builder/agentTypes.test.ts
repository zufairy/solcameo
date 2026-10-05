import { describe, it, expect } from "vitest";
import { VIDEO_ENGINES, getVideoEngine } from "./agentTypes";

describe("video engine catalog", () => {
  it("does not expose Grok 1.0 in the selectable catalog", () => {
    expect(VIDEO_ENGINES.some((engine) => engine.id === "grok-imagine-10")).toBe(false);
  });

  it("maps legacy Grok 1.0 configs to Grok 1.5", () => {
    expect(getVideoEngine("grok-imagine-10").id).toBe("grok-imagine-15");
  });
});
