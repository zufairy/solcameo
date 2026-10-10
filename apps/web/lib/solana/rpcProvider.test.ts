import { afterEach, describe, expect, it, vi } from "vitest";
import { getSolamiRpcUrl } from "./rpcProvider";
import { getRpcCandidates, getRpcUrl, getRpcWsUrl } from "./network";

afterEach(() => vi.unstubAllEnvs());

describe("Solami RPC provider", () => {
  it("builds the mainnet URL from the key and is empty elsewhere or without a key", () => {
    vi.stubEnv("SOLAMI_API_KEY", "sk_test");
    expect(getSolamiRpcUrl("mainnet-beta")).toBe("https://rpc.solami.dev/sol?api_key=sk_test");
    expect(getSolamiRpcUrl("devnet")).toBe("");
    vi.stubEnv("SOLAMI_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SOLAMI_RPC_KEY", "");
    expect(getSolamiRpcUrl("mainnet-beta")).toBe("");
  });
  it("pins a region only for known regions", () => {
    vi.stubEnv("SOLAMI_API_KEY", "k");
    vi.stubEnv("SOLAMI_RPC_REGION", "fra");
    expect(getSolamiRpcUrl("mainnet-beta")).toContain("https://fra.rpc.solami.dev/sol");
    vi.stubEnv("SOLAMI_RPC_REGION", "mars");
    expect(getSolamiRpcUrl("mainnet-beta")).toContain("https://rpc.solami.dev/sol");
  });
  it("leads with Solami when it is the default provider and keeps QuickNode as failover", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "mainnet-beta");
    vi.stubEnv("SOLAMI_API_KEY", "k");
    vi.stubEnv("SOLANA_RPC_PROVIDER", "solami");
    vi.stubEnv("QUICKNODE_SOLANA_RPC_URL", "https://qn.example/token");
    const urls = getRpcCandidates("mainnet-beta");
    expect(urls[0]).toContain("rpc.solami.dev");
    expect(urls).toContain("https://qn.example/token");
    expect(getRpcUrl("mainnet-beta")).toContain("rpc.solami.dev");
  });
  it("leads with QuickNode when that provider is chosen", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "mainnet-beta");
    vi.stubEnv("SOLAMI_API_KEY", "k");
    vi.stubEnv("SOLANA_RPC_PROVIDER", "quicknode");
    vi.stubEnv("QUICKNODE_SOLANA_RPC_URL", "https://qn.example/token");
    expect(getRpcCandidates("mainnet-beta")[0]).toBe("https://qn.example/token");
  });
  it("maps the HTTP endpoint to Solami's separate WebSocket host", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "mainnet-beta");
    vi.stubEnv("SOLAMI_API_KEY", "k");
    vi.stubEnv("SOLANA_RPC_PROVIDER", "solami");
    expect(getRpcWsUrl("mainnet-beta")).toBe("wss://ws.solami.dev/ws/sol?api_key=k");
  });
});
