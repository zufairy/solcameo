import { describe, expect, it } from "vitest";
import { estimateGenerationUsd } from "./generationPrice";

describe("explore generation price", () => {
  it("adds 10% or $1 on top of the Higgsfield rate, whichever is higher", () => {
    expect(estimateGenerationUsd(4, "480p")).toBe(2.28); // $1.272 + max($0.127, $1.00) = $2.272, rounded up to the cent
    expect(estimateGenerationUsd(10, "720p")).toBe(7.81); // $6.81 + $1.00 (10% is only $0.68)
    expect(estimateGenerationUsd(10, "1080p")).toBe(17.96); // $16.32 + 10% ($1.632) = $17.952
  });
  it("never takes less than $1 or 10% of the provider cost", () => {
    for (const resolution of ["480p", "720p", "1080p"] as const) for (const seconds of [4, 8, 15, 30]) {
      const provider = seconds * { "480p": 0.318, "720p": 0.681, "1080p": 1.632 }[resolution];
      const price = estimateGenerationUsd(seconds, resolution)!;
      expect(price - provider).toBeGreaterThanOrEqual(Math.max(provider * 0.1, 1) - 0.011);
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
