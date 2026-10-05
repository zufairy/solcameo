/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-cron-secret-autonomy";
const MINT = "MintAutonomy1111111111111111111111111111";
const CREATOR = "CreatorAutonomy11111111111111111111111111";
const SESSION = "session-autonomy";

function seedInfluencer(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    await ctx.db.insert("influencers", {
      mintAddress: MINT,
      creatorWallet: CREATOR,
      name: "Nova",
      handle: "@nova",
      avatarUrl: "",
      niche: "tech",
      language: "en",
      archetype: "creator",
      description: "AI influencer",
      agentType: "influencer",
      personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 },
      tvl: 0,
      monthlyEarnings: 0,
      sharePrice: 1,
      totalShares: 0,
      availableShares: 0,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("nftDrafts", {
      sessionId: SESSION,
      creatorWallet: CREATOR,
      name: "Nova",
      handle: "@nova",
      niche: "tech",
      characterBible: "Curious, practical, energetic.",
      avatarUrls: [],
      questionnaire: {
        contentPillars: ["topic x", "topic y", "topic z"],
      },
      mintStatus: "minted",
      mintAddress: MINT,
    });
  });
}

function extractTopic(title: string): string {
  return title.replace(/^Create video:\s*/i, "").trim();
}

describe("agentAutonomy.generateTasksForAgent", () => {
  beforeEach(() => { vi.stubEnv("INTERNAL_CRON_SECRET", SECRET); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("rotates self-video topics so heartbeat videos stay fresh and persona-fit", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t);
    await t.mutation(api.agentTasks.recordMemory, {
      mintAddress: MINT,
      sessionId: SESSION,
      kind: "lesson",
      summary: 'Drafting video about "topic x".',
      importance: 60,
      authSecret: SECRET,
    });

    const first = await t.mutation(api.agentAutonomy.generateTasksForAgent, {
      mintAddress: MINT,
      force: true,
      authSecret: SECRET,
    });
    expect(first.count).toBeGreaterThan(0);

    let tasks = await t.query(api.agentTasks.listByMint, { mintAddress: MINT, limit: 20 });
    const firstCreate = tasks.find((task) => task.type === "create_video");
    const firstPost = tasks.find((task) => task.type === "post_content");
    expect(firstCreate).toBeTruthy();
    expect(firstPost).toBeTruthy();

    const firstTopic = extractTopic(firstCreate!.title);
    const postTopic = extractTopic(firstPost!.title);
    expect(firstTopic).not.toBe("topic x");
    expect(firstTopic).toContain("topic");
    expect(postTopic).not.toBe(firstTopic);

    await t.run(async (ctx) => {
      await ctx.db.patch(firstCreate!._id, { status: "succeeded", completedAt: Date.now() });
    });
    await t.mutation(api.agentTasks.recordMemory, {
      mintAddress: MINT,
      sessionId: SESSION,
      kind: "lesson",
      summary: `Drafting video about "${firstTopic}".`,
      importance: 60,
      authSecret: SECRET,
    });

    const second = await t.mutation(api.agentAutonomy.generateTasksForAgent, {
      mintAddress: MINT,
      force: true,
      authSecret: SECRET,
    });
    expect(second.count).toBeGreaterThan(0);

    tasks = await t.query(api.agentTasks.listByMint, { mintAddress: MINT, limit: 20 });
    const secondCreate = tasks.find((task) => task.type === "create_video" && task._creationTime !== firstCreate!._creationTime);
    expect(secondCreate).toBeTruthy();
    const secondTopic = extractTopic(secondCreate!.title);
    expect(secondTopic).not.toBe(firstTopic);
  });
});
