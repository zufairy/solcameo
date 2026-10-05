/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const secret = "marketing-test-secret";
const agent = { authSecret: secret, sessionId: "s1", mintAddress: "agent1", creatorWallet: "wallet", name: "mila", handle: "@mila", description: "turns podcasts into clips", niche: "content", avatarUrl: "https://example.com/avatar.svg", language: "en", archetype: "friend" };
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = secret; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
describe("Content Control", () => {
  it("rejects unauthenticated reads and configuration writes", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.contentControl.state, { authSecret: "wrong" })).rejects.toThrow("Unauthorized");
    await expect(t.mutation(api.contentControl.settings, { authSecret: "wrong", autoAnnounce: true })).rejects.toThrow("Unauthorized");
  });
  it("announces a new mint once, including its public image and purpose", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.contentControl.settings, { authSecret: secret, autoAnnounce: true });
    await t.mutation(api.nftAgents.saveInfluencer, agent);
    await t.mutation(api.nftAgents.saveInfluencer, { ...agent, name: "renamed" });
    const { posts } = await t.query(api.contentControl.state, { authSecret: secret });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ agentMint: "agent1", mediaUrl: agent.avatarUrl, status: "queued", platforms: ["x"], source: "mint" });
    expect(posts[0].caption).toContain("podcasts");
  });
  it("announces automatically with no setup, and only once per agent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.nftAgents.saveInfluencer, agent);
    await t.mutation(api.nftAgents.saveInfluencer, { ...agent, name: "updated" });
    const { posts } = await t.query(api.contentControl.state, { authSecret: secret });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ source: "mint", status: "queued", platforms: ["x"] });
  });
  it("captures the selected marketing destination at mint time", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.nftAgents.saveInfluencer, agent);
    await t.mutation(api.contentControl.settings, { authSecret: secret, targetMint: "agent1", autoAnnounce: true });
    await t.mutation(api.nftAgents.saveInfluencer, { ...agent, sessionId: "s2", mintAddress: "agent2", creatorWallet: "wallet2", handle: "@other" });
    const { posts } = await t.query(api.contentControl.state, { authSecret: secret });
    expect(posts[0].targetMint).toBe("agent1");
  });
  it("allows one publisher, then skips a second claim and completed posts", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.contentControl.queue, { authSecret: secret, dedupeKey: "key", caption: "hello", kind: "text", platforms: ["x"] });
    const duplicate = await t.mutation(api.contentControl.queue, { authSecret: secret, dedupeKey: "key", caption: "hello", kind: "text", platforms: ["x"] });
    expect(id).toBe(duplicate);
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id })).not.toBeNull();
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id })).toBeNull();
    await t.mutation(api.contentControl.finish, { authSecret: secret, id, status: "posted" });
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id })).toBeNull();
    await expect(t.mutation(api.contentControl.retry, { authSecret: secret, id })).rejects.toThrow("cannot be retried");
  });
  it("cannot be paused: legacy pause writes are ignored and queued announcements still publish", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.nftAgents.saveInfluencer, agent);
    await t.mutation(api.contentControl.settings, { authSecret: secret, autoAnnounce: false, autoMilestones: false });
    expect((await t.query(api.contentControl.state, { authSecret: secret })).settings).toMatchObject({ autoAnnounce: true, autoMilestones: true });
    const id = (await t.query(api.contentControl.state, { authSecret: secret })).posts[0]._id;
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id })).not.toBeNull();
  });
  it("never queues the same manual post twice within 30 minutes", async () => {
    const t = convexTest(schema, modules);
    const post = { authSecret: secret, caption: "hello @mila", kind: "video", mediaUrl: "https://example.com/a.mp4", platforms: ["x"] };
    const first = await t.mutation(api.contentControl.queue, { ...post, dedupeKey: "manual:one" });
    const second = await t.mutation(api.contentControl.queue, { ...post, mediaUrl: "https://example.com/b.mp4", dedupeKey: "manual:two" });
    expect(second).toBe(first);
    expect((await t.query(api.contentControl.state, { authSecret: secret })).posts).toHaveLength(1);
    const other = await t.mutation(api.contentControl.queue, { ...post, caption: "something else", dedupeKey: "manual:three" });
    expect(other).not.toBe(first);
  });
  it("retains accepted upload IDs so retries use the provider's failed-only retry", async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(api.contentControl.queue, { authSecret: secret, dedupeKey: "key", caption: "hello", kind: "text", platforms: ["x"] });
    await t.mutation(api.contentControl.finish, { authSecret: secret, id, status: "failed", requestId: "provider-id" });
    await t.mutation(api.contentControl.retry, { authSecret: secret, id });
    expect(await t.mutation(api.contentControl.claim, { authSecret: secret, id })).toMatchObject({ requestId: "provider-id" });
  });
});
