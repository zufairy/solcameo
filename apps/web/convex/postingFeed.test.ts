/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import type { FunctionReturnType } from "convex/server";
import { api } from "./_generated/api";
import schema from "./schema";

type FeedRow = FunctionReturnType<typeof api.clipJobs.postingFeed>[number];

const modules = import.meta.glob("./**/*.ts");
const MINT = "PostingFeedTestMint1111111111111111111111";
const OTHER_MINT = "PostingFeedOtherMint22222222222222222222";

// markClipPostedByUrl is secret-gated (INTERNAL_CRON_SECRET). Set a known secret
// for the suite and thread it into every gated call.
const SECRET = "test-internal-cron-secret-postingfeed";
process.env.INTERNAL_CRON_SECRET = SECRET;

/** Insert one ready clip via recordCanvasClips and return its clipUrl. */
async function seedClip(
  t: TestConvex<typeof schema>,
  opts: { clipUrl: string; title: string; viralScore: number; mint?: string },
) {
  await t.mutation(api.clipJobs.recordCanvasClips, {
    mintAddress: opts.mint ?? MINT,
    sourceUrl: "canvas",
    clips: [
      {
        title: opts.title,
        reason: "",
        clipUrl: opts.clipUrl,
        viralScore: opts.viralScore,
        captionText: "",
        startSeconds: 0,
        endSeconds: 10,
      },
    ],
    authSecret: SECRET,
  });
}

/** Insert a scheduledContent row directly (mirrors the drip-arm schedule mutation). */
async function seedSchedule(
  t: TestConvex<typeof schema>,
  opts: { videoUrl: string; status: string; platforms?: string[]; scheduledFor?: number; error?: string; createdAt?: number; mint?: string },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("scheduledContent", {
      mintAddress: opts.mint ?? MINT,
      scheduledFor: opts.scheduledFor ?? Date.now() + 7_200_000,
      status: opts.status,
      topic: "Clip",
      platforms: opts.platforms ?? [],
      videoUrl: opts.videoUrl,
      error: opts.error,
      createdAt: opts.createdAt ?? Date.now(),
    });
  });
}

describe("markClipPostedByUrl", () => {
  it("rejects a bad secret", async () => {
    const t = convexTest(schema, modules);
    await seedClip(t, { clipUrl: "u1", title: "A", viralScore: 50 });
    await expect(
      t.mutation(api.clipJobs.markClipPostedByUrl, { mintAddress: MINT, clipUrl: "u1", authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("patches the clip matched by mint+clipUrl to posted + postUrl + platform", async () => {
    const t = convexTest(schema, modules);
    await seedClip(t, { clipUrl: "https://convex/clip-a.mp4", title: "A", viralScore: 50 });

    const r = await t.mutation(api.clipJobs.markClipPostedByUrl, {
      mintAddress: MINT,
      clipUrl: "https://convex/clip-a.mp4",
      postUrl: "https://tiktok.com/v/1",
      platform: "tiktok",
      captionText: "The caption that was actually published",
      authSecret: SECRET,
    });
    expect(r).toMatchObject({ ok: true });

    const clip = await t.run(async (ctx) =>
      (await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect())[0],
    );
    expect(clip.status).toBe("posted");
    expect(clip.postUrl).toBe("https://tiktok.com/v/1");
    expect(clip.platform).toBe("tiktok");
    expect(clip.captionText).toBe("The caption that was actually published");
  });

  it("returns {ok:false} (non-fatal) when no clip matches the url", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(api.clipJobs.markClipPostedByUrl, {
      mintAddress: MINT, clipUrl: "https://nope.mp4", authSecret: SECRET,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("is monotonic: a posted clip never regresses, but a later real permalink upgrades it", async () => {
    const t = convexTest(schema, modules);
    await seedClip(t, { clipUrl: "u-mono", title: "A", viralScore: 50 });

    // First post resolves no permalink yet (fallback).
    await t.mutation(api.clipJobs.markClipPostedByUrl, { mintAddress: MINT, clipUrl: "u-mono", status: "posted", platform: "x", authSecret: SECRET });
    // A retry tries to regress to failed — must be ignored.
    await t.mutation(api.clipJobs.markClipPostedByUrl, { mintAddress: MINT, clipUrl: "u-mono", status: "failed", authSecret: SECRET });
    let clip = await t.run(async (ctx) =>
      (await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect())[0],
    );
    expect(clip.status).toBe("posted");

    // A later real permalink upgrades the posted clip's link.
    const up = await t.mutation(api.clipJobs.markClipPostedByUrl, { mintAddress: MINT, clipUrl: "u-mono", status: "posted", postUrl: "https://x.com/p/1", authSecret: SECRET });
    expect(up).toMatchObject({ ok: true, upgraded: true });
    clip = await t.run(async (ctx) =>
      (await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect())[0],
    );
    expect(clip.postUrl).toBe("https://x.com/p/1");
  });
});

describe("postingFeed", () => {
  it("returns clips viralScore DESC with derived join states", async () => {
    const t = convexTest(schema, modules);
    // Out-of-order viral scores to prove the sort.
    await seedClip(t, { clipUrl: "c-not", title: "NotPosted", viralScore: 10 });
    await seedClip(t, { clipUrl: "c-queued", title: "Queued", viralScore: 90 });
    await seedClip(t, { clipUrl: "c-posting", title: "Posting", viralScore: 70 });
    await seedClip(t, { clipUrl: "c-posted", title: "Posted", viralScore: 80 });
    await seedClip(t, { clipUrl: "c-failed", title: "Failed", viralScore: 60 });

    await seedSchedule(t, { videoUrl: "c-queued", status: "scheduled", scheduledFor: 1234, platforms: ["youtube"] });
    await seedSchedule(t, { videoUrl: "c-posting", status: "posting" });
    await seedSchedule(t, { videoUrl: "c-failed", status: "failed", error: "boom" });
    // posted state via the clip badge (drainDueClips patches the clip).
    await t.mutation(api.clipJobs.markClipPostedByUrl, { mintAddress: MINT, clipUrl: "c-posted", status: "posted", postUrl: "https://link", platform: "tiktok", authSecret: SECRET });

    const feed = await t.query(api.clipJobs.postingFeed, { mintAddress: MINT });
    expect(feed.map((f: FeedRow) => f.title)).toEqual(["Queued", "Posted", "Posting", "Failed", "NotPosted"]);

    const byTitle = Object.fromEntries(feed.map((f: FeedRow) => [f.title, f]));
    expect(byTitle.NotPosted.state).toBe("not_posted");
    expect(byTitle.Queued.state).toBe("queued");
    expect(byTitle.Queued.scheduledFor).toBe(1234);
    expect(byTitle.Queued.platform).toBe("youtube");
    expect(byTitle.Posting.state).toBe("posting");
    expect(byTitle.Posted.state).toBe("posted");
    expect(byTitle.Posted.postUrl).toBe("https://link");
    expect(byTitle.Posted.platform).toBe("tiktok");
    expect(byTitle.Failed.state).toBe("failed");
    expect(byTitle.Failed.error).toBe("boom");
  });

  it("ignores a cancelled drip row and prefers the most-recent non-cancelled one", async () => {
    const t = convexTest(schema, modules);
    await seedClip(t, { clipUrl: "c1", title: "Clip", viralScore: 50 });
    // Older cancelled + newer scheduled for the SAME url — newer wins.
    await seedSchedule(t, { videoUrl: "c1", status: "cancelled", createdAt: 100 });
    await seedSchedule(t, { videoUrl: "c1", status: "scheduled", createdAt: 200, scheduledFor: 999 });

    const feed = await t.query(api.clipJobs.postingFeed, { mintAddress: MINT });
    expect(feed[0].state).toBe("queued");
    expect(feed[0].scheduledFor).toBe(999);
  });

  it("is mint-scoped — never leaks another agent's clips", async () => {
    const t = convexTest(schema, modules);
    await seedClip(t, { clipUrl: "mine", title: "Mine", viralScore: 50 });
    await seedClip(t, { clipUrl: "theirs", title: "Theirs", viralScore: 99, mint: OTHER_MINT });

    const feed = await t.query(api.clipJobs.postingFeed, { mintAddress: MINT });
    expect(feed.map((f: FeedRow) => f.title)).toEqual(["Mine"]);
  });
});
