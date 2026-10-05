import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAsset } from "./helius";

// lib/helius.ts talked to Helius's DAS API over a HARDCODED devnet host
// regardless of NEXT_PUBLIC_SOLANA_NETWORK. On a mainnet flip, fetchAsset /
// fetchAssetsByCreator would keep querying devnet and silently return
// null/[] (both callers swallow errors) — influencer/agent NFT data
// vanishes with no error. The host must follow the same network the rest
// of the app resolves via lib/solana/network.ts's getNetwork().

const origNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK;
afterEach(() => {
  if (origNetwork === undefined) delete process.env.NEXT_PUBLIC_SOLANA_NETWORK;
  else process.env.NEXT_PUBLIC_SOLANA_NETWORK = origNetwork;
  vi.unstubAllGlobals();
});

/** Stubs global fetch and returns the mock so the test can inspect the URL
 *  it was called with. Response shape is the minimal valid Helius DAS
 *  getAsset payload so parseAssetToInfluencer doesn't throw. */
function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      result: {
        id: "mint1",
        content: { metadata: { name: "Test" } },
        authorities: [],
        creators: [],
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("helius DAS RPC host follows NEXT_PUBLIC_SOLANA_NETWORK", () => {
  it("queries mainnet.helius-rpc.com when the network is mainnet-beta", async () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet-beta";
    const fetchMock = stubFetch();
    await fetchAsset("mint1");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(new URL(url).host).toBe("mainnet.helius-rpc.com");
  });

  it("also queries mainnet.helius-rpc.com for the 'mainnet' env spelling", async () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "mainnet";
    const fetchMock = stubFetch();
    await fetchAsset("mint1");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(new URL(url).host).toBe("mainnet.helius-rpc.com");
  });

  it("queries devnet.helius-rpc.com when the network is devnet", async () => {
    process.env.NEXT_PUBLIC_SOLANA_NETWORK = "devnet";
    const fetchMock = stubFetch();
    await fetchAsset("mint1");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(new URL(url).host).toBe("devnet.helius-rpc.com");
  });

  it("defaults to devnet.helius-rpc.com when NEXT_PUBLIC_SOLANA_NETWORK is unset", async () => {
    delete process.env.NEXT_PUBLIC_SOLANA_NETWORK;
    const fetchMock = stubFetch();
    await fetchAsset("mint1");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(new URL(url).host).toBe("devnet.helius-rpc.com");
  });
});
