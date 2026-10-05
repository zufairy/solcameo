/// <reference types="vite/client" />
// convex/solstarCatalog.test.ts
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
const originalSecret = process.env.INTERNAL_CRON_SECRET;
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = SECRET; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.INTERNAL_CRON_SECRET;
  else process.env.INTERNAL_CRON_SECRET = originalSecret;
});

describe("seedSample + listCharacters", () => {
  it("seeds once, with no trades or ledger rows", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
    await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
    const list = await t.query(api.solstarCatalog.listCharacters, {});
    expect(list).toHaveLength(6);
    const counts = await t.run(async (ctx) => ({
      trades: (await ctx.db.query("ssTrades").collect()).length,
      ledger: (await ctx.db.query("ssLedger").collect()).length,
    }));
    expect(counts).toEqual({ trades: 0, ledger: 0 });
  });
  it("seed requires the secret", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.solstarCatalog.seedSample, { authSecret: "x" })).rejects.toThrow("unauthorized");
  });
  it("filters by search and category, and never leaks another network", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
    const all = await t.query(api.solstarCatalog.listCharacters, {});
    const first = all[0];
    expect(await t.query(api.solstarCatalog.listCharacters, { search: first.character.name.toUpperCase() })).not.toHaveLength(0);
    expect(await t.query(api.solstarCatalog.listCharacters, { search: "zzzz-no-match" })).toHaveLength(0);
    expect(await t.query(api.solstarCatalog.listCharacters, { category: first.character.category })).not.toHaveLength(0);
    expect(await t.query(api.solstarCatalog.listCharacters, { network: "mainnet" })).toHaveLength(0);
  });
  it("hides draft/archived characters", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
    const [first] = await t.query(api.solstarCatalog.listCharacters, {});
    await t.run(async (ctx) => ctx.db.patch(first.character._id, { status: "draft" }));
    expect(await t.query(api.solstarCatalog.listCharacters, {})).toHaveLength(5);
  });
});

describe("getTokenPool", () => {
  it("returns reserves as strings", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
    const [{ token }] = await t.query(api.solstarCatalog.listCharacters, {});
    const pool = await t.query(api.solstarCatalog.getTokenPool, { tokenId: token._id });
    expect(pool).toEqual({ solReserve: "30000000000", tokenReserve: "1000000000000000", network: "paper" });
  });
});

describe("follow", () => {
  it("is idempotent and counted", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
    const [{ character }] = await t.query(api.solstarCatalog.listCharacters, {});
    const a = { wallet: "W1".padEnd(32, "x"), characterId: character._id, authSecret: SECRET };
    await t.mutation(api.solstarCatalog.follow, a);
    await t.mutation(api.solstarCatalog.follow, a);
    expect(await t.query(api.solstarCatalog.isFollowing, { wallet: a.wallet, characterId: character._id })).toBe(true);
    expect((await t.query(api.solstarCatalog.getCharacter, { characterId: character._id }))!.followers).toBe(1);
    await t.mutation(api.solstarCatalog.unfollow, a);
    expect((await t.query(api.solstarCatalog.getCharacter, { characterId: character._id }))!.followers).toBe(0);
  });
  it("rejects a bad secret and a malformed wallet", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.solstarCatalog.seedSample, { authSecret: SECRET });
    const [{ character }] = await t.query(api.solstarCatalog.listCharacters, {});
    await expect(t.mutation(api.solstarCatalog.follow, { wallet: "W".padEnd(32, "x"), characterId: character._id, authSecret: "bad" })).rejects.toThrow("unauthorized");
    await expect(t.mutation(api.solstarCatalog.follow, { wallet: "short", characterId: character._id, authSecret: SECRET })).rejects.toThrow("invalid_wallet");
  });
});
