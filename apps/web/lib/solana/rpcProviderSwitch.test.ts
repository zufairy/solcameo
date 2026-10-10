import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = query; } }));

beforeEach(() => {
  vi.resetModules(); query.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "mainnet-beta");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
  vi.stubEnv("SOLAMI_API_KEY", "k");
  vi.stubEnv("QUICKNODE_SOLANA_RPC_URL", "https://qn.example/token");
  vi.stubEnv("SOLANA_RPC_PROVIDER", "solami");
});
afterEach(() => vi.unstubAllEnvs());

describe("admin RPC provider switch", () => {
  it("a stored admin choice overrides the env default, in both directions", async () => {
    query.mockResolvedValue({ provider: "quicknode", updatedAt: 1, updatedByEmail: "a@b.c" });
    const { refreshActiveProvider } = await import("./rpcProvider");
    const { getRpcCandidates } = await import("./network");
    await refreshActiveProvider(true);
    expect(getRpcCandidates("mainnet-beta")[0]).toBe("https://qn.example/token");

    query.mockResolvedValue({ provider: "solami", updatedAt: 2, updatedByEmail: "a@b.c" });
    await refreshActiveProvider(true);
    expect(getRpcCandidates("mainnet-beta")[0]).toContain("rpc.solami.dev");
  });
  it("keeps the last known provider when the settings store is unreachable", async () => {
    query.mockResolvedValueOnce({ provider: "quicknode", updatedAt: 1, updatedByEmail: null });
    const { refreshActiveProvider } = await import("./rpcProvider");
    const { getRpcCandidates } = await import("./network");
    await refreshActiveProvider(true);
    query.mockRejectedValue(new Error("convex down"));
    await refreshActiveProvider(true);
    expect(getRpcCandidates("mainnet-beta")[0]).toBe("https://qn.example/token");
  });
  it("ignores an unknown stored value and falls back to the env default", async () => {
    query.mockResolvedValue({ provider: "bogus", updatedAt: 1, updatedByEmail: null });
    const { refreshActiveProvider } = await import("./rpcProvider");
    const { getRpcCandidates } = await import("./network");
    await refreshActiveProvider(true);
    expect(getRpcCandidates("mainnet-beta")[0]).toContain("rpc.solami.dev");
  });
});
