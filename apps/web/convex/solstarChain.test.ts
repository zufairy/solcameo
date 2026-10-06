/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");
const secret = "chain-test-secret";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = secret; });
const setup = async () => {
  const t = convexTest(schema, modules);
  const characterId = await t.run((ctx) => ctx.db.insert("ssCharacters", { ownerWallet: "O", name: "n", bio: "b", referenceImageUrl: "/x", category: "c", status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: 1 }));
  return { t, characterId };
};
const swap = (signature: string, wallet: string, side: "buy" | "sell", units: number, sol: number, time: number) => ({ signature, wallet, side, units, sol, priceSol: sol / units, time });
type Market = { priceSol: number; supplyRaw: string; decimals: number; slot: number; holders: { wallet: string; units: string; supplyPct: number; isPool: boolean }[] };
const base = (characterId: never, swaps: ReturnType<typeof swap>[], market?: Market) => ({ authSecret: secret, characterId, mint: "mint", network: "mainnet", swaps, ...(market ? { market } : {}) });

it("keeps an average-cost position per wallet as swaps arrive", async () => {
  const { t, characterId } = await setup();
  await t.mutation(api.solstarChain.ingest, base(characterId as never, [
    swap("s1", "A", "buy", 100, 1, 1000), swap("s2", "A", "buy", 100, 3, 2000), swap("s3", "A", "sell", 50, 1.5, 3000),
  ]));
  const { positions } = await t.query(api.solstarChain.openTrades, { characterId });
  const a = positions.find((p) => p.wallet === "A")!;
  expect(a.openTokens).toBeCloseTo(150);
  expect(a.costBasisSol).toBeCloseTo(3); // avg cost 0.02/token, 50 sold removes 1 of the 4 SOL paid
  expect(a.realizedSol).toBeCloseTo(0.5); // sold 50 for 1.5 against cost 1.0
  expect(a.trades).toBe(3);
});

it("ignores a swap it has already seen, so retries and overlaps never double count", async () => {
  const { t, characterId } = await setup();
  const batch = base(characterId as never, [swap("dup", "A", "buy", 10, 1, 1000)]);
  expect((await t.mutation(api.solstarChain.ingest, batch)).applied).toBe(1);
  expect((await t.mutation(api.solstarChain.ingest, batch)).applied).toBe(0);
  expect((await t.query(api.solstarChain.openTrades, { characterId })).positions[0].openTokens).toBe(10);
});

it("closes a position that sells out and never goes negative on tokens that arrived by transfer", async () => {
  const { t, characterId } = await setup();
  await t.mutation(api.solstarChain.ingest, base(characterId as never, [swap("b", "A", "buy", 10, 1, 1000), swap("x", "A", "sell", 25, 5, 2000)]));
  const a = (await t.query(api.solstarChain.openTrades, { characterId })).positions[0];
  expect(a.openTokens).toBe(0);
  expect(a.costBasisSol).toBe(0);
  expect(a.realizedSol).toBeCloseTo(5 * (10 / 25) - 1); // only the tracked 10 of 25 count against the 1 SOL cost
});

it("replaces holders as a set and exposes the newest swaps first", async () => {
  const { t, characterId } = await setup();
  const market = (holders: Market["holders"]): Market => ({ priceSol: 0.01, supplyRaw: "1000000000000000", decimals: 6, slot: 5, holders });
  await t.mutation(api.solstarChain.ingest, base(characterId as never, [swap("1", "A", "buy", 1, 0.01, 1), swap("2", "B", "buy", 1, 0.01, 2)], market([{ wallet: "A", units: "1", supplyPct: 50, isPool: false }, { wallet: "B", units: "1", supplyPct: 50, isPool: false }])));
  await t.mutation(api.solstarChain.ingest, base(characterId as never, [], market([{ wallet: "B", units: "1", supplyPct: 100, isPool: false }])));
  expect((await t.query(api.solstarChain.openTrades, { characterId })).holders.map((h) => h.wallet)).toEqual(["B"]);
  expect((await t.query(api.solstarChain.recentSwaps, { characterId })).map((s) => s.signature)).toEqual(["2", "1"]);
  expect(await t.query(api.solstarChain.syncState, { authSecret: secret, characterId })).toMatchObject({ lastTime: 2 });
});

it("rejects writes without the internal secret", async () => {
  const { t, characterId } = await setup();
  await expect(t.mutation(api.solstarChain.ingest, { ...base(characterId as never, []), authSecret: "nope" })).rejects.toThrow(/unauthorized/);
});
