/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";

// convex/autoClip.runAutoClipForMint is the auto-clip step. The money-selection core
// (chooseAutoClip) is unit-tested in lib/server/autoClipSelect.test.ts; here we pin
// the EARLY GATES that must short-circuit BEFORE any candidate scout / charge:
// a missing agent, the toggle OFF, a non-clip agent, and a missing app URL all return
// without spending. (The full happy path needs the Next scout route + KIE, exercised
// end-to-end on a running stack, not in this pure-DB harness.)

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-cron-secret";
const MINT = "MintAutoClipAction1111111111111111111111";

// String ref — autoClip is a NEW module not yet in the committed _generated api types.
const RUN_AUTO_CLIP = makeFunctionReference<"action">("autoClip:runAutoClipForMint");

async function seedAgent(
  t: TestConvex<typeof schema>,
  opts: { autoClipEnabled?: boolean; agentType?: string; installedSkills?: string[]; consent?: boolean; readyToPost?: boolean },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("influencers", {
      mintAddress: MINT, creatorWallet: "creator", name: "Clipper", handle: "@clipper",
      avatarUrl: "", niche: "tech", language: "en", archetype: "visionary", description: "",
      agentType: opts.agentType ?? "clipping",
      autoClipEnabled: opts.autoClipEnabled,
      ...(opts.consent ? { campaignWorkConsent: { autoJoin: true, allowThirdPartySources: false, allowProfileCtaCampaigns: false, consentedAt: Date.now() } } : {}),
      installedSkills: opts.installedSkills,
      ...(opts.readyToPost ? { clipConfig: { autoPost: true, platforms: ["tiktok"] }, connectedPlatforms: ["tiktok"] } : {}),
      personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 },
      tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0,
      updatedAt: Date.now(),
    });
  });
}

describe("autoClip.runAutoClipForMint — early gates", () => {
  beforeEach(() => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", ""); // no fetch reachable → deterministic gate
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns no_agent when the agent doesn't exist (no charge)", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(RUN_AUTO_CLIP, { mintAddress: MINT });
    expect(res).toEqual({ clipped: false, reason: "no_agent" });
  });

  it("returns off when the toggle is disabled", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, { autoClipEnabled: false });
    const res = await t.action(RUN_AUTO_CLIP, { mintAddress: MINT });
    expect(res).toEqual({ clipped: false, reason: "off" });
  });

  it("returns not_clip_agent when armed on a non-clip agent", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, { autoClipEnabled: true, agentType: "influencer", installedSkills: [], consent: true });
    const res = await t.action(RUN_AUTO_CLIP, { mintAddress: MINT });
    expect(res).toEqual({ clipped: false, reason: "not_clip_agent" });
  });

  it("stops at no_app_url for an armed clip agent with no reachable app (never scouts/charges)", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, { autoClipEnabled: true, agentType: "clipping", consent: true, readyToPost: true });
    const res = await t.action(RUN_AUTO_CLIP, { mintAddress: MINT });
    expect(res).toEqual({ clipped: false, reason: "no_app_url" });
  });

  it("does not scout or charge without owner consent", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, { autoClipEnabled: true, agentType: "clipping" });
    expect(await t.action(RUN_AUTO_CLIP, { mintAddress: MINT })).toEqual({ clipped: false, reason: "consent_required" });
  });

  it("does not charge when auto-posting is off", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, { autoClipEnabled: true, agentType: "clipping", consent: true });
    expect(await t.action(RUN_AUTO_CLIP, { mintAddress: MINT })).toEqual({ clipped: false, reason: "auto_post_off" });
  });
});
