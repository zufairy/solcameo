/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import {
  PAPER_VIRTUAL_SOL,
  PAPER_VIRTUAL_TOKENS,
} from "../lib/solstar/economics";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
const WALLET = "W1".padEnd(40, "x");
let prevSecret: string | undefined;
beforeEach(() => {
  prevSecret = process.env.INTERNAL_CRON_SECRET;
  process.env.INTERNAL_CRON_SECRET = SECRET;
});
afterEach(() => {
  if (prevSecret === undefined) delete process.env.INTERNAL_CRON_SECRET;
  else process.env.INTERNAL_CRON_SECRET = prevSecret;
});

async function seeded() {
  const t = convexTest(schema, modules);
  await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
  return t;
}

describe("listMarket", () => {
  it("returns seeded rows at launch price with no volume", async () => {
    const t = await seeded();
    const rows = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.priceLamports).toBe("30");
      expect(r.athLamports).toBe("30");
      expect(r.volume24hLamports).toBe("0");
      expect(r.trades24h).toBe(0);
      expect(r.changeBps).toBe("0");
    }
  });

  it("reflects a paper buy in volume, price and ranking", async () => {
    const t = await seeded();
    const before = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    const target = before[3];
    const tokenId = await t.run(async (ctx) => {
      const tok = await ctx.db
        .query("ssTokens")
        .withIndex("by_character", (q) =>
          q.eq("characterId", target.characterId),
        )
        .first();
      return tok!._id;
    });
    await t.mutation(api.solstarTrade.paperTrade, {
      tokenId,
      wallet: WALLET,
      side: "buy",
      amount: 1_000_000_000n,
      minOut: 1n,
      quoteExpiresAt: Date.now() + 60_000,
      idempotencyKey: "m1",
      authSecret: SECRET,
    });
    const rows = await t.query(api.solstarMarket.listMarket, {
      sort: "volume",
    });
    expect(rows[0].characterId).toBe(target.characterId);
    expect(rows[0].trades24h).toBe(1);
    expect(rows[0].volume24hLamports).toBe("1000000000");
    expect(BigInt(rows[0].priceLamports) > 30n).toBe(true);
    expect(BigInt(rows[0].changeBps) > 0n).toBe(true);
    expect(() => JSON.stringify(rows)).not.toThrow();
  });

  it("searches case-insensitively and safely", async () => {
    const t = await seeded();
    const all = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    const name = all[0].name;
    const hit = await t.query(api.solstarMarket.listMarket, {
      sort: "new",
      search: `  ${name.toUpperCase()} `,
    });
    expect(hit.some((r) => r.characterId === all[0].characterId)).toBe(true);
    const tick = await t.query(api.solstarMarket.listMarket, {
      sort: "new",
      search: all[1].ticker.toLowerCase(),
    });
    expect(tick.some((r) => r.characterId === all[1].characterId)).toBe(true);
    expect(
      await t.query(api.solstarMarket.listMarket, {
        sort: "new",
        search: ".*(",
      }),
    ).toEqual([]);
    expect(
      await t.query(api.solstarMarket.listMarket, {
        sort: "new",
        search: "a".repeat(500),
      }),
    ).toEqual([]);
  });

  it("scopes by network", async () => {
    const t = await seeded();
    const all = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    const characterId = all[0].characterId;
    await t.run(async (ctx) => {
      await ctx.db.insert("ssTokens", {
        characterId,
        network: "devnet",
        name: "Dev",
        ticker: "DEV",
        description: "d",
        state: "live",
        solReserve: PAPER_VIRTUAL_SOL,
        tokenReserve: PAPER_VIRTUAL_TOKENS,
        createdAt: Date.now(),
      });
    });
    const paper = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    expect(paper).toHaveLength(6);
    expect(paper.every((r) => r.network === "paper")).toBe(true);
    const dev = await t.query(api.solstarMarket.listMarket, {
      sort: "new",
      network: "devnet",
    });
    expect(dev).toHaveLength(1);
    expect(dev[0].ticker).toBe("DEV");
  });

  it("resolves character routes and exposes terminal videos and executed holders", async () => {
    const t = await seeded();
    const rows = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    const target = rows[0];
    expect(target.videosPosted).toBe(1);
    expect(target.holders).toBe(0);
    expect(
      await t.query(api.solstarMarket.characterForRoute, {
        id: target.characterId,
      }),
    ).toMatchObject({ name: target.name });
    expect(
      await t.query(api.solstarMarket.characterForRoute, {
        id: "invalid-handle",
      }),
    ).toBeNull();
    const before = await t.query(api.solstarMarket.terminal, {
      characterId: target.characterId,
    });
    expect(before?.episodes).toHaveLength(1);
    await t.mutation(api.solstarTrade.paperTrade, {
      tokenId: before!.token._id,
      wallet: WALLET,
      side: "buy",
      amount: 1000000000n,
      minOut: 1n,
      quoteExpiresAt: Date.now() + 60000,
      idempotencyKey: "terminal-buy",
      authSecret: SECRET,
    });
    const after = await t.query(api.solstarMarket.terminal, {
      characterId: target.characterId,
    });
    expect(after?.stats?.holders).toHaveLength(1);
    expect(after?.trades).toHaveLength(1);
    expect(after?.stats?.points).toHaveLength(1);
    expect(() => JSON.stringify(after)).not.toThrow();
  });

  it("excludes draft characters", async () => {
    const t = await seeded();
    const all = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    await t.run(async (ctx) => {
      await ctx.db.patch(all[0].characterId, { status: "draft" });
    });
    const rows = await t.query(api.solstarMarket.listMarket, { sort: "new" });
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.characterId === all[0].characterId)).toBe(false);
  });
});


describe("confirmed devnet market", () => {
  it("excludes simulated, pending, and incomplete launch records", async () => {
    const t = await seeded();
    const characters = await t.run(ctx => ctx.db.query("ssCharacters").collect());
    await t.run(async ctx => {
      const tokens = await ctx.db.query("ssTokens").collect();
      await ctx.db.patch(tokens[0]._id, { network: "devnet", state: "pending", mint: "pending" });
      await ctx.db.patch(tokens[1]._id, { network: "devnet", state: "live", mint: "mint", dbcPool: "pool", dbcConfig: "config" });
      await ctx.db.patch(tokens[2]._id, { network: "devnet", state: "live", mint: "missing-pool" });
    });
    const rows = await t.query(api.solstarMarket.listMarket, { sort: "new", network: "devnet", liveOnly: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ network: "devnet", state: "live", dbcPool: "pool" });
    expect(await t.query(api.solstarMarket.listMarket, { sort: "new", network: "paper", liveOnly: true })).toEqual([]);
    expect(characters.length).toBeGreaterThan(0);
  });
});
