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
  it("does not fail for every caller when one coin has no simulated reserves (e.g. the platform token)", async () => {
    const t = await seeded();
    await t.run(async (ctx) => {
      const base = (await ctx.db.query("ssTokens").first())!;
      const character = await ctx.db.get(base.characterId);
      const { _id, _creationTime, ...fields } = character!;
      void _id; void _creationTime;
      const characterId = await ctx.db.insert("ssCharacters", { ...fields, name: "Platform" });
      await ctx.db.insert("ssTokens", {
        characterId, network: "mainnet", name: "Platform", ticker: "PLAT", description: "", state: "live",
        mint: "M".padEnd(44, "x"), dbcPool: "P".padEnd(44, "x"), dbcConfig: "C".padEnd(44, "x"),
        solReserve: 0n, tokenReserve: 0n, createdAt: Date.now(),
      });
    });
    const rows = await t.query(api.solstarMarket.listMarket, { sort: "new", network: "mainnet", liveOnly: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].priceLamports).toBe("0");
    // The rest of the market is unaffected.
    expect(await t.query(api.solstarMarket.listMarket, { sort: "new" })).toHaveLength(6);
  });

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

describe("market summary counters", () => {
  async function liveCoin() {
    const t = await seeded();
    const ids = await t.run(async (ctx) => {
      const base = (await ctx.db.query("ssTokens").first())!;
      const { _id, _creationTime, ...c } = (await ctx.db.get(base.characterId))!;
      void _id; void _creationTime;
      const characterId = await ctx.db.insert("ssCharacters", { ...c, name: "Live" });
      const tokenId = await ctx.db.insert("ssTokens", {
        characterId, network: "mainnet", name: "Live", ticker: "LIVE", description: "", state: "live",
        solReserve: 0n, tokenReserve: 0n, createdAt: Date.now(), mint: "M", dbcPool: "P", dbcConfig: "C",
      });
      await ctx.db.insert("ssEpisodes", { tokenId, index: 0, videoUrl: "v", posterUrl: "p0", title: "t", source: "generated", createdAt: 1 });
      return { characterId, tokenId };
    });
    return { t, ...ids };
  }
  const list = (t: Awaited<ReturnType<typeof seeded>>) => t.query(api.solstarMarket.listMarket, { sort: "new", network: "mainnet", liveOnly: true });

  it("a new row is counted from existing rows, then follow and unfollow keep it exact", async () => {
    const { t, characterId } = await liveCoin();
    expect((await list(t))[0]).toMatchObject({ followers: 0, videosPosted: 1 });
    await t.mutation(api.solstarCatalog.follow, { wallet: WALLET, characterId, authSecret: SECRET });
    await t.mutation(api.solstarCatalog.follow, { wallet: "W2".padEnd(40, "x"), characterId, authSecret: SECRET });
    expect((await list(t))[0]).toMatchObject({ followers: 2, videosPosted: 1 });
    await t.mutation(api.solstarCatalog.unfollow, { wallet: WALLET, characterId, authSecret: SECRET });
    expect((await list(t))[0].followers).toBe(1);
  });

  it("rebuild repairs drifted counters and pages through coins", async () => {
    const { t, characterId, tokenId } = await liveCoin();
    await t.mutation(api.solstarCatalog.follow, { wallet: WALLET, characterId, authSecret: SECRET });
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("ssMarketSummary").withIndex("by_token", (q) => q.eq("tokenId", tokenId)).unique())!;
      await ctx.db.patch(s._id, { followers: 99, episodes: 40 });
    });
    expect((await list(t))[0]).toMatchObject({ followers: 99, videosPosted: 10 });
    const r = await t.mutation(api.solstarMarket.rebuildMarketSummary, { authSecret: SECRET, network: "mainnet" });
    expect(r).toEqual({ rebuilt: 1, next: null });
    expect((await list(t))[0]).toMatchObject({ followers: 1, videosPosted: 1 });
  });
});

describe("characterForRoute (ticker URLs)", () => {
  it("resolves an id to its ticker slug and a ticker slug back to the coin", async () => {
    const t = await seeded();
    const token = await t.run(async (ctx) => (await ctx.db.query("ssTokens").first())!);
    const slug = token.ticker.toLowerCase().replace(/[^a-z0-9]/g, "");
    const byId = await t.query(api.solstarMarket.characterForRoute, { id: token.characterId });
    expect(byId).toMatchObject({ characterId: token.characterId, slug });
    const bySlug = await t.query(api.solstarMarket.characterForRoute, { id: slug });
    expect(bySlug).toMatchObject({ characterId: token.characterId, slug });
    const upper = await t.query(api.solstarMarket.characterForRoute, { id: slug.toUpperCase() });
    expect(upper?.characterId).toBe(token.characterId);
  });

  it("prefers the live mainnet coin when a ticker exists on several networks, and keeps the older one's slug", async () => {
    const t = await seeded();
    const { paper, live } = await t.run(async (ctx) => {
      const paper = (await ctx.db.query("ssTokens").first())!;
      const { _id, _creationTime, ...c } = (await ctx.db.get(paper.characterId))!;
      void _id; void _creationTime;
      const characterId = await ctx.db.insert("ssCharacters", { ...c, name: "Twin" });
      const tokenId = await ctx.db.insert("ssTokens", { characterId, network: "mainnet", name: "Twin", ticker: paper.ticker, description: "", state: "live", solReserve: 0n, tokenReserve: 0n, createdAt: Date.now(), mint: "M", dbcPool: "P", dbcConfig: "C" });
      return { paper, live: { characterId, tokenId } };
    });
    const slug = paper.ticker.toLowerCase();
    expect((await t.query(api.solstarMarket.characterForRoute, { id: slug }))?.characterId).toBe(live.characterId);
    // the paper coin no longer owns the slug, so its id URL stays put rather than redirecting to someone else's coin
    expect((await t.query(api.solstarMarket.characterForRoute, { id: paper.characterId }))?.slug).toBeNull();
  });

  it("lets an agent handle win over a ticker", async () => {
    const t = await seeded();
    const token = await t.run(async (ctx) => (await ctx.db.query("ssTokens").first())!);
    const slug = token.ticker.toLowerCase();
    await t.run(async (ctx) => {
      await ctx.db.insert("influencers", {
        mintAddress: "AGENTMINT", creatorWallet: "W", name: "Agent", handle: slug, handleLower: slug, avatarUrl: "x", niche: "n", language: "en",
        archetype: "a", description: "d", personality: { warmth: 1, humor: 1, authority: 1, boldness: 1 }, tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 1, availableShares: 1,
      });
    });
    expect(await t.query(api.solstarMarket.characterForRoute, { id: slug })).toBeNull();
    expect((await t.query(api.solstarMarket.characterForRoute, { id: token.characterId }))?.slug).toBeNull();
  });

  it("returns null for unknown segments", async () => {
    const t = await seeded();
    expect(await t.query(api.solstarMarket.characterForRoute, { id: "nosuchcoin" })).toBeNull();
    expect(await t.query(api.solstarMarket.characterForRoute, { id: "yumelyn_vello" })).toBeNull();
  });
});
