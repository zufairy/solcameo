/// <reference types="vite/client" />
/**
 * E2E hunt #9/10/14: distribute-earnings credited the vault (creditEarnings) in
 * one Convex mutation and wrote its dedup marker (distributions.record) in a
 * SEPARATE mutation. A crash/network fault between them → the credit commits with
 * no dedup row → the claim keeper retries → DOUBLE NAV credit. The fix folds
 * dedup-check + credit + record into ONE atomic mutation (creditAndRecord), so a
 * duplicate tranche is a no-op BEFORE any vault credit.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
process.env.INTERNAL_CRON_SECRET = process.env.INTERNAL_CRON_SECRET || "test-cron-secret";

async function seedAccount(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) =>
    ctx.db.insert("agentAccount", {
      mintAddress: "MintX",
      sharesOutstanding: 1000,
      escrowUsdc: 0,
      liquidUsdc: 0,
      unsettledTabUsdc: 0,
      status: "active",
      seedSharePrice: 1,
      plannedSupply: 10000,
      updatedAt: 0,
    } as never),
  );
}

describe("earnings.creditAndRecord — atomic credit + dedup (no double-credit)", () => {
  it("credits escrow exactly once for a repeated trancheKey", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);

    const first = await t.mutation(api.earnings.creditAndRecord, {
      mintAddress: "MintX",
      amountUsdc: 100,
      builderWallet: "Builder1",
      trancheKey: "T1",
      authSecret: process.env.INTERNAL_CRON_SECRET,
    } as never);
    expect((first as { alreadyDistributed: boolean }).alreadyDistributed).toBe(false);

    // Retry the SAME tranche (as the keeper would after a partial failure) — must
    // be a no-op, NOT a second credit.
    const second = await t.mutation(api.earnings.creditAndRecord, {
      mintAddress: "MintX",
      amountUsdc: 100,
      builderWallet: "Builder1",
      trancheKey: "T1",
      authSecret: process.env.INTERNAL_CRON_SECRET,
    } as never);
    expect((second as { alreadyDistributed: boolean }).alreadyDistributed).toBe(true);

    const acct = await t.run(async (ctx) =>
      ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", "MintX")).unique());
    expect(acct!.escrowUsdc).toBe(100); // credited ONCE, not 200
    const dists = await t.run(async (ctx) =>
      ctx.db.query("distributions").withIndex("by_tranche", (q) => q.eq("trancheKey", "T1")).collect());
    expect(dists).toHaveLength(1); // one ledger row, not two
  });

  it("rejects a direct call without the internal secret", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t);
    await expect(
      t.mutation(api.earnings.creditAndRecord, {
        mintAddress: "MintX",
        amountUsdc: 100,
        builderWallet: "Builder1",
        trancheKey: "T2",
        authSecret: "wrong",
      } as never),
    ).rejects.toThrow(/unauthorized/i);
  });
});
