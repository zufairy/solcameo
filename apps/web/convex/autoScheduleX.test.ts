/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-internal-cron-secret-autox";
process.env.INTERNAL_CRON_SECRET = SECRET;

async function setup(connected: string[]) {
  const t = convexTest(schema, modules);
  const MINT = "AutoXMint1111111111111111111111111111111";
  await t.run(async (ctx) => {
    await ctx.db.insert("influencers", { mintAddress: MINT, creatorWallet: "W", name: "Nova", handle: "nova", avatarUrl: "https://x.test/a.png", niche: "fitness", language: "en", archetype: "creator", description: "d", personality: { warmth: 1, humor: 1, authority: 1, boldness: 1 }, tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 1, availableShares: 1, updatedAt: 1, connectedPlatforms: connected } as never);
  });
  const finish = async (n: number, input?: string) => {
    const taskId = await t.run((ctx) => ctx.db.insert("agentTasks", { mintAddress: MINT, sessionId: MINT, type: "create_video", status: "running", title: `t${n}`, ...(input ? { input } : {}) }));
    const id = await t.mutation(api.videoRenderJobs.create, { taskId, mintAddress: MINT, sessionId: MINT, driveToken: `d${n}`, kieModel: "veo3_fast", renderArgs: "{}", authSecret: SECRET });
    await t.mutation(api.videoRenderJobs.patch, { id, phase: "done", videoUrl: `https://v.test/${n}.mp4`, videoNote: `video ${n}`, authSecret: SECRET });
  };
  const rows = () => t.run((ctx) => ctx.db.query("scheduledContent").collect());
  return { finish, rows, t, MINT };
}

describe("automatic 3-a-day X schedule", () => {
  it("queues a finished video for an agent with X connected", async () => {
    const { finish, rows } = await setup(["x"]);
    await finish(1);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ platforms: ["x"], status: "scheduled", auto: true, videoUrl: "https://v.test/1.mp4" });
  });
  it("queues an opted-in Explore completion once, using the same schedule", async () => {
    const { t, MINT, rows } = await setup(["x"]);
    const id = await t.run(ctx => ctx.db.insert("scheduledRecreations", { mintAddress: MINT, referenceId: "r", referenceTitle: "My video", videoUrl: "https://reference.test/v.mp4", imageUrls: [], prompt: "scene", mode: "motion-transfer", resolution: "720p", runAt: Date.now(), repeat: "once", remaining: 1, status: "submitted", autoPost: true, createdAt: Date.now(), updatedAt: Date.now() }));
    await t.mutation(api.scheduledRecreations.markCompleted, { id, resultUrl: "https://result.test/v.mp4", authSecret: SECRET });
    await t.mutation(api.scheduledRecreations.markCompleted, { id, resultUrl: "https://result.test/v.mp4", authSecret: SECRET });
    expect(await rows()).toHaveLength(1);
  });
  it("configures three posts a day on connecting X without replacing explicit settings", async () => {
    const { t, MINT } = await setup([]);
    await t.mutation(api.influencers.setConnectedPlatforms, { mintAddress: MINT, platforms: ["x"], authSecret: SECRET });
    const first = await t.query(api.influencers.getByMint, { mintAddress: MINT });
    expect(first?.clipConfig).toMatchObject({ maxPerDay: 3, postIntervalMs: 8 * 3600000 });
    await t.run(async ctx => {
      const agent = await ctx.db.query("influencers").withIndex("by_mint", q => q.eq("mintAddress", MINT)).first();
      await ctx.db.patch(agent!._id, { clipConfig: { ...agent!.clipConfig, maxPerDay: 2 } });
    });
    await t.mutation(api.influencers.setConnectedPlatforms, { mintAddress: MINT, platforms: ["x"], authSecret: SECRET });
    expect((await t.query(api.influencers.getByMint, { mintAddress: MINT }))?.clipConfig?.maxPerDay).toBe(2);
  });
  it("keeps samples and videos awaiting approval out of the public queue", async () => {
    const { finish, rows } = await setup(["x"]);
    await finish(1, JSON.stringify({ sample: true }));
    await finish(2, JSON.stringify({ holdForApproval: true }));
    expect(await rows()).toHaveLength(0);
  });
  it("does nothing when X is not connected", async () => {
    const { finish, rows } = await setup(["tiktok"]);
    await finish(1);
    expect(await rows()).toHaveLength(0);
  });
  it("spaces videos 8 hours apart, newest first", async () => {
    const { finish, rows } = await setup(["x"]);
    await finish(1); await finish(2); await finish(3);
    const r = (await rows()).sort((a, b) => a.scheduledFor - b.scheduledFor);
    expect(r.map((x) => x.videoUrl)).toEqual(["https://v.test/3.mp4", "https://v.test/2.mp4", "https://v.test/1.mp4"]);
    expect(r[1].scheduledFor - r[0].scheduledFor).toBe(8 * 3_600_000);
    expect(r[2].scheduledFor - r[1].scheduledFor).toBe(8 * 3_600_000);
  });
});

describe("catch-up for videos nobody posted", () => {
  it("queues finished videos of an X-connected agent that were never scheduled, and skips ones already posted by hand", async () => {
    const t = convexTest(schema, modules);
    const MINT = "BacklogMint111111111111111111111111111111";
    await t.run(async (ctx) => {
      await ctx.db.insert("influencers", { mintAddress: MINT, creatorWallet: "W", name: "Nova", handle: "nova", avatarUrl: "https://x.test/a.png", niche: "fitness", language: "en", archetype: "creator", description: "d", personality: { warmth: 1, humor: 1, authority: 1, boldness: 1 }, tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 1, availableShares: 1, updatedAt: 1, connectedPlatforms: ["x"] } as never);
      const mk = async (n: number, output?: string, autoPost = false) => {
        const taskId = await ctx.db.insert("agentTasks", { mintAddress: MINT, sessionId: MINT, type: "create_video", status: "succeeded", title: `t${n}`, ...(output ? { output } : {}) } as never);
        await ctx.db.insert("videoRenderJobs", { taskId, mintAddress: MINT, sessionId: MINT, driveToken: `d${n}`, kieModel: "veo3_fast", phase: "done", ...(autoPost ? { autoPost: { platforms: ["x"] } } : {}), statusMessage: "Done.", renderArgs: "{}", videoUrl: `https://v.test/${n}.mp4`, videoNote: `note ${n}`, attempts: 0, updatedAt: Date.now() } as never);
      };
      await mk(1); await mk(2); await mk(3, JSON.stringify({ post: { status: "posted" } }));
      await mk(4, JSON.stringify({ post: { status: "failed" } }), true);
      await mk(5, JSON.stringify({ post: { status: "posting" } }), true);
    });
    const result = await t.mutation(internal.scheduledContent.autoScheduleBacklog, {});
    expect(result.queued).toBe(3);
    const rows = (await t.run((ctx) => ctx.db.query("scheduledContent").collect())).sort((a, b) => a.scheduledFor - b.scheduledFor);
    expect(rows.map((r) => r.videoUrl)).toEqual(["https://v.test/4.mp4", "https://v.test/2.mp4", "https://v.test/1.mp4"]); // newest first
    expect(rows[0].scheduledFor).toBeLessThan(Date.now() + 5 * 60_000); // the freshest goes out right away
    expect((await t.mutation(internal.scheduledContent.autoScheduleBacklog, {})).queued).toBe(0); // and it never doubles up
  });
});
