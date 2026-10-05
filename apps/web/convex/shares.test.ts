/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

// buyShares is now gated by NEXT_PUBLIC_INVEST_ENABLED (default OFF). These tests
// exercise the ENABLED path, so turn the flag on for this file. (The dedicated
// gate behaviour lives in sharesInvestFlag.test.ts.)
process.env.NEXT_PUBLIC_INVEST_ENABLED = "true";
// buy/redeem/markPaid are secret-gated public mutations now — set + pass the secret.
const SECRET = "test-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint1111111111111111111111111111111111111";
const A = "WalletAAA1111111111111111111111111111111";

describe("shares.walletShares", () => {
  it("sums a wallet's signed share rows for the mint (0 when none)", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: A })).toBe(0);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: A, kind: "buy", shares: 100, navPerShare: 1, usdcAmount: 100, at: now });
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: A, kind: "buy", shares: 50, navPerShare: 1, usdcAmount: 50, at: now });
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: A, kind: "redeem", shares: -30, navPerShare: 1, usdcAmount: 30, at: now });
      await ctx.db.insert("shareLedger", { mintAddress: MINT, wallet: "Other", kind: "buy", shares: 999, navPerShare: 1, usdcAmount: 999, at: now });
    });

    expect(await t.query(api.shares.walletShares, { mintAddress: MINT, wallet: A })).toBe(120);
  });
});

const ACCT_MINT = "Mint2222222222222222222222222222222222222";
const INV1 = "Inv1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INV2 = "Inv2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

async function seedAccount(t: ReturnType<typeof convexTest>) {
  await t.mutation(internal.agentAccount.create, { mintAddress: ACCT_MINT });
}

describe("shares.buyShares", () => {
  it("first buyer into an empty pool mints at the seed price ($1) and owns those shares", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const res = await t.mutation(api.shares.buyShares, {
      mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "sig-buy-1", authSecret: SECRET,
    });
    expect(res.shares).toBe(10000);
    expect(res.navPerShare).toBe(1);

    const acct = await t.query(api.agentAccount.getWithNav, { mintAddress: ACCT_MINT });
    expect(acct!.sharesOutstanding).toBe(10000);
    expect(acct!.escrowUsdc).toBe(10000);
    expect(acct!.liquidUsdc).toBe(10000);
    expect(await t.query(api.shares.walletShares, { mintAddress: ACCT_MINT, wallet: INV1 })).toBe(10000);
  });

  it("rejects a buy that would push a wallet over 10% of planned supply (100k)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await expect(
      t.mutation(api.shares.buyShares, {
        mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100001, txSignature: "sig-cap", authSecret: SECRET,
      }),
    ).rejects.toThrow(/cap/i);
  });

  it("rejects a replayed deposit signature", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100, txSignature: "dup", authSecret: SECRET });
    await expect(
      t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 100, txSignature: "dup", authSecret: SECRET }),
    ).rejects.toThrow();
  });

  it("a second investor buys at the current NAV after earnings lifted it", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "s1", authSecret: SECRET });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", ACCT_MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 20000, liquidUsdc: 20000 });
    });
    const res = await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 10000, txSignature: "s2", authSecret: SECRET });
    expect(res.navPerShare).toBe(2);
    expect(res.shares).toBe(5000);
  });

  it("rejects buying into a suspended agent", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", ACCT_MINT)).unique();
      await ctx.db.patch(a!._id, { status: "suspended" });
    });
    await expect(
      t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100, txSignature: "susp", authSecret: SECRET }),
    ).rejects.toThrow(/suspend/i);
  });

  it("allows an exact-cap buy (100,000 shares)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    const res = await t.mutation(api.shares.buyShares, {
      mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100000, txSignature: "exact-cap", authSecret: SECRET,
    });
    expect(res.shares).toBe(100000); // 10% of 1,000,000 planned supply, at $1
  });

  it("enforces the cap across multiple buys by the same wallet (no bypass)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 60000, txSignature: "acc1", authSecret: SECRET });
    await expect(
      t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 60000, txSignature: "acc2", authSecret: SECRET }),
    ).rejects.toThrow(/cap/i); // 60k + 60k = 120k > 100k cap
  });

  it("rejects a non-positive deposit", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await expect(
      t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 0, txSignature: "zero", authSecret: SECRET }),
    ).rejects.toThrow();
  });

  it("a rejected buy leaves its deposit signature reusable (transaction rollback)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    // First attempt rejected by the cap → its signature must NOT be consumed.
    await expect(
      t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100001, txSignature: "rollback-sig", authSecret: SECRET }),
    ).rejects.toThrow(/cap/i);
    // Same signature now used for a valid buy → must succeed (proves rollback).
    const res = await t.mutation(api.shares.buyShares, {
      mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 100, txSignature: "rollback-sig", authSecret: SECRET,
    });
    expect(res.shares).toBe(100);
  });
});

describe("shares.redeemShares", () => {
  async function seedWithBuyer(t: ReturnType<typeof convexTest>) {
    await t.mutation(internal.agentAccount.create, { mintAddress: ACCT_MINT });
    await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "rb1", authSecret: SECRET });
  }

  it("pays shares × NAV minus the 2% fee, and the fee stays in escrow (lifts NAV for stayers)", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t); // 10000 shares, escrow 10000, NAV 1.0
    await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 10000, txSignature: "rb2", authSecret: SECRET });
    // now 20000 shares, escrow 20000, NAV 1.0

    const res = await t.mutation(api.shares.redeemShares, {
      mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10000, authSecret: SECRET,
    });
    expect(res.payout).toBe(9800);     // 10000 × 1.0 × 0.98
    expect(res.exitFee).toBeCloseTo(200, 6);

    const acct = await t.query(api.agentAccount.getWithNav, { mintAddress: ACCT_MINT });
    expect(acct!.sharesOutstanding).toBe(10000);          // INV2's shares remain
    expect(acct!.escrowUsdc).toBe(10200);                 // 20000 − 9800 payout (200 fee retained)
    expect(acct!.navPerShare).toBeCloseTo(1.02, 6);       // 10200 / 10000
    expect(await t.query(api.shares.walletShares, { mintAddress: ACCT_MINT, wallet: INV1 })).toBe(0);
  });

  it("rejects redeeming more shares than the wallet holds", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t);
    await expect(
      t.mutation(api.shares.redeemShares, { mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10001, authSecret: SECRET }),
    ).rejects.toThrow(/shares/i);
  });

  it("rejects when liquid USDC can't cover the payout", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t); // escrow 10000, liquid 10000
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", ACCT_MINT)).unique();
      await ctx.db.patch(a!._id, { liquidUsdc: 100 });
    });
    await expect(
      t.mutation(api.shares.redeemShares, { mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10000, authSecret: SECRET }),
    ).rejects.toThrow(/liquid/i);
  });

  it("with a large unsettled tab, NAV is depressed and a full exit pays the depressed value (escrow stays ≥ tab)", async () => {
    const t = convexTest(schema, modules);
    await seedWithBuyer(t); // 10000 shares, escrow 10000, liquid 10000, tab 0, NAV 1.0
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", ACCT_MINT)).unique();
      await ctx.db.patch(a!._id, { unsettledTabUsdc: 9000 });
    });
    // NAV now = (10000 − 9000) / 10000 = 0.1. Redeem all 10000 shares:
    //   gross = 10000 × 0.1 = 1000, fee 2% = 20, payout = 980.
    const res = await t.mutation(api.shares.redeemShares, {
      mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 10000, authSecret: SECRET,
    });
    expect(res.navPerShare).toBeCloseTo(0.1, 6);
    expect(res.payout).toBe(980);
    const acct = await t.query(api.agentAccount.get, { mintAddress: ACCT_MINT });
    expect(acct!.escrowUsdc).toBe(9020);                 // 10000 − 980
    expect(acct!.escrowUsdc).toBeGreaterThanOrEqual(acct!.unsettledTabUsdc); // tab still covered
  });
});

describe("shares.markRedeemPaid", () => {
  it("stamps the txSignature on the pending redeem row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: ACCT_MINT });
    await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV1, depositUsdc: 10000, txSignature: "mb1", authSecret: SECRET });
    await t.mutation(api.shares.buyShares, { mintAddress: ACCT_MINT, investorWallet: INV2, depositUsdc: 10000, txSignature: "mb2", authSecret: SECRET });
    const r = await t.mutation(api.shares.redeemShares, { mintAddress: ACCT_MINT, holderWallet: INV1, sharesToBurn: 1000, authSecret: SECRET });
    await t.mutation(api.shares.markRedeemPaid, { redeemRowId: r.redeemRowId, txSignature: "payout-sig", authSecret: SECRET });
    const row = (await t.run(async (ctx) => ctx.db.get(r.redeemRowId))) as Doc<"shareLedger"> | null;
    expect(row!.txSignature).toBe("payout-sig");
  });
});
