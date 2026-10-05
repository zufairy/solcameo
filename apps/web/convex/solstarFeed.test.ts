/// <reference types="vite/client" />
// convex/solstarFeed.test.ts
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS } from "../lib/solstar/economics";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
const W1 = "ABCD" + "m".repeat(32) + "wxyz" ; // 40 chars
const W2 = "EFGH" + "n".repeat(32) + "qrst";
let prevSecret: string | undefined;
beforeEach(() => { prevSecret = process.env.INTERNAL_CRON_SECRET; process.env.INTERNAL_CRON_SECRET = SECRET; });
afterEach(() => {
  if (prevSecret === undefined) delete process.env.INTERNAL_CRON_SECRET;
  else process.env.INTERNAL_CRON_SECRET = prevSecret;
});

const chat = (wallet: string, body: string, authSecret = SECRET) => ({ wallet, body, authSecret });

async function seedToken(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const characterId = await ctx.db.insert("ssCharacters", { ownerWallet: "O", name: "Disco Ant", bio: "b", referenceImageUrl: "/x", category: "c", status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: 1 });
    const tokenId = await ctx.db.insert("ssTokens", { characterId, network: "paper", name: "Disco Ant", ticker: "DISCO", description: "d", state: "paper", solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS, createdAt: 1 });
    await ctx.db.insert("ssBudgets", { tokenId, network: "paper", fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
    return { characterId, tokenId };
  });
}

describe("postChat", () => {
  it("rejects bad secret and bad wallet", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, "hi", "bad"))).rejects.toThrow("unauthorized");
    await expect(t.mutation(api.solstarFeed.postChat, chat("short", "hi"))).rejects.toThrow("invalid_wallet");
    await expect(t.mutation(api.solstarFeed.postChat, chat("x".repeat(45), "hi"))).rejects.toThrow("invalid_wallet");
  });
  it("enforces body bounds 1..280 after trim", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, ""))).rejects.toThrow("invalid_body");
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, "   \n "))).rejects.toThrow("invalid_body");
    expect(await t.mutation(api.solstarFeed.postChat, chat(W1, "a"))).toEqual({ ok: true });
    expect(await t.mutation(api.solstarFeed.postChat, chat(W2, "b".repeat(280)))).toEqual({ ok: true });
    await expect(t.mutation(api.solstarFeed.postChat, chat("Z".repeat(40), "c".repeat(281)))).rejects.toThrow("invalid_body");
  });
  it("strips control characters and trims", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarFeed.postChat, chat(W1, "  he\u0000l\u0007lo\u007F  "));
    const rows = await t.run(async (ctx) => ctx.db.query("ssFeed").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("hello");
    expect(rows[0]).toMatchObject({ kind: "chat", network: "paper", wallet: W1 });
    await expect(t.mutation(api.solstarFeed.postChat, chat(W2, "\u0000\u0001  "))).rejects.toThrow("invalid_body");
  });
  it("rate limits the 6th message within 30s, passes once the window moves on", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i++) await t.mutation(api.solstarFeed.postChat, chat(W1, `msg ${i}`));
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, "msg 5"))).rejects.toThrow("rate_limited");
    // another wallet unaffected
    await t.mutation(api.solstarFeed.postChat, chat(W2, "msg 0"));
    // age this wallet's rows beyond the window
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("ssFeed").withIndex("by_wallet_kind_created", (q) => q.eq("wallet", W1).eq("kind", "chat")).collect()) {
        await ctx.db.patch(r._id, { createdAt: Date.now() - 31_000 });
      }
    });
    expect(await t.mutation(api.solstarFeed.postChat, chat(W1, "msg 5"))).toEqual({ ok: true });
  });
  it("rejects a duplicate of the wallet's previous message", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarFeed.postChat, chat(W1, "same"));
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, "  same "))).rejects.toThrow("duplicate_message");
    await t.mutation(api.solstarFeed.postChat, chat(W1, "other"));
    expect(await t.mutation(api.solstarFeed.postChat, chat(W1, "same"))).toEqual({ ok: true });
  });
});

describe("listFeed", () => {
  it("returns newest first, short wallet only, JSON-safe", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("ssFeed", { kind: "chat", wallet: W1, body: "old", network: "paper", createdAt: 100 });
      await ctx.db.insert("ssFeed", { kind: "chat", wallet: W2, body: "new", network: "paper", createdAt: 200 });
    });
    const rows = await t.query(api.solstarFeed.listFeed, {});
    expect(rows.map((r) => r.body)).toEqual(["new", "old"]);
    expect(rows[0].wallet).toBe("EFGH…qrst");
    expect(typeof rows[0].id).toBe("string");
    expect(JSON.stringify(rows)).not.toContain(W1);
    expect(JSON.stringify(rows)).not.toContain(W2);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });
  it("clamps limit (default 50, max 100, min 1, NaN/negative/fraction handled)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 120; i++) await ctx.db.insert("ssFeed", { kind: "chat", wallet: W1, body: `m${i}`, network: "paper", createdAt: i + 1 });
    });
    const n = async (limit?: number) => (await t.query(api.solstarFeed.listFeed, limit === undefined ? {} : { limit })).length;
    expect(await n()).toBe(50);
    expect(await n(1000)).toBe(100);
    expect(await n(0)).toBe(1);
    expect(await n(-5)).toBe(1);
    expect(await n(Number.NaN)).toBe(50);
    expect(await n(7.9)).toBe(7);
    expect(await n(Infinity)).toBe(100);
  });
});

describe("tickerItems", () => {
  it("returns only events (max 30), newest first, with no wallet field", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 40; i++) await ctx.db.insert("ssFeed", { kind: "event", eventType: "character_created", body: `e${i}`, network: "paper", createdAt: 1000 + i * 2 });
      await ctx.db.insert("ssFeed", { kind: "chat", wallet: W1, body: "chatty", network: "paper", createdAt: 5000 });
    });
    const items = await t.query(api.solstarFeed.tickerItems, {});
    expect(items).toHaveLength(30);
    expect(items[0].body).toBe("e39");
    expect(items.every((i) => i.eventType === "character_created")).toBe(true);
    expect(items.some((i) => i.body === "chatty")).toBe(false);
    expect(Object.keys(items[0])).not.toContain("wallet");
  });
});

describe("trade/follow events", () => {
  it("a trade writes exactly one event with matching string amount; replay writes none", async () => {
    const t = convexTest(schema, modules);
    const { characterId, tokenId } = await seedToken(t);
    const a = { tokenId, wallet: W1, side: "buy" as const, amount: 500_000_000n, minOut: 1n, quoteExpiresAt: Date.now() + 60_000, idempotencyKey: "k1", authSecret: SECRET };
    await t.mutation(api.solstarTrade.paperTrade, a);
    await t.mutation(api.solstarTrade.paperTrade, a);
    const events = await t.run(async (ctx) => ctx.db.query("ssFeed").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "event", eventType: "trade", side: "buy", amountLamports: "500000000", network: "paper", tokenId, characterId, wallet: W1 });
    expect(events[0].body).toBe("ABCD…wxyz bought 0.5 SOL of $DISCO (simulated)");
    const listed = await t.query(api.solstarFeed.listFeed, {});
    expect(JSON.stringify(listed)).not.toContain(W1);
  });
  it("a sell records net SOL out; failed trade writes no event", async () => {
    const t = convexTest(schema, modules);
    const { tokenId } = await seedToken(t);
    await expect(t.mutation(api.solstarTrade.paperTrade, { tokenId, wallet: W1, side: "sell", amount: 5n, minOut: 1n, quoteExpiresAt: Date.now() + 60_000, idempotencyKey: "bad", authSecret: SECRET })).rejects.toThrow("insufficient_position");
    expect(await t.run(async (ctx) => (await ctx.db.query("ssFeed").collect()).length)).toBe(0);
    const buy = await t.mutation(api.solstarTrade.paperTrade, { tokenId, wallet: W1, side: "buy", amount: 1_000_000_000n, minOut: 1n, quoteExpiresAt: Date.now() + 60_000, idempotencyKey: "b", authSecret: SECRET });
    await t.run(async (ctx) => { for (const e of await ctx.db.query("ssFeed").collect()) await ctx.db.patch(e._id, { createdAt: Date.now() - 20_000 }); });
    const sell = await t.mutation(api.solstarTrade.paperTrade, { tokenId, wallet: W1, side: "sell", amount: BigInt(buy.amountOut), minOut: 1n, quoteExpiresAt: Date.now() + 60_000, idempotencyKey: "s", authSecret: SECRET });
    const events = await t.run(async (ctx) => ctx.db.query("ssFeed").collect());
    expect(events).toHaveLength(2);
    const sellEv = events.find((e) => e.side === "sell")!;
    expect(sellEv.amountLamports).toBe(sell.amountOut);
    expect(sellEv.body).toContain("sold");
    expect(sellEv.body).toContain("of $DISCO (simulated)");
  });
  it("follow writes one event only when a row is created", async () => {
    const t = convexTest(schema, modules);
    const { characterId } = await seedToken(t);
    const a = { wallet: W1, characterId, authSecret: SECRET };
    await t.mutation(api.solstarCatalog.follow, a);
    await t.mutation(api.solstarCatalog.follow, a);
    const events = await t.run(async (ctx) => ctx.db.query("ssFeed").collect());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "event", eventType: "follow", characterId, network: "paper", wallet: W1 });
    expect(events[0].body).toBe("ABCD…wxyz followed Disco Ant");
  });
});

const tradeArgs = (tokenId: Id<"ssTokens">, wallet: string, key: string) => ({ tokenId, wallet, side: "buy" as const, amount: 100_000_000n, minOut: 1n, quoteExpiresAt: Date.now() + 60_000, idempotencyKey: key, authSecret: SECRET });

describe("event throttle", () => {
  it("3 trades by one wallet within 10s -> 1 event, 3 trades applied; other wallet still gets its own", async () => {
    const t = convexTest(schema, modules);
    const { tokenId } = await seedToken(t);
    for (const k of ["a", "b", "c"]) await t.mutation(api.solstarTrade.paperTrade, tradeArgs(tokenId, W1, k));
    await t.mutation(api.solstarTrade.paperTrade, tradeArgs(tokenId, W2, "d"));
    expect(await t.run(async (ctx) => (await ctx.db.query("ssTrades").collect()).length)).toBe(4);
    const events = await t.run(async (ctx) => ctx.db.query("ssFeed").collect());
    expect(events.filter((e) => e.wallet === W1)).toHaveLength(1);
    expect(events.filter((e) => e.wallet === W2)).toHaveLength(1);
  });
  it("a trade after the window creates a new event", async () => {
    const t = convexTest(schema, modules);
    const { tokenId } = await seedToken(t);
    await t.mutation(api.solstarTrade.paperTrade, tradeArgs(tokenId, W1, "a"));
    await t.run(async (ctx) => { for (const e of await ctx.db.query("ssFeed").collect()) await ctx.db.patch(e._id, { createdAt: Date.now() - 11_000 }); });
    await t.mutation(api.solstarTrade.paperTrade, tradeArgs(tokenId, W1, "b"));
    expect(await t.run(async (ctx) => (await ctx.db.query("ssFeed").collect()).length)).toBe(2);
  });
  it("follow/unfollow/follow cycle -> 1 follow event", async () => {
    const t = convexTest(schema, modules);
    const { characterId } = await seedToken(t);
    const a = { wallet: W1, characterId, authSecret: SECRET };
    await t.mutation(api.solstarCatalog.follow, a);
    await t.mutation(api.solstarCatalog.unfollow, a);
    await t.mutation(api.solstarCatalog.follow, a);
    expect(await t.run(async (ctx) => (await ctx.db.query("ssFeed").collect()).length)).toBe(1);
  });
  it("follow of a missing character -> character_not_found, no follow row", async () => {
    const t = convexTest(schema, modules);
    const { characterId } = await seedToken(t);
    await t.run(async (ctx) => { await ctx.db.delete(characterId); });
    await expect(t.mutation(api.solstarCatalog.follow, { wallet: W1, characterId, authSecret: SECRET })).rejects.toThrow("character_not_found");
    expect(await t.run(async (ctx) => (await ctx.db.query("ssFollows").collect()).length)).toBe(0);
  });
});

describe("abuse resistance", () => {
  it("interleaved event rows cannot evade the chat rate limit or duplicate check", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 120; i++) await ctx.db.insert("ssFeed", { kind: "event", eventType: "trade", wallet: W1, body: `e${i}`, network: "paper", createdAt: Date.now() - 1000 + i });
    });
    for (let i = 0; i < 5; i++) await t.mutation(api.solstarFeed.postChat, chat(W1, `m${i}`));
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, "m5"))).rejects.toThrow("rate_limited");
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("ssFeed").withIndex("by_wallet_kind_created", (q) => q.eq("wallet", W1).eq("kind", "chat")).collect()) {
        if (r.body !== "m4") await ctx.db.patch(r._id, { createdAt: Date.now() - 40_000 });
      }
    });
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, "m4"))).rejects.toThrow("duplicate_message");
  });
  it("normalises whitespace and strips invisible/bidi characters", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarFeed.postChat, chat(W1, "a\nb"));
    await t.mutation(api.solstarFeed.postChat, chat(W2, "x\u202Ey\u200Bz  \t w"));
    const bodies = (await t.run(async (ctx) => ctx.db.query("ssFeed").collect())).map((r) => r.body);
    expect(bodies).toEqual(["a b", "xyz w"]);
    await expect(t.mutation(api.solstarFeed.postChat, chat("Q".repeat(40), "\u200B\u200D\uFEFF\u2060"))).rejects.toThrow("invalid_body");
  });
  it("280/281 boundary applies after normalisation", async () => {
    const t = convexTest(schema, modules);
    const w = "B".repeat(40);
    await t.mutation(api.solstarFeed.postChat, chat(w, "a".repeat(140) + "\u200B \n\n " + "b".repeat(139)));
    await expect(t.mutation(api.solstarFeed.postChat, chat(w, "a".repeat(141) + " " + "b".repeat(139)))).rejects.toThrow("invalid_body");
  });
  it("duplicate detection ignores case and whitespace", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarFeed.postChat, chat(W1, "Same"));
    await expect(t.mutation(api.solstarFeed.postChat, chat(W1, " same "))).rejects.toThrow("duplicate_message");
  });
  it("tickerItems is not crowded out by chat rows", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("ssFeed", { kind: "event", eventType: "follow", body: "ev1", network: "paper", createdAt: 10 });
      await ctx.db.insert("ssFeed", { kind: "event", eventType: "follow", body: "ev2", network: "paper", createdAt: 11 });
      for (let i = 0; i < 100; i++) await ctx.db.insert("ssFeed", { kind: "chat", wallet: W1, body: `c${i}`, network: "paper", createdAt: 100 + i });
    });
    expect((await t.query(api.solstarFeed.tickerItems, {})).map((i) => i.body)).toEqual(["ev2", "ev1"]);
  });
});
