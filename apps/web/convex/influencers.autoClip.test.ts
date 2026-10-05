/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// influencers.setAutoClip flips the per-agent "Autonomous clipping" Home toggle
// (schema field `autoClipEnabled`). Secret-gated exactly like setVideoConfig /
// setClipConfig — the Home UI can't hold INTERNAL_CRON_SECRET, so an owner-SIWS
// route injects it. This test pins: the flip persists, it round-trips both ways,
// and a wrong secret is rejected (arming an auto-SPEND loop must never be ungated).

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-cron-secret";
const MINT = "MintAutoClip1111111111111111111111111111";

async function seedAgent(t: TestConvex<typeof schema>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("influencers", {
      mintAddress: MINT, creatorWallet: "creator", name: "Clipper", handle: "@clipper",
      avatarUrl: "", niche: "tech", language: "en", archetype: "visionary", description: "",
      agentType: "clipping",
      personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 },
      tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0,
      updatedAt: Date.now(),
    });
  });
}

describe("influencers.setAutoClip", () => {
  beforeEach(() => { vi.stubEnv("INTERNAL_CRON_SECRET", SECRET); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("arms the flag, then disarms it (round-trips both ways)", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);

    await expect(t.mutation(api.influencers.setAutoClip, { mintAddress: MINT, enabled: true, authSecret: SECRET })).rejects.toThrow(/consent/i);
    const on = await t.mutation(api.influencers.setAutoClip, { mintAddress: MINT, enabled: true, authSecret: SECRET, consent: { autoJoin: true, allowThirdPartySources: false, allowProfileCtaCampaigns: false } });
    expect(on).toEqual({ ok: true, autoClipEnabled: true });
    let doc = await t.run(async (ctx) =>
      ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).first(),
    );
    expect(doc?.autoClipEnabled).toBe(true);
    expect(doc?.campaignWorkConsent?.autoJoin).toBe(true);

    const off = await t.mutation(api.influencers.setAutoClip, { mintAddress: MINT, enabled: false, authSecret: SECRET });
    expect(off).toEqual({ ok: true, autoClipEnabled: false });
    doc = await t.run(async (ctx) =>
      ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).first(),
    );
    expect(doc?.autoClipEnabled).toBe(false);
  });

  it("rejects a wrong secret (arming an auto-spend loop must be gated)", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t);
    await expect(
      t.mutation(api.influencers.setAutoClip, { mintAddress: MINT, enabled: true, authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("throws when the agent doesn't exist", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.influencers.setAutoClip, { mintAddress: "does-not-exist", enabled: true, authSecret: SECRET }),
    ).rejects.toThrow(/not found/i);
  });
});
