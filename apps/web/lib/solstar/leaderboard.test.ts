import { describe, expect, it } from "vitest";
import { rankTraders, periodStart, type RpcTrade } from "./leaderboard";
const trade = (signature: string, side: "buy" | "sell", units: number, sol: number, time = 100): RpcTrade => ({ signature, wallet: "buyer", mint: "coin", side, units, sol, time, networkFeeSol: 0.01 });
describe("RPC trader cost basis", () => {
  it("counts an existing purchase and marks its open position without treating its cost as profit", () => {
    expect(rankTraders([trade("buy", "buy", 100, 1)], new Map([["coin", 0.012]]), 0, true)[0]).toMatchObject({ wallet: "buyer", trades: 1, realizedSol: 0, complete: true });
    expect(rankTraders([trade("buy", "buy", 100, 1)], new Map([["coin", 0.012]]), 0, true)[0].pnlSol).toBeCloseTo(0.19);
  });
  it("accounts for fees and FIFO basis when partially and fully selling", () => {
    const rows = [trade("b", "buy", 100, 1), trade("s", "sell", 50, 0.7, 200)];
    const result = rankTraders(rows, new Map([["coin", 0.012]]), 0, true)[0];
    expect(result.realizedSol).toBeCloseTo(0.185);
    expect(result.unrealizedSol).toBeCloseTo(0.095);
    expect(result.pnlSol).toBeCloseTo(0.28);
    expect(rankTraders([...rows, trade("s2", "sell", 50, 0.4, 300)], new Map(), 0, true)[0].pnlSol).toBeCloseTo(0.07);
  });
  it("uses purchases before the selected period as the basis for sales in it", () => {
    const result = rankTraders([trade("b", "buy", 100, 1), trade("s", "sell", 100, 1.4, 200)], new Map(), 150, true)[0];
    expect(result.trades).toBe(1);
    expect(result.pnlSol).toBeCloseTo(0.38);
  });
  it("does not fabricate cost basis when a buy is missing, a price is missing, or history is capped", () => {
    expect(rankTraders([trade("s", "sell", 100, 1)], new Map(), 0, true)[0].pnlSol).toBeNull();
    expect(rankTraders([trade("b", "buy", 100, 1)], new Map(), 0, true)[0].pnlSol).toBeNull();
    expect(rankTraders([trade("b", "buy", 100, 1)], new Map([["coin", 0.01]]), 0, false)[0].pnlSol).toBeNull();
  });
  it("deduplicates confirmed signatures and retains losses", () => {
    const b = trade("b", "buy", 100, 1);
    const result = rankTraders([b, b], new Map([["coin", 0.005]]), 0, true)[0];
    expect(result.trades).toBe(1);
    expect(result.pnlSol).toBeCloseTo(-0.51);
  });
  it("filters all four periods", () => {
    expect(periodStart("all", 5000000000)).toBe(0);
    expect(periodStart("24h", 5000000000)).toBe(5000000000 - 86400000);
    expect(periodStart("7d", 5000000000)).toBe(5000000000 - 7 * 86400000);
    expect(periodStart("30d", 5000000000)).toBe(5000000000 - 30 * 86400000);
  });
});

describe("realized tournament ranking", () => {
  it("excludes buyers without sales and ignores unrealized price gains", () => {
    const trades = [trade("b", "buy", 100, 1), trade("s", "sell", 50, 0.7, 200), { ...trade("other", "buy", 100, 1), wallet: "holder" }];
    const rows = rankTraders(trades, new Map([["coin", 100]]), 0, true, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wallet: "buyer", closedTrades: 1, unrealizedSol: 0, complete: true });
    expect(rows[0].pnlSol).toBeCloseTo(0.185);
  });
  it("can rank sold quantities without a spot quote, using historical purchase costs", () => {
    const row = rankTraders([trade("b", "buy", 100, 1), trade("s", "sell", 50, 0.7, 200)], new Map(), 150, true, true)[0];
    expect(row.pnlSol).toBeCloseTo(0.185);
    expect(row.closedTrades).toBe(1);
  });
  it("keeps losses and refuses missing or incomplete cost basis", () => {
    expect(rankTraders([trade("s", "sell", 100, 1)], new Map(), 0, true, true)[0].pnlSol).toBeNull();
    const rows = [trade("b", "buy", 100, 1), trade("s", "sell", 100, 0.5, 200)];
    expect(rankTraders(rows, new Map(), 0, true, true)[0].pnlSol).toBeCloseTo(-0.52);
    expect(rankTraders(rows, new Map(), 0, false, true)[0].pnlSol).toBeNull();
  });
});
