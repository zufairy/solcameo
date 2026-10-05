import { describe, it, expect } from "vitest";
import { feeOf, splitFee, quoteBuy, quoteSell, PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS, MAX_AMOUNT } from "./economics";

const pool = { solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS };

describe("feeOf / splitFee", () => {
  it("125 bps of 1,000,000 lamports splits 2500/3000/5000/2000", () => {
    const fee = feeOf(1_000_000n);
    expect(fee).toBe(12_500n);
    expect(splitFee(fee)).toEqual({ total: 12_500n, protocol: 2_500n, creator: 3_000n, ops: 5_000n, content: 2_000n });
  });
  it("shares always sum to the total, for awkward values", () => {
    for (const f of [0n, 1n, 2n, 3n, 6n, 7n, 13n, 99n, 12_501n, 999_999_999_999n]) {
      const s = splitFee(f);
      expect(s.protocol + s.creator + s.ops + s.content).toBe(f);
      expect(s.total).toBe(f);
    }
  });
  it("rejects negatives", () => {
    expect(() => splitFee(-1n)).toThrow();
    expect(() => feeOf(-1n)).toThrow();
  });
});

describe("quoteBuy", () => {
  it("charges fee on input, keeps k non-decreasing", () => {
    const q = quoteBuy(pool, 1_000_000_000n);
    expect(q.fee).toBe(feeOf(1_000_000_000n));
    expect(q.amountOut > 0n).toBe(true);
    expect(q.next.solReserve).toBe(pool.solReserve + 1_000_000_000n - q.fee);
    expect(q.next.tokenReserve).toBe(pool.tokenReserve - q.amountOut);
    expect(q.next.solReserve * q.next.tokenReserve >= pool.solReserve * pool.tokenReserve).toBe(true);
  });
  it("rejects zero, negative, oversized and dust (zero output)", () => {
    expect(() => quoteBuy(pool, 0n)).toThrow();
    expect(() => quoteBuy(pool, -5n)).toThrow();
    expect(() => quoteBuy(pool, MAX_AMOUNT + 1n)).toThrow();
    expect(() => quoteBuy(pool, 1n)).toThrow(/dust|zero/i);
  });
});

describe("quoteSell", () => {
  it("round trip never returns more than was paid in", () => {
    const buy = quoteBuy(pool, 1_000_000_000n);
    const sell = quoteSell(buy.next, buy.amountOut);
    expect(sell.amountOut < 1_000_000_000n).toBe(true);
    expect(sell.fee).toBe(feeOf(sell.amountOut + sell.fee));
  });
  it("rejects zero and oversized", () => {
    expect(() => quoteSell(pool, 0n)).toThrow();
    expect(() => quoteSell(pool, MAX_AMOUNT + 1n)).toThrow();
  });
});
