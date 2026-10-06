import { describe, expect, it } from "vitest";
import { estimateGenerationUsd } from "./generationPrice";

describe("explore generation price", () => {
  it("is the Higgsfield rate plus 10% with no flat fee", () => {
    expect(estimateGenerationUsd(10, "720p")).toBe(7.5); // 10s x $0.681 = $6.81, +10% = $7.491, rounded up to the cent
    expect(estimateGenerationUsd(4, "480p")).toBe(1.4);
  });
  it("rounds the duration up to whole seconds", () => {
    expect(estimateGenerationUsd(9.2, "720p")).toBe(estimateGenerationUsd(10, "720p"));
  });
  it("rejects references outside 4 to 30 seconds", () => {
    expect(estimateGenerationUsd(3.9, "720p")).toBeNull();
    expect(estimateGenerationUsd(31, "720p")).toBeNull();
  });
});
