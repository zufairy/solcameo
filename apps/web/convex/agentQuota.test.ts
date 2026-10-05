/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");
const secret = "quota-test-secret";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = secret; });
const mintArgs = (sessionId: string, wallet = "wallet-a", wallets = ["wallet-a", "wallet-b"]) => ({
  authSecret: secret, sessionId, creatorWallet: wallet, creatorWallets: wallets,
  creatorDid: "account", standardFeeUsdc: 0, forceFree: true,
});
const saveArgs = (sessionId: string, mintAddress: string, creatorWallet = "wallet-a") => ({
  authSecret: secret, sessionId, mintAddress, creatorWallet,
  name: "Agent", handle: mintAddress, avatarUrl: "https://example.com/avatar.png",
  niche: "tech", language: "en", archetype: "builder", description: "test",
});

it("free accounts get one agent across wallets, and deletion frees a slot without allowing deleted-session replay", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.mintFee.reserveMintFee, mintArgs("one"));
  expect(await t.mutation(api.mintFee.claimMint, mintArgs("one"))).toMatchObject({ ok: true });
  await t.mutation(api.nftAgents.saveInfluencer, saveArgs("one", "mint-one"));
  await t.mutation(api.mintFee.reserveMintFee, mintArgs("two", "wallet-b"));
  expect(await t.mutation(api.mintFee.claimMint, mintArgs("two", "wallet-b"))).toMatchObject({ ok: false, agentLimit: 1, agentCount: 1 });
  // Existing agents remain editable when their account is at the limit.
  await t.mutation(api.nftAgents.saveInfluencer, { ...saveArgs("one", "mint-one"), name: "Updated" });
  expect(await t.query(api.influencers.getByMint, { mintAddress: "mint-one" })).toMatchObject({ name: "Updated" });
  await t.mutation(api.influencers.deleteByMint, { authSecret: secret, mintAddress: "mint-one" });
  await expect(t.mutation(api.mintFee.reserveMintFee, mintArgs("one"))).rejects.toThrow(/deleted/);
  await expect(t.mutation(api.nftAgents.saveInfluencer, saveArgs("one", "mint-one"))).rejects.toThrow(/reservation/);
  expect(await t.mutation(api.mintFee.claimMint, mintArgs("two", "wallet-b"))).toMatchObject({ ok: true });
  await t.mutation(api.nftAgents.saveInfluencer, saveArgs("two", "mint-two", "wallet-b"));
});

it("banked reservations and duplicate attempts cannot claim a second free slot", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.mintFee.reserveMintFee, mintArgs("one"));
  await t.mutation(api.mintFee.reserveMintFee, mintArgs("two"));
  const claims = await Promise.all([t.mutation(api.mintFee.claimMint, mintArgs("one")), t.mutation(api.mintFee.claimMint, mintArgs("two"))]);
  expect(claims.filter(r => r.ok)).toHaveLength(1);
  expect(claims.filter(r => !r.ok)).toHaveLength(1);
});

it("an expired claim cannot insert an extra agent after another session claims the slot", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.mintFee.reserveMintFee, mintArgs("old"));
  await t.mutation(api.mintFee.claimMint, mintArgs("old"));
  await t.run(async ctx => {
    const row = await ctx.db.query("agentMintCharges").withIndex("by_session", q => q.eq("sessionId", "old")).unique();
    await ctx.db.patch(row!._id, { committedAt: Date.now() - 360_000 });
  });
  await t.mutation(api.mintFee.reserveMintFee, mintArgs("new"));
  await t.mutation(api.mintFee.claimMint, mintArgs("new"));
  await expect(t.mutation(api.nftAgents.saveInfluencer, saveArgs("old", "mint-old"))).rejects.toThrow(/limit reached/);
});

it("server identity includes the account's linked wallets and omits another owner's agent", async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { supabaseId: "account", walletAddress: "wallet-a" });
    await ctx.db.insert("walletLinks", { userId, walletAddress: "wallet-b", createdAt: 1 });
  });
  await t.mutation(api.nftAgents.saveInfluencer, saveArgs("internal-a", "mint-a"));
  await t.mutation(api.nftAgents.saveInfluencer, saveArgs("internal-b", "mint-b", "wallet-b"));
  await t.mutation(api.nftAgents.saveInfluencer, saveArgs("internal-other", "mint-other", "other"));
  const identity = await t.query(api.mintFee.accountIdentity, { authSecret: secret, userId: "account", wallets: [] });
  expect(identity.wallets.sort()).toEqual(["wallet-a", "wallet-b"]);
  expect(identity.agents.map(a => a.mintAddress).sort()).toEqual(["mint-a", "mint-b"]);
  await expect(t.query(api.mintFee.accountIdentity, { authSecret: "wrong", userId: "account", wallets: [] })).rejects.toThrow(/unauthorized/);
});

it("a session cannot be resumed by a different account", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.mintFee.reserveMintFee, mintArgs("one"));
  await expect(t.mutation(api.mintFee.claimMint, { ...mintArgs("one"), creatorDid: "different" })).rejects.toThrow(/another account/);
  await expect(t.mutation(api.mintFee.reserveMintFee, { ...mintArgs("one"), creatorWallet: "other" })).rejects.toThrow(/another account/);
});
