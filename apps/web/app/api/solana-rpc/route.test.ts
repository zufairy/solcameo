import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const h = vi.hoisted(() => ({ forward: vi.fn(), endpoints: vi.fn() }));
vi.mock("@/lib/solana/network", () => ({ getNetwork: () => "mainnet-beta", getRpcCandidates: () => ["https://quicknode.private/test/"] }));
vi.mock("@/lib/solana/failoverConnection", () => ({ failoverFetch: h.endpoints }));
import { POST } from "./route";
const request = (body: unknown, origin = "https://solcameo.com") => new NextRequest("https://solcameo.com/api/solana-rpc", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); h.endpoints.mockReturnValue(h.forward); h.forward.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 123 }), { status: 200 })); });
it("relays allowed reads through the private provider without exposing its address", async () => {
  const response = await POST(request({ jsonrpc: "2.0", id: 1, method: "getBalance", params: ["wallet"] }));
  expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: 123 });
  expect(h.endpoints).toHaveBeenCalledWith(["https://quicknode.private/test/"], 3000);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rejects methods outside the market RPC allowlist", async () => {
  expect((await POST(request({ jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [] }))).status).toBe(400);
  expect(h.forward).not.toHaveBeenCalled();
});
it("rejects another site's browser requests", async () => {
  expect((await POST(request({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [] }, "https://other.example"))).status).toBe(403);
  expect(h.forward).not.toHaveBeenCalled();
});
