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
describe("10k video milestones", () => {
  it("triggers strictly above 10k, once despite repeated/higher/lower measurements", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 10000 });
    expect((await t.query(api.contentControl.state, { authSecret: secret })).posts).toHaveLength(0);
    for (const viewCount of [10001, 10001, 25000, 9000]) await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount });
    const { posts } = await t.query(api.contentControl.state, { authSecret: secret });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ source: "milestone", platforms: ["x"], milestoneViews: 10001, agentMint: "mint", videoUrl: "https://example.com/clip.mp4", status: "queued" });
    expect(posts[0].caption).toContain("10,001"); expect(posts[0].caption).not.toMatch(/[—–]/);
  });
  it("deduplicates clip and submission observations of the same public post", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 15000 });
    await t.run(ctx => enqueueVideoMilestone(ctx, { mintAddress: "mint", views: 19000, key: "submission:another", postUrl: "https://tiktok.com/@mila/video/123" }));
    expect((await t.query(api.contentControl.state, { authSecret: secret })).posts).toHaveLength(1);
  });
  it("does not announce unposted video measurements", async () => {
    const { t, id } = await fixture();
    await t.run(ctx => ctx.db.patch(id, { status: "ready", postUrl: undefined, postedAt: undefined }));
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 20000 });
    expect((await t.query(api.contentControl.state, { authSecret: secret })).posts).toHaveLength(0);
  });
  it("is always on: milestones queue with no setup and a legacy pause write cannot cancel them", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 15000 });
    const post = (await t.query(api.contentControl.state, { authSecret: secret })).posts[0];
    await t.mutation(api.contentControl.settings, { authSecret: secret, autoAnnounce: false, autoMilestones: false });
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: post._id })).not.toBeNull();
  });
  it("posts a second milestone for the same video once it passes 100k", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 15000 });
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 130000 });
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 160000 });
    const { posts } = await t.query(api.contentControl.state, { authSecret: secret });
    expect(posts.map(p => p.milestoneViews).sort()).toEqual([15000, 130000]);
    expect(posts.find(p => p.milestoneViews === 130000)?.caption).toContain("100k");
  });
  it("spends X's daily budget: one 10k milestone a day, the most-viewed first, the rest wait", async () => {
    const { t, id } = await fixture();
    await t.mutation(api.clipJobs.recordViewCount, { authSecret: secret, id, viewCount: 12000 });
    const low = (await t.query(api.contentControl.state, { authSecret: secret })).posts[0];
    const high = await t.run(ctx => ctx.db.insert("contentControlPosts", { dedupeKey: "other", source: "milestone", caption: "c", kind: "photo", platforms: ["x"], status: "queued", attempts: 0, milestoneViews: 19000, createdAt: Date.now(), updatedAt: Date.now() }));
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: low._id })).toBeNull(); // a higher-viewed milestone is waiting
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: high })).not.toBeNull();
    await t.mutation(api.contentControl.finish, { authSecret: secret, id: high, status: "posted" });
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id: low._id })).toBeNull(); // today's slot is used
    const held = (await t.query(api.contentControl.state, { authSecret: secret })).posts.find(p => p._id === low._id)!;
    expect(held).toMatchObject({ status: "queued" });
    expect((held as { notBefore?: number }).notBefore).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });
  it("rejects caller-supplied view updates without the server secret", async () => {
    const { t, id } = await fixture();
    await expect(t.mutation(api.clipJobs.recordViewCount, { authSecret: "wrong", id, viewCount: 999999 })).rejects.toThrow("unauthorized");
    expect((await t.query(api.contentControl.state, { authSecret: secret })).posts).toHaveLength(0);
  });
});
