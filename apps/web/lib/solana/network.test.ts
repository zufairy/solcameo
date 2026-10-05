import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { isMainnet, getNetwork, getReadRpcUrl, getRpcUrl, getRpcCandidates } from "./network";

const orig = process.env.NEXT_PUBLIC_SOLANA_NETWORK;
afterEach(() => { process.env.NEXT_PUBLIC_SOLANA_NETWORK = orig; });

describe("isMainnet", () => {
  it("is true for mainnet + mainnet-beta", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet";
    expect(getNetwork()).toBe("mainnet-beta");
    expect(isMainnet()).toBe(true);
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet-beta";
    expect(isMainnet()).toBe(true);
  });
  it("is false for devnet / unset", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "devnet";
    expect(isMainnet()).toBe(false);
    delete process.env.NEXT_PUBLIC_SOLANA_NETWORK;
    expect(isMainnet()).toBe(false);
  });
  it("respects an explicit network arg", () => {
    expect(isMainnet("mainnet-beta")).toBe(true);
    expect(isMainnet("devnet")).toBe(false);
  });
});

describe("getReadRpcUrl", () => {
  const prevKey = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  beforeEach(() => { process.env.NEXT_PUBLIC_HELIUS_API_KEY = "testkey123"; });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.NEXT_PUBLIC_HELIUS_API_KEY;
    else process.env.NEXT_PUBLIC_HELIUS_API_KEY = prevKey;
  });

  it("prefers configured Helius on devnet", () => {
    expect(getReadRpcUrl("devnet")).toBe("https://devnet.helius-rpc.com/?api-key=testkey123");
    expect(getRpcUrl("devnet")).toBe("https://devnet.helius-rpc.com/?api-key=testkey123");
  });

  it("still uses Helius mainnet when the key is set", () => {
    expect(getReadRpcUrl("mainnet-beta")).toBe("https://mainnet.helius-rpc.com/?api-key=testkey123");
    expect(getRpcUrl("mainnet-beta")).toBe("https://mainnet.helius-rpc.com/?api-key=testkey123");
  });

  it("falls back to the public endpoint when no Helius key is set", () => {
    delete process.env.NEXT_PUBLIC_HELIUS_API_KEY;
    expect(getReadRpcUrl("devnet")).toBe("https://api.devnet.solana.com");
    expect(getRpcUrl("devnet")).toBe("https://api.devnet.solana.com");
  });

  it("keeps same-cluster public RPC as fallback after Helius", () => {
    expect(getRpcCandidates("devnet")).toEqual([
      "https://devnet.helius-rpc.com/?api-key=testkey123",
      "https://api.devnet.solana.com",
    ]);
    expect(getRpcCandidates("mainnet-beta")).toEqual([
      "https://mainnet.helius-rpc.com/?api-key=testkey123",
      "https://api.mainnet-beta.solana.com",
    ]);
  });
});
