/// <reference types="vite/client" />
/**
 * Security regression tests for the two campaign money-mutations that were
 * publicly writable (E2E hunt #6/7/12/13/15): topUpBudget could inflate any
 * campaign's budget with a fabricated txSignature, and updateCampaignPda
 * "authorized" on a client-supplied callerWallet (the creator wallet is public
 * → trivially spoofable IDOR). Both are now internal-secret gated; the only safe
 * caller is a Next route that verifies the on-chain deposit / SIWS ownership.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const CREATOR = "Creator11111111111111111111111111111111111";
const ATTACKER = "Attacker99999999999999999999999999999999";
const SECRET = "test-internal-secret";

const baseCampaign = {
  creatorWallet: CREATOR,
  brandName: "Acme",
  brandLogoUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Acme",
  title: "Clip campaign",
  brief: "Clip the keynote",
  budget: 500,
  ratePerThousandViews: 3,
  campaignType: "marketing",
  targetNiche: ["tech"] as string[],
  targetLanguage: ["en"] as string[],
  deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  status: "open",
  submissionsCount: 0,
};

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"campaigns">> {
  return await t.run(async (ctx) => ctx.db.insert("campaigns", baseCampaign));
}

describe("campaigns.topUpBudget — internal-secret gated", () => {
  it("rejects an unauthorized top-up and leaves the budget unchanged", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await expect(
      t.mutation(api.campaigns.topUpBudget, {
        id,
        amount: 1_000_000,
        txSignature: "ATTACKER_FAKE_SIG",
        callerWallet: ATTACKER,
        // no authSecret → must be rejected
      } as never),
    ).rejects.toThrow();
    const budget = await t.run(async (ctx) => (await ctx.db.get(id))!.budget);
    expect(budget).toBe(500);
  });

  it("applies the top-up when called with the correct internal secret", async () => {
    process.env.INTERNAL_CRON_SECRET = SECRET;
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const res = await t.mutation(api.campaigns.topUpBudget, {
      id,
      amount: 250,
      txSignature: "REAL_VERIFIED_SIG",
      callerWallet: CREATOR,
      authSecret: SECRET,
    } as never);
    expect((res as { newBudget: number }).newBudget).toBe(750);
    const budget = await t.run(async (ctx) => (await ctx.db.get(id))!.budget);
    expect(budget).toBe(750);
  });
});

describe("campaigns.updateCampaignPda — internal-secret gated (no wallet spoof)", () => {
  it("rejects a spoofed-callerWallet PDA write and leaves the campaign unchanged", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t);
    // Attacker supplies the (public) real creator wallet — the old check passed this.
    await expect(
      t.mutation(api.campaigns.updateCampaignPda, {
        id,
        pdaAddress: "AttackerPDA1111111111111111111111111111111",
        callerWallet: CREATOR,
        onchainVersion: 2,
        // no authSecret → must be rejected
      } as never),
    ).rejects.toThrow();
    const c = await t.run(async (ctx) => (await ctx.db.get(id))!);
    expect((c as { pdaAddress?: string }).pdaAddress).toBeUndefined();
    expect((c as { onchainVersion?: number }).onchainVersion).toBeUndefined();
  });

  it("persists the finalized on-chain terms when called with the internal secret", async () => {
    process.env.INTERNAL_CRON_SECRET = SECRET;
    const t = convexTest(schema, modules);
    const id = await seed(t);
    const newDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    await t.mutation(api.campaigns.updateCampaignPda, {
      id,
      pdaAddress: "RealPDA1111111111111111111111111111111111",
      onchainVersion: 2,
      budget: 800,
      ratePerThousandViews: 5,
      deadline: newDeadline,
      authSecret: SECRET,
    } as never);
    const c = await t.run(async (ctx) => (await ctx.db.get(id))!);
    expect((c as { pdaAddress?: string }).pdaAddress).toBe("RealPDA1111111111111111111111111111111111");
    expect((c as { onchainVersion?: number }).onchainVersion).toBe(2);
    expect((c as { budget?: number }).budget).toBe(800);
    expect((c as { ratePerThousandViews?: number }).ratePerThousandViews).toBe(5);
  });
});

// H06/BUG-029: set-pda forwarded client budget/ratePerThousandViews with only a
// `typeof === "number"` check, so Infinity (JSON.parse("1e400")) or a negative
// value slipped through and corrupted the campaign's payout math (Infinity - Infinity
// = NaN). updateCampaignPda is the real last line of defense for the DB write, so it
// must reject non-finite / negative economic terms even with the correct secret.
describe("campaigns.updateCampaignPda — rejects non-finite / negative economic terms", () => {
  it("rejects a negative budget and leaves the campaign row unchanged", async () => {
    process.env.INTERNAL_CRON_SECRET = SECRET;
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await expect(
      t.mutation(api.campaigns.updateCampaignPda, {
        id,
        pdaAddress: "AttackerPDA1111111111111111111111111111111",
        onchainVersion: 2,
        budget: -100,
        authSecret: SECRET,
      } as never),
    ).rejects.toThrow();
    const c = await t.run(async (ctx) => (await ctx.db.get(id))!);
    // The whole patch is rejected — neither the bad budget nor the PDA is written.
    expect((c as { budget?: number }).budget).toBe(500);
    expect((c as { pdaAddress?: string }).pdaAddress).toBeUndefined();
  });

  it("rejects a non-finite ratePerThousandViews (Infinity) and leaves the row unchanged", async () => {
    process.env.INTERNAL_CRON_SECRET = SECRET;
    const t = convexTest(schema, modules);
    const id = await seed(t);
    await expect(
      t.mutation(api.campaigns.updateCampaignPda, {
        id,
        pdaAddress: "AttackerPDA1111111111111111111111111111111",
        onchainVersion: 2,
        ratePerThousandViews: Infinity,
        authSecret: SECRET,
      } as never),
    ).rejects.toThrow();
    const c = await t.run(async (ctx) => (await ctx.db.get(id))!);
    expect((c as { ratePerThousandViews?: number }).ratePerThousandViews).toBe(3);
    expect((c as { pdaAddress?: string }).pdaAddress).toBeUndefined();
  });
});

// H09/BUG-032: campaigns.create is a PUBLIC mutation (campaigns are creatable
// pre-login) with no length cap on contentLinks, so one raw-Convex-client call
// could fan out UNBOUNDED paid transcription (pretranscribe POSTs every URL to the
// STT vendor). And it scheduled that paid side-effect even for a caller with no
// session at all. Fix: (a) cap combined contentLinks+contentFileUrls; (b) only
// schedule the paid side-effect when the caller presents a live-session token.
const MAX_CAMPAIGN_SOURCES = 100;

function createArgs(overrides: Record<string, unknown> = {}) {
  return {
    creatorWallet: CREATOR,
    brandName: "Acme",
    title: "Clip campaign",
    brief: "Clip the keynote",
    budget: 500,
    ratePerThousandViews: 3,
    campaignType: "marketing",
    targetNiche: ["tech"] as string[],
    targetLanguage: ["en"] as string[],
    requirements: ["Tag @acme"],
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/** Names of every function scheduled so far (via ctx.scheduler.runAfter). */
async function scheduledNames(t: ReturnType<typeof convexTest>): Promise<string[]> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.system.query("_scheduled_functions").collect();
    return rows.map((r) => r.name);
  });
}

describe("campaigns.create — caps sources + gates the paid side-effect (H09/BUG-032)", () => {
  it("caps combined contentLinks so one call can't fan out unbounded pretranscribe work", async () => {
    const t = convexTest(schema, modules);
    const manyLinks = Array.from({ length: 150 }, (_, i) => `https://example.com/v${i}.mp4`);
    const id = await t.mutation(
      api.campaigns.create,
      createArgs({ contentLinks: manyLinks, sessionToken: "live-session" }) as never,
    );
    const c = await t.run(async (ctx) => (await ctx.db.get(id as Id<"campaigns">))!);
    const stored = (c as { contentLinks?: string[]; contentFileUrls?: string[] });
    const combined = (stored.contentLinks?.length ?? 0) + (stored.contentFileUrls?.length ?? 0);
    expect(combined).toBeLessThanOrEqual(MAX_CAMPAIGN_SOURCES);
  });

  it("does NOT schedule the paid pretranscribe side-effect for a caller with no session token", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      api.campaigns.create,
      createArgs({ contentLinks: ["https://example.com/a.mp4", "https://example.com/b.mp4"] }) as never,
    );
    const names = await scheduledNames(t);
    expect(names.some((n) => n.includes("pretranscribe"))).toBe(false);
    expect(names.some((n) => n.includes("autoLinkContentReward"))).toBe(false);
  });

  it("DOES schedule pretranscribe when a live-session token is present (legit flow)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      api.campaigns.create,
      createArgs({
        contentLinks: ["https://example.com/a.mp4"],
        sessionToken: "live-session",
      }) as never,
    );
    const names = await scheduledNames(t);
    expect(names.some((n) => n.includes("pretranscribe"))).toBe(true);
  });

  it("still inserts the campaign row even with no session token (row insert stays open)", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(
      api.campaigns.create,
      createArgs({ contentLinks: ["https://example.com/a.mp4"] }) as never,
    );
    const c = await t.run(async (ctx) => await ctx.db.get(id as Id<"campaigns">));
    expect(c).not.toBeNull();
    expect((c as { status?: string }).status).toBe("open");
  });
});
