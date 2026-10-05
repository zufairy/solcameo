import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { verifyToken } from "./lib/supabaseAuth";
import { resolveAdmin } from "./admin";

// ─────────────────────────────────────────────────────────────────────────────
// Product analytics — Daily Active Users (DAU) + daily logins, plus the summary
// metrics an admin needs (WAU/MAU, stickiness, signups, peak/avg).
//
// Tracking model (all bucketed by UTC day):
//   • "Active" (DAU)  — any time a signed-in user opens the platform. The signal
//     is `whoami`, which runs on every page load with a session (see
//     users.upsertFromSupabase → recordDailyActivity). Deduped per user per day.
//   • "Login"         — a fresh authentication. The signal is Privy's `useLogin`
//     onComplete on the client → `recordLoginEvent` action. Counts every login
//     event (a user can log in more than once a day).
//   • "New user"      — first-ever signup, flagged by upsertFromSupabase.
//
// DAU here is signed-in users (the meaningful "users" metric for admins). Raw,
// anonymous pageview traffic is covered separately by Google Analytics (gtag).
// ─────────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** UTC epoch-day for a millisecond timestamp (consecutive days differ by 1). */
export function epochDay(ts: number): number {
  return Math.floor(ts / MS_PER_DAY);
}

/** ISO date (YYYY-MM-DD, UTC) for an epoch-day — used for chart labels. */
function epochDayToISO(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Short axis label, e.g. "Jul 1" (UTC), for an epoch-day. */
function epochDayToLabel(day: number): string {
  return new Date(day * MS_PER_DAY).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The social platforms a clip can be posted to (upload-post ids). Matches
 *  lib/server/socialTargeting.ts UPLOAD_POST_PLATFORMS. */
const CANONICAL_PLATFORMS = ["tiktok", "instagram", "youtube", "facebook", "linkedin", "x", "threads"] as const;

/** Normalize a stored clip platform to a canonical id ("twitter" → "x"); unknown
 *  / empty values fold into "other" so every posted video is still counted. */
function normalizePlatform(p?: string): string {
  if (!p) return "other";
  let s = p.toLowerCase().trim();
  if (s === "twitter") s = "x";
  return (CANONICAL_PLATFORMS as readonly string[]).includes(s) ? s : "other";
}

/** Read-modify-write the single per-day rollup row. Counters only ever increase
 *  by small, infrequent deltas (activeUsers/newUsers once per user per day,
 *  logins once per login) so single-doc contention stays low. */
async function bumpDailyStats(
  ctx: MutationCtx,
  day: number,
  delta: { activeUsers?: number; logins?: number; newUsers?: number },
): Promise<void> {
  const row = await ctx.db
    .query("dailyStats")
    .withIndex("by_day", (q) => q.eq("day", day))
    .unique();
  if (!row) {
    await ctx.db.insert("dailyStats", {
      day,
      activeUsers: delta.activeUsers ?? 0,
      logins: delta.logins ?? 0,
      newUsers: delta.newUsers ?? 0,
    });
    return;
  }
  await ctx.db.patch(row._id, {
    activeUsers: row.activeUsers + (delta.activeUsers ?? 0),
    logins: row.logins + (delta.logins ?? 0),
    newUsers: row.newUsers + (delta.newUsers ?? 0),
  });
}

/**
 * Record that a signed-in user opened the platform. Called from
 * `users.upsertFromSupabase` (which runs on every `whoami`). Inserting the first
 * row for (user, day) is what increments DAU; later opens that day just bump the
 * per-user counter, so DAU is never double-counted.
 */
export async function recordDailyActivity(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number,
  isNewUser: boolean,
): Promise<void> {
  const day = epochDay(now);
  const existing = await ctx.db
    .query("dailyActivity")
    .withIndex("by_user_and_day", (q) => q.eq("userId", userId).eq("day", day))
    .unique();
  if (!existing) {
    await ctx.db.insert("dailyActivity", {
      userId,
      day,
      firstSeenAt: now,
      lastSeenAt: now,
      opens: 1,
      loggedIn: false,
    });
    await bumpDailyStats(ctx, day, { activeUsers: 1, newUsers: isNewUser ? 1 : 0 });
    return;
  }
  await ctx.db.patch(existing._id, { lastSeenAt: now, opens: existing.opens + 1 });
}

/** Record a fresh login. A login implies activity, so this also ensures the
 *  user's daily-activity row exists (bumping DAU if it didn't). */
async function recordDailyLogin(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number,
): Promise<void> {
  const day = epochDay(now);
  const existing = await ctx.db
    .query("dailyActivity")
    .withIndex("by_user_and_day", (q) => q.eq("userId", userId).eq("day", day))
    .unique();
  if (!existing) {
    await ctx.db.insert("dailyActivity", {
      userId,
      day,
      firstSeenAt: now,
      lastSeenAt: now,
      opens: 1,
      loggedIn: true,
    });
    await bumpDailyStats(ctx, day, { activeUsers: 1, logins: 1 });
    return;
  }
  if (!existing.loggedIn) {
    await ctx.db.patch(existing._id, { loggedIn: true, lastSeenAt: now });
  } else {
    await ctx.db.patch(existing._id, { lastSeenAt: now });
  }
  await bumpDailyStats(ctx, day, { logins: 1 });
}

export const recordLoginInternal = internalMutation({
  args: { userId: v.id("users"), ts: v.number() },
  handler: async (ctx, { userId, ts }) => {
    await recordDailyLogin(ctx, userId, ts);
    return null;
  },
});

/** Public: the client calls this from Privy's login `onComplete`. Verifies the
 *  session, resolves the user, and records one login event. Fail-safe — a
 *  tracking error must never block the user's session. */
export const recordLoginEvent = action({
  args: { accessToken: v.string() },
  handler: async (ctx: ActionCtx, { accessToken }): Promise<{ ok: boolean }> => {
    try {
      const { supabaseId } = await verifyToken(accessToken);
      const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
      if (!user) return { ok: false };
      await ctx.runMutation(internal.analytics.recordLoginInternal, {
        userId: user._id,
        ts: Date.now(),
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },
});

// ── Admin read side ──────────────────────────────────────────────────────────

export type AnalyticsPoint = {
  day: number;
  date: string;
  label: string;
  activeUsers: number;
  logins: number;
  newUsers: number;
};

/** One per-day row for the videos-posted-per-platform chart. Each platform
 *  present in the range becomes a numeric key (e.g. `tiktok: 4`) plus `total`. */
export type PlatformPoint = {
  day: number;
  date: string;
  label: string;
  total: number;
  [platform: string]: number | string;
};

export type AdminAnalytics = {
  rangeDays: number;
  /** UTC. DAU/logins are bucketed by UTC calendar day. */
  timezone: "UTC";
  series: AnalyticsPoint[];
  /** Platforms present in the range, ordered by total volume (desc). */
  platforms: string[];
  /** Per-day posted-video counts, one numeric key per platform. */
  platformSeries: PlatformPoint[];
  /** Total posted videos per platform over the range. */
  platformTotals: Record<string, number>;
  /** Total posted videos (all platforms) over the range. */
  totalVideosPosted: number;
  summary: {
    dauToday: number;
    loginsToday: number;
    newUsersToday: number;
    /** Distinct active users in the last 7 / 30 days. */
    wau: number;
    mau: number;
    /** DAU/MAU — how "sticky" the product is (higher = more habitual use). */
    stickiness: number;
    avgDau: number;
    peakDau: number;
    peakDauDate: string;
    totalLoginsInRange: number;
    newUsersInRange: number;
    totalUsers: number;
    /** Videos generated today (UTC): rendered clips + agent video render jobs. */
    videosGeneratedToday: number;
    /** Total generation spend today (UTC), USD — sum of usageLedger.costUsdc. */
    costTodayUsd: number;
  };
};

// Hard cap so a window scan can't blow up at scale (admin-only; surfaced as a
// note in the UI if ever hit).
const WINDOW_SCAN_CAP = 50_000;

/** Distinct active users since `sinceDay` (inclusive), capped for safety. */
async function distinctActiveSince(ctx: QueryCtx, sinceDay: number): Promise<number> {
  const rows = await ctx.db
    .query("dailyActivity")
    .withIndex("by_day", (q) => q.gte("day", sinceDay))
    .take(WINDOW_SCAN_CAP);
  const seen = new Set<string>();
  for (const r of rows) seen.add(r.userId);
  return seen.size;
}

export const computeAnalytics = internalQuery({
  args: { days: v.number() },
  handler: async (ctx, { days }): Promise<AdminAnalytics> => {
    const rangeDays = Math.max(1, Math.min(365, Math.floor(days)));
    const today = epochDay(Date.now());
    const startDay = today - (rangeDays - 1);

    // O(rangeDays) rollup rows for the chart.
    const statRows = await ctx.db
      .query("dailyStats")
      .withIndex("by_day", (q) => q.gte("day", startDay))
      .take(rangeDays + 1);
    const byDay = new Map<number, { activeUsers: number; logins: number; newUsers: number }>();
    for (const s of statRows) byDay.set(s.day, s);

    const series: AnalyticsPoint[] = [];
    let totalLoginsInRange = 0;
    let newUsersInRange = 0;
    let peakDau = 0;
    let peakDayNum = today;
    for (let d = startDay; d <= today; d++) {
      const s = byDay.get(d);
      const activeUsers = s?.activeUsers ?? 0;
      const logins = s?.logins ?? 0;
      const newUsers = s?.newUsers ?? 0;
      totalLoginsInRange += logins;
      newUsersInRange += newUsers;
      if (activeUsers > peakDau) {
        peakDau = activeUsers;
        peakDayNum = d;
      }
      series.push({
        day: d,
        date: epochDayToISO(d),
        label: epochDayToLabel(d),
        activeUsers,
        logins,
        newUsers,
      });
    }

    const todayStats = byDay.get(today);
    const avgDau =
      series.length > 0
        ? Math.round(series.reduce((sum, p) => sum + p.activeUsers, 0) / series.length)
        : 0;

    const wau = await distinctActiveSince(ctx, today - 6);
    const mau = await distinctActiveSince(ctx, today - 29);

    // Total users — there's no denormalized counter, so scan the (small) users
    // table, matching the existing admin.listUsersData pattern.
    const allUsers = await ctx.db.query("users").take(WINDOW_SCAN_CAP);
    const totalUsers = allUsers.length;

    const dauToday = todayStats?.activeUsers ?? 0;

    // ── Videos posted per platform per day ────────────────────────────────────
    // `clips` is the convergence point: every actually-posted video (clip pipeline
    // AND scheduled drip) lands here with a single resolved platform + postedAt.
    // Read posted clips in-range straight off the by_status_postedAt index.
    const rangeStartMs = startDay * MS_PER_DAY;
    const postedClips = await ctx.db
      .query("clips")
      .withIndex("by_status_postedAt", (q) => q.eq("status", "posted").gte("postedAt", rangeStartMs))
      .take(WINDOW_SCAN_CAP);

    const platformTotalsMap = new Map<string, number>();
    const dayPlatformCounts = new Map<number, Map<string, number>>();
    let totalVideosPosted = 0;
    for (const c of postedClips) {
      if (c.postedAt == null) continue;
      const d = epochDay(c.postedAt);
      if (d < startDay || d > today) continue;
      const plat = normalizePlatform(c.platform);
      platformTotalsMap.set(plat, (platformTotalsMap.get(plat) ?? 0) + 1);
      let dm = dayPlatformCounts.get(d);
      if (!dm) { dm = new Map(); dayPlatformCounts.set(d, dm); }
      dm.set(plat, (dm.get(plat) ?? 0) + 1);
      totalVideosPosted += 1;
    }
    // Order platforms by total volume (desc) so the busiest line is drawn first.
    const platforms = [...platformTotalsMap.keys()].sort(
      (a, b) => (platformTotalsMap.get(b) ?? 0) - (platformTotalsMap.get(a) ?? 0),
    );
    const platformSeries: PlatformPoint[] = [];
    for (let d = startDay; d <= today; d++) {
      const dm = dayPlatformCounts.get(d);
      const row: PlatformPoint = { day: d, date: epochDayToISO(d), label: epochDayToLabel(d), total: 0 };
      let dayTotal = 0;
      for (const plat of platforms) {
        const v = dm?.get(plat) ?? 0;
        row[plat] = v;
        dayTotal += v;
      }
      row.total = dayTotal;
      platformSeries.push(row);
    }
    const platformTotals: Record<string, number> = {};
    for (const [k, v] of platformTotalsMap) platformTotals[k] = v;

    // ── Generation volume + spend, today (UTC) ────────────────────────────────
    // "Videos generated" = rendered clips (clip pipeline; one row per clip, skip
    // failed/skipped) + agent videoRenderJobs started today. Both read off the
    // built-in _creationTime index so no schema change is needed.
    const todayStartMs = today * MS_PER_DAY;
    const clipsToday = await ctx.db
      .query("clips")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", todayStartMs))
      .take(WINDOW_SCAN_CAP);
    const renderJobsToday = await ctx.db
      .query("videoRenderJobs")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", todayStartMs))
      .take(WINDOW_SCAN_CAP);
    const videosGeneratedToday =
      clipsToday.filter((c) => c.status !== "failed" && c.status !== "skipped").length +
      renderJobsToday.length;

    // Cost = every usageLedger row written today (skill charges, task costs) —
    // the single billing chokepoint for all generation spend. `at` is stamped
    // Date.now() at insert, so _creationTime tracks it.
    const usageToday = await ctx.db
      .query("usageLedger")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", todayStartMs))
      .take(WINDOW_SCAN_CAP);
    const costTodayUsd = +usageToday
      .reduce((sum, r) => sum + (r.costUsdc > 0 ? r.costUsdc : 0), 0)
      .toFixed(2);

    return {
      rangeDays,
      timezone: "UTC",
      series,
      platforms,
      platformSeries,
      platformTotals,
      totalVideosPosted,
      summary: {
        dauToday,
        loginsToday: todayStats?.logins ?? 0,
        newUsersToday: todayStats?.newUsers ?? 0,
        wau,
        mau,
        stickiness: mau > 0 ? Math.round((dauToday / mau) * 1000) / 10 : 0,
        avgDau,
        peakDau,
        peakDauDate: epochDayToISO(peakDayNum),
        totalLoginsInRange,
        newUsersInRange,
        totalUsers,
        videosGeneratedToday,
        costTodayUsd,
      },
    };
  },
});

/** Admin-only: the DAU/login time series + summary for the analytics dashboard. */
export const getAdminAnalytics = action({
  args: { accessToken: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { accessToken, days }): Promise<AdminAnalytics> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.analytics.computeAnalytics, { days: days ?? 30 });
  },
});
