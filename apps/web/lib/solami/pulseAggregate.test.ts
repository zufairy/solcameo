import { describe, expect, it } from "vitest";
import { createAggregator } from "./pulseAggregate";

const T0 = 1_700_000_000_000;
const swap = (o: Record<string, unknown> = {}) => ({ type: "swap", mint: "M1", side: "buy", trader: "w1", dex: "pumpswap", volume_usd: "100", price_usd: "0.5", signature: "s", block_time: T0 / 1000, ...o });

describe("pulse aggregator", () => {
  it("sums volume, trades and unique wallets across the window", () => {
    const a = createAggregator();
    a.ingest(swap(), T0); a.ingest(swap({ trader: "w2", side: "sell", volume_usd: "50" }), T0 + 61_000); a.ingest(swap({ trader: "w1" }), T0 + 62_000);
    const w = a.window(15, T0 + 62_000);
    expect(w.swaps).toBe(3); expect(w.volumeUsd).toBe(250); expect(w.uniqueWallets).toBe(2);
    expect(w.buyPressure).toBeCloseTo(2 / 3);
  });
  it("drops buckets older than the window", () => {
    const a = createAggregator();
    a.ingest(swap(), T0); a.ingest(swap(), T0 + 20 * 60_000);
    expect(a.window(15, T0 + 20 * 60_000).swaps).toBe(1);
  });
  it("tracks launches, pools and liquidity movement in both directions", () => {
    const a = createAggregator();
    a.ingest({ type: "token_create", mint: "N1", name: "Moon", symbol: "MOON", dex: "pumpfun", creator: "c", signature: "x", block_time: T0 / 1000 }, T0);
    a.ingest({ type: "pool_create" }, T0);
    a.ingest({ type: "liquidity", kind: "add", base_usd: "1000", quote_usd: "1500", base_mint: "N1", dex: "meteora_dlmm" }, T0);
    a.ingest({ type: "liquidity", kind: "remove", base_usd: "10", quote_usd: "20" }, T0);
    const w = a.window(15, T0);
    expect([w.launches, w.pools]).toEqual([1, 1]);
    expect(w.liquidityAddUsd).toBe(2500); expect(w.liquidityRemoveUsd).toBe(30);
    expect(a.feeds().launches[0]).toMatchObject({ symbol: "MOON", dex: "pumpfun" });
    expect(a.feeds().liquidity).toHaveLength(1);
  });
  it("ranks tokens by volume with per-token buy pressure and the latest price", () => {
    const a = createAggregator();
    a.ingest(swap({ mint: "A", volume_usd: "900", price_usd: "2" }), T0); a.ingest(swap({ mint: "A", side: "sell", volume_usd: "100", price_usd: "3" }), T0);
    a.ingest(swap({ mint: "B", volume_usd: "50" }), T0);
    const [top] = a.window(15, T0).topTokens;
    expect(top.mint).toBe("A"); expect(top.buyPressure).toBeCloseTo(0.9); expect(top.priceUsd).toBe(3);
  });
  it("keeps big swaps only and never stores the api-keyed image_url from metadata", () => {
    const a = createAggregator();
    a.ingest(swap({ volume_usd: "10" }), T0); a.ingest(swap({ volume_usd: "9000" }), T0);
    expect(a.feeds().bigSwaps).toHaveLength(1);
    a.ingest({ type: "metadata", mint: "M1", name: "Coin", symbol: "CN", image_url: "https://api.solami.dev/x?api_key=SECRET", logo_uri: "https://cdn/logo.png" }, T0);
    expect(JSON.stringify(a.metaFor("M1"))).not.toContain("SECRET");
    expect(a.metaFor("M1")?.logo).toBe("https://cdn/logo.png");
  });
  it("reports how stale the stream is from the newest block time", () => {
    const a = createAggregator();
    expect(a.lagSeconds(T0)).toBeNull();
    a.ingest(swap(), T0);
    expect(a.lagSeconds(T0 + 2500)).toBeCloseTo(2.5);
  });
});
