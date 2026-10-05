import { describe, expect, it } from "vitest";
import { MAX_SHORTS_DURATION_SECONDS, shortsEligibility } from "./verticalizeForShorts";

describe("YouTube Shorts eligibility", () => {
  it("accepts verified portrait and square clips", () => {
    expect(shortsEligibility(1080, 1920, 55)).toBe("ready");
    expect(shortsEligibility(1080, 1080, MAX_SHORTS_DURATION_SECONDS)).toBe("ready");
  });

  it("requires conversion for landscape clips", () => {
    expect(shortsEligibility(1920, 1080, 55)).toBe("verticalize");
  });

  it("rejects long and unprobeable clips instead of posting a normal video", () => {
    expect(shortsEligibility(1080, 1920, 181)).toBe("too_long");
    expect(shortsEligibility(0, 0, 55)).toBe("invalid");
    expect(shortsEligibility(1080, 1920, Number.NaN)).toBe("invalid");
  });
});
