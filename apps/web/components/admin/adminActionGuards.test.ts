import { describe, it, expect } from "vitest";
import { confirmMatches, parseAmount } from "./adminActionGuards";

describe("confirmMatches (type-to-confirm delete gate)", () => {
  it("matches exact text", () => {
    expect(confirmMatches("Nova", "Nova")).toBe(true);
  });
  it("is case-insensitive and trims whitespace", () => {
    expect(confirmMatches("  nova ", "Nova")).toBe(true);
    expect(confirmMatches("NOVA", "nova")).toBe(true);
  });
  it("rejects a mismatch", () => {
    expect(confirmMatches("Novaa", "Nova")).toBe(false);
    expect(confirmMatches("Nov", "Nova")).toBe(false);
  });
  it("never matches on empty input or empty target (button stays disarmed)", () => {
    expect(confirmMatches("", "Nova")).toBe(false);
    expect(confirmMatches("   ", "Nova")).toBe(false);
    expect(confirmMatches("Nova", "")).toBe(false);
    expect(confirmMatches("", "")).toBe(false);
  });
});

describe("parseAmount (money-move amount validator)", () => {
  it("accepts a positive number and rounds to cents", () => {
    expect(parseAmount("50")).toEqual({ valid: true, amount: 50 });
    expect(parseAmount("12.999")).toEqual({ valid: true, amount: 13 });
    expect(parseAmount("  7.5 ")).toEqual({ valid: true, amount: 7.5 });
  });
  it("rejects zero, negatives, and non-numbers", () => {
    expect(parseAmount("0")).toEqual({ valid: false, amount: 0 });
    expect(parseAmount("-10")).toEqual({ valid: false, amount: 0 });
    expect(parseAmount("")).toEqual({ valid: false, amount: 0 });
    expect(parseAmount("abc")).toEqual({ valid: false, amount: 0 });
  });
  it("rejects non-finite input", () => {
    expect(parseAmount("Infinity")).toEqual({ valid: false, amount: 0 });
    expect(parseAmount("NaN")).toEqual({ valid: false, amount: 0 });
  });
});
