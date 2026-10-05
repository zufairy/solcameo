// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(), query: vi.fn(), requireAuth: vi.fn(), proven: vi.fn(), siws: vi.fn(),
}));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarTrade: { paperTrade: "paperTrade" } } }));
vi.mock("@/lib/server/requireAuth", () => ({
  requireAuth: mocks.requireAuth,
  getProvenWalletFromRequest: mocks.proven,
  siwsRequiredResponse: mocks.siws,
}));

const PROVEN = "ProvenWallet1111111111111111111111111111111";
const valid = { tokenId: "abc123", side: "buy", amount: "1000000", minOut: "5", quoteExpiresAt: 1_900_000_000_000, idempotencyKey: "key-12345678" };
const post = (body: unknown) =>
  new NextRequest("https://x/api/solstar/trade", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("INTERNAL_CRON_SECRET", "test-secret");
  mocks.mutation.mockReset().mockResolvedValue({ ok: true });
  mocks.requireAuth.mockReset().mockResolvedValue({ user: { id: "u" }, token: "t" });
  mocks.proven.mockReset().mockReturnValue(PROVEN);
  mocks.siws.mockReset().mockImplementation(() => NextResponse.json({ error: "siws_required" }, { status: 403 }));
});
afterEach(() => { vi.unstubAllEnvs(); });

const run = async (body: unknown) => (await import("./route")).POST(post(body));

describe("POST /api/solstar/trade", () => {
  it("auth failure -> 401, Convex untouched", async () => {
    mocks.requireAuth.mockResolvedValue({ error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await run(valid)).status).toBe(401);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("missing SIWS proof -> siwsRequiredResponse status, Convex untouched", async () => {
    mocks.proven.mockReturnValue(undefined);
    expect((await run(valid)).status).toBe(403);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("valid body calls the mutation with proven wallet, bigint amounts, internal secret", async () => {
    const res = await run(valid);
    expect(res.status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.mutation).toHaveBeenCalledWith("paperTrade", {
      tokenId: "abc123", wallet: PROVEN, side: "buy", amount: 1000000n, minOut: 5n,
      quoteExpiresAt: 1_900_000_000_000, idempotencyKey: "key-12345678", authSecret: process.env.INTERNAL_CRON_SECRET,
    });
  });
  it("returns JSON even when the mutation result holds bigint", async () => {
    mocks.mutation.mockResolvedValue({ amountOut: 5n });
    const res = await run(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ amountOut: "5" });
  });
  it("ignores a wallet supplied in the body", async () => {
    await run({ ...valid, wallet: "attacker" });
    expect(mocks.mutation.mock.calls[0][1].wallet).toBe(PROVEN);
  });
  it("missing INTERNAL_CRON_SECRET -> 500 server_misconfigured before Convex", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", "");
    const res = await run(valid);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_misconfigured" });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("maps slippage_exceeded to 409, including wrapped messages", async () => {
    mocks.mutation.mockRejectedValue(new Error("slippage_exceeded"));
    expect((await run(valid)).status).toBe(409);
    mocks.mutation.mockRejectedValue(new Error("[Request ID: x] Server Error Uncaught Error: slippage_exceeded"));
    expect((await run(valid)).status).toBe(409);
  });
  it("malformed token id from Convex -> 400 invalid_id", async () => {
    mocks.mutation.mockRejectedValue(new Error("ArgumentValidationError: Value does not match validator"));
    const res = await run(valid);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_id" });
  });
  it("unknown errors -> 500 without leaking the message", async () => {
    mocks.mutation.mockRejectedValue(new Error("secret internals"));
    const res = await run(valid);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internals");
  });
  it.each([
    ["fractional amount", { amount: "1.5" }],
    ["missing amount", { amount: undefined }],
    ["numeric amount", { amount: 5 }],
    ["negative minOut", { minOut: "-1" }],
    ["amount above int64", { amount: "9999999999999999999" }],
    ["minOut above int64", { minOut: "9223372036854775808" }],
    ["bad side", { side: "hold" }],
    ["missing idempotencyKey", { idempotencyKey: undefined }],
    ["short idempotencyKey", { idempotencyKey: "short" }],
    ["long idempotencyKey", { idempotencyKey: "k".repeat(129) }],
    ["empty tokenId", { tokenId: "" }],
    ["non-alnum tokenId", { tokenId: "abc-123" }],
    ["65-char tokenId", { tokenId: "a".repeat(65) }],
    ["string quoteExpiresAt", { quoteExpiresAt: "123" }],
    ["NaN quoteExpiresAt", { quoteExpiresAt: null }],
  ])("400 for %s, Convex untouched", async (_n, patch) => {
    expect((await run({ ...valid, ...patch })).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("amount just above 2^62 reaches Convex and invalid_amount maps to 400", async () => {
    mocks.mutation.mockRejectedValue(new Error("invalid_amount"));
    expect((await run({ ...valid, amount: "4611686018427387905" })).status).toBe(400);
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
  });
  it("400 for non-object JSON bodies", async () => {
    expect((await run("[1]")).status).toBe(400);
    expect((await run("null")).status).toBe(400);
  });
  it("oversized body -> 413 without reading json()", async () => {
    const r = post("x".repeat(5000));
    const json = vi.spyOn(r, "json");
    expect((await (await import("./route")).POST(r)).status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("malformed JSON -> 400", async () => {
    expect((await run("{nope")).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
