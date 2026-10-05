/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// clipJobs.autoClippedKeysForMint is the dedup source of truth for autonomous
// clipping: it derives the already-clipped (campaign, source-video) keys straight
// from existing clipJobs rows. The key string MUST match lib/server/autoClipSelect
// .autoClipKey. A terminally-failed 0-clip run stays eligible to retry (excluded).

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-cron-secret";
const MINT = "MintAutoClippedKeys11111111111111111111";

async function insertJob(
  t: TestConvex<typeof schema>,
  row: { sourceUrl: string; campaignId?: string; contentRewardId?: string; status: string; clipsReady?: number },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("clipJobs", {
      mintAddress: MINT,
      sourceUrl: row.sourceUrl,
      sourceType: "auto",
      campaignId: row.campaignId,
      contentRewardId: row.contentRewardId,
      status: row.status,
      clipsReady: row.clipsReady,
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

describe("clipJobs.autoClippedKeysForMint", () => {
  beforeEach(() => { vi.stubEnv("INTERNAL_CRON_SECRET", SECRET); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns the (campaign|source) keys for clipped rows, excluding a failed 0-clip run", async () => {
    const t = convexTest(schema, modules);
    await insertJob(t, { sourceUrl: "u1", campaignId: "cA", status: "completed", clipsReady: 2 });
    await insertJob(t, { sourceUrl: "u2", contentRewardId: "rB", status: "posting", clipsReady: 1 });
    // Failed with ZERO clips → eligible to retry → NOT returned.
    await insertJob(t, { sourceUrl: "u3", campaignId: "cC", status: "error", clipsReady: 0 });

    const keys = await t.query(api.clipJobs.autoClippedKeysForMint, { mintAddress: MINT, authSecret: SECRET });
    expect([...keys].sort()).toEqual(["cA|u1", "rB|u2"]);
  });

  it("counts a status:error run that still produced clips (partial value, charge kept)", async () => {
    const t = convexTest(schema, modules);
    await insertJob(t, { sourceUrl: "u4", campaignId: "cD", status: "error", clipsReady: 1 });
    const keys = await t.query(api.clipJobs.autoClippedKeysForMint, { mintAddress: MINT, authSecret: SECRET });
    expect(keys).toEqual(["cD|u4"]);
  });

  it("uses contentRewardId when no campaignId, and '' when neither", async () => {
    const t = convexTest(schema, modules);
    await insertJob(t, { sourceUrl: "u5", contentRewardId: "rE", status: "completed", clipsReady: 3 });
    await insertJob(t, { sourceUrl: "u6", status: "completed", clipsReady: 1 });
    const keys = await t.query(api.clipJobs.autoClippedKeysForMint, { mintAddress: MINT, authSecret: SECRET });
    expect([...keys].sort()).toEqual(["rE|u5", "|u6"].sort());
  });

  it("rejects a wrong secret", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.clipJobs.autoClippedKeysForMint, { mintAddress: MINT, authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/i);
  });

  // Bounded failed-source memory (C11): a genuinely broken source (deleted/private/
  // unclippable) that terminally fails with 0 clips EVERY cycle would otherwise stay
  // first-in-line forever and block later sources. After N terminal 0-clip failures the
  // key is treated as exhausted (returned) so pickNextAutoClipSource skips it.
  it("exhausts a source after N terminal 0-clip failures so it stops re-enqueuing", async () => {
    const t = convexTest(schema, modules);
    // 3 terminal 0-clip failures for the SAME (campaign|source) key → exhausted.
    await insertJob(t, { sourceUrl: "ubroke", campaignId: "cBroke", status: "error", clipsReady: 0 });
    await insertJob(t, { sourceUrl: "ubroke", campaignId: "cBroke", status: "error", clipsReady: 0 });
    await insertJob(t, { sourceUrl: "ubroke", campaignId: "cBroke", status: "error", clipsReady: 0 });

    const keys = await t.query(api.clipJobs.autoClippedKeysForMint, { mintAddress: MINT, authSecret: SECRET });
    expect(keys).toContain("cBroke|ubroke");
  });

  it("keeps a source with fewer than N failures eligible (a transient failure still retries)", async () => {
    const t = convexTest(schema, modules);
    // 2 terminal 0-clip failures (< N) → still eligible to retry → NOT returned.
    await insertJob(t, { sourceUrl: "uflaky", campaignId: "cFlaky", status: "error", clipsReady: 0 });
    await insertJob(t, { sourceUrl: "uflaky", campaignId: "cFlaky", status: "error", clipsReady: 0 });

    const keys = await t.query(api.clipJobs.autoClippedKeysForMint, { mintAddress: MINT, authSecret: SECRET });
    expect(keys).not.toContain("cFlaky|uflaky");
  });
});
