/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { SEED_SHARE_PRICE_USDC } from "../lib/economy/constants";
import type { TxHistoryRow } from "../lib/economy/transactionHistory";

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint1111111111111111111111111111111111111";

describe("agentAccount.create", () => {
  it("creates an empty pool: 0 shares, 0 escrow, active, no shareLedger rows", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });

    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct).not.toBeNull();
    expect(acct!.sharesOutstanding).toBe(0);
    expect(acct!.escrowUsdc).toBe(0);
    expect(acct!.status).toBe("active");
    expect(acct!.plannedSupply).toBe(1_000_000);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("shareLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(rows).toHaveLength(0);
  });

  it("is idempotent — calling create twice does not duplicate", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    const all = await t.run(async (ctx) =>
      ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(all).toHaveLength(1);
  });
});

describe("agentAccount.getWithNav", () => {
  it("returns seed price NAV for an empty pool (0 shares)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    const res = await t.query(api.agentAccount.getWithNav, { mintAddress: MINT });
    expect(res!.navPerShare).toBe(SEED_SHARE_PRICE_USDC);
  });

  it("reflects shares + escrow in NAV once an investor has bought in", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    // simulate an investor having deposited: shares + escrow both set
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: 200000, escrowUsdc: 30000 });
    });
    const res = await t.query(api.agentAccount.getWithNav, { mintAddress: MINT });
    // 30000 / 200000 = 0.15
    expect(res!.navPerShare).toBeCloseTo(0.15, 6);
  });
});

describe("agentAccount.reconcile — RPC-blip safety (unknown balance must not zero the mirror)", () => {
  it("SKIPS the write when onchainUsdc is null (read failed) — escrow/liquid unchanged", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 500, liquidUsdc: 500 });
    });
    const res = await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, { mintAddress: MINT, onchainUsdc: null });
    expect(res.ok).toBe(false);
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(500); // NOT zeroed by an RPC blip
    expect(acct!.liquidUsdc).toBe(500);
  });

  it("STILL reconciles a genuine 0 (empty account, not an RPC error)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 500, liquidUsdc: 500 });
    });
    const res = await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, { mintAddress: MINT, onchainUsdc: 0 });
    expect(res.ok).toBe(true);
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(0); // a real, confirmed 0 still applies
  });
});

describe("agentAccount.reconcile — off-chain NAV carry (H5: never erase credited earnings)", () => {
  it("RE-ADDS offchainCreditedUsdc on top of the on-chain balance (earnings survive reconcile)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    // Investor deposited 1000 (on-chain, in the custodial wallet) + 500 of v1
    // off-chain earnings were credited (no on-chain counterpart).
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 1500, liquidUsdc: 1500, offchainCreditedUsdc: 500 });
    });
    // Chain read sees only the 1000 real deposit. Escrow must stay 1500, NOT drop
    // to 1000 — the 500 off-chain credit is re-added.
    const res = await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, { mintAddress: MINT, onchainUsdc: 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.escrowUsdc).toBeCloseTo(1500, 6);
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBeCloseTo(1500, 6);
  });

  it("a vault-enabled agent whose on-chain read is 0 is NOT zeroed — off-chain NAV is preserved", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 300, liquidUsdc: 300, offchainCreditedUsdc: 300, vaultEnabled: true });
    });
    // Simulates a stale/empty vault-ATA read of 0 (the H5 bug). escrow must NOT
    // collapse to 0; the 300 legitimately-credited off-chain NAV survives.
    const res = await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, { mintAddress: MINT, onchainUsdc: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.escrowUsdc).toBeCloseTo(300, 6);
  });
});

describe("agentAccount.reconcile — in-flight redemption hold-back (H07: never resurrect a burned payout)", () => {
  it("HOLDS BACK a still-pending redemption's payout — reconcile can't re-inflate escrow/NAV while the transfer is unconfirmed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    // Post-burn state: holder A redeemed 500 of 1000 shares for a $49 payout (after the
    // 2% exit fee), so the burn ALREADY dropped shares 1000→500 and escrow 100→51. The
    // shareRedemptions row is still 'pending' — the $49 has NOT yet left the wallet, so
    // the real on-chain balance is STILL $100.
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: 500, escrowUsdc: 51, liquidUsdc: 51 });
      const redeemRowId = await ctx.db.insert("shareLedger", {
        mintAddress: MINT, wallet: "HolderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", kind: "redeem",
        shares: -500, navPerShare: 0.1, usdcAmount: 49, at: Date.now(),
      });
      await ctx.db.insert("shareRedemptions", {
        mintAddress: MINT, holderWallet: "HolderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", idempotencyKey: "k-pending",
        sharesBurned: 500, payoutUsdc: 49, exitFeeUsdc: 1, redeemRowId,
        status: "pending", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    // A reconcile fires while A's payout is still in-flight, reading the real $100.
    const res = await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, { mintAddress: MINT, onchainUsdc: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    // Escrow must stay $51 (100 − 49 held back), NOT snap back to $100 — otherwise NAV
    // would inflate to 100/500=$0.20 (should be 51/500≈$0.102) and over-pay the next redeemer.
    expect(res.escrowUsdc).toBeCloseTo(51, 6);
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBeCloseTo(51, 6);
  });

  it("does NOT hold back a redemption once it is PAID (only 'pending' rows are subtracted — no double-count)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: 500, escrowUsdc: 51, liquidUsdc: 51 });
      const redeemRowId = await ctx.db.insert("shareLedger", {
        mintAddress: MINT, wallet: "HolderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", kind: "redeem",
        shares: -500, navPerShare: 0.1, usdcAmount: 49, txSignature: "PaidSigA", at: Date.now(),
      });
      await ctx.db.insert("shareRedemptions", {
        mintAddress: MINT, holderWallet: "HolderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", idempotencyKey: "k-paid",
        sharesBurned: 500, payoutUsdc: 49, exitFeeUsdc: 1, redeemRowId,
        status: "paid", txSignature: "PaidSigA", attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    // The $49 has now LEFT the wallet, so the real balance dropped to $51; the paid row
    // must NOT be subtracted again (that would under-credit escrow to $2).
    const res = await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, { mintAddress: MINT, onchainUsdc: 51 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.escrowUsdc).toBeCloseTo(51, 6);
  });
});

describe("agentAccount.transactionHistory — vault-model revenue visibility (H12)", () => {
  it("SHOWS a vault-model credit (builderUsdc=0, investorUsdc>0) that the old builderUsdc>0 gate dropped", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    const now = Date.now();
    await t.run(async (ctx) => {
      // Shaped exactly like earnings.creditAndRecord's row: the full payout raises NAV
      // for investors, the builder is paid in founder shares → builderUsdc:0.
      await ctx.db.insert("distributions", {
        mintAddress: MINT, totalPayoutUsdc: 100, investorUsdc: 100, builderUsdc: 0, protocolUsdc: 0,
        splits: [], status: "credited", createdAt: now,
      });
      // A legacy direct-cash row (recordContentRewardEarnings convention) still passes.
      await ctx.db.insert("distributions", {
        mintAddress: MINT, totalPayoutUsdc: 50, investorUsdc: 0, builderUsdc: 50, protocolUsdc: 0,
        splits: [{ wallet: "Bldr", role: "builder", usdc: 50, status: "paid", txSignature: "LegacySig" }],
        status: "paid", createdAt: now - 1,
      });
    });
    const history: TxHistoryRow[] = await t.query(api.agentAccount.transactionHistory, { mintAddress: MINT });
    const revenue = history.filter((r) => r.kind === "revenue");
    // Both the vault credit ($100, previously invisible) and the legacy split ($50) show.
    expect(revenue.map((r) => r.amountUsdc).sort((a, b) => a - b)).toEqual([50, 100]);
    const vaultRow = revenue.find((r) => r.amountUsdc === 100);
    expect(vaultRow).toBeDefined();
    expect(vaultRow!.label).toContain("NAV credit");
  });

  it("still SKIPS a truly empty distributions row (all payout fields 0)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      await ctx.db.insert("distributions", {
        mintAddress: MINT, totalPayoutUsdc: 0, investorUsdc: 0, builderUsdc: 0, protocolUsdc: 0,
        splits: [], status: "credited", createdAt: Date.now(),
      });
    });
    const history: TxHistoryRow[] = await t.query(api.agentAccount.transactionHistory, { mintAddress: MINT });
    expect(history.filter((r) => r.kind === "revenue")).toHaveLength(0);
  });
});
