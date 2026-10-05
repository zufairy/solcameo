/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "ReapClipMint111111111111111111111111111111";

// clipJobs.reapStaleJobs' INLINE clip-posting reaper (M2): finalizeJob's inline
// auto-post claims a clip "ready" → "posting" and, on a run-task TIMEOUT, leaves it
// there (the post may have published, so releasing it risks a double-post). Nothing
// else un-strands an inline clip, so it shows "posting" forever. The reaper reverts a
// clip stuck on "posting" past the TTL back to "ready" via a status-aware CAS.

const OLD = 21 * 60_000; // > CLIP_POSTING_TTL_MS (20m)

async function makeJob(t: TestConvex<typeof schema>): Promise<Id<"clipJobs">> {
  return (await t.run(async (ctx) =>
    ctx.db.insert("clipJobs", {
      mintAddress: MINT, sourceUrl: "https://x/y", sourceType: "url",
      status: "completed", createdAt: 0, updatedAt: 0,
    }),
  )) as Id<"clipJobs">;
}

async function makeClip(
  t: TestConvex<typeof schema>,
  jobId: Id<"clipJobs">,
  status: string,
  updatedAt: number,
): Promise<Id<"clips">> {
  return (await t.run(async (ctx) =>
    ctx.db.insert("clips", {
      jobId, mintAddress: MINT, title: "Clip", reason: "", startSeconds: 0, endSeconds: 10,
      viralScore: 1, clipUrl: `https://cdn/${Math.random()}.mp4`, captionText: "", status,
      createdAt: 0, updatedAt,
    }),
  )) as Id<"clips">;
}

async function clipStatus(t: TestConvex<typeof schema>, id: Id<"clips">) {
  return (await t.run(async (ctx) => ctx.db.get(id)))!.status;
}

describe("clipJobs.reapStaleJobs — inline clip-posting reaper (M2)", () => {
  it("reverts a clip stuck on 'posting' past the TTL back to 'ready'", async () => {
    const t = convexTest(schema, modules);
    const jobId = await makeJob(t);
    const stale = await makeClip(t, jobId, "posting", Date.now() - OLD);
    const res = await t.mutation(internal.clipJobs.reapStaleJobs, {});
    expect(res.clipsReaped).toBeGreaterThanOrEqual(1);
    expect(await clipStatus(t, stale)).toBe("ready");
  });

  it("does NOT touch a clip that only just started posting (inside the TTL)", async () => {
    const t = convexTest(schema, modules);
    const jobId = await makeJob(t);
    const fresh = await makeClip(t, jobId, "posting", Date.now() - 60_000); // 1m ago
    await t.mutation(internal.clipJobs.reapStaleJobs, {});
    expect(await clipStatus(t, fresh)).toBe("posting"); // still in-flight
  });

  it("never fights a concurrent successful post — a 'posted' clip is left untouched (CAS)", async () => {
    const t = convexTest(schema, modules);
    const jobId = await makeJob(t);
    const posted = await makeClip(t, jobId, "posted", Date.now() - OLD);
    const failed = await makeClip(t, jobId, "failed", Date.now() - OLD);
    const ready = await makeClip(t, jobId, "ready", Date.now() - OLD);
    await t.mutation(internal.clipJobs.reapStaleJobs, {});
    expect(await clipStatus(t, posted)).toBe("posted");
    expect(await clipStatus(t, failed)).toBe("failed");
    expect(await clipStatus(t, ready)).toBe("ready");
  });
});
