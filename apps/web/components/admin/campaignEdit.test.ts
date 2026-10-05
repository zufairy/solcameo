import { describe, it, expect } from "vitest";
import { campaignIsFunded, deadlineToDateInput, dateInputToDeadline } from "./campaignEdit";

describe("campaignIsFunded (on-chain funded-vault predicate)", () => {
  it("is true only with a pdaAddress AND onchainVersion >= 2", () => {
    expect(campaignIsFunded({ pdaAddress: "PdA1", onchainVersion: 2 })).toBe(true);
    expect(campaignIsFunded({ pdaAddress: "PdA1", onchainVersion: 3 })).toBe(true);
  });
  it("is false when there is no PDA (unfunded, even if version claims 2)", () => {
    expect(campaignIsFunded({ pdaAddress: null, onchainVersion: 2 })).toBe(false);
    expect(campaignIsFunded({ pdaAddress: "", onchainVersion: 2 })).toBe(false);
    expect(campaignIsFunded({ onchainVersion: 2 })).toBe(false);
  });
  it("is false on the legacy v1 rail (defaults to 1 when version is missing)", () => {
    expect(campaignIsFunded({ pdaAddress: "PdA1", onchainVersion: 1 })).toBe(false);
    expect(campaignIsFunded({ pdaAddress: "PdA1" })).toBe(false);
    expect(campaignIsFunded({ pdaAddress: "PdA1", onchainVersion: null })).toBe(false);
  });
});

describe("deadlineToDateInput (stored deadline → date-input value)", () => {
  it("formats a full ISO timestamp as YYYY-MM-DD", () => {
    expect(deadlineToDateInput("2026-07-12T00:00:00.000Z")).toBe("2026-07-12");
    expect(deadlineToDateInput("2026-07-12T23:59:00.000Z")).toBe("2026-07-12");
  });
  it("passes a plain date through", () => {
    expect(deadlineToDateInput("2026-07-12")).toBe("2026-07-12");
  });
  it("returns '' for empty/unparseable input", () => {
    expect(deadlineToDateInput("")).toBe("");
    expect(deadlineToDateInput(null)).toBe("");
    expect(deadlineToDateInput(undefined)).toBe("");
    expect(deadlineToDateInput("not a date")).toBe("");
  });
});

describe("dateInputToDeadline (date-input value → stored ISO)", () => {
  it("round-trips a plain date to a canonical ISO string", () => {
    expect(dateInputToDeadline("2026-07-12")).toBe("2026-07-12T00:00:00.000Z");
  });
  it("returns null for empty/unparseable input (caller skips the patch)", () => {
    expect(dateInputToDeadline("")).toBeNull();
    expect(dateInputToDeadline("nope")).toBeNull();
  });
  it("is stable across the date-input round-trip", () => {
    const stored = "2026-07-12T00:00:00.000Z";
    expect(deadlineToDateInput(stored)).toBe("2026-07-12");
    expect(dateInputToDeadline(deadlineToDateInput(stored))).toBe(stored);
  });
});
