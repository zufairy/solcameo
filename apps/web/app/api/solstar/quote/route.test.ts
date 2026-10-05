// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarCatalog: { getTokenPool: "getTokenPool" } } }));

const pool = { solReserve: "30000000000", tokenReserve: "1000000000000000", network: "paper" };
const get = (qs: string) => new NextRequest(`https://x/api/solstar/quote?${qs}`);
const run = async (qs: string) => (await import("./route")).GET(get(qs));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  mocks.query.mockReset().mockResolvedValue(pool);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("GET /api/solstar/quote", () => {
  it("returns a string-only quote with no-store and 15s expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
    const res = await run("tokenId=abc123&side=buy&amount=1000000000");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.clone().text();
    const body = JSON.parse(text);
    expect(() => JSON.stringify(body)).not.toThrow();
    expect(body.quotedAt).toBe(1_800_000_000_000);
    expect(body.expiresAt).toBe(1_800_000_015_000);
    expect(typeof body.amountOut).toBe("string");
    expect(typeof body.fee).toBe("string");
    expect(Object.values(body.feeSplit).every((v) => typeof v === "string")).toBe(true);
    expect(body.fee).toBe("12500000");
    expect(mocks.query).toHaveBeenCalledWith("getTokenPool", { tokenId: "abc123" });
  });
  it("supports sell", async () => {
    const res = await run("tokenId=abc123&side=sell&amount=1000000");
    expect(res.status).toBe(200);
  });
  it("non-paper network -> 400 not_paper_token", async () => {
    mocks.query.mockResolvedValue({ ...pool, network: "mainnet" });
    const res = await run("tokenId=abc123&side=buy&amount=1000000000");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_paper_token" });
  });
  it("unknown token -> 404", async () => {
    mocks.query.mockResolvedValue(null);
    expect((await run("tokenId=abc123&side=buy&amount=1000000000")).status).toBe(404);
  });
  it.each([
    ["bad side", "tokenId=abc123&side=x&amount=10"],
    ["missing side", "tokenId=abc123&amount=10"],
    ["fractional amount", "tokenId=abc123&side=buy&amount=1.5"],
    ["negative amount", "tokenId=abc123&side=buy&amount=-5"],
    ["missing amount", "tokenId=abc123&side=buy"],
    ["missing tokenId", "side=buy&amount=10"],
    ["amount above int64", "tokenId=abc123&side=buy&amount=9999999999999999999"],
    ["bad tokenId", "tokenId=a-b&side=buy&amount=10"],
  ])("400 for %s without querying Convex", async (_n, qs) => {
    expect((await run(qs)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("dust and too-large amounts -> 400 invalid_amount", async () => {
    for (const amt of ["1", "9999999999999999999"]) {
      const res = await run(`tokenId=abc123&side=buy&amount=${amt}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_amount" });
    }
  });
  it("malformed id from Convex -> 400 invalid_id; other errors -> 500", async () => {
    mocks.query.mockRejectedValue(new Error("ArgumentValidationError"));
    const res = await run("tokenId=abc123&side=buy&amount=1000000000");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_id" });
    mocks.query.mockRejectedValue(new Error("boom"));
    expect((await run("tokenId=abc123&side=buy&amount=1000000000")).status).toBe(500);
  });
});
