import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberBalance, takeRecentBalance } from "./balanceMemo";

afterEach(() => vi.useRealTimers());
describe("balanceMemo", () => {
  it("hands back a fresh balance once", () => {
    rememberBalance("W", 12.5);
    expect(takeRecentBalance("W")).toBe(12.5);
    expect(takeRecentBalance("W")).toBeNull();
  });
  it("never trusts an old read", () => {
    vi.useFakeTimers();
    rememberBalance("W", 3);
    vi.advanceTimersByTime(3500);
    expect(takeRecentBalance("W")).toBeNull();
  });
  it("is per wallet", () => {
    rememberBalance("A", 1);
    expect(takeRecentBalance("B")).toBeNull();
    expect(takeRecentBalance("A")).toBe(1);
  });
});
