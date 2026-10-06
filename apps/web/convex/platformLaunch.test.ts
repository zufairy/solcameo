/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const saved = process.env.INTERNAL_CRON_SECRET;
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = "test"; });
afterEach(() => { if (saved === undefined) delete process.env.INTERNAL_CRON_SECRET; else process.env.INTERNAL_CRON_SECRET = saved; });
const draft = { network: "devnet", wallet: "owner", name: "Solcameo", description: "Platform", image: "https://solcameo.com/logo.png", optionsJson: "{}", authSecret: "test" };
describe("official platform launch persistence", () => {
  it("requires the server secret and keeps platform launches separate from agents", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.platformLaunch.draft, { ...draft, authSecret: "wrong" })).rejects.toThrow("unauthorized");
    await t.mutation(api.platformLaunch.draft, draft);
    const counts = await t.run(async ctx => ({ characters: await ctx.db.query("ssCharacters").take(1), agents: await ctx.db.query("influencers").take(1) }));
    expect(counts).toEqual({ characters: [], agents: [] });
  });
  it("locks reviewed terms, refuses competing mints and finalizes idempotently", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.platformLaunch.draft, draft);
    const a = { network: "devnet", wallet: "owner", authSecret: "test", mint: "mint", config: "config" };
    await t.mutation(api.platformLaunch.update, { ...a, action: "reserve" });
    await t.mutation(api.platformLaunch.draft, { ...draft, name: "Changed" });
    expect((await t.query(api.platformLaunch.get, { network: "devnet", authSecret: "test" }))?.name).toBe("Solcameo");
    await expect(t.mutation(api.platformLaunch.update, { ...a, action: "reserve", mint: "other" })).rejects.toThrow("mint_conflict");
    await expect(t.mutation(api.platformLaunch.update, { ...a, action: "reserve", config: "other" })).rejects.toThrow("config_conflict");
    await expect(t.mutation(api.platformLaunch.update, { ...a, action: "finalize" })).rejects.toThrow("confirmation_required");
    const final = { ...a, action: "finalize" as const, pool: "pool", signature: "signature" };
    await t.mutation(api.platformLaunch.update, final);
    await t.mutation(api.platformLaunch.update, final);
    await expect(t.mutation(api.platformLaunch.update, { ...a, action: "release" })).rejects.toThrow("platform_token_already_live");
    expect((await t.query(api.platformLaunch.get, { network: "devnet", authSecret: "test" }))?.state).toBe("live");
  });
  it("isolates networks and rejects another owner or stale recovery", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.platformLaunch.draft, draft);
    await t.mutation(api.platformLaunch.draft, { ...draft, network: "mainnet" });
    await expect(t.mutation(api.platformLaunch.draft, { ...draft, wallet: "other" })).rejects.toThrow("not_owner");
    const a = { network: "devnet", wallet: "owner", authSecret: "test", mint: "mint", config: "config" };
    await t.mutation(api.platformLaunch.update, { ...a, action: "reserve" });
    await expect(t.mutation(api.platformLaunch.update, { ...a, action: "replace", oldMint: "wrong", mint: "new" })).rejects.toThrow("mint_conflict");
    await t.mutation(api.platformLaunch.update, { ...a, action: "replace", oldMint: "mint", mint: "new" });
    await t.mutation(api.platformLaunch.update, { ...a, action: "release", mint: "new" });
    expect((await t.query(api.platformLaunch.get, { network: "devnet", authSecret: "test" }))?.mint).toBeUndefined();
    expect((await t.query(api.platformLaunch.get, { network: "mainnet", authSecret: "test" }))?.state).toBe("draft");
  });
});

describe("platform token market listing", () => {
  it("lists with positive reserves (the market page prices from them) and repairs a zeroed record", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.platformLaunch.draft, draft);
    const a = { network: "devnet", wallet: "owner", authSecret: "test", mint: "mint", config: "config" };
    await t.mutation(api.platformLaunch.update, { ...a, action: "finalize", pool: "pool", signature: "sig" });
    const made = await t.mutation(api.platformLaunch.linkListing, { network: "devnet", authSecret: "test" });
    const token = await t.run(async ctx => ctx.db.query("ssTokens").first());
    expect(token!.tokenReserve > 0n && token!.solReserve > 0n).toBe(true);
    expect((await t.query(api.platformLaunch.listing, { network: "devnet", authSecret: "test" }))).toEqual({ characterId: made.characterId, needsRepair: false });
    // A record created by the earlier version had zero reserves.
    await t.run(async ctx => ctx.db.patch(token!._id, { solReserve: 0n, tokenReserve: 0n }));
    expect((await t.query(api.platformLaunch.listing, { network: "devnet", authSecret: "test" }))?.needsRepair).toBe(true);
    await t.mutation(api.platformLaunch.linkListing, { network: "devnet", authSecret: "test" });
    const fixed = await t.run(async ctx => ctx.db.get(token!._id));
    expect(fixed!.tokenReserve > 0n && fixed!.solReserve > 0n).toBe(true);
  });
});
