/// <reference types="vite/client" />
// convex/solstarCreate.test.ts
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS } from "../lib/solstar/economics";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
const W1 = "A".repeat(40);
const W2 = "B".repeat(40);
const originalSecret = process.env.INTERNAL_CRON_SECRET;
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = SECRET; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.INTERNAL_CRON_SECRET;
  else process.env.INTERNAL_CRON_SECRET = originalSecret;
});

type T = ReturnType<typeof convexTest>;
// convex-test records only size and sha256 for stored blobs; the real backend also records contentType, so patch it in.
type RawPatch = { patch(table: string, id: string, value: Record<string, unknown>): Promise<void> };
const store = (t: T, type: string, bytes = 10): Promise<Id<"_storage">> =>
  t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob([new Uint8Array(bytes)], { type }));
    await (ctx.db as unknown as RawPatch).patch("_storage", id, { contentType: type });
    return id;
  });
const validImage = (t: T) => store(t, "image/png");

type Overrides = Partial<{
  wallet: string; name: string; ticker: string; bio: string; category: string; rightsAttested: boolean;
  idempotencyKey: string; authSecret: string;
}>;
const call = (t: T, imageStorageId: Id<"_storage">, o: Overrides = {}) =>
  t.mutation(api.solstarCreate.createCharacter, {
    wallet: W1, name: "Dino", ticker: "DINO", bio: "A dino", category: "Comedy", rightsAttested: true,
    idempotencyKey: "key-00000001", authSecret: SECRET, imageStorageId, ...o,
  });
const counts = (t: T) => t.run(async (ctx) => ({
  characters: (await ctx.db.query("ssCharacters").collect()).length,
  tokens: (await ctx.db.query("ssTokens").collect()).length,
  budgets: (await ctx.db.query("ssBudgets").collect()).length,
  feed: (await ctx.db.query("ssFeed").collect()).length,
}));
const NONE = { characters: 0, tokens: 0, budgets: 0, feed: 0 };

describe("generateUploadUrl", () => {
  it("returns a url with a valid secret", async () => {
    const t = convexTest(schema, modules);
    const url = await t.mutation(api.solstarCreate.generateUploadUrl, { authSecret: SECRET });
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });
  it("rejects a bad secret", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.solstarCreate.generateUploadUrl, { authSecret: "x" })).rejects.toThrow("unauthorized");
  });
});

describe("createCharacter happy path", () => {
  it("creates character, token, budget and exactly one feed event", async () => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    const res = await call(t, img, { ticker: "DINO" });
    expect(res.reused).toBe(false);
    expect(typeof JSON.stringify(res)).toBe("string");
    expect(await counts(t)).toEqual({ characters: 1, tokens: 1, budgets: 1, feed: 1 });
    await t.run(async (ctx) => {
      const c = await ctx.db.get(res.characterId);
      expect(c).toMatchObject({
        ownerWallet: W1, name: "Dino", bio: "A dino", category: "Comedy", status: "approved",
        rightsAttested: true, rightsReviewed: false, idempotencyKey: "key-00000001", imageStorageId: img,
      });
      expect(c?.referenceImageUrl).toBeTruthy();
      const tok = await ctx.db.get(res.tokenId);
      expect(tok).toMatchObject({
        characterId: res.characterId, network: "paper", state: "paper", name: "Dino", ticker: "DINO", description: "A dino",
        solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS,
      });
      const b = await ctx.db.query("ssBudgets").first();
      expect(b).toMatchObject({ tokenId: res.tokenId, network: "paper", fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
      const f = await ctx.db.query("ssFeed").first();
      expect(f).toMatchObject({ kind: "event", eventType: "character_created", wallet: W1, characterId: res.characterId, tokenId: res.tokenId, network: "paper" });
      expect(f?.body).toContain("Dino");
      expect(f?.body).toContain("$DINO");
      expect(f?.body).toContain("simulated paper token");
    });
  });
  it("normalises name and bio, uppercases ticker", async () => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    const res = await call(t, img, { name: "  Di​no\n ", ticker: "dino", bio: " hi\u0007 there " });
    await t.run(async (ctx) => {
      expect((await ctx.db.get(res.characterId))?.name).toBe("Dino");
      expect((await ctx.db.get(res.characterId))?.bio).toBe("hi there");
      expect((await ctx.db.get(res.tokenId))?.ticker).toBe("DINO");
    });
  });
  it("accepts an empty bio", async () => {
    const t = convexTest(schema, modules);
    const res = await call(t, await validImage(t), { bio: "" });
    expect(res.reused).toBe(false);
  });
});

describe("idempotency", () => {
  it("replay by the same wallet returns the original ids with no side effects", async () => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    const first = await call(t, img);
    const again = await call(t, img);
    expect(again).toEqual({ characterId: first.characterId, tokenId: first.tokenId, agentMintAddress: first.agentMintAddress, reused: true });
    expect(await counts(t)).toEqual({ characters: 1, tokens: 1, budgets: 1, feed: 1 });
  });
  it("same key by a different wallet conflicts", async () => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    await call(t, img);
    await expect(call(t, img, { wallet: W2 })).rejects.toThrow("idempotency_conflict");
    expect(await counts(t)).toEqual({ characters: 1, tokens: 1, budgets: 1, feed: 1 });
  });
});

describe("validation (no writes on rejection)", () => {
  it("unauthorized secret", async () => {
    const t = convexTest(schema, modules);
    await expect(call(t, await validImage(t), { authSecret: "nope" })).rejects.toThrow("unauthorized");
    expect(await counts(t)).toEqual(NONE);
  });
  const cases: Array<[string, Overrides, string]> = [
    ["wallet too short", { wallet: "short" }, "invalid_wallet"],
    ["wallet too long", { wallet: "A".repeat(45) }, "invalid_wallet"],
    ["name 1 char", { name: "a" }, "invalid_name"],
    ["name 33 chars", { name: "a".repeat(33) }, "invalid_name"],
    ["name too short after stripping invisibles", { name: "\u200Ba\u200B", ticker: "OKAY" }, "invalid_name"],
    ["ticker 1 char", { ticker: "A" }, "invalid_ticker"],
    ["ticker 11 chars", { ticker: "A".repeat(11) }, "invalid_ticker"],
    ["ticker symbols", { ticker: "DI-NO" }, "invalid_ticker"],
    ["bio 281 chars", { bio: "b".repeat(281) }, "invalid_bio"],
    ["bad category", { category: "Nope" }, "invalid_category"],
    ["rights not attested", { rightsAttested: false }, "rights_required"],
    ["key too short", { idempotencyKey: "short" }, "invalid_key"],
    ["key too long", { idempotencyKey: "k".repeat(129) }, "invalid_key"],
  ];
  it.each(cases)("%s", async (_n, o, code) => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    await expect(call(t, img, o)).rejects.toThrow(code);
    expect(await counts(t)).toEqual(NONE);
  });
  it("boundary values pass", async () => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    await call(t, img, { name: "ab", ticker: "AB", bio: "", idempotencyKey: "k".repeat(8) });
    await call(t, img, { name: "a".repeat(32), ticker: "A".repeat(10), bio: "b".repeat(280), idempotencyKey: "k".repeat(128) });
    expect((await counts(t)).characters).toBe(2);
  });
});

describe("image checks", () => {
  it("wrong content type", async () => {
    const t = convexTest(schema, modules);
    await expect(call(t, await store(t, "text/plain"))).rejects.toThrow("invalid_image");
    expect(await counts(t)).toEqual(NONE);
  });
  it("oversize file", async () => {
    const t = convexTest(schema, modules);
    await expect(call(t, await store(t, "image/png", 2_097_153))).rejects.toThrow("invalid_image");
    expect(await counts(t)).toEqual(NONE);
  });
  it("exactly 2 MiB is accepted; webp and jpeg too", async () => {
    const t = convexTest(schema, modules);
    await call(t, await store(t, "image/png", 2_097_152), { ticker: "AAA", idempotencyKey: "key-aaaaaaa1" });
    await call(t, await store(t, "image/webp"), { ticker: "BBB", idempotencyKey: "key-aaaaaaa2" });
    await call(t, await store(t, "image/jpeg"), { ticker: "CCC", idempotencyKey: "key-aaaaaaa3" });
    expect((await counts(t)).characters).toBe(3);
  });
  it("deleted file", async () => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    await t.run(async (ctx) => ctx.storage.delete(img));
    await expect(call(t, img)).rejects.toThrow("invalid_image");
    expect(await counts(t)).toEqual(NONE);
  });
});

describe("ticker uniqueness", () => {
  it("is case-insensitive among paper tokens", async () => {
    const t = convexTest(schema, modules);
    const img = await validImage(t);
    await call(t, img, { ticker: "dino" });
    await expect(call(t, img, { ticker: "DINO", idempotencyKey: "key-00000002", wallet: W2 })).rejects.toThrow("ticker_taken");
    await expect(call(t, img, { ticker: "Dino", idempotencyKey: "key-00000003" })).rejects.toThrow("ticker_taken");
    expect(await counts(t)).toEqual({ characters: 1, tokens: 1, budgets: 1, feed: 1 });
  });
});

describe("unlimited character creation", () => {
  const seedRecent = (t: T, wallet: string, ageMs: number, n: number) =>
    t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("ssCharacters", {
          ownerWallet: wallet, name: `Old${i}`, bio: "", referenceImageUrl: "https://x/y.png", category: "Comedy",
          status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: Date.now() - ageMs,
        });
      }
    });
  it("allows a fourth character in a day for the same wallet", async () => {
    const t = convexTest(schema, modules);
    await seedRecent(t, W1, 60_000, 3);
    const result = await call(t, await validImage(t));
    expect(result.characterId).toBeTruthy();
    expect((await counts(t)).tokens).toBe(1);
  });
  it("does not count rows older than 24h or other wallets", async () => {
    const t = convexTest(schema, modules);
    await seedRecent(t, W1, 86_400_000 + 60_000, 3);
    await seedRecent(t, W2, 60_000, 3);
    const res = await call(t, await validImage(t));
    expect(res.reused).toBe(false);
  });
  it("allows the 3rd", async () => {
    const t = convexTest(schema, modules);
    await seedRecent(t, W1, 60_000, 2);
    expect((await call(t, await validImage(t))).reused).toBe(false);
  });
});

describe("Pump launch plans and mint reservations", () => {
  it("persists the reviewed fee and posting budget options without inventing funded balance", async () => {
    const t = convexTest(schema, modules), imageStorageId = await validImage(t);
    const launchOptions = { pair: "USDC" as const, customMint: "", rewards: "creator" as const, aiBps: 3500, operationsWallet: W2, postingBudgetUsdc: 50 };
    const result = await t.mutation(api.solstarCreate.createCharacter, { wallet: W1, name: "Dino", ticker: "DINO", bio: "", category: "Comedy", rightsAttested: true, idempotencyKey: "key-00000001", authSecret: SECRET, imageStorageId, launchOptions });
    const lookup = await t.query(api.solstarCreate.getLaunchCharacter, { characterId: result.characterId, wallet: W1, authSecret: SECRET });
    expect(lookup.character.launchOptions).toEqual(launchOptions); expect(lookup.token.network).toBe("paper");
    expect(await t.run(ctx => ctx.db.query("ssBudgets").first())).toMatchObject({ fundedLamports: 0n });
  });
  it("permits retrying the same reserved mint, rejects a second mint and a different owner", async () => {
    const t = convexTest(schema, modules), result = await call(t, await validImage(t));
    const args = { characterId: result.characterId, wallet: W1, mint: "mint-1", authSecret: SECRET };
    await t.mutation(api.solstarCreate.reservePumpMint, args);
    await expect(t.mutation(api.solstarCreate.reservePumpMint, args)).resolves.toMatchObject({ mint: "mint-1" });
    await expect(t.mutation(api.solstarCreate.reservePumpMint, { ...args, mint: "mint-2" })).rejects.toThrow("launch_conflict");
    await expect(t.mutation(api.solstarCreate.reservePumpMint, { ...args, wallet: W2 })).rejects.toThrow("character_not_found");
  });
  it("marks confirmed launches live, prevents replacing their mint, and keeps repeated finalization idempotent", async () => {
    const t = convexTest(schema, modules), result = await call(t, await validImage(t));
    const args = { characterId: result.characterId, wallet: W1, mint: "mint-1", launchSignature: "verified-launch", sharingSignature: "verified-split", authSecret: SECRET };
    await t.mutation(api.solstarCreate.finalizePumpLaunch, args); await t.mutation(api.solstarCreate.finalizePumpLaunch, args);
    const lookup = await t.query(api.solstarCreate.getLaunchCharacter, { characterId: result.characterId, wallet: W1, authSecret: SECRET });
    expect(lookup.token).toMatchObject({ network: "mainnet", state: "live", mint: "mint-1", sharingSignature: "verified-split" });
    await expect(t.mutation(api.solstarCreate.finalizePumpLaunch, { ...args, mint: "mint-2" })).rejects.toThrow("launch_conflict");
    await expect(t.query(api.solstarCreate.getLaunchCharacter, { characterId: result.characterId, wallet: W2, authSecret: SECRET })).rejects.toThrow();
  });
});


describe("coin-created agent linkage", () => {
  it("creates exactly one owned agent and economic account with the coin and keeps its identity across retries", async () => {
    const t = convexTest(schema, modules);
    const image = await validImage(t);
    const result = await call(t, image);
    const retry = await call(t, image);
    expect(retry.agentMintAddress).toBe(result.agentMintAddress);
    const agents = await t.query(api.influencers.listByCreators, { creatorWallets: [W1] });
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ mintAddress: result.agentMintAddress, solstarCharacterId: result.characterId, solstarTokenId: result.tokenId, creatorWallet: W1, name: "Dino", agentType: "influencer" });
    expect(await t.query(api.influencers.listByCreators, { creatorWallets: [W2] })).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("agentAccount").collect())).toHaveLength(1);
    const mint = "C".repeat(40);
    await t.mutation(api.solstarCreate.reservePumpMint, { characterId: result.characterId, wallet: W1, mint, authSecret: SECRET });
    await t.mutation(api.solstarCreate.finalizeDbcLaunch, { characterId: result.characterId, wallet: W1, mint, config: "config", pool: "pool", network: "devnet", launchSignature: "confirmed", authSecret: SECRET });
    const afterLaunch = await t.query(api.influencers.listByCreators, { creatorWallets: [W1] });
    expect(afterLaunch).toHaveLength(1);
    expect(afterLaunch[0].mintAddress).toBe(result.agentMintAddress);
    expect(afterLaunch[0].solstarTokenId).toBe(result.tokenId);
  });
  it("repairs existing coins idempotently and excludes seeded demos", async () => {
    const t = convexTest(schema, modules);
    const result = await call(t, await validImage(t));
    await t.run(async ctx => {
      for (const row of await ctx.db.query("influencers").collect()) await ctx.db.delete(row._id);
      await ctx.db.insert("ssCharacters", { ownerWallet: W1, name: "Demo", bio: "", category: "Comedy", referenceImageUrl: "https://example.com/demo.png", status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: Date.now() });
    });
    await t.mutation(internal.solstarCreate.backfillCharacterAgents, { cursor: null });
    await t.mutation(internal.solstarCreate.backfillCharacterAgents, { cursor: null });
    const agents = await t.query(api.influencers.listByCreators, { creatorWallets: [W1] });
    expect(agents).toHaveLength(1);
    expect(agents[0].solstarCharacterId).toBe(result.characterId);
  });
});
