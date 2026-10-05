import { describe, expect, it } from "vitest";
import type { AdminRewardSubmission } from "@/lib/content-rewards";
import {
  mergeAdminSubmissions,
  mapConvexToAdmin,
  normalizePostUrl,
  type ConvexAdminSubmission,
  type HireAdminSubmission,
} from "@/lib/mergeAdminSubmissions";

function hireRow(over: Partial<HireAdminSubmission> = {}): HireAdminSubmission {
  return {
    taskId: "task-1",
    mintAddress: "mintABC",
    agentName: "Nova",
    agentAvatar: "https://img/nova.png",
    agentType: "influencer",
    platform: "tiktok",
    postUrl: "https://www.tiktok.com/@nova/video/999",
    videoUrl: "https://cdn/vid.mp4",
    title: "Commissioned product demo",
    commissionUsdc: 8,
    createdAt: Date.parse("2026-07-08T00:00:00.000Z"),
    ...over,
  };
}

function supabaseRow(over: Partial<AdminRewardSubmission> = {}): AdminRewardSubmission {
  return {
    id: "cr-1",
    contentRewardId: "reward-1",
    campaignName: "Acme",
    platform: "tiktok",
    contentUrl: "https://www.tiktok.com/@a/video/123",
    videoUrl: null,
    title: "clip",
    views: 100,
    likes: 0,
    status: "approved",
    payoutStatus: "paid",
    payout: 5,
    supposedPayout: 5,
    currency: "USD",
    submittedAt: "2026-07-01T00:00:00.000Z",
    submitterName: "Clipper",
    submitterImage: "",
    ...over,
  };
}

function convexRow(over: Partial<ConvexAdminSubmission> = {}): ConvexAdminSubmission {
  return {
    _id: "cx-1",
    campaignId: "camp-1",
    contentRewardSubmissionId: null,
    status: "submitted",
    platform: "instagram",
    postUrl: "https://www.instagram.com/reel/xyz",
    viewCount: 2000,
    payoutAmountUsdc: 12,
    paidUsdc: 0,
    influencerName: "Nova",
    agentName: "Nova",
    agentAvatar: "https://img/nova.png",
    agentType: "influencer",
    campaignTitle: "Summer UGC",
    brandName: "Acme",
    postedAt: Date.parse("2026-07-05T00:00:00.000Z"),
    createdAt: Date.parse("2026-07-05T00:00:00.000Z"),
    ...over,
  };
}

describe("mapConvexToAdmin: postedProof (a real publish, even without a permalink)", () => {
  it("marks a row with a durable upload-post id as posted even when there's no permalink", () => {
    const r = mapConvexToAdmin(convexRow({ postUrl: "", platformPostId: "ig_123", uploadPostRequestId: null }));
    expect(r.postedProof).toBe(true);
  });
  it("marks a row with an uploadPostRequestId as posted (async platform, permalink pending)", () => {
    const r = mapConvexToAdmin(convexRow({ postUrl: "", platformPostId: null, uploadPostRequestId: "req_abc" }));
    expect(r.postedProof).toBe(true);
  });
  it("a row with a permalink is posted", () => {
    expect(mapConvexToAdmin(convexRow({ postUrl: "https://tiktok.com/@a/video/1" })).postedProof).toBe(true);
  });
  it("a row with NO url and NO durable id is NOT posted (genuine failure/never-posted)", () => {
    const r = mapConvexToAdmin(convexRow({ postUrl: "", platformPostId: null, uploadPostRequestId: null }));
    expect(r.postedProof).toBe(false);
  });
});

describe("normalizePostUrl", () => {
  it("collapses scheme, www, query, hash, and trailing slash", () => {
    expect(normalizePostUrl("https://www.tiktok.com/@a/video/123/?utm=x#top")).toBe(
      "tiktok.com/@a/video/123",
    );
    expect(normalizePostUrl("http://tiktok.com/@a/video/123")).toBe("tiktok.com/@a/video/123");
    expect(normalizePostUrl(null)).toBe("");
  });
});

describe("mergeAdminSubmissions", () => {
  it("passes pure UGC campaign rows through and tags source", () => {
    const merged = mergeAdminSubmissions([], [convexRow()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("campaign");
    expect(merged[0].submitterName).toBe("Nova");
    expect(merged[0].campaignName).toBe("Acme");
    expect(merged[0].currency).toBe("USDC");
    expect(merged[0].agentType).toBe("influencer");
  });

  it("tags Supabase rows as content_reward", () => {
    const merged = mergeAdminSubmissions([supabaseRow()], []);
    expect(merged[0].source).toBe("content_reward");
  });

  it("dedups a Convex row bridged from a Supabase row via contentRewardSubmissionId", () => {
    const merged = mergeAdminSubmissions(
      [supabaseRow({ id: "cr-1" })],
      [convexRow({ _id: "cx-1", contentRewardSubmissionId: "cr-1" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("content_reward");
  });

  it("dedups on colliding normalized postUrl even without a bridge id", () => {
    const merged = mergeAdminSubmissions(
      [supabaseRow({ contentUrl: "https://www.tiktok.com/@a/video/123" })],
      [convexRow({ postUrl: "http://tiktok.com/@a/video/123/?utm=1" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("content_reward");
  });

  it("keeps both when urls and bridge ids differ, newest first", () => {
    const merged = mergeAdminSubmissions(
      [supabaseRow({ submittedAt: "2026-07-01T00:00:00.000Z" })],
      [convexRow({ postedAt: Date.parse("2026-07-06T00:00:00.000Z") })],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].source).toBe("campaign"); // 07-06 newer than 07-01
    expect(merged[1].source).toBe("content_reward");
  });

  it("falls back to createdAt when postedAt is null", () => {
    const created = Date.parse("2026-07-03T00:00:00.000Z");
    const merged = mergeAdminSubmissions([], [convexRow({ postedAt: null, createdAt: created })]);
    expect(merged[0].submittedAt).toBe(new Date(created).toISOString());
  });

  it("surfaces a hire post as its own source with the commission as payout", () => {
    const merged = mergeAdminSubmissions([], [], [hireRow()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("hire");
    expect(merged[0].id).toBe("hire:task-1");
    expect(merged[0].contentUrl).toBe("https://www.tiktok.com/@nova/video/999");
    expect(merged[0].platform).toBe("tiktok");
    expect(merged[0].payout).toBe(8);
    expect(merged[0].paidUsdc).toBe(8);
    expect(merged[0].currency).toBe("USDC");
    expect(merged[0].views).toBe(0);
    expect(merged[0].status).toBe("paid");
    expect(merged[0].submitterName).toBe("Nova");
  });

  it("backfills the real permalink over a raw CDN contentUrl (not just an empty one)", () => {
    // Regression: the display row's contentUrl was SET to the raw clip/CDN url
    // (the write-side `postUrl || clipUrl` fallback) — non-empty, so the old
    // `!r.contentUrl` check never replaced it with the twin's real permalink and
    // the platform button opened the clip file instead of the actual post.
    const merged = mergeAdminSubmissions(
      [supabaseRow({
        id: "cr-9",
        contentUrl: "https://bold-ram-39.convex.cloud/api/storage/c7eccbaf",
      })],
      [convexRow({ contentRewardSubmissionId: "cr-9", postUrl: "https://www.tiktok.com/@a/video/999" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].contentUrl).toBe("https://www.tiktok.com/@a/video/999");
    expect(merged[0].postedProof).toBe(true);
  });

  it("merges all three sources newest-first", () => {
    const merged = mergeAdminSubmissions(
      [supabaseRow({ submittedAt: "2026-07-01T00:00:00.000Z" })],
      [convexRow({ postedAt: Date.parse("2026-07-05T00:00:00.000Z") })],
      [hireRow({ createdAt: Date.parse("2026-07-08T00:00:00.000Z") })],
    );
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.source)).toEqual(["hire", "campaign", "content_reward"]);
  });

  it("dedups a hire whose post URL already appeared from another store", () => {
    const url = "https://www.tiktok.com/@nova/video/999";
    const merged = mergeAdminSubmissions(
      [supabaseRow({ contentUrl: url })],
      [],
      [hireRow({ postUrl: "http://tiktok.com/@nova/video/999/?utm=1" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("content_reward");
  });

  it("defaults hire rows to an empty array (back-compat with 2-arg callers)", () => {
    const merged = mergeAdminSubmissions([supabaseRow()], [convexRow()]);
    expect(merged.every((r) => r.source !== "hire")).toBe(true);
  });
});
