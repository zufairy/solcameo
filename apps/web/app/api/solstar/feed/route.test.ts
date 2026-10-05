// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(), query: vi.fn(), requireAuth: vi.fn(), proven: vi.fn(), siws: vi.fn(),
}));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarFeed: { postChat: "postChat" } } }));
vi.mock("@/lib/server/requireAuth", () => ({
  requireAuth: mocks.requireAuth,
  getProvenWalletFromRequest: mocks.proven,
  siwsRequiredResponse: mocks.siws,
}));

const PROVEN = "ProvenWallet1111111111111111111111111111111";
const post = (body: unknown) =>
  new NextRequest("https://x/api/solstar/feed", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

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

describe("POST /api/solstar/feed", () => {
  it("auth failure -> 401, Convex untouched", async () => {
    mocks.requireAuth.mockResolvedValue({ error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await run({ body: "hi" })).status).toBe(401);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("missing SIWS proof -> siwsRequiredResponse status", async () => {
    mocks.proven.mockReturnValue(undefined);
    expect((await run({ body: "hi" })).status).toBe(403);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("oversized body -> 413 without json(); malformed JSON -> 400", async () => {
    const r = post("x".repeat(5000));
    const json = vi.spyOn(r, "json");
    expect((await (await import("./route")).POST(r)).status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect((await run("{nope")).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it.each([["number", { body: 5 }], ["missing", {}], ["null", { body: null }], ["object", { body: { a: 1 } }]])(
    "400 for %s body, Convex untouched", async (_n, b) => {
      expect((await run(b)).status).toBe(400);
      expect(mocks.mutation).not.toHaveBeenCalled();
    });
  it("success calls postChat once with proven wallet and secret; body wallet ignored", async () => {
    const res = await run({ body: "hello", wallet: "attacker" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.mutation).toHaveBeenCalledWith("postChat", { wallet: PROVEN, body: "hello", authSecret: "test-secret" });
  });
  it.each([["rate_limited", 429], ["invalid_body", 400], ["duplicate_message", 409], ["invalid_wallet", 400]])(
    "wrapped Convex error %s -> %i", async (code, status) => {
      mocks.mutation.mockRejectedValue(new Error(`[Request ID: abc] Server Error Uncaught Error: ${code} at handler`));
      const res = await run({ body: "hi" });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
    });
  it("unknown error -> 500 internal_error with no raw message leak", async () => {
    mocks.mutation.mockRejectedValue(new Error("secret db detail xyz"));
    const res = await run({ body: "hi" });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "internal_error" }));
    expect(text).not.toContain("xyz");
  });
});
