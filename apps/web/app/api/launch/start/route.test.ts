// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), run: vi.fn(), identity: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = mocks.query; mutation = mocks.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { launchRuns: { create: "create", patch: "patch" }, mintFee: { quoteMintFee: "quote", reserveMintFee: "reserve", claimMint: "claim" } } }));
vi.mock("@/lib/server/requireAuth", () => ({ requireAuth: async () => ({ user: { id: "owner", walletAddress: "wallet" }, token: "token" }) }));
vi.mock("@/lib/server/agentQuota", () => ({ getAgentQuotaIdentity: mocks.identity }));
vi.mock("@/lib/server/launch/runLaunch", () => ({ runLaunch: mocks.run, defaultLaunchDeps: vi.fn(() => ({})) }));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("INTERNAL_CRON_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn(async () => new Response()));
  mocks.query.mockReset().mockResolvedValue({ priorMints: 0 });
  mocks.mutation.mockReset().mockImplementation(async name => name === "create" ? "run-one" : name === "claim" ? { ok: true } : {});
  mocks.run.mockReset().mockResolvedValue(undefined);
  mocks.identity.mockReset().mockResolvedValue({ creatorWallets: ["wallet"], creatorDid: "owner", agentLimit: 1, agents: [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const req = () => new NextRequest("https://velloagents.com/api/launch/start", { method: "POST", body: JSON.stringify({ websiteUrl: "https://example.com" }) });
it("blocks launch before paid generation or run creation when the free slot is used", async () => {
  mocks.query.mockResolvedValue({ priorMints: 1 });
  const { POST } = await import("./route");
  expect((await POST(req())).status).toBe(403);
  expect(mocks.mutation).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
it("claims the account-wide slot before dispatching a new launch", async () => {
  const { POST } = await import("./route");
  expect((await POST(req())).status).toBe(202);
  expect(mocks.mutation).toHaveBeenCalledWith("claim", expect.objectContaining({ sessionId: "launch_run-one", creatorDid: "owner", creatorWallets: ["wallet"], agentLimit: 1 }));
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("does not dispatch when a concurrent creation takes the slot after the quote", async () => {
  mocks.mutation.mockImplementation(async name => name === "create" ? "run-one" : name === "claim" ? { ok: false } : {});
  const { POST } = await import("./route");
  expect((await POST(req())).status).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.mutation).toHaveBeenCalledWith("patch", expect.objectContaining({ stage: "failed" }));
});
