// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(), query: vi.fn(), requireAuth: vi.fn(), proven: vi.fn(), siws: vi.fn(),
}));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarCatalog: { follow: "follow", unfollow: "unfollow" } } }));
vi.mock("@/lib/server/requireAuth", () => ({
  requireAuth: mocks.requireAuth,
  getProvenWalletFromRequest: mocks.proven,
  siwsRequiredResponse: mocks.siws,
}));

const PROVEN = "ProvenWallet1111111111111111111111111111111";
const post = (body: unknown) =>
  new NextRequest("https://x/api/solstar/follow", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("INTERNAL_CRON_SECRET", "test-secret");
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.requireAuth.mockReset().mockResolvedValue({ user: { id: "u" }, token: "t" });
  mocks.proven.mockReset().mockReturnValue(PROVEN);
  mocks.siws.mockReset().mockImplementation(() => NextResponse.json({ error: "siws_required" }, { status: 403 }));
});
afterEach(() => { vi.unstubAllEnvs(); });

const run = async (body: unknown) => (await import("./route")).POST(post(body));

describe("POST /api/solstar/follow", () => {
  it("auth failure -> 401, Convex untouched", async () => {
    mocks.requireAuth.mockResolvedValue({ error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await run({ characterId: "c1", follow: true })).status).toBe(401);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("missing SIWS proof -> siwsRequiredResponse status, Convex untouched", async () => {
    mocks.proven.mockReturnValue(undefined);
    expect((await run({ characterId: "c1", follow: true })).status).toBe(403);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("follow:true calls follow with proven wallet and secret; body wallet ignored", async () => {
    const res = await run({ characterId: "c1", follow: true, wallet: "attacker" });
    expect(res.status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith("follow", { wallet: PROVEN, characterId: "c1", authSecret: process.env.INTERNAL_CRON_SECRET });
  });
  it("follow:false calls unfollow", async () => {
    await run({ characterId: "c1", follow: false });
    expect(mocks.mutation).toHaveBeenCalledWith("unfollow", { wallet: PROVEN, characterId: "c1", authSecret: process.env.INTERNAL_CRON_SECRET });
  });
  it.each([
    ["truthy string follow", { characterId: "c1", follow: "true" }],
    ["missing follow", { characterId: "c1" }],
    ["missing characterId", { follow: true }],
    ["empty characterId", { characterId: "", follow: true }],
    ["non-alnum characterId", { characterId: "a b", follow: true }],
  ])("400 for %s, Convex untouched", async (_n, body) => {
    expect((await run(body)).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("missing INTERNAL_CRON_SECRET -> 500 server_misconfigured before Convex", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", "");
    const res = await run({ characterId: "c1", follow: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_misconfigured" });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("malformed id from Convex -> 400 invalid_id; invalid_wallet -> 400; unknown -> 500", async () => {
    mocks.mutation.mockRejectedValue(new Error("Unable to decode ID"));
    const a = await run({ characterId: "c1", follow: true });
    expect(a.status).toBe(400);
    expect(await a.json()).toEqual({ error: "invalid_id" });
    mocks.mutation.mockRejectedValue(new Error("invalid_wallet"));
    expect((await run({ characterId: "c1", follow: true })).status).toBe(400);
    mocks.mutation.mockRejectedValue(new Error("boom"));
    expect((await run({ characterId: "c1", follow: true })).status).toBe(500);
  });
  it("oversized body -> 413 without json(); malformed JSON -> 400", async () => {
    const r = post("x".repeat(5000));
    const json = vi.spyOn(r, "json");
    expect((await (await import("./route")).POST(r)).status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect((await run("{nope")).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
