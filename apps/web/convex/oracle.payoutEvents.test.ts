/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const secret = "test-cron-secret";
const mint = "TestPayoutMint11111111111111111111111111";

describe("on-chain payout receipts", () => {
  beforeEach(() => vi.stubEnv("INTERNAL_CRON_SECRET", secret));
  afterEach(() => vi.unstubAllEnvs());

  it("records each paid tranche once across keeper retries", async () => {
    const t = convexTest(schema, modules);
    const submissionId = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", {
        creatorWallet: "creator", brandName: "Brand", brandLogoUrl: "", title: "Campaign",
        brief: "Brief", budget: 10, ratePerThousandViews: 1, targetNiche: ["all"],
        targetLanguage: ["en"], status: "open", submissionsCount: 1,
        deadline: "2030-01-01T00:00:00.000Z",
      });
      return ctx.db.insert("submissions", {
        campaignId, influencerMint: mint, influencerName: "Clipper",
        submitterWallet: "creator", status: "verified", paidUsdc: 0,
      });
    });
    const args = { authSecret: secret, submissionId, paidUsdc: 1, payoutTxSignature: "tx-one" };
    await t.mutation(api.oracle.markPaidOnchain, args);
    await t.mutation(api.oracle.markPaidOnchain, args);
    await t.mutation(api.oracle.markPaidOnchain, { ...args, paidUsdc: 1.5, payoutTxSignature: "tx-two" });
    const events = await t.query(api.oracle.payoutEventsByMint, { mintAddress: mint });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.grossDeltaUsdc).sort()).toEqual([0.5, 1]);
    expect(events.map((event) => event.txSignature).sort()).toEqual(["tx-one", "tx-two"]);
  });

  it("reopens a fully paid claim when confirmed on-chain views grow", async () => {
    const t = convexTest(schema, modules);
    const submissionId = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", {
        creatorWallet: "creator", brandName: "Brand", brandLogoUrl: "", title: "Campaign",
        brief: "Brief", budget: 10, spentUsdc: 0.1, ratePerThousandViews: 1,
        targetNiche: ["all"], targetLanguage: ["en"], status: "open", submissionsCount: 1,
        deadline: "2030-01-01T00:00:00.000Z", onchainVersion: 2,
      });
      return ctx.db.insert("submissions", {
        campaignId, influencerMint: mint, influencerName: "Clipper", submitterWallet: "creator",
        status: "verified", verificationDecision: "approved", viewCount: 100,
        payoutAmountUsdc: 0.1, paidUsdc: 0.1, claimDone: true,
      });
    });
    await t.mutation(api.oracle.commitGrowth, {
      authSecret: secret, submissionId, confirmedViews: 200, accruedUsdc: 0.2,
      attestationTx: "growth-tx", candidateViews: 200, candidateAt: Date.now(),
    });
    const result = await t.run(async (ctx) => {
      const s = await ctx.db.get(submissionId);
      const c = s ? await ctx.db.get(s.campaignId) : null;
      return { s, c };
    });
    expect(result.s?.viewCount).toBe(200);
    expect(result.s?.payoutAmountUsdc).toBe(0.2);
    expect(result.s?.claimDone).toBe(false);
    expect(result.c?.spentUsdc).toBeCloseTo(0.2);
  });
});
