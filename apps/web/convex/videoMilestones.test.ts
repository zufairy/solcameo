/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { enqueueVideoMilestone } from "./contentControl";
const modules = import.meta.glob("./**/*.ts");
const secret = "milestone-test";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = secret; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
async function fixture() {
  const t = convexTest(schema, modules);
  await t.mutation(api.nftAgents.saveInfluencer, { authSecret: secret, sessionId: "s", mintAddress: "mint", creatorWallet: "wallet", name: "mila", handle: "@mila", avatarUrl: "https://example.com/a.png", description: "clips videos", niche: "podcasts", language: "en", archetype: "friend" });
  const id = await t.run(async ctx => {
    const jobId = await ctx.db.insert("clipJobs", { mintAddress: "mint", sourceUrl: "https://example.com/v.mp4", sourceType: "url", status: "completed", createdAt: Date.now(), updatedAt: Date.now() });
    return ctx.db.insert("clips", { jobId, mintAddress: "mint", title: "video", reason: "test", startSeconds: 0, endSeconds: 10, viralScore: 90, captionText: "caption", status: "posted", clipUrl: "https://example.com/clip.mp4", postUrl: "https://www.tiktok.com/@mila/video/123?source=app", platform: "tiktok", createdAt: Date.now(), updatedAt: Date.now() });
  });
  return { t, id };
}
const milestones = async (t: ReturnType<typeof convexTest>) => (await t.query(api.contentControl.state, { authSecret: secret })).posts.filter(p => p.source === "milestone");
describe("100k video milestones", () => {
  it("ignores everything up to 100k, then triggers strictly above it, once despite repeated/higher/lower measurements", async () => {
    const { t, id } = await fixture();
    for (const viewCount of [10001, 25000, 100000]) await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount });
    expect(await milestones(t)).toHaveLength(0);
    for (const viewCount of [100001, 100001, 250000, 9000]) await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount });
    const posts = await milestones(t);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ source: "milestone", platforms: ["x"], milestoneViews: 100001, agentMint: "mint", videoUrl: "https://example.com/clip.mp4", status: "queued" });
    expect(posts[0].caption).toContain("100,001"); expect(posts[0].caption).not.toMatch(/[—–]/);
  });
  it("deduplicates clip and submission observations of the same public post", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 150000 });
    await t.run(ctx => enqueueVideoMilestone(ctx, { mintAddress: "mint", views: 190000, key: "submission:another", postUrl: "https://tiktok.com/@mila/video/123" }));
    expect(await milestones(t)).toHaveLength(1);
  });
  it("does not announce unposted video measurements", async () => {
    const { t, id } = await fixture();
    await t.run(ctx => ctx.db.patch(id, { status: "ready", postUrl: undefined, postedAt: undefined }));
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 200000 });
    expect(await milestones(t)).toHaveLength(0);
  });
  it("is always on: milestones queue with no setup and a legacy pause write cannot cancel them", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 150000 });
    const post = (await milestones(t))[0];
    await t.mutation(api.contentControl.settings, { authSecret: secret, autoAnnounce: false, autoMilestones: false });
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: post._id })).not.toBeNull();
  });
  it("spends X's budget: the most-viewed milestone first, the rest wait their turn", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 120000 });
    const low = (await milestones(t))[0];
    const high = await t.run(ctx => ctx.db.insert("contentControlPosts", { dedupeKey: "other", source: "milestone", caption: "c", kind: "photo", platforms: ["x"], status: "queued", attempts: 0, milestoneViews: 190000, createdAt: Date.now(), updatedAt: Date.now() }));
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: low._id })).toBeNull(); // a higher-viewed milestone is waiting
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: high })).not.toBeNull();
    await t.mutation(api.contentControl.finish, { authSecret: secret, id: high, status: "posted" });
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: low._id })).toBeNull(); // spaced six hours apart
    const held = (await milestones(t)).find(p => p._id === low._id)!;
    expect(held).toMatchObject({ status: "queued" });
    expect((held as { notBefore?: number }).notBefore).toBeGreaterThan(Date.now() + 5 * 3_600_000);
  });
  it("rejects caller-supplied view updates without the server secret", async () => {
    const { t, id } = await fixture();
    await expect(t.mutation(api.clipJobs.recordViewCount, { authSecret: "wrong", id, viewCount: 999999 })).rejects.toThrow("unauthorized");
    expect(await milestones(t)).toHaveLength(0);
  });
});
