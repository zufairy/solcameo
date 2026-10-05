/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());
it("requires owner authorization and a reserved mint, then finalizes once", async () => {
  vi.stubEnv("INTERNAL_CRON_SECRET", "dbc-test");
  const t = convexTest(schema, modules);
  const characterId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("ssCharacters", {
      ownerWallet: "owner",
      name: "DBC",
      bio: "",
      category: "Comedy",
      referenceImageUrl: "https://example.com/image",
      status: "approved",
      rightsAttested: true,
      rightsReviewed: false,
      createdAt: Date.now(),
    });
    const tokenId = await ctx.db.insert("ssTokens", {
      characterId: id,
      network: "paper",
      name: "DBC",
      ticker: "DBC",
      description: "",
      state: "paper",
      solReserve: 30n,
      tokenReserve: 1000n,
      createdAt: Date.now(),
    });
    await ctx.db.insert("ssBudgets", { tokenId, network: "paper", fundedLamports: 100n, reservedLamports: 0n, spentLamports: 0n });
    return id;
  });
  const args = {
    characterId,
    wallet: "owner",
    mint: "mint",
    config: "config",
    pool: "pool",
    network: "devnet" as const,
    launchSignature: "signature",
    authSecret: "dbc-test",
  };
  await expect(
    t.mutation(api.solstarCreate.finalizeDbcLaunch, {
      ...args,
      wallet: "other",
    }),
  ).rejects.toThrow("character_not_found");
  await expect(
    t.mutation(api.solstarCreate.finalizeDbcLaunch, args),
  ).rejects.toThrow("launch_conflict");
  await t.mutation(api.solstarCreate.reservePumpMint, {
    characterId,
    wallet: "owner",
    mint: "mint",
    authSecret: "dbc-test",
  });
  await t.mutation(api.solstarCreate.finalizeDbcLaunch, args);
  await expect(
    t.mutation(api.solstarCreate.finalizeDbcLaunch, args),
  ).resolves.toEqual({ mint: "mint" });
  const market = await t.query(api.solstarMarket.terminal, { characterId });
  expect(market!.budget.funded).toBe("0");
  expect(market!.token).toMatchObject({
    dbcPool: "pool",
    dbcConfig: "config",
    network: "devnet",
    state: "live",
  });
});
