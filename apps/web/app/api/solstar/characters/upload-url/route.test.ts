// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(), query: vi.fn(), requireAuth: vi.fn(), proven: vi.fn(), siws: vi.fn(),
}));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarCreate: { generateUploadUrl: "generateUploadUrl" } } }));
vi.mock("@/lib/server/requireAuth", () => ({
  requireAuth: mocks.requireAuth,
  getProvenWalletFromRequest: mocks.proven,
  siwsRequiredResponse: mocks.siws,
}));

const PROVEN = "ProvenWallet1111111111111111111111111111111";
const post = (body?: string) => new NextRequest("https://x/api/solstar/characters/upload-url", { method: "POST", body });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("INTERNAL_CRON_SECRET", "test-secret");
  mocks.mutation.mockReset().mockResolvedValue("https://upload.example/u?token=1");
  mocks.requireAuth.mockReset().mockResolvedValue({ user: { id: "u" }, token: "t" });
  mocks.proven.mockReset().mockReturnValue(PROVEN);
  mocks.siws.mockReset().mockImplementation(() => NextResponse.json({ error: "siws_required" }, { status: 403 }));
});
afterEach(() => { vi.unstubAllEnvs(); });

const run = async (body?: string) => (await import("./route")).POST(post(body));

describe("POST /api/solstar/characters/upload-url", () => {
  it("auth failure -> 401, Convex untouched", async () => {
    mocks.requireAuth.mockResolvedValue({ error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await run()).status).toBe(401);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("missing SIWS proof -> 403, Convex untouched", async () => {
    mocks.proven.mockReturnValue(undefined);
    expect((await run()).status).toBe(403);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("missing server secret -> 500 server_misconfigured", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", "");
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_misconfigured" });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("success with empty body and with {} body returns { uploadUrl }", async () => {
    for (const b of [undefined, "{}"]) {
      mocks.mutation.mockClear();
      const res = await run(b);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ uploadUrl: "https://upload.example/u?token=1" });
      expect(mocks.mutation).toHaveBeenCalledWith("generateUploadUrl", { authSecret: "test-secret" });
    }
  });
  it("oversized body -> 413, Convex untouched", async () => {
    expect((await run("x".repeat(5000))).status).toBe(413);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("Convex failure -> 500 internal_error, no leak", async () => {
    mocks.mutation.mockRejectedValue(new Error("secret detail xyz"));
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(JSON.stringify({ error: "internal_error" }));
  });
});
