import { expect, it } from "vitest";
import { leaderboardFromChain, type ChainCoin } from "./leaderboardFromChain";

const now = Date.now();
const base = (over: Partial<ChainCoin> = {}): ChainCoin => ({
  characterId: "c", name: "Coin", ticker: "COIN", imageUrl: "", mint: "m", dbcPool: "p", swapsTruncated: false, holders: [],
  state: { priceSol: 0.02, decimals: 6, syncedAt: now, creator: "CREATOR", creatorSharePct: 50, feesSol: 3, claimableSol: 1, historyComplete: true, feeTrackedSince: 0 },
  swaps: [
    { signature: "b", wallet: "W", side: "buy", units: 100, sol: 1, time: now - 1000, feeSol: 0.02 },
    { signature: "s", wallet: "W", side: "sell", units: 40, sol: 0.8, time: now - 500, feeSol: 0.016 },
  ], ...over,
});
const run = (coins: ChainCoin[], period: "all" | "24h" = "all", realizedOnly = false) => leaderboardFromChain(coins, { period, realizedOnly, now, marketUrl: (id) => `/market/${id}` });

it("marks open lots to the synced price and reports creator fees", () => {
  const r = run([base()]);
  expect(r.complete).toBe(true);
  expect(r.traders[0].pnlSol).toBeCloseTo(0.8 - 0.4 + (60 * 0.02 - 0.6)); // realized 0.4 + unrealized 0.6
  expect(r.earners[0]).toMatchObject({ wallet: "CREATOR", feesSol: 3, claimableSol: 1 });
});
it("flags a wallet whose live balance disagrees with its swaps, instead of a rate-limit message", () => {
  const r = run([base({ holders: [{ wallet: "W", units: String(500 * 1e6), isPool: false }] })]);
  expect(r.traders[0]).toMatchObject({ pnlSol: null, complete: false });
  expect(r.errors.join()).toContain("cannot be verified");
  expect(r.errors.join()).not.toMatch(/rate limited/i);
});
it("trusts a wallet whose holdings match", () => {
  const r = run([base({ holders: [{ wallet: "W", units: String(60 * 1e6), isPool: false }] })]);
  expect(r.traders[0].pnlSol).not.toBeNull();
});
it("sums period creator fees from per-swap fees only when they are tracked", () => {
  expect(run([base()], "24h").earners[0].feesSol).toBeCloseTo((0.02 + 0.016) * 0.5);
  const partial = run([base({ state: { ...base().state!, feeTrackedSince: now } })], "24h");
  expect(partial.earners[0].feesSol).toBeNull();
});
it("keeps one unsynced coin from blanking the others", () => {
  const r = run([base(), base({ characterId: "d", mint: "x", state: null, swaps: [] })]);
  expect(r.traders).toHaveLength(1);
  expect(r.complete).toBe(false);
  expect(r.traders[0].pnlSol).not.toBeNull();
});
