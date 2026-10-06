import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ query: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/server/solstarRoute", () => ({ convexClient: () => ({ query: mocks.query }) }));
vi.mock("@/lib/server/marketChainSync", () => ({ syncAllMarkets: mocks.sync }));
vi.mock("@/convex/_generated/api", () => ({ api: { solstarMarket: { tokenomicsTargets: "targets" }, solstarChain: { leaderboardCoin: "coin" }, users: { leaderboardProfiles: "profiles" } } }));
import { GET } from "./route";

const coin = { characterId: "c1", name: "Coin", ticker: "COIN", imageUrl: "", mint: "m", dbcPool: "p", swapsTruncated: false, holders: [],
  state: { priceSol: 0.00001, decimals: 6, syncedAt: Date.now(), historyComplete: true },
  swaps: [
    { signature: "b", wallet: "W", side: "buy", units: 100, sol: 1, time: 1, networkFeeSol: 0.01 },
    { signature: "s", wallet: "W", side: "sell", units: 100, sol: 1.5, time: 2, networkFeeSol: 0.01 },
  ] };

it("ranks realized profit from the Convex market tables without any chain read", async () => {
  mocks.query.mockImplementation(async (q: string) => q === "targets" ? [{ characterId: "c1" }] : q === "coin" ? coin : []);
  const response = await GET(new NextRequest("http://localhost/api/solstar/leaderboard?metric=realized&period=all&refresh=1"));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.complete).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.traders[0]).toMatchObject({ wallet: "W", closedTrades: 1 });
  expect(result.traders[0].pnlSol).toBeCloseTo(0.48);
});
it("rejects an unsupported period before reading anything", async () => {
  expect((await GET(new NextRequest("http://localhost/api/solstar/leaderboard?metric=realized&period=bogus"))).status).toBe(400);
});
