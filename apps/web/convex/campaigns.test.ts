/// <reference types="vite/client" />
/**
 * Tests for `campaigns.getFundedByContentRewardId` — the query that powers the
 * clipJobs USDC bridge (Task 1.2: auto-match a v2 campaign to a contentRewardId).
 *
 * "Failing test" scenario today: a v2 campaign (pdaAddress + onchainVersion:2) with
 * a matching contentRewardId exists, but getFundedByContentRewardId returns null
 * because no code previously wrote contentRewardId + pdaAddress + onchainVersion:2
 * together. After Task 1.1 + 1.2 all tests must pass.
 */
import { convexTest } from "convex-test";
import { describe, it, test, expect } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// updateCampaignPda is now internal-secret gated; tests inject the same secret.
process.env.INTERNAL_CRON_SECRET = process.env.INTERNAL_CRON_SECRET || "test-cron-secret";

const CREATOR = "Creator11111111111111111111111111111111111";
const PDA = "Vault111111111111111111111111111111111111";
const CONTENT_REWARD_ID = "test-content-reward-uuid-R";

/** Minimal campaign db fields shared by all tests (bypasses Convex validator,
 *  inserted directly via ctx.db.insert in t.run for test isolation). */
const baseCampaign = {
  creatorWallet: CREATOR,
  brandName: "Acme",
  brandLogoUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Acme",
  title: "Clip campaign",
  brief: "Clip the keynote for Acme Q3",
  budget: 500,
  ratePerThousandViews: 3,
  campaignType: "marketing",
  targetNiche: ["tech"] as string[],
  targetLanguage: ["en"] as string[],
  deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  status: "open",
  submissionsCount: 0,
};

describe("Stage on-chain inventory", () => {
  it("returns only finalized v2 vaults, excluding drafts and legacy mirrors", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => ({
      funded: await ctx.db.insert("campaigns", { ...baseCampaign, pdaAddress: PDA, onchainVersion: 2 }),
      draft: await ctx.db.insert("campaigns", { ...baseCampaign, onchainVersion: 2 }),
      legacy: await ctx.db.insert("campaigns", { ...baseCampaign, pdaAddress: "LegacyVault", onchainVersion: 1 }),
      mirror: await ctx.db.insert("campaigns", { ...baseCampaign, pdaAddress: "MirrorVault", onchainVersion: 2, origin: "clipping_fr" }),
    }));

    const stage = await t.query(api.campaigns.listStage, {});
    expect(stage.map((campaign) => campaign._id)).toEqual([ids.funded]);
    expect(await t.query(api.campaigns.getStageById, { id: ids.funded })).not.toBeNull();
    for (const id of [ids.draft, ids.legacy, ids.mirror]) {
      expect(await t.query(api.campaigns.getStageById, { id })).toBeNull();
    }
  });
});

describe("getFundedByContentRewardId", () => {
  it("returns null when no campaign is linked to the content reward", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(internal.campaigns.getFundedByContentRewardId, {
      contentRewardId: CONTENT_REWARD_ID,
    });
    expect(result).toBeNull();
  });

  it("returns null for a v1 campaign (no pdaAddress) even when contentRewardId matches", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("campaigns", {
        ...baseCampaign,
        contentRewardId: CONTENT_REWARD_ID,
        // No pdaAddress, no onchainVersion → v1 → must NOT match
      });
    });
    const result = await t.query(internal.campaigns.getFundedByContentRewardId, {
      contentRewardId: CONTENT_REWARD_ID,
    });
    expect(result).toBeNull();
  });

  it("returns null when pdaAddress is set but onchainVersion < 2", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("campaigns", {
        ...baseCampaign,
        contentRewardId: CONTENT_REWARD_ID,
        pdaAddress: PDA,
        onchainVersion: 1, // explicitly v1 → must NOT match
      });
    });
    const result = await t.query(internal.campaigns.getFundedByContentRewardId, {
      contentRewardId: CONTENT_REWARD_ID,
    });
    expect(result).toBeNull();
  });

  it("returns the campaign when contentRewardId + pdaAddress + onchainVersion:2 are all set", async () => {
    // TARGET STATE after Task 1.1+1.2: a v2 funded campaign the clip bridge can find.
    const t = convexTest(schema, modules);
    const campaignId = await t.run(async (ctx) =>
      ctx.db.insert("campaigns", {
        ...baseCampaign,
        contentRewardId: CONTENT_REWARD_ID,
        pdaAddress: PDA,
        onchainVersion: 2,
      }),
    );

    const result = await t.query(internal.campaigns.getFundedByContentRewardId, {
      contentRewardId: CONTENT_REWARD_ID,
    });

    expect(result).not.toBeNull();
    expect(result!._id).toBe(campaignId);
    expect(result!.creatorWallet).toBe(CREATOR);
    expect(result!.onchainVersion).toBe(2);
  });

  it("patchContentRewardId links a v2 campaign and makes getFundedByContentRewardId match", async () => {
    const t = convexTest(schema, modules);
    // Campaign that has pdaAddress+onchainVersion:2 but NO contentRewardId
    // (as it would be right after updateCampaignPda succeeds but before
    // autoLinkContentReward fires and patches it).
    const campaignId: Id<"campaigns"> = await t.run(async (ctx) =>
      ctx.db.insert("campaigns", {
        ...baseCampaign,
        pdaAddress: PDA,
        onchainVersion: 2,
        // contentRewardId NOT set yet
      }),
    );

    // Before patch: no match
    const before = await t.query(internal.campaigns.getFundedByContentRewardId, {
      contentRewardId: CONTENT_REWARD_ID,
    });
    expect(before).toBeNull();

    // Simulate autoLinkContentReward resolving the match and calling patchContentRewardId
    await t.mutation(internal.campaigns.patchContentRewardId, {
      campaignId,
      contentRewardId: CONTENT_REWARD_ID,
    });

    // After patch: match found
    const after = await t.query(internal.campaigns.getFundedByContentRewardId, {
      contentRewardId: CONTENT_REWARD_ID,
    });
    expect(after).not.toBeNull();
    expect(after!._id).toBe(campaignId);
  });

  it("patchContentRewardId is a no-op when contentRewardId is already set (no overwrite)", async () => {
    const t = convexTest(schema, modules);
    const ORIGINAL = "original-content-reward-id";
    const DIFFERENT = "different-content-reward-id";

    const campaignId: Id<"campaigns"> = await t.run(async (ctx) =>
      ctx.db.insert("campaigns", {
        ...baseCampaign,
        pdaAddress: PDA,
        onchainVersion: 2,
        contentRewardId: ORIGINAL, // already linked
      }),
    );

    // Attempt to overwrite — must be silently ignored
    await t.mutation(internal.campaigns.patchContentRewardId, {
      campaignId,
      contentRewardId: DIFFERENT,
    });

    const row = await t.run(async (ctx) => ctx.db.get(campaignId));
    expect(row!.contentRewardId).toBe(ORIGINAL); // unchanged
  });
});

test("listDraftsByCreator returns only unfunded open drafts", async () => {
  const t = convexTest(schema, modules);
  const wallet = "Wa11etCreator1111111111111111111111111111111";
  // draft: no pdaAddress
  await t.mutation(api.campaigns.create, {
    creatorWallet: wallet, brandName: "B", title: "Draft one",
    brief: "x".repeat(60), budget: 100, ratePerThousandViews: 3,
    campaignType: "marketing", targetNiche: ["lifestyle"], targetLanguage: ["en"],
    requirements: ["Follow the brief."],
    deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  // funded: has pdaAddress + onchainVersion 2
  const fundedId = await t.mutation(api.campaigns.create, {
    creatorWallet: wallet, brandName: "B", title: "Funded one",
    brief: "x".repeat(60), budget: 100, ratePerThousandViews: 3,
    campaignType: "marketing", targetNiche: ["lifestyle"], targetLanguage: ["en"],
    requirements: ["Follow the brief."],
    deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  await t.mutation(api.campaigns.updateCampaignPda, {
    id: fundedId, pdaAddress: "PdA11111111111111111111111111111111111111111",
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "", onchainVersion: 2,
  });

  const drafts = await t.query(api.campaigns.listDraftsByCreator, { creatorWallet: wallet });
  expect(drafts).toHaveLength(1);
  expect(drafts[0].title).toBe("Draft one");
});

describe("campaigns.create — mandatory requirements", () => {
  const createArgs = (requirements?: string[]) => ({
    creatorWallet: "Req111111111111111111111111111111111111111",
    brandName: "B", title: "Reqs campaign",
    brief: "x".repeat(60), budget: 100, ratePerThousandViews: 3,
    campaignType: "marketing", targetNiche: ["lifestyle"], targetLanguage: ["en"],
    deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    ...(requirements !== undefined ? { requirements } : {}),
  });

  it("rejects a create with no requirements field", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.campaigns.create, createArgs())).rejects.toThrow(
      /at least one campaign requirement/i,
    );
  });

  it("rejects a whitespace-only requirements array", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.campaigns.create, createArgs(["   ", ""]))).rejects.toThrow(
      /at least one campaign requirement/i,
    );
  });

  it("accepts and stores a CLEANED requirements array", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      api.campaigns.create,
      createArgs(["  tag @alongrocket on tiktok  ", "", "  clip rocket videos  "]),
    );
    const row = await t.run(async (ctx) => ctx.db.get(id));
    // trimmed + empties dropped, order preserved.
    // Cast: `requirements` is new in the schema; _generated Doc types lag until codegen.
    expect((row! as { requirements?: string[] }).requirements).toEqual(["tag @alongrocket on tiktok", "clip rocket videos"]);
  });
});

describe("campaigns.create — cannot forge funded on-chain state (C2 auth hole)", () => {
  // `create` is a PUBLIC mutation (no secret/auth gate). A raw client could pass
  // pdaAddress + onchainVersion:2 to forge a FUNDED vault the USDC money-router
  // (getFundedByContentRewardId) would route agent clips to. Funded v2 must be
  // reachable ONLY via the secret+SIWS-gated updateCampaignPda after an on-chain
  // deposit — so create must strip these fields and be born v1/unfunded.
  it("strips client-supplied pdaAddress + onchainVersion (no forged funded vault)", async () => {
    const t = convexTest(schema, modules);
    const FORGED_CR = "forged-content-reward-C2";
    const id = await t.mutation(api.campaigns.create, {
      creatorWallet: "Forger11111111111111111111111111111111111",
      brandName: "B", title: "Forged funded", brief: "x".repeat(60),
      budget: 100, ratePerThousandViews: 3, campaignType: "marketing",
      targetNiche: ["lifestyle"], targetLanguage: ["en"],
      requirements: ["Follow the brief."],
      deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
      // Hostile forgery attempt — must NOT be persisted:
      pdaAddress: "FORGEDVAULT111111111111111111111111111111",
      onchainVersion: 2,
      contentRewardId: FORGED_CR,
    });

    // The row is born v1/unfunded: no pdaAddress, onchainVersion not >= 2.
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect((row as { pdaAddress?: string } | null)?.pdaAddress).toBeUndefined();
    expect((row as { onchainVersion?: number } | null)?.onchainVersion ?? 1).toBeLessThan(2);

    // The USDC money-router must NOT see a funded vault for this content_reward.
    const funded = await t.query(internal.campaigns.getFundedByContentRewardId, {
      contentRewardId: FORGED_CR,
    });
    expect(funded).toBeNull();
  });
});
