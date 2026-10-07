import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ auth: vi.fn(), settle: vi.fn() }));
vi.mock("@/lib/server/requireAuth", () => ({ requireInternalOrUserAuth: h.auth, requireOwnerWithSiws: () => null }));
vi.mock("@/lib/economy/settleAgent", () => ({ settleAgentEconomics: h.settle }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query() { return Promise.resolve({}); } } }));
import { POST } from "./route";

const call = (body: unknown) => POST(new NextRequest("http://x/api/economy/settle-agent", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { h.auth.mockReset(); h.settle.mockReset(); h.settle.mockResolvedValue({ status: "settled", amountUsdc: 0.66, txSignature: "SIG", tabUsdc: 0 }); });

describe("POST /api/economy/settle-agent", () => {
  it("sweeps the whole tab straight away for a server caller that asks for it", async () => {
    h.auth.mockResolvedValue({ internal: true });
    const res = await call({ mintAddress: "mint1", immediate: true });
    expect((await res.json()).status).toBe("settled");
    expect(h.settle).toHaveBeenCalledWith("mint1", { immediate: true });
  });
  it("ignores immediate from a browser caller, which keeps the normal threshold", async () => {
    h.auth.mockResolvedValue({ internal: false });
    await call({ mintAddress: "mint1", immediate: true });
    expect(h.settle).toHaveBeenCalledWith("mint1", { immediate: false });
  });
  it("rejects a request without a mint", async () => {
    h.auth.mockResolvedValue({ internal: true });
    expect((await call({})).status).toBe(400);
  });
});
