/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// markClipPostedByUrl must return the clip's job campaign provenance so the manual
// "Post now" (/api/social/post) can auto-submit a posted campaign clip to its
// Submissions page — parity with the cloud auto-post (which used to be the only
// path that submitted).

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-cron-secret";
const MINT = "MintMark1111111111111111111111111111";
const CLIP_URL = "https://cdn.example.com/clip-9.mp4";

async function seed(t: TestConvex<typeof schema>, jobFields: Record<string, unknown>) {
  const jobId = await t.run((ctx) =>
    ctx.db.insert("clipJobs", {
      mintAddress: MINT, sourceUrl: "https://drive.google.com/file/d/x/view", sourceType: "url",
      status: "completed", createdAt: 0, updatedAt: 0, ...jobFields,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("clips", {
      jobId: jobId as never, mintAddress: MINT, title: "Clip", reason: "x", startSeconds: 0, endSeconds: 30,
      viralScore: 50, captionText: "hi", status: "ready", clipUrl: CLIP_URL, createdAt: 0, updatedAt: 0,
    }),
  );
}

describe("clipJobs.markClipPostedByUrl — campaign provenance", () => {
  beforeEach(() => vi.stubEnv("INTERNAL_CRON_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("returns the clip's job contentRewardId + ownerWallet (for manual Post-now auto-submit)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { contentRewardId: "cr-9", ownerWallet: "Wal9" });
    const res = await t.mutation(api.clipJobs.markClipPostedByUrl, {
      mintAddress: MINT, clipUrl: CLIP_URL, status: "posted", authSecret: SECRET,
    });
    expect(res).toMatchObject({ ok: true, contentRewardId: "cr-9", ownerWallet: "Wal9", campaignId: null });
  });

  it("returns the campaignId for a Convex-campaign clip", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { campaignId: "camp-7", ownerWallet: "Wal7" });
    const res = await t.mutation(api.clipJobs.markClipPostedByUrl, {
      mintAddress: MINT, clipUrl: CLIP_URL, status: "posted", authSecret: SECRET,
    });
    expect(res).toMatchObject({ ok: true, campaignId: "camp-7", contentRewardId: null });
  });

  it("returns the clip's own row id (clipId) so drip/manual can link the submission without a URL re-query", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { campaignId: "camp-7", ownerWallet: "Wal7" });
    const clipId = await t.run(async (ctx) => {
      const c = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).first();
      return c?._id;
    });
    const res = await t.mutation(api.clipJobs.markClipPostedByUrl, {
      mintAddress: MINT, clipUrl: CLIP_URL, status: "posted", authSecret: SECRET,
    });
    expect((res as { clipId?: string }).clipId).toBe(clipId);
  });

  it("still returns clipId on the monotonic no-op branch (already-posted clip)", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { campaignId: "camp-7", ownerWallet: "Wal7" });
    const clipId = await t.run(async (ctx) => {
      const c = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).first();
      return c?._id;
    });
    // First mark → posted; second mark (no better URL) → noop branch, still carries provenance.
    await t.mutation(api.clipJobs.markClipPostedByUrl, { mintAddress: MINT, clipUrl: CLIP_URL, status: "posted", authSecret: SECRET });
    const res = await t.mutation(api.clipJobs.markClipPostedByUrl, { mintAddress: MINT, clipUrl: CLIP_URL, status: "posted", authSecret: SECRET });
    expect(res).toMatchObject({ ok: true, noop: true, campaignId: "camp-7" });
    expect((res as { clipId?: string }).clipId).toBe(clipId);
  });
});
