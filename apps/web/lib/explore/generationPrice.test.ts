import { describe, expect, it } from "vitest";
import { estimateGenerationUsd } from "./generationPrice";

describe("explore generation price", () => {
  it("adds exactly 15% on top of the Higgsfield rate, rounded up to the cent", () => {
    expect(estimateGenerationUsd(4, "480p")).toBe(1.47); // $1.272 + $0.1908 = $1.4628
    expect(estimateGenerationUsd(10, "720p")).toBe(7.84); // $6.81 + $1.0215 = $7.8315
    expect(estimateGenerationUsd(10, "1080p")).toBe(18.77); // $16.32 + $2.448 = $18.768
  });
  it("takes the same 15% on every length and quality", () => {
    for (const resolution of ["480p", "720p", "1080p"] as const) for (const seconds of [4, 8, 15, 30]) {
      const provider = seconds * { "480p": 0.318, "720p": 0.681, "1080p": 1.632 }[resolution];
      const price = estimateGenerationUsd(seconds, resolution)!;
      expect(price / provider).toBeGreaterThanOrEqual(1.15 - 1e-9);
      expect(price / provider).toBeLessThan(1.15 + 0.01 / provider + 1e-9);
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
