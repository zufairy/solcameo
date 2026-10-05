import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relativeTime";

const NOW = 1_000_000_000;
describe("formatRelativeTime", () => {
  it("buckets", () => {
    expect(formatRelativeTime(NOW, NOW - 2_000)).toBe("just now");
    expect(formatRelativeTime(NOW, NOW - 12_000)).toBe("12s ago");
    expect(formatRelativeTime(NOW, NOW - 180_000)).toBe("3m ago");
    expect(formatRelativeTime(NOW, NOW - 2 * 3_600_000)).toBe("2h ago");
    expect(formatRelativeTime(NOW, NOW - 5 * 86_400_000)).toBe("5d ago");
  });
  it("boundaries", () => {
    expect(formatRelativeTime(NOW, NOW - 4_999)).toBe("just now");
    expect(formatRelativeTime(NOW, NOW - 5_000)).toBe("5s ago");
    expect(formatRelativeTime(NOW, NOW - 59_999)).toBe("59s ago");
    expect(formatRelativeTime(NOW, NOW - 60_000)).toBe("1m ago");
    expect(formatRelativeTime(NOW, NOW - 59 * 60_000)).toBe("59m ago");
    expect(formatRelativeTime(NOW, NOW - 60 * 60_000)).toBe("1h ago");
    expect(formatRelativeTime(NOW, NOW - 24 * 3_600_000)).toBe("1d ago");
  });
  it("is safe for future and NaN", () => {
    expect(formatRelativeTime(NOW, NOW + 60_000)).toBe("just now");
    expect(formatRelativeTime(NaN, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW, NaN)).toBe("just now");
  });
});
