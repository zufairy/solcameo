// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(), query: vi.fn(), requireAuth: vi.fn(), proven: vi.fn(), siws: vi.fn(),
}));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarCreate: { createCharacter: "createCharacter" } } }));
vi.mock("@/lib/server/agentWallet", () => ({ ensureInfluencerWallet: async () => ({ agentWallet: "AgentWallet1" }) }));
vi.mock("@/lib/server/requireAuth", () => ({
  requireAuth: mocks.requireAuth,
  getProvenWalletFromRequest: mocks.proven,
  siwsRequiredResponse: mocks.siws,
}));

const PROVEN = "ProvenWallet1111111111111111111111111111111";
const post = (body: unknown) =>
  new NextRequest("https://x/api/solstar/characters", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const good = {
  name: "Dino", ticker: "dino", bio: "A dino", category: "Comedy", imageStorageId: "kg2abc123def456",
  rightsAttested: true, idempotencyKey: "key-00000001",
};
const OK = { characterId: "c1", tokenId: "t1", reused: false };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("INTERNAL_CRON_SECRET", "test-secret");
  mocks.mutation.mockReset().mockResolvedValue(OK);
  mocks.requireAuth.mockReset().mockResolvedValue({ user: { id: "u" }, token: "t" });
  mocks.proven.mockReset().mockReturnValue(PROVEN);
  mocks.siws.mockReset().mockImplementation(() => NextResponse.json({ error: "siws_required" }, { status: 403 }));
});
afterEach(() => { vi.unstubAllEnvs(); });

const run = async (body: unknown) => (await import("./route")).POST(post(body));

describe("POST /api/solstar/characters", () => {
  it("auth failure -> 401, Convex untouched", async () => {
    mocks.requireAuth.mockResolvedValue({ error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await run(good)).status).toBe(401);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("missing SIWS proof -> siwsRequiredResponse status", async () => {
    mocks.proven.mockReturnValue(undefined);
    expect((await run(good)).status).toBe(403);
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
  it.each([
    ["name number", { ...good, name: 5 }],
    ["ticker missing", { ...good, ticker: undefined }],
    ["bio null", { ...good, bio: null }],
    ["category object", { ...good, category: { a: 1 } }],
    ["imageStorageId missing", { ...good, imageStorageId: undefined }],
    ["imageStorageId bad chars", { ...good, imageStorageId: "../etc/passwd" }],
    ["imageStorageId too long", { ...good, imageStorageId: "a".repeat(65) }],
    ["key missing", { ...good, idempotencyKey: undefined }],
    ["rightsAttested string", { ...good, rightsAttested: "true" }],
    ["rightsAttested number", { ...good, rightsAttested: 1 }],
    ["rightsAttested missing", { ...good, rightsAttested: undefined }],
  ])("400 for %s, Convex untouched", async (_n, b) => {
    expect((await run(b)).status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("rightsAttested false is forwarded (server decides rights_required)", async () => {
    expect((await run({ ...good, rightsAttested: false })).status).toBe(200);
    expect(mocks.mutation.mock.calls[0][1].rightsAttested).toBe(false);
  });
  it("success: proven wallet only, ticker uppercased, JSON-safe result", async () => {
    const res = await run({ ...good, wallet: "attacker", authSecret: "evil" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...OK, agentWallet: "AgentWallet1" });
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.mutation).toHaveBeenCalledWith("createCharacter", {
      wallet: PROVEN, name: "Dino", ticker: "DINO", bio: "A dino", category: "Comedy", imageStorageId: "kg2abc123def456",
      rightsAttested: true, idempotencyKey: "key-00000001", authSecret: "test-secret",
    });
  });
  it.each([
    ["ticker_taken", 409], ["idempotency_conflict", 409], ["create_limit", 429], ["invalid_name", 400],
    ["invalid_ticker", 400], ["invalid_bio", 400], ["invalid_category", 400], ["invalid_image", 400],
    ["rights_required", 400], ["invalid_key", 400], ["invalid_wallet", 400],
  ])("wrapped Convex error %s -> %i", async (code, status) => {
    mocks.mutation.mockRejectedValue(new Error(`[Request ID: abc] Server Error Uncaught Error: ${code} at handler`));
    const res = await run(good);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });
  it("unknown error -> 500 internal_error with no raw message leak", async () => {
    mocks.mutation.mockRejectedValue(new Error("secret db detail xyz"));
    const res = await run(good);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "internal_error" }));
    expect(text).not.toContain("xyz");
  });
});
