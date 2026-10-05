/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "MintTaskAccrue11111111111111111111111111111";
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

/**
 * accrueTaskCost ALWAYS records (the task ran), unlike recordUsage. Without an
 * idemKey a duplicate agentTasks.succeed (double-clicked approve-trade, cron
 * re-fire) would insert a second usageLedger row and double-add to the tab, which
 * settleTab then sweeps to the treasury — an over-charge against the agent. succeed
 * now passes idemKey `task:${id}` so a duplicate is a no-op.
 */
describe("agentTasks.succeed — accrueTaskCost idempotency", () => {
  async function seedFunded(t: TestConvex<typeof schema>) {
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { escrowUsdc: 100, liquidUsdc: 100 });
    });
  }

  it("charges the agent ONCE when succeed fires twice for the same task", async () => {
    const t = convexTest(schema, modules);
    await seedFunded(t);
    const taskId = await t.mutation(api.agentTasks.create, {
      mintAddress: MINT, sessionId: "s1", type: "clip", title: "t", authSecret: SECRET,
    });
    await t.mutation(api.agentTasks.succeed, { id: taskId, cost: 0.5, authSecret: SECRET });
    await t.mutation(api.agentTasks.succeed, { id: taskId, cost: 0.5, authSecret: SECRET }); // duplicate

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("usageLedger").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect();
      const taskRows = rows.filter((r) => r.idemKey === `task:${taskId}`);
      expect(taskRows).toHaveLength(1); // ONE charge, not two
      const acct = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      expect(acct!.unsettledTabUsdc).toBeCloseTo(0.5, 6); // tab charged once
    });
  });
});
