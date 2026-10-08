import { expect, it } from "vitest";
import { fundingReadiness } from "./fundingReadiness";
it("is ready when USDC covers the price", () => expect(fundingReadiness({ priceUsd: 1, usdc: 2, sol: 0, solUsd: 150 })).toEqual({ state: "ready" }));
it("swaps SOL for the shortfall when USDC is short", () => {
  const r = fundingReadiness({ priceUsd: 1, usdc: 0, sol: 0.1, solUsd: 150 });
  expect(r.state).toBe("swap");
  if (r.state === "swap") expect(r.usd).toBeCloseTo(1.05, 5);
});
it("keeps the SOL reserve, so a tiny balance is short", () => expect(fundingReadiness({ priceUsd: 1, usdc: 0, sol: 0.005, solUsd: 150 })).toMatchObject({ state: "short" }));
it("reports what is missing when SOL only covers part", () => {
  const r = fundingReadiness({ priceUsd: 2, usdc: 0, sol: 0.0083, solUsd: 150 });
  expect(r.state).toBe("short");
});
it("is short without a SOL price", () => expect(fundingReadiness({ priceUsd: 1, usdc: 0, sol: 5, solUsd: null }).state).toBe("short"));
