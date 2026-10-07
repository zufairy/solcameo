import { describe, expect, it } from "vitest";
import { marketPath, marketSlug, tickerFromSegment } from "./marketSlug";

describe("marketSlug", () => {
  it("lowercases and drops the dollar sign", () => expect(marketSlug("$BUTTONS")).toBe("buttons"));
  it("runs spaces and symbols together", () => expect(marketSlug("HOOK PAD!")).toBe("hookpad"));
});
describe("marketPath", () => {
  it("uses the ticker", () => expect(marketPath({ characterId: "abc123", ticker: "BUTTONS" })).toBe("/market/buttons"));
  it("falls back to the id without a usable ticker", () => {
    expect(marketPath({ characterId: "abc123" })).toBe("/market/abc123");
    expect(marketPath({ characterId: "abc123", ticker: "$" })).toBe("/market/abc123");
  });
});
describe("tickerFromSegment", () => {
  it("accepts ticker-shaped segments only", () => {
    expect(tickerFromSegment("buttons")).toBe("BUTTONS");
    expect(tickerFromSegment("a")).toBeNull();
    expect(tickerFromSegment("sn73e77qrrvkdgxwdge9cbmsas8fs7qc")).toBeNull();
    expect(tickerFromSegment("yumelyn_vello")).toBeNull();
  });
});
