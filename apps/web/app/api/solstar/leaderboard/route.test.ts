import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ query: vi.fn(), balance: vi.fn(), fee: vi.fn() }));
vi.mock("@/lib/server/solstarRoute", () => ({ convexClient: () => ({ query: mocks.query }) }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarMarket: { listMarket: "markets" }, users: { leaderboardProfiles: "profiles" } } }));
vi.mock("@/lib/solana/network", () => ({ getNetwork: () => "devnet", getRpcCandidates: () => ["https://rpc.test"] }));
vi.mock("@solana/web3.js", async original => {
  const actual = await original<typeof import("@solana/web3.js")>();
  return { ...actual, Connection: class { getParsedTokenAccountsByOwner = mocks.balance; } };
});
vi.mock("@meteora-ag/dynamic-bonding-curve-sdk", async original => {
  const actual = await original<typeof import("@meteora-ag/dynamic-bonding-curve-sdk")>();
  const { PublicKey } = await import("@solana/web3.js");
  const { NATIVE_MINT } = await import("@solana/spl-token");
  return { ...actual, DynamicBondingCurveClient: class { state = {
    getPool: async () => ({ poolState: { config: NATIVE_MINT, baseMint: new PublicKey("So11111111111111111111111111111111111111112"), isMigrated: false } }),
    getPoolConfig: async () => ({ quoteMint: NATIVE_MINT }), getPoolFeeBreakdown: mocks.fee,
  }; } };
});
vi.mock("@/lib/server/marketLeaderboard", () => ({
  readPoolHistory: async () => ({ complete: true, transactions: [{ signature: "buy", tx: { side: "buy" } }, { signature: "sell", tx: { side: "sell" } }] }),
  readMarketSwap: (tx: { side: string }, signature: string) => ({ trade: { signature, wallet: "So11111111111111111111111111111111111111112", mint: "coin", side: tx.side, units: 100, sol: tx.side === "buy" ? 1 : 1.5, networkFeeSol: 0.01, time: Date.now() }, fee: 0 }),
}));
import { GET } from "./route";
it("returns realized profits from RPC history without needing spot prices or creator payout counters", async () => {
  mocks.query.mockImplementation(async (query: string) => query === "markets" ? [{ dbcPool: "So11111111111111111111111111111111111111112", characterId: "character", name: "Coin", ticker: "COIN" }] : []);
  mocks.balance.mockResolvedValue({ value: [] });
  const response = await GET(new NextRequest("http://localhost/api/solstar/leaderboard?metric=realized&period=all"));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.network).toBe("devnet");
  expect(result.complete).toBe(true);
  expect(result.traders[0]).toMatchObject({ closedTrades: 1, unrealizedSol: 0 });
  expect(result.traders[0].pnlSol).toBeCloseTo(0.48);
  expect(mocks.fee).not.toHaveBeenCalled();
});
it("rejects an unsupported period before reading chain", async () => {
  expect((await GET(new NextRequest("http://localhost/api/solstar/leaderboard?metric=realized&period=bogus"))).status).toBe(400);
});
