/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { AgentInvestmentDetail } from "./adminEconomy";

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint1111111111111111111111111111111111111";

describe("adminEconomy.adjustEscrowData", () => {
  it("credits escrow, accumulates the offset, and writes an audit row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });

    const res = await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 25, reason: "test credit", adminEmail: "admin@vello.fun",
    });
    expect(res.escrowBefore).toBe(0);
    expect(res.escrowAfter).toBe(25);

    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(25);
    expect(acct!.liquidUsdc).toBe(25);
    expect(acct!.adminAdjustmentUsdc).toBe(25);

    const audit = await t.run(async (ctx) =>
      ctx.db.query("adminAdjustments").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe("test credit");
    expect(audit[0].deltaUsdc).toBe(25);
  });

  it("rejects an empty reason and a zero delta", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await expect(t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 5, reason: "   ", adminEmail: "a@b.c",
    })).rejects.toThrow(/reason/i);
    await expect(t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 0, reason: "noop", adminEmail: "a@b.c",
    })).rejects.toThrow(/zero/i);
  });

  it("rejects a deduction that would push escrow below zero", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 10, reason: "seed", adminEmail: "a@b.c",
    });
    await expect(t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: -10.01, reason: "too much", adminEmail: "a@b.c",
    })).rejects.toThrow(/below zero/i);
  });

  it("a deduction nets the offset back down (+10 then −10 → offset 0)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 10, reason: "up", adminEmail: "a@b.c",
    });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: -10, reason: "down", adminEmail: "a@b.c",
    });
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(0);
    expect(acct!.adminAdjustmentUsdc).toBe(0);
  });

  it("rejects NaN, Infinity, and >$1M deltas", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    for (const bad of [NaN, Infinity, -Infinity]) {
      await expect(t.mutation(internal.adminEconomy.adjustEscrowData, {
        mintAddress: MINT, deltaUsdc: bad, reason: "bad", adminEmail: "a@b.c",
      })).rejects.toThrow(/finite/i);
    }
    await expect(t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 1_000_001, reason: "too big", adminEmail: "a@b.c",
    })).rejects.toThrow(/1,000,000/);
  });

  it("a deduction below the unsettled tab flips status to needs_funding (escrow still > 0)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 20, liquidUsdc: 20, unsettledTabUsdc: 8 });
    });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: -15, reason: "drain", adminEmail: "a@b.c",
    });
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(5);            // > 0 …
    expect(acct!.status).toBe("needs_funding");  // … but below the $8 tab
  });

  it("a credit never un-suspends a suspended account", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { status: "suspended" as const });
    });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 100, reason: "credit", adminEmail: "a@b.c",
    });
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.status).toBe("suspended");
    expect(acct!.escrowUsdc).toBe(100);
  });
});

describe("reconcileEscrowToOnchain preserves admin adjustments", () => {
  it("reads escrow as onchain + adminAdjustmentUsdc", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 25, reason: "manual credit", adminEmail: "a@b.c",
    });
    await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, {
      mintAddress: MINT, onchainUsdc: 100,
    });
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(125); // NOT clobbered back to 100
    expect(acct!.liquidUsdc).toBe(125);
  });

  it("offset of zero leaves reconcile behavior unchanged", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 50, reason: "seed", adminEmail: "a@b.c",
    });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: -50, reason: "remove", adminEmail: "a@b.c",
    });
    await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, {
      mintAddress: MINT, onchainUsdc: 7,
    });
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(7);
  });

  it("subsidy semantics: credit → fee deduction from mirror → reconcile re-adds full offset", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    // admin credits $25 (no on-chain backing)
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 25, reason: "subsidy", adminEmail: "a@b.c",
    });
    // a $10 fee settlement deducts from the escrow mirror directly
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 15, liquidUsdc: 15 });
    });
    // reconcile against a wallet that genuinely holds $0 on-chain:
    // PERMANENT-SUBSIDY semantics — the full $25 offset is re-added.
    await t.mutation(internal.agentAccount.reconcileEscrowToOnchain, {
      mintAddress: MINT, onchainUsdc: 0,
    });
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBe(25);
    expect(acct!.adminAdjustmentUsdc).toBe(25);
  });
});

describe("adminEconomy.listInvestmentsData", () => {
  it("returns newest-first rows joined with agent names, plus a global summary", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("influencers", {
        mintAddress: MINT, creatorWallet: "creator", name: "Nova", handle: "@nova",
        avatarUrl: "", niche: "tech", language: "en", archetype: "visionary", description: "",
        personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 },
        tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("investments", {
        mintAddress: MINT, investorWallet: "investorA", sharesBought: 100,
        usdcAmount: 100, txSignature: "sig1", sharePrice: 1, investedAt: 1000,
      });
      await ctx.db.insert("investments", {
        mintAddress: MINT, investorWallet: "investorB", sharesBought: 50,
        usdcAmount: 55, txSignature: "sig2", sharePrice: 1.1, investedAt: 2000,
      });
    });
    const res = await t.query(internal.adminEconomy.listInvestmentsData, {});
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].investorWallet).toBe("investorB"); // newest first
    expect(res.rows[0].agentName).toBe("Nova");
    expect(res.summary.totalUsdc).toBe(155);
    expect(res.summary.uniqueInvestors).toBe(2);
    expect(res.summary.agentsFunded).toBe(1);
  });
});

describe("adminEconomy.agentInvestmentDetailData", () => {
  it("returns account+NAV, aggregated investors, ledger, and adjustments", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: 100, escrowUsdc: 150 });
      await ctx.db.insert("investments", {
        mintAddress: MINT, investorWallet: "investorA", sharesBought: 60,
        usdcAmount: 60, txSignature: "s1", sharePrice: 1, investedAt: 1000,
      });
      await ctx.db.insert("investments", {
        mintAddress: MINT, investorWallet: "investorA", sharesBought: 40,
        usdcAmount: 40, txSignature: "s2", sharePrice: 1, investedAt: 2000,
      });
      await ctx.db.insert("shareLedger", {
        mintAddress: MINT, wallet: "investorA", kind: "buy", shares: 100,
        navPerShare: 1, usdcAmount: 100, at: 1000,
      });
    });
    await t.mutation(internal.adminEconomy.adjustEscrowData, {
      mintAddress: MINT, deltaUsdc: 50, reason: "bonus", adminEmail: "a@b.c",
    });

    const d = await t.query(internal.adminEconomy.agentInvestmentDetailData, { mintAddress: MINT });
    expect(d.account).not.toBeNull();
    expect(d.account!.escrowUsdc).toBe(200); // 150 + 50 adjustment
    expect(d.account!.navPerShare).toBeCloseTo(2, 6); // (200 escrow − 0 tab) / 100 shares
    expect(d.investors).toHaveLength(1); // two buys aggregated into one wallet
    expect(d.investors[0].sharesBought).toBe(100);
    expect(d.investors[0].usdcAmount).toBe(100);
    expect(d.ledger).toHaveLength(1);
    expect(d.adjustments).toHaveLength(1);
    expect(d.adjustments[0].reason).toBe("bonus");
  });

  it("sorts aggregated investors by total shares descending", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("investments", {
        mintAddress: MINT, investorWallet: "small", sharesBought: 10,
        usdcAmount: 10, txSignature: "t1", sharePrice: 1, investedAt: 3000,
      });
      await ctx.db.insert("investments", {
        mintAddress: MINT, investorWallet: "whale", sharesBought: 500,
        usdcAmount: 500, txSignature: "t2", sharePrice: 1, investedAt: 1000,
      });
    });
    const d: AgentInvestmentDetail = await t.query(internal.adminEconomy.agentInvestmentDetailData, { mintAddress: MINT });
    expect(d.investors.map((i) => i.investorWallet)).toEqual(["whale", "small"]);
  });

  it("returns null account and empty lists for an unknown mint", async () => {
    const t = convexTest(schema, modules);
    const d = await t.query(internal.adminEconomy.agentInvestmentDetailData, { mintAddress: "Unknown111" });
    expect(d.account).toBeNull();
    expect(d.agent).toBeNull();
    expect(d.investors).toHaveLength(0);
  });
});
