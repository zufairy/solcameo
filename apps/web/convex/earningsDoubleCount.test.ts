/// <reference types="vite/client" />
/**
 * E2E hunt #18/24/26: a content-reward clip BRIDGED to a funded v2 campaign was
 * counted twice in earningsByAgent — once via the on-chain paidUsdc submission,
 * once via its redundant `creward:<id>` distribution mirror. The fix drops the
 * creward mirror when the same clip already counted via on-chain paidUsdc.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const baseCampaign = {
  creatorWallet: "Creator1",
  brandName: "Acme",
  brandLogoUrl: "https://example.com/logo.svg",
  title: "C",
  brief: "b".repeat(60),
  budget: 500,
  ratePerThousandViews: 5,
  campaignType: "marketing",
  targetNiche: ["tech"],
  targetLanguage: ["en"],
  deadline: "2026-12-31",
  status: "open",
  submissionsCount: 0,
};

describe("earningsByAgent — no content-reward double-count", () => {
  it("counts a bridged content-reward clip ONCE (real paidUsdc, not the creward mirror)", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", {
        ...baseCampaign,
        onchainVersion: 2,
        pdaAddress: "PDA",
      } as never);
      await ctx.db.insert("submissions", {
        campaignId,
        influencerMint: "MintA",
        influencerName: "A",
        submitterWallet: "W",
        status: "verified",
        paidUsdc: 10,
        contentRewardSubmissionId: "cr1",
        verifiedAt: now,
      } as never);
      await ctx.db.insert("distributions", {
        mintAddress: "MintA",
        submissionId: "creward:cr1",
        totalPayoutUsdc: 10,
        investorUsdc: 10,
        builderUsdc: 0,
        protocolUsdc: 0,
        splits: [],
        status: "credited",
        createdAt: now,
      } as never);
    });
    const earnings = await t.query(api.submissions.earningsByAgent, {});
    expect(earnings.MintA.lifetime).toBe(10); // NOT 20
  });

  it("still counts a pure (non-bridged) content-reward clip", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("distributions", {
        mintAddress: "MintB",
        submissionId: "creward:cr2",
        totalPayoutUsdc: 5,
        investorUsdc: 5,
        builderUsdc: 0,
        protocolUsdc: 0,
        splits: [],
        status: "credited",
        createdAt: now,
      } as never);
    });
    const earnings = await t.query(api.submissions.earningsByAgent, {});
    expect(earnings.MintB.lifetime).toBe(5);
  });
});
