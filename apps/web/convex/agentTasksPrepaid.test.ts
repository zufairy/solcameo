/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "MintTaskPrepaid1111111111111111111111111111";
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

async function seed(t: TestConvex<typeof schema>) {
  await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
  await t.run(async (ctx) => {
    const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
    await ctx.db.patch(a!._id, { escrowUsdc: 100, liquidUsdc: 100 });
  });
  return t.mutation(api.agentTasks.create, { mintAddress: MINT, sessionId: "s1", type: "create_video", title: "t", authSecret: SECRET });
}
const tab = (t: TestConvex<typeof schema>) => t.run(async (ctx) => (await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique())!.unsettledTabUsdc);

describe("pay-first video tasks", () => {
  it("bills nothing extra when the render cost equals what was already paid", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await t.mutation(api.agentTasks.markPrepaid, { id, usdc: 0.4, runId: `video:${id}`, authSecret: SECRET });
    await t.mutation(api.agentTasks.succeed, { id, cost: 0.4, authSecret: SECRET });
    expect(await tab(t)).toBeCloseTo(0, 6);
  });
  it("bills only the overage when the render cost more than the prepayment", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await t.mutation(api.agentTasks.markPrepaid, { id, usdc: 0.4, runId: `video:${id}`, authSecret: SECRET });
    await t.mutation(api.agentTasks.succeed, { id, cost: 0.5, authSecret: SECRET });
    expect(await tab(t)).toBeCloseTo(0.1, 6);
  });
  it("still bills the full cost for a task that was not prepaid", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await t.mutation(api.agentTasks.succeed, { id, cost: 0.4, authSecret: SECRET });
    expect(await tab(t)).toBeCloseTo(0.4, 6);
  });
});
