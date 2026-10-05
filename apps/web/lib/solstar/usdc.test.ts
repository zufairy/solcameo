import { expect, it } from "vitest";
import { formatUsdcEstimate, activityInUsdc, formatUsdEstimate, activityInUsd } from "./usdc";
it("converts lamports with the SOL/USDC rate instead of relabeling SOL", () => {
  expect(formatUsdcEstimate("2000000000", 120)).toBe("240");
  expect(formatUsdcEstimate("1000000000000", 120)).toBe("120K");
  expect(formatUsdcEstimate("0", 120)).toBe("0");
});
it("shows unavailable rather than inventing a price", () => {
  expect(formatUsdcEstimate("1000000000", null)).toBe("—");
  expect(formatUsdcEstimate("invalid", 120)).toBe("—");
});

it("converts activity amounts without modifying coin tickers", () => {
  expect(activityInUsdc("Bought 2 SOL of $SPARK", 120)).toBe("Bought 240 USDC of $SPARK");
  expect(activityInUsdc("Bought 2 SOL", null)).toBe("Bought — USDC");
  expect(formatUsdcEstimate("1", 120)).toBe("<0.01");
});

it("uses dollars consistently, including negative positions and ticker amounts", () => {
  expect(formatUsdEstimate("1000000000", 120)).toBe("$120");
  expect(formatUsdEstimate("-1000000000", 120)).toBe("−$120");
  expect(activityInUsd("Bought 2 SOL of $ALO", 120)).toBe("Bought $240 USD of $ALO");
});
