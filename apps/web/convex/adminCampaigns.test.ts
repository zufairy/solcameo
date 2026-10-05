/// <reference types="vite/client" />
/**
 * Tests for the secret-gated Web3-campaign cleanup tool (convex/adminCampaigns.ts)
 * and its pure selection predicate (lib/stage/web3Campaign.isWeb3Campaign).
 *
 * Locks in: the predicate selects ONLY non-clipping_fr, non-ugc, non-clipping rows;
 * the mutation cascades submissions, skips funded rows unless forced, and never
 * touches a UGC / Clipping / Clipping FR campaign.
 */
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { isWeb3Campaign } from "../lib/stage/web3Campaign";
import type { Web3CampaignPreview } from "./adminCampaigns";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "test-internal-secret";

beforeEach(() => {
  process.env.INTERNAL_CRON_SECRET = SECRET;
});

// ── Pure predicate ──────────────────────────────────────────────────────────
describe("isWeb3Campaign — pure selection predicate", () => {
  it("is TRUE for an explicit web3 category", () => {
    expect(isWeb3Campaign({ category: "web3" })).toBe(true);
  });
  it("is TRUE when the category is undefined (legacy rows default to Web3)", () => {
    expect(isWeb3Campaign({})).toBe(true);
    expect(isWeb3Campaign({ category: undefined, origin: undefined })).toBe(true);
  });
  it("is TRUE for an unknown/garbage category (falls to the removed Web3 board)", () => {
    expect(isWeb3Campaign({ category: "foobar" })).toBe(true);
  });
  it("is FALSE for a UGC campaign", () => {
    expect(isWeb3Campaign({ category: "ugc" })).toBe(false);
    expect(isWeb3Campaign({ category: "UGC" })).toBe(false); // case-insensitive
  });
  it("is FALSE for a Clipping campaign", () => {
    expect(isWeb3Campaign({ category: "clipping" })).toBe(false);
  });
  it("is FALSE for a Clipping FR mirror (origin wins over any category)", () => {
    expect(isWeb3Campaign({ origin: "clipping_fr" })).toBe(false);
    expect(isWeb3Campaign({ origin: "clipping_fr", category: "web3" })).toBe(false);
  });
});

// ── Convex query + mutation ─────────────────────────────────────────────────
type CampaignOverride = {
  title?: string;
  category?: string;
  origin?: string;
  budget?: number;
  spentUsdc?: number;
  pdaAddress?: string;
};

async function seedCampaign(
  t: ReturnType<typeof convexTest>,
  over: CampaignOverride = {},
): Promise<Id<"campaigns">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("campaigns", {
      creatorWallet: "Wcreator1111111111111111111111111111111111",
      brandName: "Brand",
      brandLogoUrl: "https://example.com/logo.svg",
      title: over.title ?? "Untitled",
      brief: "x".repeat(60),
      budget: over.budget ?? 100,
      ratePerThousandViews: 3,
      targetNiche: [],
      targetLanguage: [],
      status: "open",
      submissionsCount: 0,
      deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
      ...(over.category !== undefined ? { category: over.category } : {}),
      ...(over.origin !== undefined ? { origin: over.origin } : {}),
      ...(over.spentUsdc !== undefined ? { spentUsdc: over.spentUsdc } : {}),
      ...(over.pdaAddress !== undefined ? { pdaAddress: over.pdaAddress } : {}),
    });
  });
}

async function seedSubmission(t: ReturnType<typeof convexTest>, campaignId: Id<"campaigns">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("submissions", {
      campaignId,
      influencerMint: "mint1",
      influencerName: "Agent",
      submitterWallet: "Wsubmitter",
      status: "submitted",
    });
  });
}

async function allCampaignIds(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => (await ctx.db.query("campaigns").collect()).map((c) => c._id));
}

describe("adminCampaigns.previewWeb3Deletion — dry run", () => {
  it("lists only web3/absent rows, never ugc/clipping/clipping_fr", async () => {
    const t = convexTest(schema, modules);
    const web3 = await seedCampaign(t, { title: "Web3 one", category: "web3" });
    const absent = await seedCampaign(t, { title: "Legacy no-cat" });
    await seedCampaign(t, { title: "UGC one", category: "ugc" });
    await seedCampaign(t, { title: "Clip one", category: "clipping" });
    await seedCampaign(t, { title: "FR one", origin: "clipping_fr", category: "web3" });

    const p = await t.query(api.adminCampaigns.previewWeb3Deletion, { authSecret: SECRET });
    expect(p.total).toBe(2);
    expect(p.skipped).toHaveLength(0);
    expect(new Set(p.toDelete.map((r: Web3CampaignPreview) => r._id))).toEqual(new Set([web3, absent]));
    expect(p.scanned).toBe(5);
  });

  it("classifies a funded web3 row into skipped (not toDelete)", async () => {
    const t = convexTest(schema, modules);
    await seedCampaign(t, { title: "Unfunded", category: "web3" });
    await seedCampaign(t, { title: "Spent", category: "web3", spentUsdc: 5 });
    await seedCampaign(t, { title: "HasPda", category: "web3", pdaAddress: "PdA1111" });

    const p = await t.query(api.adminCampaigns.previewWeb3Deletion, { authSecret: SECRET });
    expect(p.toDelete.map((r: Web3CampaignPreview) => r.title)).toEqual(["Unfunded"]);
    expect(new Set(p.skipped.map((r: Web3CampaignPreview) => r.title))).toEqual(new Set(["Spent", "HasPda"]));
    expect(p.total).toBe(3);
  });

  it("rejects an unauthorized caller", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.adminCampaigns.previewWeb3Deletion, { authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
  });
});

describe("adminCampaigns.executeWeb3Deletion — delete + cascade", () => {
  it("deletes web3/absent rows + their submissions, keeps ugc/clipping/clipping_fr", async () => {
    const t = convexTest(schema, modules);
    const web3 = await seedCampaign(t, { title: "Web3 one", category: "web3" });
    const absent = await seedCampaign(t, { title: "Legacy" });
    const ugc = await seedCampaign(t, { title: "UGC", category: "ugc" });
    const clip = await seedCampaign(t, { title: "Clip", category: "clipping" });
    const fr = await seedCampaign(t, { title: "FR", origin: "clipping_fr" });
    // Submissions: 2 on a deleted campaign, 1 on a kept campaign.
    await seedSubmission(t, web3);
    await seedSubmission(t, web3);
    await seedSubmission(t, ugc);

    const res = await t.mutation(api.adminCampaigns.executeWeb3Deletion, { authSecret: SECRET });
    expect(res.deletedCount).toBe(2);
    expect(res.removedSubmissions).toBe(2);
    expect(new Set(res.deleted.map((r: Web3CampaignPreview) => r._id))).toEqual(new Set([web3, absent]));

    // Only ugc/clipping/clipping_fr remain.
    expect(new Set(await allCampaignIds(t))).toEqual(new Set([ugc, clip, fr]));
    // The kept campaign's submission survives; the deleted ones are gone.
    const subs = await t.run(async (ctx) => ctx.db.query("submissions").collect());
    expect(subs).toHaveLength(1);
    expect(subs[0].campaignId).toBe(ugc);
  });

  it("skips funded rows by default, deletes them with force", async () => {
    const t = convexTest(schema, modules);
    const unfunded = await seedCampaign(t, { title: "Unfunded", category: "web3" });
    const spent = await seedCampaign(t, { title: "Spent", category: "web3", spentUsdc: 10 });
    const pda = await seedCampaign(t, { title: "Pda", category: "web3", pdaAddress: "PdA9" });

    // Default: only the unfunded one is deleted; funded rows are skipped + survive.
    const res1 = await t.mutation(api.adminCampaigns.executeWeb3Deletion, { authSecret: SECRET });
    expect(res1.deletedCount).toBe(1);
    expect(res1.skippedCount).toBe(2);
    expect(res1.deleted[0]._id).toBe(unfunded);
    expect(new Set(await allCampaignIds(t))).toEqual(new Set([spent, pda]));

    // With force, the remaining funded rows are deleted too.
    const res2 = await t.mutation(api.adminCampaigns.executeWeb3Deletion, { authSecret: SECRET, force: true });
    expect(res2.deletedCount).toBe(2);
    expect(await allCampaignIds(t)).toHaveLength(0);
  });

  it("rejects an unauthorized delete", async () => {
    const t = convexTest(schema, modules);
    await seedCampaign(t, { category: "web3" });
    await expect(
      t.mutation(api.adminCampaigns.executeWeb3Deletion, { authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/);
    // Nothing was deleted.
    expect(await allCampaignIds(t)).toHaveLength(1);
  });
});
