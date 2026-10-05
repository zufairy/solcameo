import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/* Platform-wide totals for the /agents hero stat row — realtime.
 *
 * clips / submissions / distributions / usageLedger / videoRenderJobs are all
 * past the 16,384-doc per-query read limit, so the totals are split in two:
 *
 *  1. Baseline — `refresh` (hourly cron) walks each table page by page (every
 *     page is its own query, so no single read hits the limit) and stores one
 *     "global" row covering rows created at or before its start (`updatedAt`).
 *  2. Live delta — `live` adds everything created AFTER that cutoff via the
 *     built-in by_creation_time index, so it only reads the last hour's rows
 *     and Convex re-runs it the moment a new video / charge lands. View growth
 *     on older posts is an update, not an insert, so the view-sync mutations
 *     bump `viewsDelta` instead (bumpLiveViews).
 *
 * The next refresh folds the deltas into a fresh baseline. */

const PAGE = 1000;
/** Per-table cap on the live delta scan — an hour of rows is far below this. */
const LIVE_SCAN = 4000;

const clipCountsAsVideo = (c: Doc<"clips">) => !!c.clipUrl && c.status !== "failed";
const renderCountsAsVideo = (r: Doc<"videoRenderJobs">) => !!r.videoUrl && r.phase !== "failed";
/** "Total Volume" = every real USDC dollar ever transacted through Vello, both
 *  directions:
 *   - money owners spent USING the platform (usageLedger.costUsdc — renders,
 *     posts, clips), minus rows voided by a refund;
 *   - money Vello paid OUT to creators (distributions.totalPayoutUsdc —
 *     campaign, content-reward and hire payouts; the single source of truth
 *     for all three, see influencers.addEarnings / submissions.ts).
 *  `status: "pending"` on a distribution hasn't settled yet, so it isn't
 *  counted as transacted. Campaign escrow payouts alone (`distributions`
 *  filtered to source "campaign") are real but still small — on-chain payouts
 *  aren't live yet (see the escrow-program-undeployed note) — so counting
 *  ONLY that badly undersold total platform volume; the usage side is where
 *  almost all of the real transacted money already is. */
const usageVolume = (u: Doc<"usageLedger">) => (u.settledBatchId?.startsWith("refund:") ? 0 : u.costUsdc);
const distributionVolume = (d: Doc<"distributions">) => (d.status === "pending" ? 0 : d.totalPayoutUsdc);

/** Views per post, keyed by post URL so a clip and the submission recording
 *  the same post count once (max wins). Rows without a post URL have nothing
 *  to collide with and are summed as-is under `loose`. */
export const pageClips = internalQuery({
  args: { paginationOpts: paginationOptsValidator, cutoff: v.number() },
  handler: async (ctx, { paginationOpts, cutoff }) => {
    const res = await ctx.db.query("clips").paginate(paginationOpts);
    const views: [string, number][] = [];
    let loose = 0;
    let videos = 0;
    for (const c of res.page) {
      if (c._creationTime <= cutoff && clipCountsAsVideo(c)) videos++;
      if (c.viewCount == null) continue;
      if (c.postUrl) views.push([c.postUrl, c.viewCount]);
      else loose += c.viewCount;
    }
    return { views, loose, videos, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const pageSubmissions = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const res = await ctx.db.query("submissions").paginate(paginationOpts);
    const views: [string, number][] = [];
    for (const s of res.page) {
      if (s.postUrl && s.viewCount != null) views.push([s.postUrl, s.viewCount]);
    }
    return { views, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const pageRenders = internalQuery({
  args: { paginationOpts: paginationOptsValidator, cutoff: v.number() },
  handler: async (ctx, { paginationOpts, cutoff }) => {
    const res = await ctx.db.query("videoRenderJobs").paginate(paginationOpts);
    const videos = res.page.filter((r) => r._creationTime <= cutoff && renderCountsAsVideo(r)).length;
    return { videos, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const pageDistributions = internalQuery({
  args: { paginationOpts: paginationOptsValidator, cutoff: v.number() },
  handler: async (ctx, { paginationOpts, cutoff }) => {
    const res = await ctx.db.query("distributions").paginate(paginationOpts);
    let volume = 0;
    for (const d of res.page) if (d._creationTime <= cutoff) volume += distributionVolume(d);
    return { volume, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const pageUsage = internalQuery({
  args: { paginationOpts: paginationOptsValidator, cutoff: v.number() },
  handler: async (ctx, { paginationOpts, cutoff }) => {
    const res = await ctx.db.query("usageLedger").paginate(paginationOpts);
    let volume = 0;
    for (const u of res.page) if (u._creationTime <= cutoff) volume += usageVolume(u);
    return { volume, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

export const save = internalMutation({
  args: { totalViews: v.number(), totalVolumeUsdc: v.number(), videosGenerated: v.number(), cutoff: v.number() },
  handler: async (ctx, { cutoff, ...totals }) => {
    const row = { key: "global", ...totals, updatedAt: cutoff, viewsDelta: 0 };
    const existing = await ctx.db.query("platformStats").withIndex("by_key", (q) => q.eq("key", "global")).first();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("platformStats", row);
  },
});

export const refresh = internalAction({
  args: {},
  handler: async (ctx) => {
    // Cutoff = start of the walk: rows created mid-walk belong to the live
    // delta, not the baseline, so nothing is counted twice.
    const cutoff = Date.now();
    const viewsByPost = new Map<string, number>();
    const addViews = (pairs: [string, number][]) => {
      for (const [url, n] of pairs) viewsByPost.set(url, Math.max(viewsByPost.get(url) ?? 0, n));
    };
    let looseViews = 0;
    let videos = 0;
    let volume = 0;

    let cursor: string | null = null;
    for (;;) {
      const r: { views: [string, number][]; loose: number; videos: number; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.platformStats.pageClips, { paginationOpts: { numItems: PAGE, cursor }, cutoff });
      addViews(r.views);
      looseViews += r.loose;
      videos += r.videos;
      if (r.isDone) break;
      cursor = r.continueCursor;
    }

    cursor = null;
    for (;;) {
      const r: { views: [string, number][]; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.platformStats.pageSubmissions, { paginationOpts: { numItems: PAGE, cursor } });
      addViews(r.views);
      if (r.isDone) break;
      cursor = r.continueCursor;
    }

    cursor = null;
    for (;;) {
      const r: { videos: number; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.platformStats.pageRenders, { paginationOpts: { numItems: PAGE, cursor }, cutoff });
      videos += r.videos;
      if (r.isDone) break;
      cursor = r.continueCursor;
    }

    cursor = null;
    for (;;) {
      const r: { volume: number; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.platformStats.pageDistributions, { paginationOpts: { numItems: PAGE, cursor }, cutoff });
      volume += r.volume;
      if (r.isDone) break;
      cursor = r.continueCursor;
    }

    cursor = null;
    for (;;) {
      const r: { volume: number; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.platformStats.pageUsage, { paginationOpts: { numItems: PAGE, cursor }, cutoff });
      volume += r.volume;
      if (r.isDone) break;
      cursor = r.continueCursor;
    }

    let totalViews = looseViews;
    for (const n of viewsByPost.values()) totalViews += n;
    await ctx.runMutation(internal.platformStats.save, {
      totalViews,
      totalVolumeUsdc: +volume.toFixed(2),
      videosGenerated: videos,
      cutoff,
    });
    return { totalViews, totalVolumeUsdc: volume, videosGenerated: videos };
  },
});

/** Called from the view-sync mutations with how much a post's count grew, so
 *  the hero's view total ticks between refreshes. No-op before the first
 *  refresh (nothing to add to yet). */
export async function bumpLiveViews(ctx: MutationCtx, delta: number) {
  if (!(delta > 0)) return;
  const row = await ctx.db.query("platformStats").withIndex("by_key", (q) => q.eq("key", "global")).first();
  if (row) await ctx.db.patch(row._id, { viewsDelta: (row.viewsDelta ?? 0) + delta });
}

/** Realtime totals: hourly baseline + everything created since it. null
 *  until the first refresh has run. */
export const live = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("platformStats").withIndex("by_key", (q) => q.eq("key", "global")).first();
    if (!row) return null;
    const since = row.updatedAt;
    const [clips, renders, distributions, usage] = await Promise.all([
      ctx.db.query("clips").withIndex("by_creation_time", (q) => q.gt("_creationTime", since)).take(LIVE_SCAN),
      ctx.db.query("videoRenderJobs").withIndex("by_creation_time", (q) => q.gt("_creationTime", since)).take(LIVE_SCAN),
      ctx.db.query("distributions").withIndex("by_creation_time", (q) => q.gt("_creationTime", since)).take(LIVE_SCAN),
      ctx.db.query("usageLedger").withIndex("by_creation_time", (q) => q.gt("_creationTime", since)).take(LIVE_SCAN),
    ]);
    const liveVolume =
      distributions.reduce((s, d) => s + distributionVolume(d), 0) + usage.reduce((s, u) => s + usageVolume(u), 0);
    return {
      totalViews: row.totalViews + (row.viewsDelta ?? 0),
      totalVolumeUsdc: +(row.totalVolumeUsdc + liveVolume).toFixed(2),
      videosGenerated: row.videosGenerated + clips.filter(clipCountsAsVideo).length + renders.filter(renderCountsAsVideo).length,
    };
  },
});

/** Views this week — every view on a post Vello's agents published in the
 *  last 7 days (clips + submissions, deduped by post URL, max wins — same
 *  rules as the all-time total). `since` comes from the client rounded down
 *  to the hour, so the args stay stable and the subscription stays cached
 *  instead of re-running on every render. A week of rows is far below the
 *  per-query read limit; LIVE_SCAN caps it anyway. Reactive: view-sync
 *  patches viewCount on these rows, so the counter ticks as views land. */
export const weekViews = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const [clips, submissions] = await Promise.all([
      ctx.db.query("clips").withIndex("by_creation_time", (q) => q.gt("_creationTime", since)).take(LIVE_SCAN),
      ctx.db.query("submissions").withIndex("by_creation_time", (q) => q.gt("_creationTime", since)).take(LIVE_SCAN),
    ]);
    const viewsByPost = new Map<string, number>();
    let loose = 0;
    for (const row of [...clips, ...submissions]) {
      if (row.viewCount == null) continue;
      if (row.postUrl) viewsByPost.set(row.postUrl, Math.max(viewsByPost.get(row.postUrl) ?? 0, row.viewCount));
      else loose += row.viewCount;
    }
    let views = loose;
    for (const n of viewsByPost.values()) views += n;
    return { views };
  },
});
