/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "influencer-auto-post-test-secret";
process.env.INTERNAL_CRON_SECRET = SECRET;

describe("influencer auto-post handoff", () => {
  it("links a rendered video to its durable posting row and deduplicates reruns", async () => {
    const t = convexTest(schema, modules);
    const taskId = await t.mutation(api.agentTasks.create, {
      mintAddress: "influencer-test-mint", sessionId: "test-session", type: "create_video",
      title: "Video", authSecret: SECRET,
    });
    const args = {
      mintAddress: "influencer-test-mint", taskId,
      scheduledFor: Date.now(), topic: "A story", caption: "The actual caption",
      platforms: [], videoUrl: "https://example.com/render.mp4", authSecret: SECRET,
    };
    const id = await t.mutation(api.scheduledContent.schedule, args);
    expect(await t.mutation(api.scheduledContent.schedule, args)).toBe(id);
    const rows = await t.query(api.scheduledContent.listByMint, { mintAddress: args.mintAddress });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId, status: "scheduled", caption: "The actual caption", videoUrl: args.videoUrl });
  });

  it("records post failure without turning a successful render into a failed render", async () => {
    const t = convexTest(schema, modules);
    const taskId = await t.mutation(api.agentTasks.create, {
      mintAddress: "influencer-test-mint", sessionId: "test-session", type: "create_video",
      title: "Video", authSecret: SECRET,
    });
    await t.mutation(api.agentTasks.succeed, {
      id: taskId, output: JSON.stringify({ videoUrl: "https://example.com/render.mp4" }), authSecret: SECRET,
    });
    await t.mutation(api.agentTasks.updatePostResult, {
      id: taskId, status: "failed", error: "No connected video account", authSecret: SECRET,
    });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe("succeeded");
    expect(JSON.parse(task?.output ?? "{}").post).toEqual({ status: "failed", error: "No connected video account" });
  });
});
