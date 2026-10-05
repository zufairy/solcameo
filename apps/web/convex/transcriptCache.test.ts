/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const getByKey = makeFunctionReference<"query">("transcriptCache:getByKey");
const put = makeFunctionReference<"mutation">("transcriptCache:put");
// transcriptCache.put is now INTERNAL_CRON_SECRET-gated (the transcribe-clip route forwards it).
const SECRET = "test-internal-cron-secret-transcriptcache";
process.env.INTERNAL_CRON_SECRET = SECRET;

describe("transcriptCache", () => {
  it("put → getByKey round-trips, upsert replaces, miss returns null", async () => {
    const t = convexTest(schema, modules);

    const sid = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([JSON.stringify({ segments: [], words: [] })], { type: "application/json" })),
    );
    await t.mutation(put, {
      authSecret: SECRET,
      sourceKey: "yt:abc", version: 1, durationSeconds: 120, transcriptStorageId: sid,
      analysis: { moments: [{ title: "Hook", viralScore: 90 }], version: 1 }, provider: "elevenlabs", createdAt: 111,
    });

    const hit = await t.query(getByKey, { sourceKey: "yt:abc" });
    expect(hit).not.toBeNull();
    expect(hit!.version).toBe(1);
    expect(hit!.durationSeconds).toBe(120);
    expect(hit!.provider).toBe("elevenlabs");
    expect(hit!.analysis.moments[0].title).toBe("Hook");
    expect(hit!.transcriptUrl).toBeTruthy();

    // miss
    expect(await t.query(getByKey, { sourceKey: "yt:none" })).toBeNull();

    // upsert: same key replaces, leaving exactly one row
    const sid2 = await t.run(async (ctx) => ctx.storage.store(new Blob(["{}"], { type: "application/json" })));
    await t.mutation(put, {
      authSecret: SECRET,
      sourceKey: "yt:abc", version: 2, durationSeconds: 200, transcriptStorageId: sid2,
      analysis: {}, provider: "elevenlabs", createdAt: 222,
    });
    const hit2 = await t.query(getByKey, { sourceKey: "yt:abc" });
    expect(hit2!.version).toBe(2);
    expect(hit2!.durationSeconds).toBe(200);
    const count = await t.run(async (ctx) => (await ctx.db.query("transcriptCache").collect()).length);
    expect(count).toBe(1);
  });
});
