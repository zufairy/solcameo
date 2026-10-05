import { describe, expect, it } from "vitest";
import { shortWallet } from "./feed";

describe("shortWallet", () => {
  it("returns first 4 + ellipsis + last 4 for a 44-char wallet", () => {
    const w = "ABCD" + "m".repeat(36) + "wxyz";
    expect(w).toHaveLength(44);
    expect(shortWallet(w)).toBe("ABCD…wxyz");
  });
  it("returns short inputs unchanged", () => {
    expect(shortWallet("abcdefgh")).toBe("abcdefgh");
    expect(shortWallet("")).toBe("");
  });
});
