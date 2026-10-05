/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-secret";
const OWNER = "OwnerWa11et";
const MINT = "Mint111";

beforeEach(() => { process.env.INTERNAL_CRON_SECRET = SECRET; });

async function setup(balance: number) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("influencers", {
      mintAddress: MINT, creatorWallet: OWNER, name: "Fikri", handle: "fikri", avatarUrl: "", niche: "fashion",
      language: "en", archetype: "friend", description: "", personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 },
      tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0, updatedAt: Date.now(),
    });
    await ctx.db.insert("userCredits", { ownerWallet: OWNER, balanceCredits: balance, totalPurchasedCredits: 0, totalSpentCredits: 0, updatedAt: 0 });
  });
  const newTask = () => t.mutation(api.agentTasks.create, {
    mintAddress: MINT, sessionId: MINT, type: "create_video", title: "v", input: "{}", triggeredBy: "user", authSecret: SECRET,
  });
  const balance_ = async () => (await t.query(api.userCredits.getBalance, { ownerWallet: OWNER }))?.balanceCredits;
  return { t, newTask, balance: balance_ };
}

describe("up-front credit holds", () => {
  it("parallel starts can never spend more than the balance", async () => {
    const { t, newTask, balance } = await setup(300);
    const ids = await Promise.all([newTask(), newTask(), newTask()]);
    const holds = await Promise.all(ids.map((id) => t.mutation(api.agentTasks.holdCredits, { id, credits: 150, authSecret: SECRET })));
    expect(holds.filter((h) => h.ok)).toHaveLength(2);
    expect(holds.filter((h) => !h.ok)).toHaveLength(1);
    expect(await balance()).toBe(0);
  });

  it("success keeps the actual cost and refunds the rest (no double charge)", async () => {
    const { t, newTask, balance } = await setup(300);
    const id = await newTask();
    await t.mutation(api.agentTasks.holdCredits, { id, credits: 150, authSecret: SECRET });
    expect(await balance()).toBe(150);
    await t.mutation(api.agentTasks.succeed, { id, output: "{}", cost: 1.1, authSecret: SECRET });
    expect(await balance()).toBe(190); // 150 held → 110 kept, 40 refunded
    // A duplicate succeed must not refund or charge again.
    await t.mutation(api.agentTasks.succeed, { id, output: "{}", cost: 1.1, authSecret: SECRET });
    expect(await balance()).toBe(190);
  });

  it("fail, cancel and repeat holds refund / no-op correctly", async () => {
    const { t, newTask, balance } = await setup(300);
    const a = await newTask();
    const b = await newTask();
    await t.mutation(api.agentTasks.holdCredits, { id: a, credits: 100, authSecret: SECRET });
    await t.mutation(api.agentTasks.holdCredits, { id: a, credits: 100, authSecret: SECRET }); // idempotent
    await t.mutation(api.agentTasks.holdCredits, { id: b, credits: 100, authSecret: SECRET });
    expect(await balance()).toBe(100);
    await t.mutation(api.agentTasks.fail, { id: a, errorMessage: "boom", authSecret: SECRET });
    await t.mutation(api.agentTasks.cancel, { id: b });
    expect(await balance()).toBe(300);
    await t.mutation(api.agentTasks.fail, { id: a, errorMessage: "again", authSecret: SECRET }); // no double refund
    expect(await balance()).toBe(300);
  });
});
