/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// invest is now secret-gated (server-only); give the test a matching secret.
const SECRET = "test-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

const modules = import.meta.glob("./**/*.ts");

// ─── helpers ─────────────────────────────────────────────────────────────────

async function seedInfluencer(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("influencers", {
      mintAddress: "MINT_AAA",
      creatorWallet: "Creator111111111111111111111111111111111111",
      name: "Test Agent",
      handle: "testagent",
      avatarUrl: "",
      niche: "tech",
      language: "English",
      archetype: "friend",
      description: "Test",
      personality: { warmth: 50, humor: 50, authority: 50, boldness: 50 },
      tvl: 0,
      monthlyEarnings: 0,
      sharePrice: 10,
      totalShares: 1000,
      availableShares: 1000,
    });
  });
}

async function seedCampaign(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("campaigns", {
      creatorWallet: "Creator111111111111111111111111111111111111",
      brandName: "Acme",
      brandLogoUrl: "https://example.com/logo.svg",
      title: "Test Campaign",
      brief: "Brief",
      budget: 500,
      ratePerThousandViews: 5,
      targetNiche: ["tech"],
      targetLanguage: ["en"],
      status: "open",
      submissionsCount: 0,
      deadline: "2026-12-31",
    });
  });
}

// ─── invest idempotency ───────────────────────────────────────────────────────

describe("influencers.invest — replay protection", () => {
  it("rejects a replayed txSignature from the same investor", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t);

    await t.mutation(api.influencers.invest, {
      mintAddress: "MINT_AAA",
      investorWallet: "Investor111111111111111111111111111111111",
      usdcAmount: 50,
      txSignature: "SIG_INVEST_001",
        authSecret: SECRET,
    });

    await expect(
      t.mutation(api.influencers.invest, {
        mintAddress: "MINT_AAA",
        investorWallet: "Investor111111111111111111111111111111111",
        usdcAmount: 50,
        txSignature: "SIG_INVEST_001",
        authSecret: SECRET,
      })
    ).rejects.toThrow("Transaction already processed");
  });

  it("rejects a replayed txSignature from a DIFFERENT investor wallet", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t);

    await t.mutation(api.influencers.invest, {
      mintAddress: "MINT_AAA",
      investorWallet: "Investor111111111111111111111111111111111",
      usdcAmount: 50,
      txSignature: "SIG_INVEST_002",
        authSecret: SECRET,
    });

    // Different wallet, same signature — must still be rejected
    await expect(
      t.mutation(api.influencers.invest, {
        mintAddress: "MINT_AAA",
        investorWallet: "Investor222222222222222222222222222222222",
        usdcAmount: 50,
        txSignature: "SIG_INVEST_002",
        authSecret: SECRET,
      })
    ).rejects.toThrow("Transaction already processed");
  });

  it("credits only the on-chain amount, not a manipulated client amount", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t);

    // First call succeeds with 50 USDC
    await t.mutation(api.influencers.invest, {
      mintAddress: "MINT_AAA",
      investorWallet: "Investor333333333333333333333333333333333",
      usdcAmount: 50,
      txSignature: "SIG_INVEST_003",
        authSecret: SECRET,
    });

    // Same signature but with inflated amount — must be rejected at the signature layer
    await expect(
      t.mutation(api.influencers.invest, {
        mintAddress: "MINT_AAA",
        investorWallet: "Investor333333333333333333333333333333333",
        usdcAmount: 999_999,
        txSignature: "SIG_INVEST_003",
        authSecret: SECRET,
      })
    ).rejects.toThrow("Transaction already processed");
  });
});

// ─── topUpBudget idempotency ──────────────────────────────────────────────────

describe("campaigns.topUpBudget — replay protection", () => {
  it("rejects a replayed txSignature", async () => {
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);

    await t.mutation(api.campaigns.topUpBudget, {
      id: campaignId,
      amount: 100,
      txSignature: "SIG_TOPUP_001",
      callerWallet: "Creator111111111111111111111111111111111111",
      authSecret: SECRET,
    });

    await expect(
      t.mutation(api.campaigns.topUpBudget, {
        id: campaignId,
        amount: 100,
        txSignature: "SIG_TOPUP_001",
        callerWallet: "Creator111111111111111111111111111111111111",
        authSecret: SECRET,
      })
    ).rejects.toThrow("Transaction already processed");
  });

  it("only adds budget once even if called concurrently with same sig", async () => {
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);

    // Sequential simulation — one commit, one reject
    await t.mutation(api.campaigns.topUpBudget, {
      id: campaignId,
      amount: 200,
      txSignature: "SIG_TOPUP_002",
      callerWallet: "Creator111111111111111111111111111111111111",
      authSecret: SECRET,
    });
    await expect(
      t.mutation(api.campaigns.topUpBudget, {
        id: campaignId,
        amount: 200,
        txSignature: "SIG_TOPUP_002",
        callerWallet: "Creator111111111111111111111111111111111111",
        authSecret: SECRET,
      })
    ).rejects.toThrow("Transaction already processed");

    // Budget should be 500 (seed) + 200 (one top-up), not 900 (two top-ups)
    const campaign = await t.run(async (ctx) => ctx.db.get(campaignId));
    expect(campaign?.budget).toBe(700);
  });
});

// ─── cross-path signature isolation ──────────────────────────────────────────

describe("cross-path signature isolation", () => {
  it("rejects a signature used in deposit when replayed for invest", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t);

    // Manually insert a processedSignature as if deposit already consumed it
    await t.run(async (ctx) => {
      await ctx.db.insert("processedSignatures", {
        txSignature: "SIG_CROSS_001",
        purpose: "trader_deposit",
        ref: "MINT_AAA",
        amount: 50,
        consumedAt: Date.now(),
      });
    });

    // Attempting to use the same signature for invest should fail
    await expect(
      t.mutation(api.influencers.invest, {
        mintAddress: "MINT_AAA",
        investorWallet: "Investor444444444444444444444444444444444",
        usdcAmount: 50,
        txSignature: "SIG_CROSS_001",
        authSecret: SECRET,
      })
    ).rejects.toThrow("Transaction already processed");
  });
});
