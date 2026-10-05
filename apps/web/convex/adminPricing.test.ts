/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { SERVICE_PRICES } from "../lib/economy/servicePrices";

const modules = import.meta.glob("./**/*.ts");
const MINT = "PricingTestMint11111111111111111111111111";

// recordUsage is secret-gated; set a known secret for the suite (mirrors usage.test.ts).
const SECRET = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

async function seedFundedAccount(t: TestConvex<typeof schema>) {
  await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
  await t.run(async (ctx) => {
    const a = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", MINT))
      .unique();
    await ctx.db.patch(a!._id, { escrowUsdc: 100, liquidUsdc: 100 });
  });
}

describe("adminPricing — override data mutations (validation + gate logic)", () => {
  it("setSkillPriceData upserts, patches in place, and validates", async () => {
    const t = convexTest(schema, modules);
    const r1 = await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.title", priceUsdc: 0.25, updatedByEmail: "a@b.co" });
    expect(r1.priceUsdc).toBe(0.25);

    // Upsert the same skill → patches the existing row (still exactly one).
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.title", priceUsdc: 0.5, updatedByEmail: "a@b.co" });
    const rows = await t.run((ctx) =>
      ctx.db.query("skillPriceOverrides").withIndex("by_skill", (q) => q.eq("skillId", "clip.title")).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].priceUsdc).toBe(0.5);

    // Clamp: reject over-cap, negative, and unknown-skill writes.
    await expect(t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.title", priceUsdc: 1000, updatedByEmail: "a@b.co" })).rejects.toThrow();
    await expect(t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.title", priceUsdc: -1, updatedByEmail: "a@b.co" })).rejects.toThrow();
    await expect(t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.bogus", priceUsdc: 1, updatedByEmail: "a@b.co" })).rejects.toThrow();
  });

  it("clearSkillPriceData removes the override", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.hook", priceUsdc: 0.9, updatedByEmail: "a@b.co" });
    const res = await t.mutation(internal.adminPricing.clearSkillPriceData, { skillId: "clip.hook" });
    expect(res.cleared).toBe(1);
    const rows = await t.run((ctx) => ctx.db.query("skillPriceOverrides").collect());
    expect(rows).toHaveLength(0);
  });

  it("effectiveSkillPrices applies overrides over the static defaults", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.title", priceUsdc: 0.99, updatedByEmail: "a@b.co" });
    const { effective, overrides } = await t.query(api.adminPricing.effectiveSkillPrices, {});
    expect(overrides["clip.title"]).toBe(0.99);
    expect(effective["clip.title"]).toBe(0.99);     // overridden
    expect(effective["clip.facetrack"]).toBe(0.43); // static default still present
  });

  it("listSkillPricesData returns effective + static default + override metadata", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.title", priceUsdc: 0.2, updatedByEmail: "boss@vello.gg" });
    const rows = (await t.query(internal.adminPricing.listSkillPricesData, {})) as Array<{
      skillId: string;
      staticDefaultUsdc: number;
      effectiveUsdc: number;
      overrideUsdc?: number;
      updatedByEmail?: string;
    }>;
    const title = rows.find((r) => r.skillId === "clip.title")!;
    expect(title.staticDefaultUsdc).toBe(0.12);
    expect(title.effectiveUsdc).toBe(0.2);
    expect(title.overrideUsdc).toBe(0.2);
    expect(title.updatedByEmail).toBe("boss@vello.gg");
    const facetrack = rows.find((r) => r.skillId === "clip.facetrack")!;
    expect(facetrack.effectiveUsdc).toBe(0.43);
    expect(facetrack.overrideUsdc).toBeUndefined();
  });
});

describe("recordUsage honors an admin price override (the money chokepoint)", () => {
  it("charges the OVERRIDE price when a skillPriceOverrides row exists", async () => {
    const t = convexTest(schema, modules);
    await seedFundedAccount(t);
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "clip.title", priceUsdc: 0.30, updatedByEmail: "a@b.co" });
    const res = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.title", qty: 1, authSecret: SECRET });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.costUsdc).toBe(0.30); // NOT the 0.12 static default
  });

  it("charges the STATIC default when there is no override", async () => {
    const t = convexTest(schema, modules);
    await seedFundedAccount(t);
    const res = await t.mutation(api.usage.recordUsage, { mintAddress: MINT, service: "clip.title", qty: 1, authSecret: SECRET });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.costUsdc).toBe(0.12);
  });
});

describe("auto-post fee (social_post) is admin-overridable + applied at post time", () => {
  it("social_post appears in the admin list + effective map at its $0.05 default", async () => {
    const t = convexTest(schema, modules);
    const rows = (await t.query(internal.adminPricing.listSkillPricesData, {})) as Array<{
      skillId: string; staticDefaultUsdc: number; effectiveUsdc: number;
    }>;
    const post = rows.find((r) => r.skillId === "social_post");
    expect(post).toBeDefined();
    expect(post!.staticDefaultUsdc).toBe(0.05);
    expect(post!.effectiveUsdc).toBe(0.05);
    const { effective } = await t.query(api.adminPricing.effectiveSkillPrices, {});
    expect(effective["social_post"]).toBe(0.05);
  });

  it("setSkillPriceData ACCEPTS social_post (a metered service, not a clip skill) + rejects >MAX", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "social_post", priceUsdc: 0.10, updatedByEmail: "a@b.co" });
    expect(r.priceUsdc).toBe(0.10);
    const { effective } = await t.query(api.adminPricing.effectiveSkillPrices, {});
    expect(effective["social_post"]).toBe(0.10);
    await expect(t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "social_post", priceUsdc: 1000, updatedByEmail: "a@b.co" })).rejects.toThrow();
    await expect(t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "social_post", priceUsdc: -1, updatedByEmail: "a@b.co" })).rejects.toThrow();
  });

  // Debit the effective social_post fee onto the agent's tab for a post_content task.
  async function debitPost(t: TestConvex<typeof schema>, cost: number): Promise<number> {
    const taskId = await t.mutation(api.agentTasks.create, {
      mintAddress: MINT, sessionId: "s1", type: "post_content", title: "post", authSecret: SECRET,
    });
    await t.mutation(api.agentTasks.succeed, { id: taskId, cost, authSecret: SECRET });
    return await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      return a!.unsettledTabUsdc;
    });
  }

  it("no override → a published post debits the $0.05 default", async () => {
    const t = convexTest(schema, modules);
    await seedFundedAccount(t);
    const tab = await debitPost(t, SERVICE_PRICES.social_post);
    expect(tab).toBe(0.05);
  });

  it("override social_post=$0.10 → the SAME published post now debits $0.10", async () => {
    const t = convexTest(schema, modules);
    await seedFundedAccount(t);
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "social_post", priceUsdc: 0.10, updatedByEmail: "a@b.co" });
    const tab = await debitPost(t, SERVICE_PRICES.social_post);
    expect(tab).toBe(0.10);
  });

  it("clearing the override → the post debits the $0.05 default again", async () => {
    const t = convexTest(schema, modules);
    await seedFundedAccount(t);
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "social_post", priceUsdc: 0.10, updatedByEmail: "a@b.co" });
    await t.mutation(internal.adminPricing.clearSkillPriceData, { skillId: "social_post" });
    const tab = await debitPost(t, SERVICE_PRICES.social_post);
    expect(tab).toBe(0.05);
  });

  it("a FAILED post's $0.001 floor is NEVER re-priced by the override", async () => {
    const t = convexTest(schema, modules);
    await seedFundedAccount(t);
    await t.mutation(internal.adminPricing.setSkillPriceData, { skillId: "social_post", priceUsdc: 0.10, updatedByEmail: "a@b.co" });
    const tab = await debitPost(t, 0.001); // run-task bills 0.001 for a failed publish
    expect(tab).toBe(0.001);
  });
});
