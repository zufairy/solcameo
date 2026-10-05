// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  resolveOracleThresholds,
  toPostMetrics,
  toAnalyticsInput,
  toPeer,
  signalsScoreHash,
} from "./oracleRun";
import { normalizePostUrl } from "./oracleFraud";
import type { PostAnalyticsResult } from "./uploadPost";

/** Build a process-env-shaped object for the pure threshold resolver under test. */
const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

describe("resolveOracleThresholds", () => {
  it("returns all defaults for an empty env", () => {
    const t = resolveOracleThresholds(env({}));
    expect(t).toEqual({
      maturationHours: 48,
      settleDeadlineHours: 168,
      maxViewsPerHour: 500_000,
      velocityMinViews: 50_000,
      velocityHardMultiple: 4,
      engagementMinViews: 10_000,
      engagementMinRatio: 0.001,
      engagementHardViews: 25_000,
      dupSourceClusterMax: 5,
    });
  });

  it("parses a numeric override", () => {
    const t = resolveOracleThresholds(env({ ORACLE_MATURATION_HOURS: "24" }));
    expect(t.maturationHours).toBe(24);
    // untouched keys keep their default
    expect(t.settleDeadlineHours).toBe(168);
  });

  it("falls back to the default for a non-numeric value", () => {
    const t = resolveOracleThresholds(env({ ORACLE_MAX_VIEWS_PER_HOUR: "notanumber" }));
    expect(t.maxViewsPerHour).toBe(500_000);
  });

  it("falls back to the default for an empty-string value", () => {
    const t = resolveOracleThresholds(env({ ORACLE_VELOCITY_MIN_VIEWS: "" }));
    expect(t.velocityMinViews).toBe(50_000);
  });

  it("accepts an explicit zero override", () => {
    const t = resolveOracleThresholds(env({ ORACLE_DUP_SOURCE_CLUSTER_MAX: "0" }));
    expect(t.dupSourceClusterMax).toBe(0);
  });
});

describe("toPostMetrics", () => {
  it("keeps only known numeric keys", () => {
    const out = toPostMetrics({
      views: 1000,
      impressions: 5,
      plays: 7,
      reach: 9,
      score: 3,
      likes: 11,
      comments: 12,
      shares: 13,
      saves: 14,
    });
    expect(out).toEqual({
      views: 1000,
      impressions: 5,
      plays: 7,
      reach: 9,
      score: 3,
      likes: 11,
      comments: 12,
      shares: 13,
      saves: 14,
    });
  });

  it("drops unknown keys", () => {
    const out = toPostMetrics({ views: 1000, foo: 99, watch_time: 42 } as Record<string, number>);
    expect(out).toEqual({ views: 1000 });
    expect("foo" in out).toBe(false);
  });

  it("drops non-finite values (NaN / Infinity)", () => {
    const out = toPostMetrics({ views: NaN, likes: Infinity, comments: 5 });
    expect(out).toEqual({ comments: 5 });
  });

  it("drops non-number values", () => {
    const out = toPostMetrics({ views: "1000" as unknown as number, likes: 5 });
    expect(out).toEqual({ likes: 5 });
  });

  it("preserves a present zero (real zero, never coerced away)", () => {
    const out = toPostMetrics({ views: 0, likes: 0 });
    expect(out).toEqual({ views: 0, likes: 0 });
  });
});

describe("toAnalyticsInput", () => {
  it("maps an ok result to status ok with filtered metrics + ids", () => {
    const r: PostAnalyticsResult = {
      ok: true,
      metrics: { views: 1000, foo: 99 } as Record<string, number>,
      platformPostId: "pid_1",
      postUrl: "https://tiktok.com/@a/video/1",
    };
    const out = toAnalyticsInput(r);
    expect(out).toEqual({
      status: "ok",
      metrics: { views: 1000 },
      platformPostId: "pid_1",
      postUrl: "https://tiktok.com/@a/video/1",
    });
  });

  it("maps not_ready to status error", () => {
    expect(toAnalyticsInput({ ok: false, reason: "not_ready" })).toEqual({ status: "error", error: "not_ready" });
  });

  it("maps not_found to status error", () => {
    expect(toAnalyticsInput({ ok: false, reason: "not_found" })).toEqual({ status: "error", error: "not_found" });
  });

  it("maps error to status error", () => {
    expect(toAnalyticsInput({ ok: false, reason: "error" })).toEqual({ status: "error", error: "error" });
  });

  it("maps unsupported to status unsupported", () => {
    expect(toAnalyticsInput({ ok: false, reason: "unsupported" })).toEqual({ status: "unsupported" });
  });
});

describe("toPeer", () => {
  it("maps fields, normalizes the post url, sets campaignSame true", () => {
    const peer = toPeer({
      _id: "sub_2",
      _creationTime: 1234,
      status: "submitted",
      platform: "tiktok",
      platformPostId: "pid_2",
      postUrl: "https://www.TikTok.com/@a/video/2?utm=x#frag",
      submitterWallet: "WalletB",
    });
    expect(peer).toEqual({
      submissionId: "sub_2",
      creationTimeMs: 1234,
      status: "submitted",
      platform: "tiktok",
      platformPostId: "pid_2",
      normalizedPostUrl: normalizePostUrl("https://www.TikTok.com/@a/video/2?utm=x#frag"),
      submitterWallet: "WalletB",
      campaignSame: true,
      sourceKey: undefined,
    });
  });

  it("maps null platform / platformPostId / postUrl to undefined", () => {
    const peer = toPeer({
      _id: "sub_3",
      _creationTime: 5678,
      status: "pending",
      platform: null,
      platformPostId: null,
      postUrl: null,
      submitterWallet: "WalletC",
    });
    expect(peer.platform).toBeUndefined();
    expect(peer.platformPostId).toBeUndefined();
    expect(peer.normalizedPostUrl).toBeUndefined();
    expect(peer.campaignSame).toBe(true);
    expect(peer.submitterWallet).toBe("WalletC");
  });

  it("leaves normalizedPostUrl undefined when postUrl is absent", () => {
    const peer = toPeer({
      _id: "sub_4",
      _creationTime: 1,
      status: "submitted",
      submitterWallet: "WalletD",
    });
    expect(peer.normalizedPostUrl).toBeUndefined();
  });
});

describe("signalsScoreHash", () => {
  it("is deterministic for the same input", () => {
    const a = signalsScoreHash({ softFlags: ["x"], skips: [], viewField: "views" });
    const b = signalsScoreHash({ softFlags: ["x"], skips: [], viewField: "views" });
    expect(a).toBe(b);
  });

  it("differs for different input", () => {
    const a = signalsScoreHash({ softFlags: ["x"], skips: [] });
    const b = signalsScoreHash({ softFlags: ["y"], skips: [] });
    expect(a).not.toBe(b);
  });

  it("returns a 64-char hex sha256 digest", () => {
    const h = signalsScoreHash({ softFlags: [], skips: [] });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
