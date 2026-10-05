/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint941XE5";

beforeEach(() => { process.env.INTERNAL_CRON_SECRET = "s"; });
afterEach(() => vi.unstubAllGlobals());

describe("drip publish-once + pacing", () => {
  it("never re-posts a row an earlier (timed-out) attempt already published, and posts max 1 per agent per tick", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes("/api/agents/run-task")) posts.push(JSON.parse(init?.body ?? "{}").input?.mediaUrl);
      return new Response(JSON.stringify({ ok: true, output: { status: "posted", postUrl: "https://tiktok/x" } }));
    }));
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { rowA, rowB } = await t.run(async (ctx) => {
      const rowA = await ctx.db.insert("scheduledContent", { mintAddress: MINT, scheduledFor: now - 60_000, status: "scheduled", topic: "A", platforms: ["tiktok"], videoUrl: "https://cdn/a.mp4", createdAt: now - 3_600_000, retryCount: 1 });
      const rowB = await ctx.db.insert("scheduledContent", { mintAddress: MINT, scheduledFor: now - 30_000, status: "scheduled", topic: "B", platforms: ["tiktok"], videoUrl: "https://cdn/b.mp4", createdAt: now - 3_600_000 });
      // The earlier attempt for row A: its caller timed out, but it DID publish.
      await ctx.db.insert("agentTasks", {
        mintAddress: MINT, sessionId: MINT, type: "post_content", status: "succeeded", title: "post",
        input: JSON.stringify({ mediaUrl: "https://cdn/a.mp4", idempotencyKey: `sched:${rowA}` }),
        output: JSON.stringify({ status: "posted", postUrl: "https://tiktok/a" }), triggeredBy: "drip_scheduler",
      });
      return { rowA, rowB };
    });

    await t.action(internal.scheduledContent.drainDueClips, {});

    const [a, b] = await t.run(async (ctx) => [await ctx.db.get(rowA), await ctx.db.get(rowB)]);
    expect(a?.status).toBe("posted");         // recognised as already published
    expect(posts).not.toContain("https://cdn/a.mp4"); // ...and NOT sent again
    // Pacing: row A used this agent's slot for the tick, so B waits for the next tick.
    expect(b?.status).toBe("scheduled");
    expect(posts).toHaveLength(0);

    await t.action(internal.scheduledContent.drainDueClips, {});
    const b2 = await t.run(async (ctx) => ctx.db.get(rowB));
    expect(posts).toEqual(["https://cdn/b.mp4"]);
    expect(b2?.status).toBe("posted");
  });
});
