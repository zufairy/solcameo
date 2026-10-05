import { describe, expect, it } from "vitest";
import { estimateGenerationUsd } from "./generationPrice";

describe("Genjutsu generation estimates", () => {
  it("uses the resolution rate and includes the platform amount", () => {
    expect(estimateGenerationUsd(10, "480p")).toBe(4.18);
    expect(estimateGenerationUsd(10, "720p")).toBe(7.81);
    expect(estimateGenerationUsd(10, "1080p")).toBe(17.32);
  });
  it("rounds input duration up and the total up to cents", () => {
    expect(estimateGenerationUsd(4.01, "720p")).toBe(4.41);
    expect(estimateGenerationUsd(30, "1080p")).toBe(49.96);
  });
  it("rejects unsupported input durations", () => {
    for (const duration of [0, 3.9, 30.1, NaN, Infinity]) {
      expect(estimateGenerationUsd(duration, "720p")).toBeNull();
    }
  });
});
