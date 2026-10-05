import { describe, it, expect } from "vitest";
import {
  scoreSubmission,
  normalizePostUrl,
  type OracleThresholds,
  type ScoreInput,
  type PostMetrics,
  type AnalyticsInput,
  type PeerSubmission,
} from "./oracleFraud";

const HOUR = 3_600_000;

function defaultConfig(over: Partial<OracleThresholds> = {}): OracleThresholds {
  return {
    maturationHours: 48,
    settleDeadlineHours: 168,
    maxViewsPerHour: 500_000,
    velocityMinViews: 50_000,
    velocityHardMultiple: 4,
    engagementMinViews: 10_000,
    engagementMinRatio: 0.001,
    engagementHardViews: 25_000,
    dupSourceClusterMax: 3,
    ...over,
  };
}

function baseInput(over: Partial<ScoreInput> = {}): ScoreInput {
  const nowMs = 1_000_000_000_000;
  return {
    platform: "tiktok",
    analytics: { status: "ok", metrics: { views: 1000 } },
    postedAtMs: nowMs - 60 * HOUR, // mature by default (60h > 48h)
    nowMs,
    submissionId: "s_subject",
    submissionCreationTimeMs: nowMs - 60 * HOUR,
    submitterWallet: "Wallet_subject",
    peers: [],
    config: defaultConfig(),
    ...over,
  };
}

function ok(metrics: PostMetrics, extra: Partial<Extract<AnalyticsInput, { status: "ok" }>> = {}): AnalyticsInput {
  return { status: "ok", metrics, ...extra };
}

function peer(over: Partial<PeerSubmission> = {}): PeerSubmission {
  return {
    submissionId: "p1",
    creationTimeMs: 0,
    status: "approved",
    submitterWallet: "Wallet_peer",
    campaignSame: true,
    ...over,
  };
}

describe("normalizePostUrl", () => {
  it("strips query string and fragment", () => {
    expect(normalizePostUrl("https://www.tiktok.com/@a/video/123?utm=x&y=2#frag")).toBe(
      "https://www.tiktok.com/@a/video/123",
    );
  });
  it("strips a trailing slash", () => {
    expect(normalizePostUrl("https://tiktok.com/@a/video/123/")).toBe("https://tiktok.com/@a/video/123");
  });
  it("lowercases the host but keeps path case", () => {
    expect(normalizePostUrl("https://WWW.TikTok.COM/@Abc/Video/123")).toBe("https://www.tiktok.com/@Abc/Video/123");
  });
  it("returns trimmed lowercased input when URL parsing throws", () => {
    expect(normalizePostUrl("  Not A Url  ")).toBe("not a url");
  });
  it("keeps the youtube ?v= identity so distinct videos do NOT collide", () => {
    expect(normalizePostUrl("https://www.youtube.com/watch?v=AAA")).not.toBe(
      normalizePostUrl("https://www.youtube.com/watch?v=BBB"),
    );
  });
  it("drops tracking params but keeps youtube ?v= so the same video collapses", () => {
    expect(normalizePostUrl("https://www.youtube.com/watch?v=AAA&utm_source=x")).toBe(
      normalizePostUrl("https://www.youtube.com/watch?v=AAA"),
    );
  });
  it("keeps facebook permalink identity (story_fbid + id) so distinct stories do NOT collide", () => {
    expect(
      normalizePostUrl("https://www.facebook.com/permalink.php?story_fbid=111&id=9"),
    ).not.toBe(normalizePostUrl("https://www.facebook.com/permalink.php?story_fbid=222&id=9"));
  });
});

describe("scoreSubmission — view-field resolution", () => {
  it("tiktok resolves views", () => {
    const r = scoreSubmission(baseInput({ platform: "tiktok", analytics: ok({ views: 1234 }) }));
    expect(r.signals.viewField).toBe("views");
    expect(r.decision).toBe("approved");
    expect(r.viewCount).toBe(1234);
  });
  it("x resolves impressions before views", () => {
    const r = scoreSubmission(baseInput({ platform: "x", analytics: ok({ views: 10, impressions: 999 }) }));
    expect(r.signals.viewField).toBe("impressions");
    expect(r.viewCount).toBe(999);
  });
  it("facebook resolves reach (proxy) → manual_review, viewCount 0 (not priced as views)", () => {
    const r = scoreSubmission(baseInput({ platform: "facebook", analytics: ok({ reach: 777 }) }));
    expect(r.signals.viewField).toBe("reach");
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("proxy_metric_review");
    expect(r.viewCount).toBe(0);
  });
  it("reddit resolves score (proxy) → manual_review, viewCount 0 (not priced as views)", () => {
    const r = scoreSubmission(baseInput({ platform: "reddit", analytics: ok({ score: 42 }) }));
    expect(r.signals.viewField).toBe("score");
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("proxy_metric_review");
    expect(r.viewCount).toBe(0);
  });
  it("instagram with only impressions resolves impressions", () => {
    const r = scoreSubmission(baseInput({ platform: "instagram", analytics: ok({ impressions: 555 }) }));
    expect(r.signals.viewField).toBe("impressions");
    expect(r.viewCount).toBe(555);
  });
  it("platform with no candidate field present → defer/manual_review (missing)", () => {
    const r = scoreSubmission(baseInput({ platform: "tiktok", analytics: ok({ likes: 5 }) }));
    expect(r.decision).toBe("defer");
    expect(r.reason).toBe("analytics_unavailable");
    expect(r.viewCount).toBe(0);
  });
  it("default/unknown platform falls through the full chain (proxy reach → manual_review)", () => {
    const r = scoreSubmission(baseInput({ platform: "mystery", analytics: ok({ reach: 88 }) }));
    expect(r.signals.viewField).toBe("reach");
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("proxy_metric_review");
    expect(r.viewCount).toBe(0);
  });
});

describe("scoreSubmission — maturation", () => {
  it("defers an immature post (12h @ 48h)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(baseInput({ postedAtMs: now - 12 * HOUR }));
    expect(r.decision).toBe("defer");
    expect(r.reason).toBe("immature");
    expect(r.viewCount).toBe(0);
  });
  it("runs the gates for a mature post (60h)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(baseInput({ postedAtMs: now - 60 * HOUR }));
    expect(r.decision).toBe("approved");
  });
  it("age exactly maturationHours runs (>=)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(baseInput({ postedAtMs: now - 48 * HOUR, config: defaultConfig({ maturationHours: 48 }) }));
    expect(r.decision).toBe("approved");
    expect(r.signals.ageHours).toBe(48);
  });
  it("postedAtMs absent → no defer, skip recorded, no ageHours", () => {
    const r = scoreSubmission(baseInput({ postedAtMs: undefined }));
    expect(r.decision).toBe("approved");
    expect(r.signals.skips).toContain("maturation:no_postedAt");
    expect(r.signals.ageHours).toBeUndefined();
  });
});

describe("scoreSubmission — missing analytics never approves", () => {
  it("status error within deadline → defer analytics_unavailable", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({ analytics: { status: "error", error: "boom" }, postedAtMs: now - 10 * HOUR }),
    );
    expect(r.decision).toBe("defer");
    expect(r.reason).toBe("analytics_unavailable");
    expect(r.decision).not.toBe("approved");
  });
  it("status error past deadline → manual_review analytics_unavailable_stale", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: { status: "error", error: "boom" },
        postedAtMs: now - 200 * HOUR,
        config: defaultConfig({ settleDeadlineHours: 168 }),
      }),
    );
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("analytics_unavailable_stale");
  });
  it("status unsupported → manual_review analytics_unsupported_platform", () => {
    const r = scoreSubmission(baseInput({ analytics: { status: "unsupported" } }));
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("analytics_unsupported_platform");
  });
  it("ok but viewLike undefined within deadline → defer analytics_unavailable", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(baseInput({ analytics: ok({ likes: 3 }), postedAtMs: now - 10 * HOUR }));
    expect(r.decision).toBe("defer");
    expect(r.reason).toBe("analytics_unavailable");
  });
  it("ok but viewLike undefined past deadline → manual_review", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(baseInput({ analytics: ok({ likes: 3 }), postedAtMs: now - 300 * HOUR }));
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("analytics_unavailable");
  });
});

describe("scoreSubmission — real zero", () => {
  it("ok with views:0 present and mature → approved, viewCount 0", () => {
    const r = scoreSubmission(baseInput({ analytics: ok({ views: 0 }) }));
    expect(r.decision).toBe("approved");
    expect(r.viewCount).toBe(0);
    expect(r.signals.viewField).toBe("views");
  });
});

describe("scoreSubmission — velocity", () => {
  it("soft-flags a high but plausible view rate (1M @ ~1h)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: ok({ views: 1_000_000 }),
        postedAtMs: now - 1 * HOUR,
        config: defaultConfig({ maturationHours: 0 }),
      }),
    );
    expect(r.decision).toBe("approved");
    expect(r.signals.softFlags).toContain("velocity:high_view_rate");
    expect(r.signals.viewsPerHour).toBe(1_000_000);
  });
  it("hard-rejects an impossible view rate (5M @ ~1h)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: ok({ views: 5_000_000 }),
        postedAtMs: now - 1 * HOUR,
        config: defaultConfig({ maturationHours: 0 }),
      }),
    );
    expect(r.decision).toBe("rejected");
    expect(r.reason).toBe("velocity:impossible_view_rate");
    expect(r.viewCount).toBe(5_000_000);
  });
  it("passes a normal rate (400k @ ~1h, under ceiling)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: ok({ views: 400_000 }),
        postedAtMs: now - 1 * HOUR,
        config: defaultConfig({ maturationHours: 0 }),
      }),
    );
    expect(r.decision).toBe("approved");
    expect(r.signals.softFlags).not.toContain("velocity:high_view_rate");
  });
  it("skips velocity for a proxy metric (reach 1M @ ~1h) → manual_review", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        platform: "facebook",
        analytics: ok({ reach: 1_000_000 }),
        postedAtMs: now - 1 * HOUR,
        config: defaultConfig({ maturationHours: 0 }),
      }),
    );
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("proxy_metric_review");
    expect(r.signals.skips).toContain("velocity:proxy_metric");
  });
  it("passes when below velocityMinViews even at a high rate", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: ok({ views: 40_000 }),
        postedAtMs: now - 0.01 * HOUR,
        config: defaultConfig({ maturationHours: 0 }),
      }),
    );
    expect(r.decision).toBe("approved");
    expect(r.signals.softFlags).not.toContain("velocity:high_view_rate");
  });
  it("skips velocity when no age (postedAtMs absent)", () => {
    const r = scoreSubmission(baseInput({ analytics: ok({ views: 1_000_000 }), postedAtMs: undefined }));
    expect(r.signals.skips).toContain("velocity:no_age");
  });
});

describe("scoreSubmission — engagement", () => {
  it("soft-flags a low engagement ratio", () => {
    // 100k views, 50 engagement → ratio 0.0005 < 0.001
    const r = scoreSubmission(baseInput({ analytics: ok({ views: 100_000, likes: 50 }) }));
    expect(r.decision).toBe("approved");
    expect(r.signals.softFlags).toContain("engagement:low_ratio");
    expect(r.signals.engagementRatio).toBeCloseTo(0.0005, 6);
  });
  it("hard-rejects zero engagement above the hard-view floor", () => {
    const r = scoreSubmission(baseInput({ analytics: ok({ views: 100_000, likes: 0 }) }));
    expect(r.decision).toBe("rejected");
    expect(r.reason).toBe("engagement:zero_engagement");
    expect(r.viewCount).toBe(100_000);
  });
  it("skips engagement when no engagement fields present", () => {
    const r = scoreSubmission(baseInput({ analytics: ok({ views: 100_000 }) }));
    expect(r.decision).toBe("approved");
    expect(r.signals.skips).toContain("engagement:fields_absent");
  });
  it("passes when below engagementMinViews even at zero engagement", () => {
    const r = scoreSubmission(baseInput({ analytics: ok({ views: 5_000, likes: 0 }) }));
    expect(r.decision).toBe("approved");
    expect(r.signals.softFlags).not.toContain("engagement:zero_engagement");
    expect(r.signals.softFlags).not.toContain("engagement:low_ratio");
  });
  it("ratio exactly engagementMinRatio passes (strict <)", () => {
    // 100k views, 100 engagement → ratio exactly 0.001
    const r = scoreSubmission(baseInput({ analytics: ok({ views: 100_000, likes: 100 }) }));
    expect(r.decision).toBe("approved");
    expect(r.signals.softFlags).not.toContain("engagement:low_ratio");
  });
  it("sums all present engagement fields", () => {
    const r = scoreSubmission(
      baseInput({ analytics: ok({ views: 100_000, likes: 10, comments: 20, shares: 30, saves: 40 }) }),
    );
    expect(r.signals.engagementRatio).toBeCloseTo(0.001, 6);
  });
  it("skips engagement for a proxy metric → manual_review", () => {
    const r = scoreSubmission(
      baseInput({ platform: "reddit", analytics: ok({ score: 100_000, likes: 0 }) }),
    );
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("proxy_metric_review");
    expect(r.signals.skips).toContain("engagement:proxy_metric");
  });
});

describe("scoreSubmission — duplicate gate", () => {
  it("hard-rejects when an earlier peer shares (platform, platformPostId)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        platformPostId: "POST123",
        submissionCreationTimeMs: now,
        peers: [peer({ platform: "tiktok", platformPostId: "POST123", creationTimeMs: now - 5 * HOUR })],
      }),
    );
    expect(r.decision).toBe("rejected");
    expect(r.reason).toBe("duplicate:platform_post_id");
  });
  it("hard-rejects when an earlier peer shares the normalized url", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        normalizedPostUrl: "https://tiktok.com/@a/video/1",
        submissionCreationTimeMs: now,
        peers: [
          peer({
            platform: "tiktok",
            normalizedPostUrl: "https://tiktok.com/@a/video/1",
            creationTimeMs: now - 5 * HOUR,
          }),
        ],
      }),
    );
    expect(r.decision).toBe("rejected");
    expect(r.reason).toBe("duplicate:post_url");
  });
  it("does NOT reject the same id on a different platform (cross-post)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        platformPostId: "POST123",
        peers: [peer({ platform: "youtube", platformPostId: "POST123", creationTimeMs: now - 5 * HOUR })],
      }),
    );
    expect(r.decision).toBe("approved");
  });
  it("does NOT reject when this submission is the earliest of the collision set", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        platformPostId: "POST123",
        submissionCreationTimeMs: now - 10 * HOUR,
        peers: [peer({ platform: "tiktok", platformPostId: "POST123", creationTimeMs: now - 5 * HOUR })],
      }),
    );
    expect(r.decision).toBe("approved");
  });
  it("equal-time collision: only the lexicographically-later submissionId is rejected", () => {
    const now = baseInput().nowMs;
    const loser = scoreSubmission(
      baseInput({
        submissionId: "s_zzz",
        platformPostId: "POST123",
        submissionCreationTimeMs: now,
        peers: [peer({ submissionId: "s_aaa", platform: "tiktok", platformPostId: "POST123", creationTimeMs: now })],
      }),
    );
    expect(loser.decision).toBe("rejected");
    const winner = scoreSubmission(
      baseInput({
        submissionId: "s_aaa",
        platformPostId: "POST123",
        submissionCreationTimeMs: now,
        peers: [peer({ submissionId: "s_zzz", platform: "tiktok", platformPostId: "POST123", creationTimeMs: now })],
      }),
    );
    expect(winner.decision).toBe("approved");
  });
  it("sets dupCheck insufficient_id when neither id nor url present", () => {
    const r = scoreSubmission(baseInput({ platformPostId: undefined, normalizedPostUrl: undefined }));
    expect(r.signals.dupCheck).toBe("insufficient_id");
    expect(r.decision).toBe("approved");
  });
  it("soft-flags a shared-source cluster at dupSourceClusterMax", () => {
    const r = scoreSubmission(
      baseInput({
        submitterWallet: "W1",
        sourceKey: "yt:abc",
        config: defaultConfig({ dupSourceClusterMax: 3 }),
        peers: [
          peer({ submitterWallet: "W1", sourceKey: "yt:abc", campaignSame: true }),
          peer({ submitterWallet: "W1", sourceKey: "yt:abc", campaignSame: true }),
          peer({ submitterWallet: "W1", sourceKey: "yt:abc", campaignSame: true }),
        ],
      }),
    );
    expect(r.decision).toBe("approved");
    expect(r.signals.softFlags).toContain("duplicate:shared_source_cluster");
  });
  it("does NOT count cluster peers from other wallets or other campaigns", () => {
    const r = scoreSubmission(
      baseInput({
        submitterWallet: "W1",
        sourceKey: "yt:abc",
        config: defaultConfig({ dupSourceClusterMax: 3 }),
        peers: [
          peer({ submitterWallet: "W1", sourceKey: "yt:abc", campaignSame: true }),
          peer({ submitterWallet: "W2", sourceKey: "yt:abc", campaignSame: true }),
          peer({ submitterWallet: "W1", sourceKey: "yt:abc", campaignSame: false }),
        ],
      }),
    );
    expect(r.signals.softFlags).not.toContain("duplicate:shared_source_cluster");
  });
});

describe("scoreSubmission — precedence", () => {
  it("immature beats a would-fail velocity (defer wins)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: ok({ views: 5_000_000 }),
        postedAtMs: now - 1 * HOUR,
        config: defaultConfig({ maturationHours: 48 }),
      }),
    );
    expect(r.decision).toBe("defer");
    expect(r.reason).toBe("immature");
  });
  it("duplicate beats good metrics (rejected wins over approve)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: ok({ views: 100_000, likes: 5000 }),
        platformPostId: "POST123",
        submissionCreationTimeMs: now,
        peers: [peer({ platform: "tiktok", platformPostId: "POST123", creationTimeMs: now - 5 * HOUR })],
      }),
    );
    expect(r.decision).toBe("rejected");
    expect(r.reason).toBe("duplicate:platform_post_id");
  });
  it("velocity hard reject beats engagement (first hard-reject reason wins)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        analytics: ok({ views: 5_000_000, likes: 0 }),
        postedAtMs: now - 1 * HOUR,
        config: defaultConfig({ maturationHours: 0 }),
      }),
    );
    expect(r.decision).toBe("rejected");
    expect(r.reason).toBe("velocity:impossible_view_rate");
  });
});

describe("scoreSubmission — proxy metrics are not priced as views (money-correctness)", () => {
  it("facebook reach 200k matured → manual_review, viewCount 0 (NOT approved 200000)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({ platform: "facebook", analytics: ok({ reach: 200_000 }), postedAtMs: now - 60 * HOUR }),
    );
    expect(r.decision).toBe("manual_review");
    expect(r.reason).toBe("proxy_metric_review");
    expect(r.viewCount).toBe(0);
  });
  it("X impressions (a real view-like metric) still auto-approves at full count", () => {
    const r = scoreSubmission(baseInput({ platform: "x", analytics: ok({ impressions: 200_000 }) }));
    expect(r.signals.viewField).toBe("impressions");
    expect(r.decision).toBe("approved");
    expect(r.viewCount).toBe(200_000);
  });
  it("a DUPLICATE proxy post still HARD-REJECTS (duplicate gate precedes the proxy check)", () => {
    const now = baseInput().nowMs;
    const r = scoreSubmission(
      baseInput({
        platform: "facebook",
        analytics: ok({ reach: 200_000 }),
        platformPostId: "FBPOST",
        submissionCreationTimeMs: now,
        peers: [peer({ platform: "facebook", platformPostId: "FBPOST", creationTimeMs: now - 5 * HOUR })],
      }),
    );
    expect(r.decision).toBe("rejected");
    expect(r.reason).toBe("duplicate:platform_post_id");
  });
});

describe("scoreSubmission — distinct youtube posts do NOT collide via normalized url", () => {
  it("the later of two DISTINCT youtube videos (different ?v=) is approved, not duplicate", () => {
    const now = baseInput().nowMs;
    const mine = normalizePostUrl("https://www.youtube.com/watch?v=AAA");
    const theirs = normalizePostUrl("https://www.youtube.com/watch?v=BBB");
    const r = scoreSubmission(
      baseInput({
        platform: "youtube",
        analytics: ok({ views: 1000 }),
        platformPostId: "yt_AAA",
        normalizedPostUrl: mine,
        submissionCreationTimeMs: now,
        peers: [
          peer({
            platform: "youtube",
            platformPostId: "yt_BBB",
            normalizedPostUrl: theirs,
            creationTimeMs: now - 5 * HOUR,
          }),
        ],
      }),
    );
    expect(r.decision).toBe("approved");
  });
});
