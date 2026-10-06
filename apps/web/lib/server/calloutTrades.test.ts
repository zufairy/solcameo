import { describe, it, expect } from "vitest";
import { verifiedPosition } from "./calloutTrades";
import type { RpcTrade } from "@/lib/solstar/leaderboard";
const buy: RpcTrade = { wallet: "W", mint: "M", signature: "buy", side: "buy", units: 100, sol: 1, networkFeeSol: 0.01, time: 1 };
const sell: RpcTrade = { ...buy, signature: "sell", side: "sell", units: 40, sol: 0.8, networkFeeSol: 0.01, time: 2 };
describe("verified callout positions", () => {
  it("selects the latest trade and computes realised plus open P&L with fees", () => {
    const p = verifiedPosition([sell, buy], "W", "M", 0.02, true, 60)!;
    expect(p.latest.signature).toBe("sell");
    expect(p.realizedSol).toBeCloseTo(0.386);
    expect(p.unrealizedSol).toBeCloseTo(0.594);
    expect(p.pnlSol).toBeCloseTo(0.98);
  });
  it("rejects unknown cost basis, mismatched holdings and incomplete history", () => {
    expect(verifiedPosition([sell], "W", "M", 0.02, true, 0)).toBeNull();
    expect(verifiedPosition([buy], "W", "M", 0.02, false, 100)).toBeNull();
    expect(verifiedPosition([buy], "W", "M", 0.02, true, 200)).toBeNull();
    expect(verifiedPosition([buy], "OTHER", "M", 0.02, true, 0)).toBeNull();
  });
  it("deduplicates transactions and identifies buy P&L as an open position", () => {
    const p = verifiedPosition([buy, buy], "W", "M", 0.02, true, 100)!;
    expect(p.realizedSol).toBe(0);
    expect(p.unrealizedSol).toBeCloseTo(0.99);
  });
});
