/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { runHasSuccessfulClip } from "./clipJobs";

const modules = import.meta.glob("./**/*.ts");
const MINT = "UsageTestMint111111111111111111111111111";

// The money mutations (recordUsage/settleTab/markSettlementPaid) are public but
// INTERNAL_CRON_SECRET-gated (ConvexHttpClient can't reach internal fns). Set a
// known secret for the suite and thread it into every gated call.
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

async function seedAccount(t: TestConvex<typeof schema>) {
  await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
}

async function fundAccount(t: TestConvex<typeof schema>, escrowUsdc: number) {
  await t.run(async (ctx) => {
    const a = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", MINT))
      .unique();
    await ctx.db.patch(a!._id, { escrowUsdc, liquidUsdc: escrowUsdc });
  });
}

describe("recordUsage", () => {
  it("ok path: records a usage row and increments unsettledTabUsdc", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    const result = await t.mutation(api.usage.recordUsage, {
      mintAddress: MINT,
      service: "render",
      qty: 1,
      authSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    expect(result.costUsdc).toBe(0.4);
    expect(result.unsettledTabUsdc).toBe(0.4);

    // usage row should exist
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("usageLedger")
        .withIndex("by_mint", (q) => q.eq("mintAddress", MINT))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].service).toBe("render");
    expect(rows[0].costUsdc).toBe(0.4);
    expect(rows[0].unitPriceUsdc).toBe(0.4);
    expect(rows[0].qty).toBe(1);
    expect(rows[0].settledBatchId).toBeUndefined();

    // account tab should be updated
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.unsettledTabUsdc).toBe(0.4);
    expect(acct!.status).toBe("active");
  });

  it("denies (ok:false) and PERSISTS needs_funding when spendable can't cover the cost", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    // escrow stays 0 → spendable 0 < render price
    const res = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("needs_funding");
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.status).toBe("needs_funding");          // PERSISTED (the fix)
    expect(acct!.unsettledTabUsdc).toBe(0);              // no tab added on denial
    const rows = await t.run(async (ctx) => ctx.db.query("usageLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(rows).toHaveLength(0);                         // no usage row on denial
  });

  it("recovers to active once funded and meters successfully", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET }); // → needs_funding
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 100, liquidUsdc: 100 });
    });
    const res = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
    expect(res.ok).toBe(true);
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.status).toBe("active");
    expect(acct!.unsettledTabUsdc).toBeCloseTo(0.4, 6);
  });

  it("rejects service call for a suspended agent", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.run(async (ctx) => {
      const a = await ctx.db
        .query("agentAccount")
        .withIndex("by_mint", (q) => q.eq("mintAddress", MINT))
        .unique();
      await ctx.db.patch(a!._id, { status: "suspended" });
    });

    // Suspended is now a DENIAL (ok:false), not a throw — a best-effort caller
    // would swallow a throw and do the work for free, so we deny instead.
    const res = await t.mutation(api.usage.recordUsage, {
      mintAddress: MINT,
      service: "render",
      qty: 1,
      authSecret: SECRET,
    });
    expect(res.ok).toBe(false);
    expect((res as { reason?: string }).reason).toBe("suspended");
  });

  it("rejects a call WITHOUT the internal secret", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await expect(
      t.mutation(api.usage.recordUsage, {
        mintAddress: MINT,
        service: "render",
        qty: 1,
        authSecret: "wrong-secret",
      })
    ).rejects.toThrow(/unauthorized/);
    // …and no usage row was written (the gate fired before any work)
    const rows = await t.run(async (ctx) => ctx.db.query("usageLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(rows).toHaveLength(0);
  });

  it("throws for a missing account", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.usage.recordUsage, {
        mintAddress: "nonexistent_mint_addr_111111111111111111",
        service: "render",
        qty: 1,
        authSecret: SECRET,
      })
    ).rejects.toThrow(/no agentAccount/);
  });

  it("throws for an unknown service (delegates to priceFor)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await expect(
      t.mutation(api.usage.recordUsage, {
        mintAddress: MINT,
        service: "nonexistent_service",
        qty: 1,
        authSecret: SECRET,
      })
    ).rejects.toThrow(/unknown service/);
  });
});

describe("recordUsage retry payment proof", () => {
  it("converts a video's own reservation into one charge without requiring twice the funds", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 0.4);
    const taskId = await t.mutation(api.agentTasks.create, { mintAddress: MINT, sessionId: "sample", type: "create_video", title: "Sample", authSecret: SECRET });
    expect(await t.mutation(api.agentTasks.holdWallet, { id: taskId, amountUsdc: 0.4, authSecret: SECRET })).toMatchObject({ ok: true });
    const result = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, walletOnly: true, requireTransfer: true, reservationTaskId: taskId, authSecret: SECRET });
    expect(result).toMatchObject({ ok: true, costUsdc: 0.4 });
    const account = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(account?.generationReservedUsdc).toBe(0);
    expect(account?.unsettledTabUsdc).toBeCloseTo(0.4);
    expect((await t.run(ctx => ctx.db.get(taskId)))?.walletHold?.settled).toBe(true);
  });
  it("preserves refund credits while booking a real transfer for a video", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 1);
    await t.run(async ctx => {
      await ctx.db.insert("usageLedger", { mintAddress: MINT, service: "clip_refund_credit", qty: 1, unitPriceUsdc: -0.9, costUsdc: -0.9, at: Date.now() });
      const account = await ctx.db.query("agentAccount").withIndex("by_mint", q => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(account!._id, { unsettledTabUsdc: -0.9 });
    });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, walletOnly: true, requireTransfer: true, authSecret: SECRET });
    expect(await t.mutation(api.usage.settleTab, { mintAddress: MINT, requireTransfer: true, authSecret: SECRET })).toMatchObject({ settled: true, amountUsdc: 0.4 });
    const account = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(account?.unsettledTabUsdc).toBeCloseTo(-0.9);
    const tail = await t.run(ctx => ctx.db.query("usageLedger").withIndex("by_mint_settled", q => q.eq("mintAddress", MINT).eq("settledBatchId", undefined)).collect());
    expect(tail.map(row => row.costUsdc)).toEqual([-0.9]);
  });
  it("does not use refund credit to authorize a transfer the wallet cannot afford", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 0.1);
    await t.run(async ctx => {
      const account = await ctx.db.query("agentAccount").withIndex("by_mint", q => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(account!._id, { unsettledTabUsdc: -1 });
    });
    expect(await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, walletOnly: true, requireTransfer: true, authSecret: SECRET })).toMatchObject({ ok: false, reason: "needs_funding" });
  });
  it("distinguishes a reservation, pending settlement, and confirmed payment", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    const args = { mintAddress: MINT, service: "render", qty: 1, idemKey: "retry:skill:render", authSecret: SECRET };
    await t.mutation(api.usage.recordUsage, args);
    expect(await t.mutation(api.usage.recordUsage, args)).toMatchObject({ ok: true, duplicate: true, paymentConfirmed: false });
    const batch = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    if (!batch.settled) throw new Error("expected settlement");
    expect(await t.mutation(api.usage.recordUsage, args)).toMatchObject({ ok: false, reason: "payment_pending" });
    await t.mutation(api.usage.markSettlementPaid, { settlementId: batch.settlementId, txSignature: "confirmed-signature", authSecret: SECRET });
    expect(await t.mutation(api.usage.recordUsage, args)).toMatchObject({ ok: true, paymentConfirmed: true });
  });
  it("rejects an idempotency row voided by a failed run", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    const args = { mintAddress: MINT, service: "render", qty: 1, idemKey: "failed:skill:render", authSecret: SECRET };
    await t.mutation(api.usage.recordUsage, args);
    await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: "failed", authSecret: SECRET });
    expect(await t.mutation(api.usage.recordUsage, args)).toMatchObject({ ok: false, reason: "charge_refunded" });
  });
});

describe("settleTab", () => {
  it.each([0.4, 0.9])("consumes a %s refund credit once and preserves the remainder", async (credit) => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.run(async (ctx) => {
      await ctx.db.insert("usageLedger", { mintAddress: MINT, service: "clip_refund_credit", qty: 1, unitPriceUsdc: -credit, costUsdc: -credit, at: Date.now() });
      const account = await ctx.db.query("agentAccount").withIndex("by_mint", q => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(account!._id, { unsettledTabUsdc: -credit });
    });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
    const result = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    expect(result).toMatchObject({ settled: false, credited: true, coveredUsdc: 0.4 });
    expect(await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET })).toEqual({ settled: false });
    const tail = await t.run(ctx => ctx.db.query("usageLedger").withIndex("by_mint_settled", q => q.eq("mintAddress", MINT).eq("settledBatchId", undefined)).collect());
    expect(tail.reduce((sum, row) => sum + row.costUsdc, 0)).toBeCloseTo(0.4 - credit, 6);
    expect((await t.query(api.agentAccount.get, { mintAddress: MINT }))!.unsettledTabUsdc).toBeCloseTo(0.4 - credit, 6);
  });

  it("settles two unsettled rows: reduces the tab + stamps settledBatchId, WITHOUT debiting the mirror (chain=truth)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    // record render (0.40) + image_gen (0.05) = 0.45 total
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "image_gen", qty: 1, authSecret: SECRET });

    const result = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    expect(result.settled).toBe(true);
    if (!result.settled) throw new Error("expected settled");

    expect(result.amountUsdc).toBe(0.45);

    // Compute-settlement migration: settleTab must NOT debit escrow/liquid — the
    // on-chain vault (debit_fee) + reconcile own those now. Only the tab moves; the
    // 0.45 is carried by the (unpaid) feeSettlements row until the on-chain sweep.
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBeCloseTo(100, 6);   // UNCHANGED (was 99.55)
    expect(acct!.liquidUsdc).toBeCloseTo(100, 6);   // UNCHANGED (was 99.55)
    expect(acct!.unsettledTabUsdc).toBe(0);

    // all usage rows have settledBatchId set
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("usageLedger")
        .withIndex("by_mint", (q) => q.eq("mintAddress", MINT))
        .collect()
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].settledBatchId).toBeDefined();
    expect(rows[1].settledBatchId).toBeDefined();
    expect(rows[0].settledBatchId).toBe(rows[1].settledBatchId); // same batch

    // feeSettlements row exists
    const settlements = await t.run(async (ctx) =>
      ctx.db
        .query("feeSettlements")
        .withIndex("by_mint", (q) => q.eq("mintAddress", MINT))
        .collect()
    );
    expect(settlements).toHaveLength(1);
    expect(settlements[0].amountUsdc).toBe(0.45);
    expect(settlements[0].coversUsageIds).toHaveLength(2);
    expect(settlements[0].txSignature).toBeUndefined();
  });

  it("returns settled:false when there is nothing to settle", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    const result = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    expect(result.settled).toBe(false);
  });

  it("second settleTab after first returns settled:false (already settled rows ignored)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });
    await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });

    // second settle: no unsettled rows remain
    const result2 = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    expect(result2.settled).toBe(false);
  });

  it("throws for a missing account", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.usage.settleTab, {
        mintAddress: "nonexistent_mint_addr_111111111111111111",
        authSecret: SECRET,
      })
    ).rejects.toThrow(/no agentAccount/);
  });
});

describe("markSettlementPaid", () => {
  it("stamps txSignature on the settlement row", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });

    const settleResult = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    if (!settleResult.settled) throw new Error("expected settled");

    await t.mutation(api.usage.markSettlementPaid, {
      settlementId: settleResult.settlementId as Id<"feeSettlements">,
      txSignature: "on-chain-tx-sig",
      authSecret: SECRET,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get(settleResult.settlementId as Id<"feeSettlements">)
    );
    expect(row!.txSignature).toBe("on-chain-tx-sig");
  });

  it("throws when marking an already-paid settlement", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, authSecret: SECRET });

    const settleResult = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    if (!settleResult.settled) throw new Error("expected settled");

    await t.mutation(api.usage.markSettlementPaid, {
      settlementId: settleResult.settlementId as Id<"feeSettlements">,
      txSignature: "first-tx",
      authSecret: SECRET,
    });

    await expect(
      t.mutation(api.usage.markSettlementPaid, {
        settlementId: settleResult.settlementId as Id<"feeSettlements">,
        txSignature: "second-tx",
        authSecret: SECRET,
      })
    ).rejects.toThrow(/already paid/);
  });

  it("throws when settlement row not found (validator rejects invalid id format)", async () => {
    const t = convexTest(schema, modules);
    // Convex validates Id format before the handler runs; "nonexistent" is not a
    // valid Convex Id, so the validator throws. This is the expected guard at the
    // entry point — the handler's own "settlement not found" branch handles the
    // case of a well-formed but deleted id, which is covered by the double-pay test.
    await expect(
      t.mutation(api.usage.markSettlementPaid, {
        settlementId: "nonexistent" as Id<"feeSettlements">,
        txSignature: "tx",
        authSecret: SECRET,
      })
    ).rejects.toThrow();
  });
});


describe("recordUsage idempotency + daily cap", () => {
  it("same idemKey bills once — retry returns the prior charge", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    const first = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, idemKey: "run1:render:0", authSecret: SECRET });
    const retry = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, idemKey: "run1:render:0", authSecret: SECRET });
    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    expect((retry as { duplicate?: boolean }).duplicate).toBe(true);

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("usageLedger").collect();
      expect(rows.length).toBe(1); // one charge, not two
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      expect(a!.unsettledTabUsdc).toBe(0.4);
    });
  });

  it("different idemKeys bill separately", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, idemKey: "run1:render:0", authSecret: SECRET });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, idemKey: "run1:render:1", authSecret: SECRET });
    await t.run(async (ctx) => {
      expect((await ctx.db.query("usageLedger").collect()).length).toBe(2);
    });
  });

  it("daily cap denies with daily_cap and does NOT flip needs_funding", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 1000); // richly funded — the cap, not the balance, is the gate
    // default cap is $10; render is $0.40 → 25 charges fit, the 26th crosses
    for (let i = 0; i < 25; i++) {
      const r = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, idemKey: `cap:${i}`, authSecret: SECRET });
      expect(r.ok).toBe(true);
    }
    const denied = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, idemKey: "cap:26", authSecret: SECRET });
    expect(denied.ok).toBe(false);
    expect((denied as { reason?: string }).reason).toBe("daily_cap");
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      expect(a!.status).toBe("active"); // capped ≠ broke
    });
  });

  it("todaysSpendQuery reports spend + cap", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "transcription", qty: 1, authSecret: SECRET });
    const r = await t.query(api.usage.todaysSpendQuery, { mintAddress: MINT });
    expect(r.spentTodayUsdc).toBe(0.1);
    expect(r.capUsdc).toBeGreaterThan(0);
  });
});

// #23 render-backstop support: the clip route uses this to tell a documented
// run-start under-charge (a skill precheck cleanly denied on a cap race) apart
// from a direct billing-less caller (the #23 exploit shape) — proof precheck ran
// for this run is a prior `${runId}:skill:*` ledger row.
describe("hasRunSkillCharge", () => {
  it("is true when a prior skill charge for the runId exists today", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.facetrack", qty: 1, idemKey: "run-1:skill:clip.facetrack", authSecret: SECRET });
    expect(await t.query(api.usage.hasRunSkillCharge, { mintAddress: MINT, runId: "run-1" })).toBe(true);
  });

  it("is false when no skill charge for that runId exists", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.facetrack", qty: 1, idemKey: "run-1:skill:clip.facetrack", authSecret: SECRET });
    expect(await t.query(api.usage.hasRunSkillCharge, { mintAddress: MINT, runId: "run-OTHER" })).toBe(false);
  });

  it("does not match a non-skill idemKey with the same runId (e.g. the render step key)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "render", qty: 1, idemKey: "run-1:cut", authSecret: SECRET });
    expect(await t.query(api.usage.hasRunSkillCharge, { mintAddress: MINT, runId: "run-1" })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// refundRunFees — void a failed clip run's up-front skill fees (0-clip runs).
// The funding GATE still charges before compute; a run that delivers ZERO clips
// must not KEEP the money. The refund reverses recordUsage for the run's
// `${jobId}:skill:*` charges, and it never claws back a fee already swept to
// treasury (settled). See convex/usage.ts:refundRunFeesTx.
// ─────────────────────────────────────────────────────────────────────────────
describe("refundRunFees", () => {
  const JOB = "clipjob_refund_test_1";

  it("nets the tab AND the daily total back to zero + voids the rows in place", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    // Two wired-skill charges for one run (facetrack 0.43 + hook 0.35 = 0.78).
    const r1 = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.facetrack", qty: 1, idemKey: `${JOB}:skill:clip.facetrack`, authSecret: SECRET });
    const r2 = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.hook", qty: 1, idemKey: `${JOB}:skill:clip.hook`, authSecret: SECRET });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const charged = +(0.43 + 0.35).toFixed(6);

    const tabBefore = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(tabBefore!.unsettledTabUsdc).toBeCloseTo(charged, 6);
    const dayBefore = await t.query(api.usage.todaysSpendQuery, { mintAddress: MINT });
    expect(dayBefore.spentTodayUsdc).toBeCloseTo(charged, 6);

    const refund = await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: SECRET });
    expect(refund.count).toBe(2);
    expect(refund.refundedUsdc).toBeCloseTo(charged, 6);

    // Tab restored + daily total reversed.
    const tabAfter = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(tabAfter!.unsettledTabUsdc).toBeCloseTo(0, 6);
    const dayAfter = await t.query(api.usage.todaysSpendQuery, { mintAddress: MINT });
    expect(dayAfter.spentTodayUsdc).toBeCloseTo(0, 6);

    // Rows KEPT (audit + precheck proof) but voided: cost 0 + refund sentinel.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("usageLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.costUsdc).toBe(0);
      expect(row.settledBatchId).toBe(`refund:${JOB}`);
      expect(typeof row.idemKey).toBe("string"); // idemKey untouched (hasRunSkillCharge still works)
    }

    // The economyReconcile tab-drift invariant (Σ unsettled costUsdc === tab) holds.
    const chk = await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT });
    expect(chk.ok).toBe(true);
  });

  it("double-refund is a no-op (second call refunds nothing, tab unchanged)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.facetrack", qty: 1, idemKey: `${JOB}:skill:clip.facetrack`, authSecret: SECRET });

    const first = await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: SECRET });
    expect(first.count).toBe(1);
    const second = await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: SECRET });
    expect(second.count).toBe(0);
    expect(second.refundedUsdc).toBe(0);

    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.unsettledTabUsdc).toBeCloseTo(0, 6); // not driven negative
  });

  it("refunding a never-charged job is a no-op", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    // Charge a DIFFERENT job so the tab is non-zero; the uncharged job must not touch it.
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.hook", qty: 1, idemKey: `other_job:skill:clip.hook`, authSecret: SECRET });

    const r = await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: "job_that_never_ran", authSecret: SECRET });
    expect(r.count).toBe(0);
    expect(r.refundedUsdc).toBe(0);

    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.unsettledTabUsdc).toBeCloseTo(0.35, 6); // the OTHER job's charge is untouched
  });

  // C12: a run that straddles the hourly boundary can have its in-flight
  // `${jobId}:skill:*` fees SWEPT off the tab by the settle cron BEFORE it fails.
  // The old refund only voided the still-unsettled tail → a 0-clip run stayed
  // charged for the swept fees. Now the swept portion is made whole via an
  // idempotent compensating credit (the settlement row itself is left intact).
  it("(0-clip) makes the agent whole for skill fees the hourly sweep already collected mid-run", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    // Two wired skills charged up-front (facetrack 0.43 + hook 0.35 = 0.78).
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.facetrack", qty: 1, idemKey: `${JOB}:skill:clip.facetrack`, authSecret: SECRET });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.hook", qty: 1, idemKey: `${JOB}:skill:clip.hook`, authSecret: SECRET });
    const charged = +(0.43 + 0.35).toFixed(6);

    // The HOURLY settle cron fires MID-RUN → both in-flight skill rows get a
    // settledBatchId and move off the tab onto a feeSettlements row.
    const settle = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    expect(settle.settled).toBe(true);
    expect((await t.query(api.agentAccount.get, { mintAddress: MINT }))!.unsettledTabUsdc).toBeCloseTo(0, 6);
    expect((await t.query(api.usage.serviceSpendQuery, { mintAddress: MINT })).totalSpentUsdc).toBeCloseTo(charged, 6);

    // The run then fails with 0 clips → refund. BOTH swept fees are made whole.
    const refund = await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: SECRET });
    expect(refund.count).toBe(2);
    expect(refund.refundedUsdc).toBeCloseTo(charged, 6);

    // NET lifetime charge for the run is 0 (a compensating credit offsets the swept fees).
    expect((await t.query(api.usage.serviceSpendQuery, { mintAddress: MINT })).totalSpentUsdc).toBeCloseTo(0, 6);
    // The credit rides the tab as a negative offset that reduces the agent's NEXT settle.
    expect((await t.query(api.agentAccount.get, { mintAddress: MINT }))!.unsettledTabUsdc).toBeCloseTo(-charged, 6);
    // Spine invariant (Σ unsettled usageLedger costUsdc === tab) still holds.
    expect((await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT })).ok).toBe(true);
    // Exactly ONE compensating-credit row (negative cost), keyed off the job.
    const credits = await t.run(async (ctx) =>
      (await ctx.db.query("usageLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect()).filter((r) => r.costUsdc < 0));
    expect(credits).toHaveLength(1);
    expect(credits[0].costUsdc).toBeCloseTo(-charged, 6);

    // IDEMPOTENT: a second refund (reaper / finalizeJob re-fire) must NOT double-credit.
    const second = await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: SECRET });
    expect(second.count).toBe(0);
    expect(second.refundedUsdc).toBe(0);
    expect((await t.query(api.agentAccount.get, { mintAddress: MINT }))!.unsettledTabUsdc).toBeCloseTo(-charged, 6);
    const creditsAfter = await t.run(async (ctx) =>
      (await ctx.db.query("usageLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect()).filter((r) => r.costUsdc < 0));
    expect(creditsAfter).toHaveLength(1); // still exactly one credit row
  });

  // C12 end-to-end money proof: the agent's RECONCILED spendable returns to its
  // pre-run value after a 0-clip refund — whether or not the on-chain debit_fee
  // sweep has landed yet (the pending-settlement hold-out and the credit cancel).
  it("(0-clip, end-to-end) reconciled spendable returns to pre-run after the swept fee is credited", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.facetrack", qty: 1, idemKey: `${JOB}:skill:clip.facetrack`, authSecret: SECRET });
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.hook", qty: 1, idemKey: `${JOB}:skill:clip.hook`, authSecret: SECRET });
    const charged = +(0.43 + 0.35).toFixed(6);

    const settle = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    if (!settle.settled) throw new Error("expected settled");

    // Pre-refund: the run is charged — reconciled spendable is 100 − 0.78.
    const preRefund = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!preRefund.ok) throw new Error("unreachable");
    expect(preRefund.spendableUsdc).toBeCloseTo(100 - charged, 6);

    await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: SECRET });

    // Post-refund, BEFORE the on-chain sweep lands (vault still holds 100): the
    // pending-settlement hold-out (−0.78) and the tab credit (+0.78 to spendable) cancel.
    const preSweep = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!preSweep.ok) throw new Error("unreachable");
    expect(preSweep.spendableUsdc).toBeCloseTo(100, 6); // restored to pre-run

    // Now the on-chain debit_fee lands: mark paid + reconcile at the LOWERED vault
    // (100 − 0.78). Spendable is STILL 100 — the credit offsets the swept fee.
    await t.mutation(api.usage.markSettlementPaid, {
      settlementId: settle.settlementId as Id<"feeSettlements">, txSignature: "onchain-debit-fee-sig", authSecret: SECRET,
    });
    const postSweep = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100 - charged, authSecret: SECRET });
    if (!postSweep.ok) throw new Error("unreachable");
    expect(postSweep.spendableUsdc).toBeCloseTo(100, 6); // still whole after the sweep
  });

  it("makes a MIXED run whole: voids the still-unsettled fee AND credits the already-swept one; settlement row intact", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);

    // Skill A charged then SETTLED (swept to a feeSettlements row, tab → 0).
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.facetrack", qty: 1, idemKey: `${JOB}:skill:clip.facetrack`, authSecret: SECRET });
    const settle = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    expect(settle.settled).toBe(true);

    // Skill B charged AFTER the sweep → still unsettled (tab = 0.35).
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.hook", qty: 1, idemKey: `${JOB}:skill:clip.hook`, authSecret: SECRET });

    const refund = await t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: SECRET });
    expect(refund.count).toBe(2);                    // BOTH made whole (B voided, A credited)
    expect(refund.refundedUsdc).toBeCloseTo(0.78, 6);

    // Net lifetime charge for the run is 0; tab = −(swept skill-A 0.43) — skill B was
    // voided to 0, skill A became a compensating credit.
    expect((await t.query(api.usage.serviceSpendQuery, { mintAddress: MINT })).totalSpentUsdc).toBeCloseTo(0, 6);
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.unsettledTabUsdc).toBeCloseTo(-0.43, 6);
    expect((await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT })).ok).toBe(true);

    // The SETTLED skill-A fee's settlement row is LEFT INTACT — the treasury still
    // collects it on-chain via debit_fee; the agent is made whole by the compensating
    // credit (which offsets its NEXT fees), NOT by mutating the in-flight settlement.
    const settlements = await t.run(async (ctx) =>
      ctx.db.query("feeSettlements").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(settlements).toHaveLength(1);
    expect(settlements[0].amountUsdc).toBeCloseTo(0.43, 6);
  });

  it("rejects a call WITHOUT the internal secret", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 100);
    await expect(
      t.mutation(api.usage.refundRunFees, { mintAddress: MINT, jobId: JOB, authSecret: "wrong-secret" })
    ).rejects.toThrow(/unauthorized/);
  });
});

// The refund-on-failure PREDICATE (clipJobs.runHasSuccessfulClip): a run keeps its
// charge iff ≥1 clip rendered (clipUrl) or reached ready/posted; a full-failure run
// (all failed / still-rendering / no rows) is refundable.
describe("runHasSuccessfulClip (refund predicate)", () => {
  it("is false for a run with no successful clip (refundable)", () => {
    expect(runHasSuccessfulClip([])).toBe(false);
    expect(runHasSuccessfulClip([{ status: "failed" }, { status: "rendering" }])).toBe(false);
    expect(runHasSuccessfulClip([{ status: "skipped" }])).toBe(false);
  });
  it("is true when ANY clip rendered or posted (charge KEPT)", () => {
    expect(runHasSuccessfulClip([{ status: "failed" }, { status: "ready" }])).toBe(true);
    expect(runHasSuccessfulClip([{ status: "posted" }])).toBe(true);
    expect(runHasSuccessfulClip([{ status: "rendering", clipUrl: "https://cdn/x.mp4" }])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compute-settlement migration (chain=truth) — the money invariant.
//
// Under the migration the on-chain agent-vault owns the balance: `debit_fee` moves
// the compute fee out of the vault, and the Convex escrow mirror is reconciled to
// the vault balance. The delicate seam is the DOUBLE-DEBIT: settleTab must no
// longer debit the mirror (debit_fee does that on-chain), while the booked-unpaid
// fee must still be held out of spendable EXACTLY ONCE until the sweep lands.
// ─────────────────────────────────────────────────────────────────────────────
describe("compute-settlement migration: money invariant", () => {
  it("(invariant 1) settleTab drops the tab by $1 and leaves the escrow mirror UNTOUCHED (no double-debit)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 5); // escrow = liquid = 5

    // Book a $1.00 tab (transcription $0.10 × 10).
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "transcription", qty: 10, authSecret: SECRET });
    const before = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(before!.unsettledTabUsdc).toBeCloseTo(1, 6);
    expect(before!.escrowUsdc).toBeCloseTo(5, 6);

    const res = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    expect(res.settled).toBe(true);
    if (!res.settled) throw new Error("expected settled");
    expect(res.amountUsdc).toBeCloseTo(1, 6);

    const after = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(after!.unsettledTabUsdc).toBeCloseTo(0, 6); // tab dropped by exactly $1
    expect(after!.escrowUsdc).toBeCloseTo(5, 6);       // mirror UNCHANGED by settleTab
    expect(after!.liquidUsdc).toBeCloseTo(5, 6);       // mirror UNCHANGED by settleTab

    // The $1 now rides on an UNPAID feeSettlements row (swept on-chain by debit_fee).
    const settlements = await t.run(async (ctx) =>
      ctx.db.query("feeSettlements").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(settlements).toHaveLength(1);
    expect(settlements[0].amountUsdc).toBeCloseTo(1, 6);
    expect(settlements[0].txSignature).toBeUndefined();
  });

  it("(invariant 2) reconcile mirrors the on-chain VAULT balance: escrow === $3 (adminAdj 0, no pending settlement)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t); // fresh: no adminAdjustment, no settlements

    const recon = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, {
      mintAddress: MINT, onchainUsdc: 3, authSecret: SECRET,
    });
    expect(recon.ok).toBe(true);
    if (!recon.ok) throw new Error("unreachable");
    expect(recon.escrowUsdc).toBeCloseTo(3, 6); // escrow === vault balance

    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct!.escrowUsdc).toBeCloseTo(3, 6);
  });

  it("(invariant 3) a booked-but-unpaid settlement is held out ONCE — never double-reduced across the on-chain sweep", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await fundAccount(t, 5);

    // Book $1 and settle it (tab → 0; an UNPAID feeSettlements row of $1 remains).
    await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "transcription", qty: 10, authSecret: SECRET });
    const settle = await t.mutation(api.usage.settleTab, { mintAddress: MINT, authSecret: SECRET });
    if (!settle.settled) throw new Error("expected settled");

    // The chain hasn't moved yet (debit_fee pending): the vault still holds $5.
    // Reconcile must hold the $1 owed out of escrow EXACTLY ONCE — via the
    // unpaid-settlement guard, NOT also via a settleTab mirror debit (which would
    // give 5 − 2 = 3).
    const r1 = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 5, authSecret: SECRET });
    if (!r1.ok) throw new Error("unreachable");
    expect(r1.escrowUsdc).toBeCloseTo(4, 6);     // 5 − 1 (once), not 3
    expect(r1.spendableUsdc).toBeCloseTo(4, 6);

    // Now the on-chain debit_fee lands: mark the settlement paid + reconcile at the
    // LOWERED vault ($4). The fee counts ONCE end-to-end — the vault drop REPLACES
    // the guard hold-out (never both), so escrow stays $4.
    await t.mutation(api.usage.markSettlementPaid, {
      settlementId: settle.settlementId as Id<"feeSettlements">, txSignature: "onchain-debit-fee-sig", authSecret: SECRET,
    });
    const r2 = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 4, authSecret: SECRET });
    if (!r2.ok) throw new Error("unreachable");
    expect(r2.escrowUsdc).toBeCloseTo(4, 6);     // counted once — not reduced again
    expect(r2.spendableUsdc).toBeCloseTo(4, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reconcile: bounded unpaid-settlement hold-out (scaling / integrity).
//
// reconcile subtracts the UNPAID-settlement total (USDC owed the treasury but not
// yet swept on-chain) out of spendable. It must compute that hold-out from ONLY the
// unpaid-candidate rows via the by_mint_paid index — NEVER an unbounded scan of the
// (mostly-paid) lifetime settlement history, which throws past Convex's ~16k-row
// read cap on a long-lived busy agent and strands the escrow mirror. The `paid`
// flag is the authoritative set-membership key: a row flagged paid:true is OUT of
// the hold-out set; paid:false and legacy paid===undefined rows are still in it.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Credits-first billing (Task 2): recordUsage checks the agent owner's pooled
// userCredits balance before falling through to the agentAccount USDC path.
// ─────────────────────────────────────────────────────────────────────────────
const CREDITS_MINT = "MintCredits11111111111111111111111111111";
const CREDITS_WALLET = "WalletCredits111111111111111111111111111";

async function seedAgentWithOwner(t: TestConvex<typeof schema>) {
  await t.mutation(internal.agentAccount.create, { mintAddress: CREDITS_MINT });
  await t.run(async (ctx) => {
    await ctx.db.insert("influencers", {
      mintAddress: CREDITS_MINT, name: "Test Agent", handle: "test_agent", creatorWallet: CREDITS_WALLET,
      avatarUrl: "https://example.com/avatar.png", niche: "test", language: "en", archetype: "test",
      description: "test", personality: { warmth: 0, humor: 0, authority: 0, boldness: 0 },
      tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0,
    } as never);
  });
}

describe("recordUsage — credits-first billing", () => {
  it("charges userCredits when the owning wallet has enough balance, leaves agentAccount untouched", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 100_00, kind: "purchase" });

    // qty:10 so the credits amount (cost×100, rounded) is non-zero — llm_message is
    // $0.003/unit, and a single unit rounds to 0 credits.
    const res = await t.mutation(api.usage.recordUsage, {
      mintAddress: CREDITS_MINT, service: "llm_message", qty: 10, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res as { paidWithCredits?: boolean }).paidWithCredits).toBe(true);

    const acct = await t.query(api.agentAccount.get, { mintAddress: CREDITS_MINT });
    expect(acct!.unsettledTabUsdc).toBe(0);

    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: CREDITS_WALLET });
    expect(bal!.balanceCredits).toBeLessThan(100_00);
  });

  it("falls back to agentAccount when credits are insufficient", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    // Fund the agentAccount directly so the fallback path can succeed. spendableUsdc
    // is escrowUsdc − unsettledTabUsdc, so escrowUsdc (not just liquidUsdc) must be set.
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", CREDITS_MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 10, liquidUsdc: 10 });
    });

    const res = await t.mutation(api.usage.recordUsage, {
      mintAddress: CREDITS_MINT, service: "llm_message", qty: 10, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res as { paidWithCredits?: boolean }).paidWithCredits).toBeFalsy();

    const acct = await t.query(api.agentAccount.get, { mintAddress: CREDITS_MINT });
    expect(acct!.unsettledTabUsdc).toBeGreaterThan(0);
  });

  it("falls back to agentAccount when the agent has no owning wallet (e.g. investor-funded)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: CREDITS_MINT });
    // No influencers row → no creatorWallet to look up.
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", CREDITS_MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 10, liquidUsdc: 10 });
    });

    const res = await t.mutation(api.usage.recordUsage, {
      mintAddress: CREDITS_MINT, service: "llm_message", qty: 1, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res as { paidWithCredits?: boolean }).paidWithCredits).toBeFalsy();
  });
});

describe("reconcile: bounded unpaid-settlement hold-out", () => {
  async function insertSettlement(
    t: TestConvex<typeof schema>,
    row: { amountUsdc: number; paid?: boolean; txSignature?: string },
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("feeSettlements", {
        mintAddress: MINT,
        amountUsdc: row.amountUsdc,
        coversUsageIds: [],
        at: Date.now(),
        ...(row.paid !== undefined ? { paid: row.paid } : {}),
        ...(row.txSignature !== undefined ? { txSignature: row.txSignature } : {}),
      });
    });
  }

  it("subtracts ONLY unpaid settlements; a paid-flagged row is ignored even with a non-real sig (RED on the old all-rows scan)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);

    // Swept/PAID settlements (paid:true + real base58 sig) — already off the books, NOT held out.
    await insertSettlement(t, { amountUsdc: 2, paid: true, txSignature: "real-sig-a" });
    await insertSettlement(t, { amountUsdc: 3, paid: true, txSignature: "real-sig-b" });
    // Booked/UNPAID settlements (paid:false, no sig) — held out of spendable.
    await insertSettlement(t, { amountUsdc: 1, paid: false });
    await insertSettlement(t, { amountUsdc: 4, paid: false });

    // Vault holds 100. Hold-out = unpaid only = 1 + 4 = 5 → escrow/spendable = 95.
    const r1 = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!r1.ok) throw new Error("expected ok");
    expect(r1.escrowUsdc).toBeCloseTo(95, 6);
    expect(r1.spendableUsdc).toBeCloseTo(95, 6);

    // Adding MORE paid rows must not change the hold-out (they are not unpaid).
    await insertSettlement(t, { amountUsdc: 50, paid: true, txSignature: "real-sig-c" });
    const r2 = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!r2.ok) throw new Error("expected ok");
    expect(r2.spendableUsdc).toBeCloseTo(95, 6);

    // THE CONTRACT (RED-before / GREEN-after): a row the `paid` flag marks DONE
    // (paid:true) is OUT of the hold-out set — even if its recorded sig is not a
    // real base58 (undefined / INFLIGHT placeholder). The bounded by_mint_paid path
    // reads only paid!=true rows, so it ignores this row. The OLD unbounded by_mint
    // .collect() re-scans every row and (via isPaidSig alone) WRONGLY counts this
    // oversized amount as unpaid → over-subtracts → spendable collapses to 75.
    await insertSettlement(t, { amountUsdc: 20, paid: true /* no real sig recorded */ });
    const r3 = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!r3.ok) throw new Error("expected ok");
    expect(r3.spendableUsdc).toBeCloseTo(95, 6); // NOT 75 — the paid-flagged row is ignored
    expect(r3.escrowUsdc).toBeCloseTo(95, 6);
  });

  it("still holds out LEGACY unpaid rows that predate the `paid` flag (paid===undefined) — fail closed, never over-credit", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);

    // A legacy booked-unpaid settlement written before the denormalized `paid`
    // field existed: paid===undefined, no sig. It STILL owes the treasury, so
    // reconcile must hold it out (subtract it) — the bounded read must include the
    // paid===undefined bucket, else it under-subtracts → over-credits (fail-OPEN).
    await insertSettlement(t, { amountUsdc: 7 /* paid undefined, no sig */ });
    // Plus a current booked-unpaid row.
    await insertSettlement(t, { amountUsdc: 3, paid: false });

    const r = await t.mutation(api.agentAccount.reconcileEscrowToOnchainServer, { mintAddress: MINT, onchainUsdc: 100, authSecret: SECRET });
    if (!r.ok) throw new Error("expected ok");
    expect(r.spendableUsdc).toBeCloseTo(90, 6); // 100 − (7 + 3), both held out
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Final-review fixes: a credits-paid usageLedger row now carries its REAL cost
// (+ a `paidWith` marker) instead of costUsdc:0. That single overload had
// silently broken the daily cap, every spend report, and failed-run refunds for
// credit-funded users, while suspension was skipped entirely.
// ─────────────────────────────────────────────────────────────────────────────
describe("recordUsage — credits path: real cost, caps, suspension, refunds", () => {
  async function creditsRows(t: TestConvex<typeof schema>) {
    return t.run(async (ctx) =>
      ctx.db.query("usageLedger").withIndex("by_mint", (q) => q.eq("mintAddress", CREDITS_MINT)).collect());
  }

  it("writes the REAL costUsdc + paidWith:'credits', never touches the agent's USDC tab, and IS visible to spend reports", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 100_00, kind: "purchase" });

    const res = await t.mutation(api.usage.recordUsage, {
      mintAddress: CREDITS_MINT, service: "render", qty: 1, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);

    const rows = await creditsRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsdc).toBeCloseTo(0.4, 6);   // REAL cost, not the old 0
    expect(rows[0].paidWith).toBe("credits");
    expect(rows[0].settledBatchId).toBe("credits"); // never swept on-chain

    // Spend reporting now sees it (was $0 across the board).
    const today = await t.query(api.usage.todaysSpendQuery, { mintAddress: CREDITS_MINT });
    expect(today.spentTodayUsdc).toBeCloseTo(0.4, 6);
    const lifetime = await t.query(api.usage.serviceSpendQuery, { mintAddress: CREDITS_MINT });
    expect(lifetime.totalSpentUsdc).toBeCloseTo(0.4, 6);

    // INVARIANT: only USDC-path charges may move the agent's on-chain tab.
    const acct = await t.query(api.agentAccount.get, { mintAddress: CREDITS_MINT });
    expect(acct!.unsettledTabUsdc).toBe(0);
    // …and the settle sweep must not pick the row up, nor reconcile see tab drift.
    const settled = await t.mutation(api.usage.settleTab, { mintAddress: CREDITS_MINT, authSecret: SECRET });
    expect(settled.settled).toBe(false);
    const check = await t.query(api.economyReconcile.checkAccount, { mintAddress: CREDITS_MINT });
    expect(check.issues).toEqual([]);
  });

  it("links the credit ledger row back to the usageLedger row it paid for", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 100_00, kind: "purchase" });
    await t.mutation(api.usage.recordUsage, { mintAddress: CREDITS_MINT, service: "render", qty: 1, authSecret: SECRET });

    const usage = (await creditsRows(t))[0];
    const ledger = await t.query(api.userCredits.listLedger, { ownerWallet: CREDITS_WALLET });
    const spend = ledger.find((r) => r.kind === "spend")!;
    expect(spend.relatedUsageLedgerId).toBe(usage._id);
    expect(spend.relatedMintAddress).toBe(CREDITS_MINT);
  });

  it("enforces the daily cap BEFORE the credits branch (a rich credit balance is not a cap bypass)", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 100_00, kind: "purchase" });
    await t.mutation(api.usage.setDailyCap, { mintAddress: CREDITS_MINT, capUsdc: 0.5, authSecret: SECRET });

    const first = await t.mutation(api.usage.recordUsage, { mintAddress: CREDITS_MINT, service: "render", qty: 1, authSecret: SECRET });
    expect(first.ok).toBe(true);                    // 0.40 ≤ 0.50

    // Second $0.40 charge would take today to $0.80 — over the $0.50 cap. Because
    // credit-paid rows now carry their real cost, todaysSpend SEES the first one.
    const second = await t.mutation(api.usage.recordUsage, { mintAddress: CREDITS_MINT, service: "render", qty: 1, authSecret: SECRET });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("daily_cap");

    expect(await creditsRows(t)).toHaveLength(1);   // denial wrote nothing
    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: CREDITS_WALLET });
    expect(bal!.balanceCredits).toBe(100_00 - 40);  // only the FIRST charge debited
  });

  it("denies a SUSPENDED agent even when the owner has plenty of credits", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 100_00, kind: "purchase" });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", CREDITS_MINT)).unique();
      await ctx.db.patch(a!._id, { status: "suspended" });
    });

    const res = await t.mutation(api.usage.recordUsage, { mintAddress: CREDITS_MINT, service: "render", qty: 1, authSecret: SECRET });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("suspended");
    expect(await creditsRows(t)).toHaveLength(0);
    const bal = await t.query(api.userCredits.getBalance, { ownerWallet: CREDITS_WALLET });
    expect(bal!.balanceCredits).toBe(100_00);       // nothing debited
  });

  it("refunds a 0-clip run's CREDIT spend back to the credit balance (not the USDC tab), idempotently", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 100_00, kind: "purchase" });

    const jobId = "job-credits-1";
    await t.mutation(api.usage.recordUsage, {
      mintAddress: CREDITS_MINT, service: "render", qty: 1, idemKey: `${jobId}:skill:clip.render`, authSecret: SECRET,
    });
    const afterCharge = await t.query(api.userCredits.getBalance, { ownerWallet: CREDITS_WALLET });
    expect(afterCharge!.balanceCredits).toBe(100_00 - 40);

    const refund = await t.mutation(api.usage.refundRunFees, { mintAddress: CREDITS_MINT, jobId, authSecret: SECRET });
    expect(refund.count).toBe(1);
    expect(refund.refundedUsdc).toBeCloseTo(0.4, 6);

    const afterRefund = await t.query(api.userCredits.getBalance, { ownerWallet: CREDITS_WALLET });
    expect(afterRefund!.balanceCredits).toBe(100_00);            // made whole
    expect(afterRefund!.totalSpentCredits).toBe(0);              // spend unwound…
    expect(afterRefund!.totalPurchasedCredits).toBe(100_00);     // …a refund is NOT a purchase

    const ledger = await t.query(api.userCredits.listLedger, { ownerWallet: CREDITS_WALLET });
    expect(ledger.some((r) => r.kind === "refund" && r.deltaCredits === 40)).toBe(true);

    // The usage row is VOIDED (audit marker kept) and the agent's tab is untouched.
    const rows = await creditsRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsdc).toBe(0);
    expect(rows[0].settledBatchId).toBe(`refund:${jobId}`);
    const acct = await t.query(api.agentAccount.get, { mintAddress: CREDITS_MINT });
    expect(acct!.unsettledTabUsdc).toBe(0);

    // IDEMPOTENT: the reaper / finalizeJob re-fire must not double-refund.
    const again = await t.mutation(api.usage.refundRunFees, { mintAddress: CREDITS_MINT, jobId, authSecret: SECRET });
    expect(again.refundedUsdc).toBe(0);
    const finalBal = await t.query(api.userCredits.getBalance, { ownerWallet: CREDITS_WALLET });
    expect(finalBal!.balanceCredits).toBe(100_00);
  });

  it("still refunds a USDC-funded run to the tab (the credits branch does not regress the old path)", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);   // owner exists but has ZERO credits → USDC path
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", CREDITS_MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 10, liquidUsdc: 10 });
    });
    const jobId = "job-usdc-1";
    await t.mutation(api.usage.recordUsage, {
      mintAddress: CREDITS_MINT, service: "render", qty: 1, idemKey: `${jobId}:skill:clip.render`, authSecret: SECRET,
    });
    const charged = await t.query(api.agentAccount.get, { mintAddress: CREDITS_MINT });
    expect(charged!.unsettledTabUsdc).toBeCloseTo(0.4, 6);

    const refund = await t.mutation(api.usage.refundRunFees, { mintAddress: CREDITS_MINT, jobId, authSecret: SECRET });
    expect(refund.refundedUsdc).toBeCloseTo(0.4, 6);
    const after = await t.query(api.agentAccount.get, { mintAddress: CREDITS_MINT });
    expect(after!.unsettledTabUsdc).toBe(0);
  });

  it("still bills credits for an agent that has no agentAccount row at all", async () => {
    // The suspension + cap gates now run BEFORE the credits branch, so they must
    // tolerate a missing account rather than throwing the way the USDC fallback
    // does — a credit-funded agent may never have had one created.
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("influencers", {
        mintAddress: CREDITS_MINT, name: "No Account", handle: "no_account", creatorWallet: CREDITS_WALLET,
        avatarUrl: "https://example.com/avatar.png", niche: "test", language: "en", archetype: "test",
        description: "test", personality: { warmth: 0, humor: 0, authority: 0, boldness: 0 },
        tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0,
      } as never);
    });
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 100_00, kind: "purchase" });

    const res = await t.mutation(api.usage.recordUsage, { mintAddress: CREDITS_MINT, service: "render", qty: 1, authSecret: SECRET });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res as { paidWithCredits?: boolean }).paidWithCredits).toBe(true);
  });

  it("balanceForMint exposes the owner's balance to the upstream funding gates", async () => {
    const t = convexTest(schema, modules);
    await seedAgentWithOwner(t);
    expect(await t.query(api.userCredits.balanceForMint, { mintAddress: CREDITS_MINT })).toBe(0);
    await t.mutation(internal.userCredits.credit, { ownerWallet: CREDITS_WALLET, deltaCredits: 2500, kind: "purchase" });
    expect(await t.query(api.userCredits.balanceForMint, { mintAddress: CREDITS_MINT })).toBe(2500);
    // An agent with no owning wallet (investor-funded) has no credit pool.
    expect(await t.query(api.userCredits.balanceForMint, { mintAddress: MINT })).toBe(0);
  });
});
