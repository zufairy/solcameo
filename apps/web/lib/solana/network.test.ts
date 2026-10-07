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
  it("is false for devnet, true when unset", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "devnet";
    expect(isMainnet()).toBe(false);
    delete process.env.NEXT_PUBLIC_SOLANA_NETWORK;
    expect(isMainnet()).toBe(true);
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

  it("keeps configured requests on Helius without public RPC fallback", () => {
    expect(getRpcCandidates("devnet")).toEqual([
      "https://devnet.helius-rpc.com/?api-key=testkey123",
    ]);
    expect(getRpcCandidates("mainnet-beta")).toEqual([
      "https://mainnet.helius-rpc.com/?api-key=testkey123",
    ]);
  });
});

describe("QuickNode RPC", () => {
  const saved = { q: process.env.QUICKNODE_SOLANA_RPC_URL, n: process.env.NEXT_PUBLIC_QUICKNODE_SOLANA_RPC_URL, h: process.env.HELIUS_API_KEY };
  afterEach(() => {
    for (const [k, v] of [["QUICKNODE_SOLANA_RPC_URL", saved.q], ["NEXT_PUBLIC_QUICKNODE_SOLANA_RPC_URL", saved.n], ["HELIUS_API_KEY", saved.h]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  it("comes first on mainnet, with Helius as the backup", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet-beta";
    process.env.QUICKNODE_SOLANA_RPC_URL = "https://node.quiknode.pro/abc/";
    process.env.HELIUS_API_KEY = "k";
    expect(getRpcUrl()).toBe("https://node.quiknode.pro/abc/");
    expect(getRpcCandidates()).toEqual(["https://node.quiknode.pro/abc/", "https://mainnet.helius-rpc.com/?api-key=k"]);
  });
  it("the browser-visible variable works when the private one is absent, and a non-https value is ignored", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet-beta";
    delete process.env.QUICKNODE_SOLANA_RPC_URL; delete process.env.HELIUS_API_KEY;
    process.env.NEXT_PUBLIC_QUICKNODE_SOLANA_RPC_URL = "https://pub.quiknode.pro/xyz/";
    expect(getRpcUrl()).toBe("https://pub.quiknode.pro/xyz/");
    process.env.NEXT_PUBLIC_QUICKNODE_SOLANA_RPC_URL = "http://insecure";
    expect(getRpcUrl()).toBe("https://api.mainnet-beta.solana.com");
  });
  it("never applies the mainnet endpoint to devnet", () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "devnet";
    process.env.QUICKNODE_SOLANA_RPC_URL = "https://node.quiknode.pro/abc/";
    delete process.env.HELIUS_API_KEY;
    expect(getRpcUrl()).toBe("https://api.devnet.solana.com");
  });
});
