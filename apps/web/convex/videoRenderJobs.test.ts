/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const MINT = "RenderKeyTestMint111111111111111111111111";
const SECRET = "test-internal-cron-secret-renderkey";
process.env.INTERNAL_CRON_SECRET = SECRET;

/** Seed an agentTask row (create requires a real taskId: v.id("agentTasks")). */
async function seedTask(t: TestConvex<typeof schema>): Promise<Id<"agentTasks">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("agentTasks", {
      mintAddress: MINT,
      sessionId: MINT,
      type: "create_video",
      status: "running",
      title: "Commissioned · test",
    }),
  );
}

async function createJob(
  t: TestConvex<typeof schema>,
  taskId: Id<"agentTasks">,
  renderKey: string | undefined,
) {
  return await t.mutation(api.videoRenderJobs.create, {
    taskId,
    mintAddress: MINT,
    sessionId: MINT,
    driveToken: "drive-token",
    kieModel: "veo3_fast",
    renderArgs: "{}",
    ...(renderKey ? { renderKey } : {}),
    authSecret: SECRET,
  });
}

describe("videoRenderJobs.getByRenderKey (hire dedup)", () => {
  it("rejects a bad secret", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.videoRenderJobs.getByRenderKey, { renderKey: "k", authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("returns null when no render job carries the key", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.videoRenderJobs.getByRenderKey, { renderKey: "sig-none", authSecret: SECRET });
    expect(r).toBeNull();
  });

  it("finds the job for a payment signature so a retry dedups to the same render", async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    await createJob(t, taskId, "sig-abc");

    const r = await t.query(api.videoRenderJobs.getByRenderKey, { renderKey: "sig-abc", authSecret: SECRET });
    expect(r).not.toBeNull();
    expect(r!.taskId).toBe(taskId);
    expect(r!.phase).toBe("storyboard");
  });

  it("does not match a different key", async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    await createJob(t, taskId, "sig-abc");
    const r = await t.query(api.videoRenderJobs.getByRenderKey, { renderKey: "sig-xyz", authSecret: SECRET });
    expect(r).toBeNull();
  });

  it("marks a wedged (never-advanced) render stale so it stops blocking retries", async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    const jobId = await createJob(t, taskId, "sig-wedged");
    // Simulate a render that never advanced: push updatedAt > 30m into the past.
    await t.run(async (ctx) => ctx.db.patch(jobId, { updatedAt: Date.now() - 31 * 60 * 1000 }));

    const r = await t.query(api.videoRenderJobs.getByRenderKey, { renderKey: "sig-wedged", authSecret: SECRET });
    expect(r!.phase).toBe("storyboard"); // still non-failed…
    expect(r!.stale).toBe(true); // …but stale, so run-task will NOT dedup → retry allowed
  });

  it("a fresh live render is not stale (so a retry dedups to it)", async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    await createJob(t, taskId, "sig-fresh");
    const r = await t.query(api.videoRenderJobs.getByRenderKey, { renderKey: "sig-fresh", authSecret: SECRET });
    expect(r!.stale).toBe(false);
  });

  it("returns the LATEST job for a key (so a failed render can be retried)", async () => {
    const t = convexTest(schema, modules);
    const firstTask = await seedTask(t);
    const firstJob = await createJob(t, firstTask, "sig-retry");
    // Mark the first render failed.
    await t.run(async (ctx) => ctx.db.patch(firstJob, { phase: "failed" }));
    // A manual retry created a second, newer job for the SAME payment.
    const secondTask = await seedTask(t);
    await createJob(t, secondTask, "sig-retry");

    const r = await t.query(api.videoRenderJobs.getByRenderKey, { renderKey: "sig-retry", authSecret: SECRET });
    // Latest wins → the fresh (non-failed) render, so run-task dedups to it.
    expect(r!.taskId).toBe(secondTask);
    expect(r!.phase).toBe("storyboard");
  });
});
