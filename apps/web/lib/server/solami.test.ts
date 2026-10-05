// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSolamiReport } from "./solami";
const mint = "So11111111111111111111111111111111111111112";
const w = { trades: 3, buys: 2, sells: 1, traders: 2, volume_usd: "12.50", fees_usd: "0.02", open: "1", close: "1.1", high: "1.2", low: "1", price_change_pct: "10" };
const trade = { signature: "evidence", slot: 123, block_time: Math.floor(Date.now()/1000), dex: "pumpswap", pool: mint, side: "buy", trader: mint, price_usd: "1.1", volume_usd: "2" };
function provider(stats: unknown = { mint, primary_pool: mint, windows: { "300": w, "3600": w, "86400": w } }, trades: unknown = [trade]) {
  return vi.fn(async (url: URL | RequestInfo) => Response.json(String(url).includes("/stats?") ? stats : trades)) as unknown as typeof fetch;
}
afterEach(() => vi.unstubAllEnvs());
describe("Solami live reports", () => {
  it("uses authenticated real Solami paths, preserves decimal strings and source evidence", async () => {
    vi.stubEnv("SOLAMI_API_KEY", "test-key");
    const f = provider(); const report = await buildSolamiReport(mint, f);
    expect(report.windows["86400"].volume_usd).toBe("12.50");
    expect(report.windows["300"].buyShare).toBeCloseTo(2/3);
    expect(report.evidence[0].signature).toBe("evidence");
    const calls = vi.mocked(f).mock.calls;
    expect(String(calls[0][0])).toContain("https://api.solami.dev/data/token/stats?chain=solana&address=");
    expect(calls[0][1]?.headers).toEqual({ "x-api-key": "test-key" });
    expect(calls[0][1]?.redirect).toBe("error");
  });
  it("blocks missing credentials without contacting Solami", async () => {
    vi.stubEnv("SOLAMI_API_KEY", ""); const f = provider();
    await expect(buildSolamiReport(mint, f)).rejects.toThrow("SOLAMI_API_KEY"); expect(f).not.toHaveBeenCalled();
  });
  it("blocks stale data rather than selling a fabricated live report", async () => {
    vi.stubEnv("SOLAMI_API_KEY", "key");
    await expect(buildSolamiReport(mint, provider(undefined, [{...trade, block_time: 1}]))).rejects.toThrow("stale");
  });
  it("blocks missing windows and mismatched mint", async () => {
    vi.stubEnv("SOLAMI_API_KEY", "key");
    await expect(buildSolamiReport(mint, provider({ mint: "other", primary_pool: mint, windows: { "300": w } }))).rejects.toThrow("mismatched");
  });
  it("rejects nonfinite/malformed metric values and API failures", async () => {
    vi.stubEnv("SOLAMI_API_KEY", "key");
    await expect(buildSolamiReport(mint, provider({mint, primary_pool: mint, windows: {"300": {...w, volume_usd: "NaN"}}}))).rejects.toThrow();
    await expect(buildSolamiReport(mint, vi.fn(async () => new Response("denied", {status:403})) as typeof fetch)).rejects.toThrow("403");
  });
});
