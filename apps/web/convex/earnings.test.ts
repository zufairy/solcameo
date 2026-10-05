/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "MintE1111111111111111111111111111111111111";
const INV1 = "InvE1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BUILDER = "BldrE111111111111111111111111111111111111";

// creditEarnings is a public but INTERNAL_CRON_SECRET-gated money mutation.
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;
// This suite seeds via buyShares, which is now gated by NEXT_PUBLIC_INVEST_ENABLED
// (default OFF) — turn it on so the seed buy runs the enabled path.
process.env.NEXT_PUBLIC_INVEST_ENABLED = "true";

describe("earnings.creditEarnings", () => {
  it("raises NAV ~85% to investors and mints ~15% founder shares (no principal dilution)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.mutation(api.shares.buyShares, { mintAddress: MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "e-buy", authSecret: SECRET });
    // S=10000, escrow=10000, NAV 1.0

    const res = await t.mutation(api.earnings.creditEarnings, { mintAddress: MINT, amountUsdc: 10000, builderWallet: BUILDER, authSecret: SECRET });
    expect(res.navAfterEscrow).toBe(2); // 20000/10000
    expect(res.founderShares).toBe(750); // 0.15*10000/2

    const acct = await t.query(api.agentAccount.getWithNav, { mintAddress: MINT });
    expect(acct!.sharesOutstanding).toBe(10750);
    expect(acct!.escrowUsdc).toBe(20000);
    // investor value = 10000 shares × NAV; founder value = 750 × NAV
    const nav = acct!.navPerShare; // 20000/10750 ≈ 1.8605
    const investorValue = 10000 * nav;
    const founderValue = 750 * nav;
    expect(investorValue).toBeGreaterThan(18000); // gained ~86% of the 10000 earnings
    expect(founderValue).toBeGreaterThan(1300);    // ~14% of earnings
    expect(founderValue).toBeLessThan(1500);
    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: BUILDER })).toBe(750);
  });

  it("rejects non-positive earnings", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await expect(t.mutation(api.earnings.creditEarnings, { mintAddress: MINT, amountUsdc: 0, builderWallet: BUILDER, authSecret: SECRET })).rejects.toThrow();
  });
});

describe("earnings underwater handling (H10: a RangeError must not abort a valid credit)", () => {
  const UW_MINT = "MintUW11111111111111111111111111111111111";
  const UW_BUILDER = "BldrUW11111111111111111111111111111111111";

  // sharesOutstanding>0 (founder shares from a prior earning) but the service tab has
  // outrun escrow — the agent is underwater (escrow 0 < tab 100). A later payout smaller
  // than the deficit leaves escrow still <= tab, so navAfterEscrow==0 and the pre-fix
  // founderSharesForEarnings threw RangeError, rolling back the WHOLE credit + dedup row.
  async function seedUnderwater(t: TestConvex<typeof schema>) {
    await t.mutation(internal.agentAccount.create, { mintAddress: UW_MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", UW_MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: 1000, escrowUsdc: 0, liquidUsdc: 0, unsettledTabUsdc: 100 });
    });
  }

  it("creditAndRecord: an underwater payout still credits escrow + writes the dedup row (no throw, founderShares=0)", async () => {
    const t = convexTest(schema, modules);
    await seedUnderwater(t);
    const res = await t.mutation(api.earnings.creditAndRecord, {
      mintAddress: UW_MINT, amountUsdc: 50, builderWallet: UW_BUILDER, submissionId: "sub-uw", authSecret: SECRET,
    });
    expect(res.alreadyDistributed).toBe(false);
    if (res.alreadyDistributed) throw new Error("unreachable");
    expect(res.founderShares).toBe(0);            // underwater: founder mint deferred
    expect(res.escrowUsdc).toBeCloseTo(50, 6);    // escrow credit still applied

    const acct = await t.query(api.agentAccount.get, { mintAddress: UW_MINT });
    expect(acct!.escrowUsdc).toBeCloseTo(50, 6);
    expect(acct!.sharesOutstanding).toBe(1000);   // no founder shares minted
    expect(acct!.offchainCreditedUsdc).toBeCloseTo(50, 6);

    // The dedup row committed on the FIRST attempt → the 10-min re-drive keeper can't
    // re-hit the same throw forever; a re-drive of the same submission is a true no-op.
    const dists = await t.run(async (ctx) =>
      ctx.db.query("distributions").withIndex("by_mint", (q) => q.eq("mintAddress", UW_MINT)).collect());
    expect(dists).toHaveLength(1);
    expect(dists[0].builderUsdc).toBe(0);
    expect(dists[0].totalPayoutUsdc).toBeCloseTo(50, 6);

    const again = await t.mutation(api.earnings.creditAndRecord, {
      mintAddress: UW_MINT, amountUsdc: 50, builderWallet: UW_BUILDER, submissionId: "sub-uw", authSecret: SECRET,
    });
    expect(again.alreadyDistributed).toBe(true);
  });

  it("creditEarnings: an underwater credit does not throw and still raises escrow (founderShares=0)", async () => {
    const t = convexTest(schema, modules);
    await seedUnderwater(t);
    const res = await t.mutation(api.earnings.creditEarnings, {
      mintAddress: UW_MINT, amountUsdc: 50, builderWallet: UW_BUILDER, authSecret: SECRET,
    });
    expect(res.founderShares).toBe(0);
    expect(res.escrowUsdc).toBeCloseTo(50, 6);
    const acct = await t.query(api.agentAccount.get, { mintAddress: UW_MINT });
    expect(acct!.escrowUsdc).toBeCloseTo(50, 6);
    expect(acct!.sharesOutstanding).toBe(1000);
  });

  it("a HEALTHY (non-underwater) credit still mints founder shares — regression", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: UW_MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", UW_MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: 1000, escrowUsdc: 1000, liquidUsdc: 1000, unsettledTabUsdc: 0 });
    });
    const res = await t.mutation(api.earnings.creditEarnings, {
      mintAddress: UW_MINT, amountUsdc: 100, builderWallet: UW_BUILDER, authSecret: SECRET,
    });
    expect(res.founderShares).toBeGreaterThan(0);
  });
});
