/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { normalizeClipConfig } from "../lib/builder/clipConfig";
const modules = import.meta.glob("./**/*.ts");
const secret = "campaign-posting-test";
const mintAddress = "posting-agent";
const now = Date.parse("2026-10-01T00:00:00Z");
const config = normalizeClipConfig({ autoPost: true, timezone: "UTC", maxPerDay: 1, postIntervalMs: 3600000,
  campaignPosting: { maxPerDay: 2, postIntervalMs: 3600000, dailyStartHour: 9, dailyStartMinute: 0 } });
beforeEach(() => { vi.stubEnv("INTERNAL_CRON_SECRET", secret); vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function seed(t: ReturnType<typeof convexTest>) {
  await t.run((ctx) => ctx.db.insert("influencers", {
    mintAddress, creatorWallet: "creator", name: "Clipper", handle: "@clipper", avatarUrl: "", niche: "tech", language: "en", archetype: "visionary", description: "", agentType: "clipping",
    personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 }, tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0, updatedAt: now, clipConfig: config,
  }));
}
async function queue(t: ReturnType<typeof convexTest>, video: string, campaignId?: string) {
  return t.mutation(api.scheduledContent.schedule, { mintAddress, videoUrl: `https://cdn/${video}.mp4`, topic: video, scheduledFor: now + 3600000, campaignId, authSecret: secret });
}
describe("campaign posting", () => {
  it("keeps every clip when slots collide and deduplicates retries", async () => {
    const t = convexTest(schema, modules);
    const a = await queue(t, "a", "campaign");
    const b = await queue(t, "b", "campaign");
    expect(a).not.toBe(b);
    expect(await queue(t, "a", "campaign")).toBe(a);
    const rows = await t.query(api.scheduledContent.listByMint, { mintAddress });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.scheduledFor)).size).toBe(2);
  });
  it("allows own content alongside campaign content and caps campaigns independently", async () => {
    const t = convexTest(schema, modules); await seed(t);
    await queue(t, "own");
    await queue(t, "c1", "campaign-a");
    await queue(t, "c2", "campaign-b");
    await queue(t, "c3", "campaign-a");
    const rows = await t.query(api.scheduledContent.listByMint, { mintAddress });
    const today = rows.filter((r) => r.scheduledFor < now + 86400000);
    expect(today.filter((r) => r.campaignId)).toHaveLength(2);
    expect(today.filter((r) => !r.campaignId)).toHaveLength(1);
    expect(today.filter((r) => r.campaignId).map((r) => new Date(r.scheduledFor).getUTCHours()).sort((a, b) => a - b)).toEqual([9, 10]);
  });
  it("spaces multiple daily-start campaign clips when the daily cap is unlimited", async () => {
    const t = convexTest(schema, modules); await seed(t);
    await t.mutation(api.influencers.setClipConfig, { mintAddress, authSecret: secret, clipConfig: { ...config,
      campaignPosting: { ...config.campaignPosting, maxPerDay: 0 } } });
    await queue(t, "a", "campaign"); await queue(t, "b", "campaign");
    const rows = await t.query(api.scheduledContent.listByMint, { mintAddress });
    expect(rows.map((r) => r.scheduledFor).sort((a, b) => a - b)).toEqual([now + 9 * 3600000, now + 10 * 3600000]);
  });
  it("reschedules queued campaigns on save without moving own content", async () => {
    const t = convexTest(schema, modules); await seed(t);
    const own = await queue(t, "own"); await queue(t, "c1", "campaign"); await queue(t, "c2", "campaign");
    const before = await t.run((ctx) => ctx.db.get(own));
    await t.mutation(api.influencers.setClipConfig, { mintAddress, authSecret: secret, clipConfig: { ...config,
      campaignPosting: { ...config.campaignPosting, maxPerDay: 1, dailyStartHour: 14 } } });
    const rows = await t.query(api.scheduledContent.listByMint, { mintAddress });
    expect(rows.find((r) => r._id === own)?.scheduledFor).toBe(before?.scheduledFor);
    const campaigns = rows.filter((r) => r.campaignId).sort((a, b) => a.scheduledFor - b.scheduledFor);
    expect(campaigns.map((r) => new Date(r.scheduledFor).getUTCHours())).toEqual([14, 14]);
    expect(campaigns[1].scheduledFor - campaigns[0].scheduledFor).toBe(86400000);
  });
});
