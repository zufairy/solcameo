/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, beforeEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "s";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = SECRET; });

async function seed(t: ReturnType<typeof convexTest>, mint: string, agentType: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("influencers", {
      mintAddress: mint, creatorWallet: "W", name: "A", handle: "@a", avatarUrl: "", niche: "tech", language: "en",
      archetype: "creator", description: "", agentType, personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 },
      tvl: 0, monthlyEarnings: 0, sharePrice: 1, totalShares: 0, availableShares: 0, updatedAt: Date.now(),
    });
  });
}

describe("heartbeat planner", () => {
  it("never plans an original video (or UGC campaign submit / text post) for an AI Clipper", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "ClipMint", "clipping");
    const res = await t.mutation(api.agentAutonomy.generateTasksForAgent, { mintAddress: "ClipMint", authSecret: SECRET });
    expect(res.count).toBe(0);
    const tasks = await t.run((ctx) => ctx.db.query("agentTasks").collect());
    expect(tasks).toHaveLength(0);
  });
  it("still plans the creator pack for an influencer", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "InfMint", "influencer");
    const res = await t.mutation(api.agentAutonomy.generateTasksForAgent, { mintAddress: "InfMint", authSecret: SECRET });
    const types = (await t.run((ctx) => ctx.db.query("agentTasks").collect())).map((x) => x.type);
    expect(res.count).toBeGreaterThan(0);
    expect(types).toContain("create_video");
  });
});
