/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// clipJobs.appendLog is the observability + reaper-HEARTBEAT primitive for the
// cloud clip pipeline (the fix for the "Running 0/6" silent stall): it appends a
// bounded run-log line, denormalizes the latest note/pct for the UI, and — the
// load-bearing part — ALWAYS bumps updatedAt so a long-running step keeps the row
// "fresh" instead of looking dead to reapStaleJobs.

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-cron-secret";

async function makeJob(t: TestConvex<typeof schema>): Promise<string> {
  return (await t.run(async (ctx) =>
    ctx.db.insert("clipJobs", {
      mintAddress: "MintAppendLog111111111111111111111111",
      sourceUrl: "https://drive.google.com/file/d/x/view",
      sourceType: "url",
      status: "queued",
      createdAt: 0,
      updatedAt: 0, // start frozen so a heartbeat is observable
    }),
  )) as unknown as string;
}

describe("clipJobs.appendLog", () => {
  beforeEach(() => { vi.stubEnv("INTERNAL_CRON_SECRET", SECRET); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("appends a line, denormalizes note/pct, and bumps updatedAt (the reaper heartbeat)", async () => {
    const t = convexTest(schema, modules);
    const jobId = await makeJob(t);
    await t.mutation(api.clipJobs.appendLog, { jobId: jobId as never, phase: "downloading", note: "Downloading 40% (120/300 MB)", pct: 40, authSecret: SECRET });

    const job = await t.run(async (ctx) => ctx.db.get(jobId as never)) as {
      log?: { phase: string; note: string; pct?: number }[]; progressNote?: string; progressPct?: number; updatedAt: number;
    };
    expect(job.log).toHaveLength(1);
    expect(job.log![0]).toMatchObject({ phase: "downloading", note: "Downloading 40% (120/300 MB)", pct: 40 });
    expect(job.progressNote).toBe("Downloading 40% (120/300 MB)");
    expect(job.progressPct).toBe(40);
    expect(job.updatedAt).toBeGreaterThan(0); // heartbeat: advanced past the frozen 0
  });

  it("bounds the log to the last 80 entries (doc-size guard)", async () => {
    const t = convexTest(schema, modules);
    const jobId = await makeJob(t);
    for (let i = 0; i < 90; i++) {
      await t.mutation(api.clipJobs.appendLog, { jobId: jobId as never, phase: "clipping", note: `line ${i}`, authSecret: SECRET });
    }
    const job = await t.run(async (ctx) => ctx.db.get(jobId as never)) as { log?: { note: string }[] };
    expect(job.log).toHaveLength(80);
    expect(job.log![0].note).toBe("line 10"); // oldest 10 dropped
    expect(job.log![79].note).toBe("line 89");
  });

  it("rejects an unauthorized caller (secret-gated, like the other internal mutations)", async () => {
    const t = convexTest(schema, modules);
    const jobId = await makeJob(t);
    await expect(
      t.mutation(api.clipJobs.appendLog, { jobId: jobId as never, phase: "x", note: "y", authSecret: "wrong-secret" }),
    ).rejects.toThrow(/unauthorized/);
  });
});
