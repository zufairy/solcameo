// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
it("retries a Helius 429 on the same endpoint instead of sending to public RPC", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "1" } })).mockResolvedValueOnce(Response.json({ result: 10 }));
  vi.stubGlobal("fetch", fetcher);
  const { marketRpcFetch } = await import("./marketRpcFetch");
  const work = marketRpcFetch("https://mainnet.helius-rpc.com/?api-key=test", { method: "POST" });
  await vi.runAllTimersAsync();
  expect((await work).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(c => String(c[0]).includes("helius-rpc.com"))).toBe(true);
});
it("paces concurrent calls rather than bursting them at the RPC", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ result: 10 }));
  vi.stubGlobal("fetch", fetcher);
  const { marketRpcFetch } = await import("./marketRpcFetch");
  const first = marketRpcFetch("https://mainnet.helius-rpc.com/");
  const second = marketRpcFetch("https://mainnet.helius-rpc.com/");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.runAllTimersAsync(); await Promise.all([first, second]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
