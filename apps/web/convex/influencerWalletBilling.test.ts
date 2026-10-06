/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const secret = "wallet-billing-test";
process.env.INTERNAL_CRON_SECRET = secret;
const mint = "WalletBillingAgent";
const owner = "WalletBillingOwner";

async function setup(balance = 1) {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    await ctx.db.insert("influencers", {
      mintAddress: mint, creatorWallet: owner, name: "Agent", handle: "agent", avatarUrl: "",
      niche: "test", language: "English", archetype: "creator", description: "",
      personality: { warmth: 0, humor: 0, authority: 0, boldness: 0 },
      tvl: 0, monthlyEarnings: 0, sharePrice: 0, totalShares: 0, availableShares: 0,
      generationFunding: "agent_wallet",
    });
    await ctx.db.insert("userCredits", { ownerWallet: owner, balanceCredits: 10000, totalPurchasedCredits: 10000, totalSpentCredits: 0, updatedAt: Date.now() });
  });
  await t.mutation(internal.agentAccount.create, { mintAddress: mint });
  await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: mint, onchainUsdc: balance, authSecret: secret });
  return t;
}

describe("influencer wallet generation billing", () => {
  it("denies an empty agent even when its owner has credits", async () => {
    const t = await setup(0);
    const r = await t.mutation(api.usage.recordUsage, { mintAddress: mint, service: "image_gen", qty: 1, authSecret: secret });
    expect(r).toMatchObject({ ok: false, reason: "needs_funding" });
    expect(await t.query(api.userCredits.balanceForMint, { mintAddress: mint })).toBe(10000);
  });

  it("preserves the first wallet and its encrypted key on concurrent provisioning", async () => {
    const t = await setup();
    const first = await t.mutation(api.influencers.setAgentWallet, { mintAddress: mint, agentWallet: "first", agentWalletSecret: "encrypted-first", authSecret: secret });
    const second = await t.mutation(api.influencers.setAgentWallet, { mintAddress: mint, agentWallet: "second", agentWalletSecret: "encrypted-second", authSecret: secret });
    expect(first).toEqual({ agentWallet: "first", created: true });
    expect(second).toEqual({ agentWallet: "first", created: false });
    const agent = await t.query(api.influencers.getByMintServer, { mintAddress: mint, authSecret: secret });
    expect(agent?.agentWalletSecret).toBe("encrypted-first");
  });

  it("atomically prevents concurrent renders from spending the same balance", async () => {
    const t = await setup(1);
    const args = { mintAddress: mint, sessionId: "session", type: "create_video", title: "Video", input: JSON.stringify({ fundingSource: "agent_wallet" }), authSecret: secret };
    const a = await t.mutation(api.agentTasks.create, args);
    const b = await t.mutation(api.agentTasks.create, args);
    expect(await t.mutation(api.agentTasks.holdWallet, { id: a, amountUsdc: 0.75, authSecret: secret })).toMatchObject({ ok: true });
    expect(await t.mutation(api.agentTasks.holdWallet, { id: b, amountUsdc: 0.75, authSecret: secret })).toMatchObject({ ok: false });
    expect(await t.mutation(api.usage.recordUsage, { mintAddress: mint, service: "render", qty: 1, authSecret: secret })).toMatchObject({ ok: false });
    await t.mutation(api.agentTasks.fail, { id: a, errorMessage: "Provider failed", authSecret: secret });
    expect((await t.query(api.agentAccount.get, { mintAddress: mint }))?.generationReservedUsdc).toBe(0);
    expect(await t.mutation(api.agentTasks.holdWallet, { id: b, amountUsdc: 0.75, authSecret: secret })).toMatchObject({ ok: true });
    await t.mutation(api.agentTasks.succeed, { id: b, cost: 0.6, authSecret: secret });
    await t.mutation(api.agentTasks.succeed, { id: b, cost: 0.6, authSecret: secret });
    const account = await t.query(api.agentAccount.get, { mintAddress: mint });
    expect(account?.generationReservedUsdc).toBe(0);
    expect(account?.unsettledTabUsdc).toBeCloseTo(0.6);
    expect(await t.query(api.userCredits.balanceForMint, { mintAddress: mint })).toBe(10000);
  });

  it("does not treat legacy bookkeeping subsidies as spendable wallet money", async () => {
    const t = await setup();
    await t.run(async ctx => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", q => q.eq("mintAddress", mint)).unique();
      await ctx.db.patch(a!._id, { adminAdjustmentUsdc: 100, offchainCreditedUsdc: 100 });
    });
    await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: mint, onchainUsdc: 0, authSecret: secret });
    expect((await t.query(api.agentAccount.get, { mintAddress: mint }))?.escrowUsdc).toBe(0);
  });
});
