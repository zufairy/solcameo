/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { recordDailyActivity, epochDay } from "./analytics";

const modules = import.meta.glob("./**/*.ts");

describe("analytics DAU + login tracking", () => {
  it("dedupes DAU per user per day, counts opens, logins, and new users", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const day = epochDay(now);

    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { supabaseId: "did:test:1", status: "active", createdAt: now, lastSeenAt: now }),
    );

    // First open of the day for a brand-new user → DAU +1, newUsers +1.
    await t.run(async (ctx) => recordDailyActivity(ctx, userId, now, true));
    // Second open same day → must NOT add a new DAU, just bump opens.
    await t.run(async (ctx) => recordDailyActivity(ctx, userId, now + 1000, false));

    const stats1 = await t.run(async (ctx) =>
      ctx.db.query("dailyStats").withIndex("by_day", (q) => q.eq("day", day)).unique(),
    );
    expect(stats1!.activeUsers).toBe(1); // deduped — one unique user
    expect(stats1!.newUsers).toBe(1);
    expect(stats1!.logins).toBe(0); // opening ≠ logging in

    const act = await t.run(async (ctx) =>
      ctx.db.query("dailyActivity").withIndex("by_user_and_day", (q) => q.eq("userId", userId).eq("day", day)).unique(),
    );
    expect(act!.opens).toBe(2);
    expect(act!.loggedIn).toBe(false);

    // A real login event for that same user/day.
    await t.mutation(internal.analytics.recordLoginInternal, { userId, ts: now });
    const stats2 = await t.run(async (ctx) =>
      ctx.db.query("dailyStats").withIndex("by_day", (q) => q.eq("day", day)).unique(),
    );
    expect(stats2!.logins).toBe(1);
    expect(stats2!.activeUsers).toBe(1); // login of an already-active user doesn't double-count DAU
    const act2 = await t.run(async (ctx) =>
      ctx.db.query("dailyActivity").withIndex("by_user_and_day", (q) => q.eq("userId", userId).eq("day", day)).unique(),
    );
    expect(act2!.loggedIn).toBe(true);

    // computeAnalytics surfaces the right series + summary for today.
    const analytics = await t.query(internal.analytics.computeAnalytics, { days: 7 });
    const today = analytics.series[analytics.series.length - 1];
    expect(today.activeUsers).toBe(1);
    expect(today.logins).toBe(1);
    expect(today.newUsers).toBe(1);
    expect(analytics.summary.dauToday).toBe(1);
    expect(analytics.summary.loginsToday).toBe(1);
    expect(analytics.summary.wau).toBe(1);
    expect(analytics.summary.mau).toBe(1);
    expect(analytics.summary.totalUsers).toBe(1);
    expect(analytics.series).toHaveLength(7); // gap-filled to the full window
  });

  it("counts two distinct users as DAU 2", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const day = epochDay(now);
    const u1 = await t.run(async (ctx) =>
      ctx.db.insert("users", { supabaseId: "did:a", status: "active", createdAt: now, lastSeenAt: now }),
    );
    const u2 = await t.run(async (ctx) =>
      ctx.db.insert("users", { supabaseId: "did:b", status: "active", createdAt: now, lastSeenAt: now }),
    );
    await t.run(async (ctx) => recordDailyActivity(ctx, u1, now, true));
    await t.run(async (ctx) => recordDailyActivity(ctx, u2, now, true));

    const stats = await t.run(async (ctx) =>
      ctx.db.query("dailyStats").withIndex("by_day", (q) => q.eq("day", day)).unique(),
    );
    expect(stats!.activeUsers).toBe(2);
    expect(stats!.newUsers).toBe(2);
  });

  it("buckets activity on different days into separate DAU rows", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const yesterday = now - 86_400_000;
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { supabaseId: "did:c", status: "active", createdAt: yesterday, lastSeenAt: now }),
    );
    await t.run(async (ctx) => recordDailyActivity(ctx, userId, yesterday, true));
    await t.run(async (ctx) => recordDailyActivity(ctx, userId, now, false));

    const rows = await t.run(async (ctx) =>
      ctx.db.query("dailyActivity").withIndex("by_user_and_day", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(2); // one row per day

    const analytics = await t.query(internal.analytics.computeAnalytics, { days: 7 });
    expect(analytics.summary.dauToday).toBe(1);
    expect(analytics.summary.wau).toBe(1); // same user, still 1 distinct in the window
    expect(analytics.summary.newUsersInRange).toBe(1); // signup counted once (yesterday)
  });
});

describe("analytics videos posted by platform", () => {
  it("aggregates posted clips per platform per day, normalizes twitter→x, excludes non-posted", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("clipJobs", { mintAddress: "M", sourceUrl: "u", sourceType: "url", status: "completed", createdAt: now, updatedAt: now }),
    );
    const mkClip = (platform: string | undefined, status: string, postedAt?: number) =>
      t.run(async (ctx) =>
        ctx.db.insert("clips", {
          jobId, mintAddress: "M", title: "t", reason: "r", startSeconds: 0, endSeconds: 1,
          viralScore: 50, captionText: "c", status, platform, postedAt, createdAt: now, updatedAt: now,
        }),
      );

    await mkClip("tiktok", "posted", now);
    await mkClip("tiktok", "posted", now);
    await mkClip("instagram", "posted", now);
    await mkClip("twitter", "posted", now);   // normalizes to "x"
    await mkClip("youtube", "rendering", now); // not posted → excluded
    await mkClip("facebook", "posted", undefined); // no postedAt → excluded

    const a = await t.query(internal.analytics.computeAnalytics, { days: 7 });
    expect(a.totalVideosPosted).toBe(4);
    expect(a.platformTotals.tiktok).toBe(2);
    expect(a.platformTotals.instagram).toBe(1);
    expect(a.platformTotals.x).toBe(1);
    expect(a.platformTotals.youtube ?? 0).toBe(0); // not posted
    expect(a.platformTotals.facebook ?? 0).toBe(0); // no postedAt
    expect(a.platforms[0]).toBe("tiktok"); // ordered by volume desc

    const today = a.platformSeries[a.platformSeries.length - 1];
    expect(today.tiktok).toBe(2);
    expect(today.instagram).toBe(1);
    expect(today.x).toBe(1);
    expect(today.total).toBe(4);
    expect(a.platformSeries).toHaveLength(7); // gap-filled window
  });
});
