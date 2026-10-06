import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ prep: vi.fn(), mutation: vi.fn(), trades: vi.fn() }));
vi.mock("@/lib/server/solstarRoute", () => ({ prepareAuthedJson: mocks.prep, convexClient: () => ({ mutation: mocks.mutation }), isConvexIdString: (v: unknown) => typeof v === "string" && !!v, errorResponse: () => NextResponse.json({ error: "failed" }, { status: 400 }) }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarFeed: { postChat: "postChat" } } }));
vi.mock("@/lib/server/calloutTrades", () => ({ loadCalloutTrades: mocks.trades }));
import { POST } from "./route";
const trade = { wallet: "proven-wallet", mint: "M".repeat(40), signature: "1".repeat(88), ticker: "COIN", name: "Coin", imageUrl: "/x", side: "buy", amountSol: 1, time: 1, pnlSol: 0.05, realizedSol: 0, unrealizedSol: 0.05, network: "devnet" };
const oldBase = process.env.R2_PUBLIC_BASE_URL;
beforeEach(() => { vi.clearAllMocks(); process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com"; mocks.mutation.mockResolvedValue({ ok: true }); mocks.trades.mockResolvedValue({ coins: [trade], errors: [] }); });
afterEach(() => { if (oldBase === undefined) delete process.env.R2_PUBLIC_BASE_URL; else process.env.R2_PUBLIC_BASE_URL = oldBase; });
async function post(url: string) {
  mocks.prep.mockResolvedValue({ ok: true, wallet: "proven-wallet", secret: "server-secret", body: { body: "Trade", calloutMetric: "trade", tradeMint: trade.mint, attachments: [{ url, type: "gif", alt: "Reaction" }] } });
  return POST(new NextRequest("http://localhost/api/solstar/feed", { method: "POST" }));
}
describe("callout attachment posting", () => {
  it("accepts hosted callout media and GIPHY, using the authenticated wallet", async () => {
    for (const url of ["https://cdn.example.com/callouts/a.gif", "https://media2.giphy.com/media/a/giphy.gif"]) {
      expect((await post(url)).status).toBe(200);
      expect(mocks.mutation).toHaveBeenLastCalledWith("postChat", expect.objectContaining({ wallet: "proven-wallet", attachments: [{ url, type: "gif", alt: "Reaction" }] }));
    }
  });
  it("rejects user-supplied P&L and requires a verified trade from the signed wallet", async () => {
    mocks.prep.mockResolvedValue({ ok: true, wallet: "proven-wallet", secret: "server-secret", body: { body: "Trade", calloutMetric: "trade", tradeMint: trade.mint, tradePnlUsd: 999 } });
    expect((await POST(new NextRequest("http://localhost/api/solstar/feed", { method: "POST" }))).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
    mocks.trades.mockResolvedValue({ coins: [] });
    expect((await post("https://media.giphy.com/media/a/giphy.gif")).status).toBe(422);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("refreshes the selected coin server-side and stores the computed snapshot", async () => {
    await post("https://media.giphy.com/media/a/giphy.gif");
    expect(mocks.trades).toHaveBeenCalledWith("proven-wallet", trade.mint, true);
    expect(mocks.mutation).toHaveBeenCalledWith("postChat", expect.objectContaining({ onchainTrade: trade }));
  });
  it("rejects arbitrary hosts, spoofed GIPHY domains and other storage namespaces", async () => {
    for (const url of ["https://example.com/a.gif", "https://media.giphy.com.evil.test/a.gif", "https://cdn.example.com/editor/a.gif", "javascript:alert(1)"]) expect((await post(url)).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
