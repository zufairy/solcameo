/// <reference types="vite/client" />
// convex/solstarBudget.test.ts
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { splitFee, MAX_AMOUNT } from "../lib/solstar/economics";
import { applyFeeSplit } from "./solstarBudget";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = SECRET; });

async function setup(network: "paper" | "devnet", funded: bigint) {
  const t = convexTest(schema, modules);
  const tokenId = await t.run(async (ctx) => {
    const characterId = await ctx.db.insert("ssCharacters", {
      ownerWallet: "W", name: "n", bio: "b", referenceImageUrl: "/x.png", category: "c",
      status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: 1,
    });
    const id = await ctx.db.insert("ssTokens", {
      characterId, network, name: "n", ticker: "N", description: "d", state: network === "paper" ? "paper" : "live",
      solReserve: 1n, tokenReserve: 1n, createdAt: 1,
    });
    await ctx.db.insert("ssBudgets", { tokenId: id, network, fundedLamports: funded, reservedLamports: 0n, spentLamports: 0n });
    return id;
  });
  return { t, tokenId };
}
const budget = (t: TestConvex<typeof schema>, tokenId: Id<"ssTokens">) =>
  t.run(async (ctx) => ctx.db.query("ssBudgets").withIndex("by_token", (q) => q.eq("tokenId", tokenId)).first());

describe("reserve", () => {
  it("rejects without the secret", async () => {
    const { t, tokenId } = await setup("paper", 100n);
    await expect(t.mutation(api.solstarBudget.reserve, { tokenId, amountLamports: 10n, idempotencyKey: "a", provider: "demo", authSecret: "bad" })).rejects.toThrow("unauthorized");
  });
  it("reserves once per idempotency key", async () => {
    const { t, tokenId } = await setup("paper", 100n);
    const args = { tokenId, amountLamports: 40n, idempotencyKey: "k1", provider: "demo", authSecret: SECRET };
    expect((await t.mutation(api.solstarBudget.reserve, args)).reused).toBe(false);
    expect((await t.mutation(api.solstarBudget.reserve, args)).reused).toBe(true);
    expect((await budget(t, tokenId))!.reservedLamports).toBe(40n);
  });
  it("sequential reservations (convex-test serializes mutations) never overspend: exercises the funds check", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    const mk = (k: string) => t.mutation(api.solstarBudget.reserve, { tokenId, amountLamports: 80n, idempotencyKey: k, provider: "higgsfield", authSecret: SECRET });
    const results = await Promise.allSettled([mk("a"), mk("b"), mk("c")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await budget(t, tokenId))!.reservedLamports).toBe(80n);
  });
  it("paper budget cannot fund a real provider", async () => {
    const { t, tokenId } = await setup("paper", 1_000n);
    await expect(t.mutation(api.solstarBudget.reserve, { tokenId, amountLamports: 10n, idempotencyKey: "z", provider: "higgsfield", authSecret: SECRET })).rejects.toThrow("paper_cannot_fund_real_provider");
  });
  it("rejects zero, negative and oversized amounts", async () => {
    const { t, tokenId } = await setup("paper", 100n);
    for (const amountLamports of [0n, -1n, (1n << 62n) + 1n]) {
      await expect(t.mutation(api.solstarBudget.reserve, { tokenId, amountLamports, idempotencyKey: `x${amountLamports}`, provider: "demo", authSecret: SECRET })).rejects.toThrow("invalid_amount");
    }
  });
});

describe("release / spend", () => {
  it("release frees the reservation, idempotently", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await t.mutation(api.solstarBudget.reserve, { tokenId, amountLamports: 60n, idempotencyKey: "r", provider: "higgsfield", authSecret: SECRET });
    const a = { tokenId, reservationKey: "r", authSecret: SECRET };
    expect((await t.mutation(api.solstarBudget.release, a)).reused).toBe(false);
    expect((await t.mutation(api.solstarBudget.release, a)).reused).toBe(true);
    const b = (await budget(t, tokenId))!;
    expect([b.reservedLamports, b.spentLamports]).toEqual([0n, 0n]);
  });
  it("spend moves reserved to spent once; release after spend is rejected", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await t.mutation(api.solstarBudget.reserve, { tokenId, amountLamports: 60n, idempotencyKey: "s", provider: "higgsfield", authSecret: SECRET });
    const a = { tokenId, reservationKey: "s", authSecret: SECRET };
    await t.mutation(api.solstarBudget.spend, a);
    await t.mutation(api.solstarBudget.spend, a);
    await expect(t.mutation(api.solstarBudget.release, a)).rejects.toThrow("reservation_settled");
    const b = (await budget(t, tokenId))!;
    expect([b.reservedLamports, b.spentLamports]).toEqual([0n, 60n]);
  });
  it("unknown reservation is rejected", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await expect(t.mutation(api.solstarBudget.spend, { tokenId, reservationKey: "nope", authSecret: SECRET })).rejects.toThrow("reservation_not_found");
  });
});

describe("applyFeeSplit", () => {
  it("credits only the content share and is keyed per trade", async () => {
    const { t, tokenId } = await setup("paper", 0n);
    const split = splitFee(15_000n);
    const applied = await t.run(async (ctx) => [
      await applyFeeSplit(ctx, { tokenId, network: "paper", split, idempotencyKey: "trade1", source: "paper_simulated" }),
      await applyFeeSplit(ctx, { tokenId, network: "paper", split, idempotencyKey: "trade1", source: "paper_simulated" }),
    ]);
    expect(applied).toEqual([true, false]);
    expect((await budget(t, tokenId))!.fundedLamports).toBe(1_500n);
    expect(await t.run(async (ctx) => (await ctx.db.query("ssLedger").collect()).length)).toBe(4);
  });
});

describe("hardening", () => {
  const R = (t: any, tokenId: any, over: any = {}) =>
    t.mutation(api.solstarBudget.reserve, { tokenId, amountLamports: 10n, idempotencyKey: "k", provider: "higgsfield", authSecret: SECRET, ...over });
  const cloneToken = (t: TestConvex<typeof schema>, tokenId: Id<"ssTokens">) =>
    t.run(async (ctx) => {
      const { _id, _creationTime, ...rest } = (await ctx.db.get(tokenId))!;
      const id = await ctx.db.insert("ssTokens", rest);
      await ctx.db.insert("ssBudgets", { tokenId: id, network: rest.network, fundedLamports: 100n, reservedLamports: 0n, spentLamports: 0n });
      return id;
    });
  it("same key with different amount is an idempotency_conflict", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await R(t, tokenId);
    await expect(R(t, tokenId, { amountLamports: 20n })).rejects.toThrow("idempotency_conflict");
  });
  it("same key with a different token is an idempotency_conflict", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await R(t, tokenId);
    await expect(R(t, await cloneToken(t, tokenId))).rejects.toThrow("idempotency_conflict");
  });
  it("keys containing ':' are invalid", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await expect(R(t, tokenId, { idempotencyKey: "a:release" })).rejects.toThrow("invalid_key");
  });
  it("applyFeeSplit rejects network mismatch with no writes", async () => {
    const { t, tokenId } = await setup("paper", 0n);
    await expect(t.run(async (ctx) => applyFeeSplit(ctx, { tokenId, network: "devnet", split: splitFee(15_000n), idempotencyKey: "m", source: "x" }))).rejects.toThrow("network_mismatch");
    expect(await t.run(async (ctx) => (await ctx.db.query("ssLedger").collect()).length)).toBe(0);
    expect((await budget(t, tokenId))!.fundedLamports).toBe(0n);
  });
  it("release then spend is reservation_settled", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await R(t, tokenId, { idempotencyKey: "q" });
    const a = { tokenId, reservationKey: "q", authSecret: SECRET };
    await t.mutation(api.solstarBudget.release, a);
    await expect(t.mutation(api.solstarBudget.spend, a)).rejects.toThrow("reservation_settled");
  });
  it("settle with wrong tokenId is reservation_not_found", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await R(t, tokenId, { idempotencyKey: "w" });
    const other = await cloneToken(t, tokenId);
    await expect(t.mutation(api.solstarBudget.spend, { tokenId: other, reservationKey: "w", authSecret: SECRET })).rejects.toThrow("reservation_not_found");
  });
  it("MAX_AMOUNT passes amount check, MAX_AMOUNT+1 is invalid_amount", async () => {
    const { t, tokenId } = await setup("devnet", 100n);
    await expect(R(t, tokenId, { amountLamports: MAX_AMOUNT })).rejects.toThrow("insufficient_budget");
    await expect(R(t, tokenId, { amountLamports: MAX_AMOUNT + 1n })).rejects.toThrow("invalid_amount");
  });
  it("applyFeeSplit ledger rows sum to split.total", async () => {
    const { t, tokenId } = await setup("paper", 0n);
    const split = splitFee(15_000n);
    await t.run(async (ctx) => applyFeeSplit(ctx, { tokenId, network: "paper", split, idempotencyKey: "s", source: "x" }));
    const sum = await t.run(async (ctx) => (await ctx.db.query("ssLedger").collect()).reduce((n, r) => n + r.amountLamports, 0n));
    expect(sum).toBe(split.total);
  });
});
