import { describe, expect, it } from "vitest";
import { positionFromTrades } from "./position";
import type { RpcTrade } from "./leaderboard";

const t = (signature: string, side: "buy" | "sell", units: number, sol: number, time: number, fee = 0): RpcTrade => ({ signature, wallet: "w", mint: "m", side, units, sol, networkFeeSol: fee, time });
const D = 6, U = 10 ** D;

describe("positionFromTrades", () => {
  it("tracks entry, value and unrealized PnL for an open position", () => {
    const p = positionFromTrades([t("a", "buy", 100 * U, 1, 1, 0.001)], 0.02 / U, D);
    expect(p.tokens).toBe(100);
    expect(p.costBasisSol).toBeCloseTo(1.001);
    expect(p.avgEntrySol).toBeCloseTo(0.01001);
    expect(p.valueSol).toBeCloseTo(2);
    expect(p.unrealizedSol).toBeCloseTo(0.999);
    expect(p.roiPct).toBeCloseTo(99.8, 0);
    expect(p.complete).toBe(true);
  });
  it("books realized PnL FIFO on a partial sell and keeps the remaining basis", () => {
    const p = positionFromTrades([t("a", "buy", 100 * U, 1, 1), t("b", "buy", 100 * U, 3, 2), t("c", "sell", 150 * U, 3, 3)], 0.03 / U, D);
    expect(p.tokens).toBeCloseTo(50);
    expect(p.realizedSol).toBeCloseTo(3 - (1 + 1.5));
    expect(p.costBasisSol).toBeCloseTo(1.5);
    expect(p.avgEntrySol).toBeCloseTo(0.03);
  });
  it("closes out cleanly and reports total return", () => {
    const p = positionFromTrades([t("a", "buy", 10 * U, 1, 1), t("b", "sell", 10 * U, 1.5, 2)], 0.05 / U, D);
    expect(p.tokens).toBe(0);
    expect(p.avgEntrySol).toBeNull();
    expect(p.pnlSol).toBeCloseTo(0.5);
    expect(p.roiPct).toBeCloseTo(50);
  });
  it("flags an untrusted basis when a sell has no matching buy", () => {
    expect(positionFromTrades([t("a", "sell", 5 * U, 1, 1)], 0.01 / U, D).complete).toBe(false);
  });
  it("ignores duplicate signatures and bad rows", () => {
    const p = positionFromTrades([t("a", "buy", 10 * U, 1, 1), t("a", "buy", 10 * U, 1, 1), t("x", "buy", 0, 1, 2)], 0.1 / U, D);
    expect(p.tokens).toBe(10);
    expect(p.trades).toHaveLength(1);
  });
});
