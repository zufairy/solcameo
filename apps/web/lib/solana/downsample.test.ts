import { describe, expect, it } from "vitest";
import { downsample } from "./downsample";

describe("downsample", () => {
  it("returns short lists untouched", () => expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]));
  it("caps length and keeps first and last", () => {
    const out = downsample(Array.from({ length: 1000 }, (_, i) => i), 32);
    expect(out).toHaveLength(32);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(999);
  });
});
