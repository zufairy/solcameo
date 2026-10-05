/// <reference types="vite/client" />
// convex/solstarTrade.test.ts
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS, PAPER_START_LAMPORTS, quoteBuy, quoteSell } from "../lib/solstar/economics";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
const W1 = "W1".padEnd(40, "x");
const W2 = "W2".padEnd(40, "x");
let prevSecret: string | undefined;
beforeEach(() => { prevSecret = process.env.INTERNAL_CRON_SECRET; process.env.INTERNAL_CRON_SECRET = SECRET; });
afterEach(() => {
  if (prevSecret === undefined) delete process.env.INTERNAL_CRON_SECRET;
  else process.env.INTERNAL_CRON_SECRET = prevSecret;
});

async function setup(network: "paper" | "devnet" = "paper") {
  const t = convexTest(schema, modules);
  const tokenId = await t.run(async (ctx) => {
    const characterId = await ctx.db.insert("ssCharacters", { ownerWallet: "O", name: "n", bio: "b", referenceImageUrl: "/x", category: "c", status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: 1 });
    const id = await ctx.db.insert("ssTokens", { characterId, network, name: "n", ticker: "N", description: "d", state: "paper", solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS, createdAt: 1 });
    await ctx.db.insert("ssBudgets", { tokenId: id, network, fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
    return id;
  });
  return { t, tokenId };
}
const base = (tokenId: Id<"ssTokens">) => ({ tokenId, wallet: W1, quoteExpiresAt: Date.now() + 60_000, authSecret: SECRET });
const POOL = { solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS };

describe("paperTrade", () => {
  it("buy updates position and credits content budget", async () => {
    const { t, tokenId } = await setup();
    const q = quoteBuy(POOL, 1_000_000_000n);
    const r = await t.mutation(api.solstarTrade.paperTrade, { ...base(tokenId), side: "buy", amount: 1_000_000_000n, minOut: q.amountOut, idempotencyKey: "t1" });
    expect(r.amountOut).toBe(q.amountOut.toString());
    const pos = await t.query(api.solstarTrade.positionOf, { wallet: W1, tokenId });
    expect(pos.tokens).toBe(q.amountOut.toString());
    expect(pos.lamports).toBe((PAPER_START_LAMPORTS - 1_000_000_000n).toString());
    const budget = await t.run(async (ctx) => ctx.db.query("ssBudgets").first());
    expect(budget!.fundedLamports).toBe(q.feeSplit.content);
  });
  it("replayed idempotency key applies once", async () => {
    const { t, tokenId } = await setup();
    const a = { ...base(tokenId), side: "buy" as const, amount: 500_000_000n, minOut: 1n, idempotencyKey: "dup" };
    await t.mutation(api.solstarTrade.paperTrade, a);
    expect((await t.mutation(api.solstarTrade.paperTrade, a)).reused).toBe(true);
    expect(await t.run(async (ctx) => (await ctx.db.query("ssTrades").collect()).length)).toBe(1);
  });
  it("rejects expired quote, slippage, overspend, oversell, bad amounts, non-paper token, bad secret", async () => {
    const { t, tokenId } = await setup();
    const ok = { ...base(tokenId), side: "buy" as const, amount: 1_000_000_000n, minOut: 1n };
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, quoteExpiresAt: Date.now() - 1, idempotencyKey: "e" })).rejects.toThrow("quote_expired");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, minOut: 1n << 60n, idempotencyKey: "s" })).rejects.toThrow("slippage_exceeded");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, amount: PAPER_START_LAMPORTS + 1n, idempotencyKey: "o" })).rejects.toThrow("insufficient_balance");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, side: "sell", amount: 1_000n, idempotencyKey: "p" })).rejects.toThrow("insufficient_position");
    for (const amount of [0n, -1n, (1n << 62n) + 1n]) {
      await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, amount, idempotencyKey: `a${amount}` })).rejects.toThrow("invalid_amount");
    }
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, authSecret: "bad", idempotencyKey: "b" })).rejects.toThrow("unauthorized");
    const dev = await setup("devnet");
    await expect(dev.t.mutation(api.solstarTrade.paperTrade, { ...base(dev.tokenId), side: "buy", amount: 1_000_000n, minOut: 1n, idempotencyKey: "d" })).rejects.toThrow("not_paper_token");
    expect(await t.run(async (ctx) => (await ctx.db.query("ssTrades").collect()).length)).toBe(0);
    expect(await dev.t.run(async (ctx) => (await ctx.db.query("ssTrades").collect()).length)).toBe(0);
    expect(await dev.t.run(async (ctx) => (await ctx.db.query("ssLedger").collect()).length)).toBe(0);
  });
  it("sell after buy returns less than paid", async () => {
    const { t, tokenId } = await setup();
    const q = quoteBuy(POOL, 1_000_000_000n);
    await t.mutation(api.solstarTrade.paperTrade, { ...base(tokenId), side: "buy", amount: 1_000_000_000n, minOut: 1n, idempotencyKey: "b1" });
    await t.mutation(api.solstarTrade.paperTrade, { ...base(tokenId), side: "sell", amount: q.amountOut, minOut: 1n, idempotencyKey: "s1" });
    const pos = await t.query(api.solstarTrade.positionOf, { wallet: W1, tokenId });
    expect(pos.tokens).toBe("0");
    expect(BigInt(pos.lamports) < PAPER_START_LAMPORTS).toBe(true);
  });

  it("replay with a different wallet, token, side or amount throws idempotency_conflict", async () => {
    const { t, tokenId } = await setup();
    const a = { ...base(tokenId), side: "buy" as const, amount: 500_000_000n, minOut: 1n, idempotencyKey: "k" };
    await t.mutation(api.solstarTrade.paperTrade, a);
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...a, wallet: W2 })).rejects.toThrow("idempotency_conflict");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...a, side: "sell" })).rejects.toThrow("idempotency_conflict");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...a, amount: 500_000_001n })).rejects.toThrow("idempotency_conflict");
    const other = await t.run(async (ctx) => {
      const characterId = await ctx.db.insert("ssCharacters", { ownerWallet: "O", name: "n2", bio: "b", referenceImageUrl: "/x", category: "c", status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: 1 });
      const id = await ctx.db.insert("ssTokens", { characterId, network: "paper", name: "n2", ticker: "M", description: "d", state: "paper", solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS, createdAt: 1 });
      await ctx.db.insert("ssBudgets", { tokenId: id, network: "paper", fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
      return id;
    });
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...a, tokenId: other })).rejects.toThrow("idempotency_conflict");
    expect(await t.run(async (ctx) => (await ctx.db.query("ssTrades").collect()).length)).toBe(1);
  });
  it("legit retry after quote expiry returns the original result", async () => {
    const { t, tokenId } = await setup();
    const a = { ...base(tokenId), side: "buy" as const, amount: 500_000_000n, minOut: 1n, idempotencyKey: "late" };
    const first = await t.mutation(api.solstarTrade.paperTrade, a);
    const again = await t.mutation(api.solstarTrade.paperTrade, { ...a, quoteExpiresAt: Date.now() - 1 });
    expect(again.reused).toBe(true);
    expect(again.amountOut).toBe(first.amountOut);
  });
  it("validates wallet and idempotency key length", async () => {
    const { t, tokenId } = await setup();
    const ok = { ...base(tokenId), side: "buy" as const, amount: 1_000_000n, minOut: 1n, idempotencyKey: "w" };
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, wallet: "short" })).rejects.toThrow("invalid_wallet");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, wallet: "x".repeat(45) })).rejects.toThrow("invalid_wallet");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, idempotencyKey: "" })).rejects.toThrow("invalid_key");
    await expect(t.mutation(api.solstarTrade.paperTrade, { ...ok, idempotencyKey: "k".repeat(129) })).rejects.toThrow("invalid_key");
  });
  it("keeps pool reserves and ledger consistent across buy then sell", async () => {
    const { t, tokenId } = await setup();
    const buy = quoteBuy(POOL, 1_000_000_000n);
    const sell = quoteSell(buy.next, buy.amountOut);
    await t.mutation(api.solstarTrade.paperTrade, { ...base(tokenId), side: "buy", amount: 1_000_000_000n, minOut: 1n, idempotencyKey: "pb" });
    await t.mutation(api.solstarTrade.paperTrade, { ...base(tokenId), side: "sell", amount: buy.amountOut, minOut: 1n, idempotencyKey: "ps" });
    const token = await t.run(async (ctx) => ctx.db.get(tokenId));
    expect(token!.solReserve).toBe(sell.next.solReserve);
    expect(token!.tokenReserve).toBe(sell.next.tokenReserve);
    const ledger = await t.run(async (ctx) => ctx.db.query("ssLedger").collect());
    expect(ledger.length).toBe(8);
    expect(ledger.every((r) => r.network === "paper")).toBe(true);
    for (const [key, fee] of [["pb", buy.fee], ["ps", sell.fee]] as const) {
      const rows = ledger.filter((r) => r.idempotencyKey.startsWith(`${key}:`));
      expect(rows.length).toBe(4);
      expect(rows.reduce((s, r) => s + r.amountLamports, 0n)).toBe(fee);
    }
  });
});
