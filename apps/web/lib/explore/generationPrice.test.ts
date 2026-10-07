import { describe, expect, it } from "vitest";
import { estimateGenerationUsd } from "./generationPrice";

describe("explore generation price", () => {
  it("adds 15% or $1 on top of the Higgsfield rate, whichever is higher", () => {
    expect(estimateGenerationUsd(4, "480p")).toBe(2.28); // $1.272 + max($0.127, $1.00) = $2.272, rounded up to the cent
    expect(estimateGenerationUsd(10, "720p")).toBe(7.84); // $6.81 + 15% ($1.022), which is above the $1.00 floor
    expect(estimateGenerationUsd(10, "1080p")).toBe(18.77); // $16.32 + 15% ($2.448) = $18.768
  });
  it("never takes less than $1 or 15% of the provider cost", () => {
    for (const resolution of ["480p", "720p", "1080p"] as const) for (const seconds of [4, 8, 15, 30]) {
      const provider = seconds * { "480p": 0.318, "720p": 0.681, "1080p": 1.632 }[resolution];
      const price = estimateGenerationUsd(seconds, resolution)!;
      expect(price - provider).toBeGreaterThanOrEqual(Math.max(provider * 0.15, 1) - 0.011);
    }
  });
  it("rounds the duration up to whole seconds", () => {
    expect(estimateGenerationUsd(9.2, "720p")).toBe(estimateGenerationUsd(10, "720p"));
  });
  it("rejects references outside 4 to 30 seconds", () => {
    expect(estimateGenerationUsd(3.9, "720p")).toBeNull();
    expect(estimateGenerationUsd(31, "720p")).toBeNull();
  });
});
