import { expect, it } from "vitest";
import { dbcFromChain, mergeDbc } from "./chainDbc";

const state = { priceSol: 0.00001, supplyRaw: "1000000000000000", decimals: 6, curveProgress: 0.4, reserveSol: 12, targetSol: 30, volume24hSol: 2.5 };

it("builds the pool snapshot from Convex alone, with no chain read", () => {
  const dbc = dbcFromChain(state, [{ time: 1, price: 5, volume: 0.1, side: "buy" }])!;
  expect(dbc.capSol).toBeCloseTo(10_000); // 0.00001 SOL x 1B tokens
  expect(dbc).toMatchObject({ available: true, progress: 0.4, reserveSol: 12, targetSol: 30, migrated: false, appVolume24hLamports: "2500000000" });
  expect(dbc.points).toHaveLength(1);
});
it("a graduated coin reads 100% and a missing state gives nothing", () => {
  expect(dbcFromChain({ ...state, migrated: true, curveProgress: 0.1 }, [])!.progress).toBe(1);
  expect(dbcFromChain(null, [])).toBeNull();
});
it("merges the chain read over the Convex snapshot, keeping every chart point once, oldest first", () => {
  const chain = dbcFromChain(state, [{ time: 1, price: 1, volume: 1, side: "buy" }, { time: 3, price: 3, volume: 1, side: "buy" }])!;
  const rpc = { ...chain, capSol: 12_000, points: [{ time: 2, price: 2, volume: 1, side: "sell" as const }, { time: 3, price: 33, volume: 1, side: "buy" as const }] };
  const merged = mergeDbc(rpc, chain)!;
  expect((merged as typeof rpc).capSol).toBe(12_000); // the fresher chain figure wins
  expect((merged as typeof rpc).points.map((p) => [p.time, p.price])).toEqual([[1, 1], [2, 2], [3, 33]]);
  expect(mergeDbc(null, chain)).toBe(chain);
});
