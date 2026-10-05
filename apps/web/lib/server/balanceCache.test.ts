// @vitest-environment node
import { describe, it, expect } from "vitest";
import { splitByFreshness } from "./balanceCache";

// The market page polls /api/agent-wallet-balances on an interval, and every open
// tab hits the same throttled Solana RPC. splitByFreshness lets the route serve
// recently-fetched balances from an in-memory cache and re-fetch only the STALE
// wallets — collapsing N polls of the same agent set into ~one RPC round-trip per TTL.
describe("splitByFreshness — serve cached balances, re-fetch only stale", () => {
  const mk = (usdc: number, sol: number, at: number) => ({ usdc, sol, at });

  it("returns a wallet with a FRESH entry as fresh (not re-fetched)", () => {
    const cache = new Map([["A", mk(5, 1, 1000)]]);
    const { fresh, stale } = splitByFreshness(["A"], cache, 1000 + 5_000, 20_000);
    expect(fresh).toEqual({ A: { usdc: 5, sol: 1 } });
    expect(stale).toEqual([]);
  });

  it("marks an EXPIRED entry stale (age ≥ TTL)", () => {
    const cache = new Map([["A", mk(5, 1, 1000)]]);
    const { fresh, stale } = splitByFreshness(["A"], cache, 1000 + 25_000, 20_000);
    expect(fresh).toEqual({});
    expect(stale).toEqual(["A"]);
  });

  it("marks an UNCACHED wallet stale, keeps the cached one fresh", () => {
    const cache = new Map([["A", mk(5, 1, 1000)]]);
    const { fresh, stale } = splitByFreshness(["A", "B"], cache, 1000 + 1_000, 20_000);
    expect(fresh).toEqual({ A: { usdc: 5, sol: 1 } });
    expect(stale).toEqual(["B"]);
  });

  it("empty wallet list → empty fresh + stale", () => {
    const { fresh, stale } = splitByFreshness([], new Map(), 0, 20_000);
    expect(fresh).toEqual({});
    expect(stale).toEqual([]);
  });
});
