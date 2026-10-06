import { describe, expect, it } from "vitest";
import { withCastKey } from "./castKey";

describe("withCastKey", () => {
  it("binds every mention to its image, in order", () => {
    const out = withCastKey("Replace the dancer with @Luna and @Kai.", ["Luna", "Kai"], 2);
    expect(out).toContain("@Luna = image 1, @Kai = image 2");
  });
  it("does not stack the key when re-applied", () => {
    const once = withCastKey("Replace the dancer with @Luna.", ["Luna"], 1);
    expect(withCastKey(once, ["Luna"], 1).match(/Cast images/g)).toHaveLength(1);
  });
  it("leaves the prompt alone without tokens", () => {
    expect(withCastKey("hello", undefined, 1)).toBe("hello");
  });
});
