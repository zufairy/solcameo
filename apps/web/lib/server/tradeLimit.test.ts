import { describe, expect, it } from "vitest";
import { tradeAllowed } from "./tradeLimit";
import { boundedPrice, MAX_PRIORITY_LAMPORTS } from "./priorityFee";

describe("trade rate limit", () => {
  it("allows a burst up to the limit, then refuses, then recovers", () => {
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) expect(tradeAllowed("w1", "prepare", now + i)).toBe(true);
    expect(tradeAllowed("w1", "prepare", now + 30)).toBe(false);
    expect(tradeAllowed("w2", "prepare", now + 30)).toBe(true);
    expect(tradeAllowed("w1", "prepare", now + 61_000)).toBe(true);
  });
});

describe("priority fee bounds", () => {
  it("never lets a swap pay more than the lamport ceiling", () => {
    for (const units of [50_000, 200_000, 600_000]) {
      const price = boundedPrice(50_000_000, units);
      expect((price * units) / 1e6).toBeLessThanOrEqual(MAX_PRIORITY_LAMPORTS);
    }
    expect(boundedPrice(1, 200_000)).toBe(20_000);
    expect(boundedPrice(150_000, 200_000)).toBe(150_000);
  });
});
