/// <reference types="vite/client" />
/**
 * E2E hunt #11: the v1 (legacy off-chain) payout re-drive probe. Finds
 * verified+approved v1 submissions with a positive payout and NO distributions
 * row (their scheduled dispatch dropped), so the keeper can re-credit them.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-cron-secret";
process.env.INTERNAL_CRON_SECRET = process.env.INTERNAL_CRON_SECRET || SECRET;

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

async function seedSub(
  t: ReturnType<typeof convexTest>,
  campaignOverrides: Record<string, unknown> = {},
  subOverrides: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    const campaignId = await ctx.db.insert("campaigns", { ...baseCampaign, ...campaignOverrides } as never);
    const subId = await ctx.db.insert("submissions", {
      campaignId,
      influencerMint: "MintA",
      influencerName: "A",
      submitterWallet: "W",
      status: "verified",
      verificationDecision: "approved",
      payoutAmountUsdc: 10,
      ...subOverrides,
    } as never);
    return { campaignId, subId };
  });
}

describe("submissions.dueForDistribution", () => {
  it("returns a v1 verified+approved submission with a payout and no distribution row", async () => {
    const t = convexTest(schema, modules);
    const { subId } = await seedSub(t); // no onchainVersion → v1
    const due = await t.query(api.submissions.dueForDistribution, { authSecret: SECRET } as never);
    expect(due).toHaveLength(1);
    expect(due[0].submissionId).toBe(subId);
    expect(due[0].payoutUsdc).toBe(10);
  });

  it("excludes a submission that already has a distribution row (idempotent)", async () => {
    const t = convexTest(schema, modules);
    const { subId } = await seedSub(t);
    await t.run(async (ctx) =>
      ctx.db.insert("distributions", {
        mintAddress: "MintA",
        submissionId: subId,
        totalPayoutUsdc: 10,
        investorUsdc: 10,
        builderUsdc: 0,
        protocolUsdc: 0,
        splits: [],
        status: "credited",
        createdAt: 1,
      } as never),
    );
    const due = await t.query(api.submissions.dueForDistribution, { authSecret: SECRET } as never);
    expect(due).toHaveLength(0);
  });

  it("excludes a v2 (onchainVersion>=2) submission — that path uses the on-chain claim keeper", async () => {
    const t = convexTest(schema, modules);
    await seedSub(t, { onchainVersion: 2, pdaAddress: "PDA" });
    const due = await t.query(api.submissions.dueForDistribution, { authSecret: SECRET } as never);
    expect(due).toHaveLength(0);
  });

  it("excludes a rejected submission and a zero-payout one", async () => {
    const t = convexTest(schema, modules);
    await seedSub(t, {}, { verificationDecision: "rejected" });
    await seedSub(t, {}, { payoutAmountUsdc: 0 });
    const due = await t.query(api.submissions.dueForDistribution, { authSecret: SECRET } as never);
    expect(due).toHaveLength(0);
  });

  it("rejects without the internal secret", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.submissions.dueForDistribution, { authSecret: "wrong" } as never),
    ).rejects.toThrow(/unauthorized/i);
  });
});
