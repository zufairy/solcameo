import { describe, it, expect } from "vitest";
import { candlesFromPoints, deriveTerminal, parseUnits } from "./terminal";
import {
  PAPER_VIRTUAL_SOL,
  PAPER_VIRTUAL_TOKENS,
  quoteBuy,
  quoteSell,
} from "./economics";
describe("terminal market data", () => {
  it("derives holders, volume, ATH, and real price points from executed trades", () => {
    const now = 100000000;
    const buy = quoteBuy(
      { solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS },
      1000000000n,
    );
    const sell = quoteSell(buy.next, buy.amountOut);
    const stats = deriveTerminal(
      [
        {
          wallet: "a",
          side: "buy",
          amountIn: buy.amountIn,
          amountOut: buy.amountOut,
          createdAt: now - 2000,
        },
        {
          wallet: "a",
          side: "sell",
          amountIn: sell.amountIn,
          amountOut: sell.amountOut,
          createdAt: now - 1000,
        },
      ],
      now,
    );
    expect(stats.holders).toEqual([]);
    expect(stats.buyVolume).toBe("1000000000");
    expect(stats.sellVolume).toBe(sell.amountOut.toString());
    expect(stats.buys).toBe(1);
    expect(stats.sells).toBe(1);
    expect(stats.points).toHaveLength(2);
    expect(stats.ath).toBeGreaterThan(stats.points[1].price);
  });
  it("aggregates recorded points into OHLC without manufacturing empty candles", () => {
    expect(
      candlesFromPoints(
        [
          { time: 300000, price: 10 },
          { time: 310000, price: 15 },
          { time: 320000, price: 9 },
          { time: 330000, price: 12 },
          { time: 900000, price: 20 },
        ],
        5,
      ),
    ).toEqual([
      { time: 300, open: 10, high: 15, low: 9, close: 12 },
      { time: 900, open: 20, high: 20, low: 20, close: 20 },
    ]);
  });
  it("parses exact input units and rejects unsupported precision or non-positive amounts", () => {
    expect(parseUnits("0.123456789", 9)).toBe(123456789n);
    expect(parseUnits("1.000001", 6)).toBe(1000001n);
    for (const v of ["-1", "0", "1e3", "NaN", "1.0000001"])
      expect(parseUnits(v, 6)).toBeNull();
  });
});
