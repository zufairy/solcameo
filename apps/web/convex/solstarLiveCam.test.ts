/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const characterId = await ctx.db.insert("ssCharacters", { ownerWallet: "owner", name: "Lime", bio: "Public bio", referenceImageUrl: "/brand/solcameo-mark.png", category: "Other", status: "approved", rightsAttested: true, rightsReviewed: true, createdAt: 1 });
    const tokenId = await ctx.db.insert("ssTokens", { characterId, network: "paper", name: "Lime", ticker: "LIME", description: "", state: "paper", solReserve: 1n, tokenReserve: 1n, createdAt: 1 });
    return { characterId, tokenId };
  });
  return { t, ...ids };
}
describe("public Live Cam activity", () => {
  it("shows idle instead of inventing an active task and hides unapproved characters", async () => {
    const { t, characterId } = await setup();
    expect(await t.query(api.solstarLiveCam.state, { characterId })).toMatchObject({ activity: { kind: "idle" }, latestVideo: null, messages: [] });
    await t.run(ctx => ctx.db.patch(characterId, { status: "draft" }));
    expect(await t.query(api.solstarLiveCam.state, { characterId })).toBeNull();
  });
  it("tracks active reading rounds, and does not show an expired lease as reading", async () => {
    const { t, characterId } = await setup();
    const round = await t.run(ctx => ctx.db.insert("ssCommunityRounds", { characterId, window: 1, status: "running", leaseUntil: Date.now() + 60000, createdAt: 1 }));
    expect(await t.query(api.solstarLiveCam.state, { characterId })).toMatchObject({ activity: { kind: "reading" } });
    await t.run(ctx => ctx.db.patch(round, { leaseUntil: 1 }));
    expect(await t.query(api.solstarLiveCam.state, { characterId })).toMatchObject({ activity: { kind: "idle" } });
  });
  it("transitions from generation to a finished video without exposing task inputs", async () => {
    const { t, characterId } = await setup();
    const task = await t.run(ctx => ctx.db.insert("agentTasks", { mintAddress: characterId, sessionId: "private-session", type: "create_video", status: "running", title: "private-title", input: '{"secret":"private"}' }));
    const running = await t.query(api.solstarLiveCam.state, { characterId });
    expect(running?.activity.kind).toBe("generating");
    expect(JSON.stringify(running)).not.toContain("private");
    await t.run(ctx => ctx.db.patch(task, { status: "succeeded", completedAt: Date.now(), output: JSON.stringify({ videoUrl: "https://example.com/new.mp4", privateProviderKey: "secret" }) }));
    const done = await t.query(api.solstarLiveCam.state, { characterId });
    expect(done).toMatchObject({ activity: { kind: "video" }, latestVideo: { url: "https://example.com/new.mp4" } });
    expect(JSON.stringify(done)).not.toContain("secret");
  });
  it("uses actual content jobs, prioritizes rendering, and returns the newest completed clip", async () => {
    const { t, characterId, tokenId } = await setup();
    await t.run(async ctx => {
      const roundId = await ctx.db.insert("ssCommunityRounds", { characterId, window: 1, status: "running", leaseUntil: Date.now() + 60000, createdAt: 1 });
      await ctx.db.insert("ssContentJobs", { tokenId, roundId, key: "job", status: "running", costLamports: 1n, prompt: "private-prompt", createdAt: 10, updatedAt: 10 });
      await ctx.db.insert("ssEpisodes", { tokenId, index: 1, videoUrl: "https://example.com/old.mp4", posterUrl: "/poster.png", title: "Old video", source: "generated", createdAt: 1 });
      await ctx.db.insert("ssEpisodes", { tokenId, index: 2, videoUrl: "https://example.com/new.mp4", posterUrl: "/poster.png", title: "New video", source: "generated", createdAt: 2 });
    });
    expect(await t.query(api.solstarLiveCam.state, { characterId })).toMatchObject({ activity: { kind: "generating" }, latestVideo: { title: "New video" } });
  });
  it("rejects unsafe video outputs and ignores another agent's task", async () => {
    const { t, characterId } = await setup();
    await t.run(async ctx => {
      await ctx.db.insert("agentTasks", { mintAddress: "other-agent", sessionId: "other", type: "create_video", status: "running", title: "Other task" });
      await ctx.db.insert("agentTasks", { mintAddress: characterId, sessionId: "self", type: "create_video", status: "succeeded", title: "Unsafe", output: JSON.stringify({ videoUrl: "javascript:alert(1)" }) });
    });
    expect(await t.query(api.solstarLiveCam.state, { characterId })).toMatchObject({ activity: { kind: "idle" }, latestVideo: null });
  });
});
