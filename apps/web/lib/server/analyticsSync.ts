import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { fetchUploadPostViews } from "@/lib/server/scraperService";
import { getRecentMedia, getPostAnalytics, resolveUsername, type RecentMediaItem } from "@/lib/server/uploadPost";

// String refs so this typechecks before `npx convex deploy` regenerates types.
const LIST_BY_CREATORS = makeFunctionReference<"query">("influencers:listByCreators");
// Pass 1: organic clips — the clip carries its OWN upload-post handle, so this
// is the only view-count path for a post with no campaign `submissions` row.
const CLIPS_DUE = makeFunctionReference<"query">("clipJobs:dueForScrapeByMints");
const CLIPS_RECORD = makeFunctionReference<"mutation">("clipJobs:recordViewCount");
// Pass 2: campaign submissions — a separate store (campaignId required there).
const SUBS_DUE = makeFunctionReference<"query">("submissions:dueForScrapeByMints");
const SUBS_RECORD = makeFunctionReference<"mutation">("submissions:recordScrapedViews");
// Pass 4: generated videos posted from the schedule (automatic 3-a-day X posts and manual drips), which have no clip row.
const SCHED_DUE = makeFunctionReference<"query">("scheduledContent:dueForViewSyncByMints");
const SCHED_RECORD = makeFunctionReference<"mutation">("scheduledContent:recordViews");

export { LIST_BY_CREATORS };

type DueRow = {
  _id: string;
  postUrl: string | null;
  platform: string;
  viewCount: number;
  uploadPostRequestId: string | null;
  platformPostId: string | null;
  mintAddress: string;
  postedAt?: number | null;
};

// Worker-pool fan-out for the upload-post GET-analytics calls (cheap reads, no
// scrape/proxy cost) — each pass runs this many rows in flight at once. Raised
// from 6: upload-post has no documented bulk/batch analytics endpoint, so
// "faster" here means more in-flight single-row GETs, not fewer requests.
const CONCURRENCY = 16;
// A backfill-matched cached post must have gone up within this window of the
// clip's own postedAt to be trusted as "this is that post" — wide enough to
// absorb upload-post's own processing lag, tight enough that two different
// posts on a busy day don't get cross-matched.
const MATCH_WINDOW_MS = 30 * 60 * 1000;

export interface SyncViewsResult {
  scanned: number;
  measured: number;
  updated: number;
  errors: number;
  clipsDueCount: number;
  withHandleCount: number;
  backfillCount: number;
  subsDueCount: number;
  debug: { id: string; via: string; platform: string; result: string }[];
}

/**
 * Re-reads each of the given agents' posted videos' live view count from
 * upload-post's official analytics API (no residential-proxy scrape) and
 * writes it back onto Convex. Extracted from the original single-route
 * implementation so BOTH the user-facing "Refresh" button
 * (app/api/analytics/refresh-views/route.ts, caller-owned mints, requireAuth)
 * and the background cron (app/api/analytics/sync-cron/route.ts, ALL agents'
 * mints, internal-secret) share one sync engine instead of two copies that
 * would drift.
 *
 * THREE passes, because a plain organic auto-post has no `submissions` row
 * (campaign-only table) and, for clips posted before the markClipPostedByUrl
 * arg-validator bug was fixed, never got its upload-post handle (request_id /
 * platform_post_id) captured at post time either:
 *   1. Direct — clips.viewCount for rows that DO have a handle.
 *   2. Backfill — clips.viewCount for POSTED rows with NO handle: pulls the
 *      agent's whole post history via GET /uploadposts/media and matches each
 *      clip to its post by nearest timestamp.
 *   3. Campaign — submissions.viewCount, the pre-existing campaign-only path.
 */
export async function syncViewsForMints(opts: {
  convex: ConvexHttpClient;
  secret: string;
  mintAddresses: string[];
  /** Rows to consider per pass. Bounded so one tick stays fast — older
   *  backlog catches up over successive ticks/clicks (already-synced rows
   *  are cheap no-ops via the "not-newer" guard in the record mutations). */
  clipsLimit?: number;
  subsLimit?: number;
  /** Outer stop-adding-new-work clock — every upstream fetch is itself
   *  timeout-bounded, this just caps how long the whole sync keeps going. */
  deadlineMs?: number;
  /** Fired once with the total row count right after the due-lists resolve,
   *  then again after every row finishes (any pass) — lets a caller stream a
   *  real determinate progress bar instead of faking one against a timer. */
  onProgress?: (scanned: number, total: number) => void;
}): Promise<SyncViewsResult> {
  const { convex, secret, mintAddresses, clipsLimit = 60, subsLimit = 60, deadlineMs = 22_000, onProgress } = opts;
  const startedAt = Date.now();
  let scanned = 0;
  let measured = 0;
  let updated = 0;
  let errors = 0;
  // Per-row diagnostics — DEBUG ONLY, capped, returned to the caller so a
  // "0 views after refresh" failure mode is diagnosable without dashboard log access.
  const debug: SyncViewsResult["debug"] = [];
  const pushDebug = (id: string, via: string, platform: string, result: string) => {
    if (debug.length < 60) debug.push({ id, via, platform, result });
  };

  if (mintAddresses.length === 0) {
    return { scanned: 0, measured: 0, updated: 0, errors: 0, clipsDueCount: 0, withHandleCount: 0, backfillCount: 0, subsDueCount: 0, debug: [] };
  }

  const [clipsDue, subsDue, schedDue] = await Promise.all([
    (convex.query(CLIPS_DUE, { authSecret: secret, mintAddresses, limit: clipsLimit }).catch(() => [])) as Promise<DueRow[]>,
    (convex
      .query(SUBS_DUE, { authSecret: secret, mintAddresses, limit: subsLimit })
      .catch(() => [])) as Promise<(Omit<DueRow, "mintAddress"> & { influencerMint: string })[]>,
    (convex.query(SCHED_DUE, { authSecret: secret, mintAddresses, limit: subsLimit }).catch(() => [])) as Promise<DueRow[]>,
  ]);

  const withHandle = clipsDue.filter((r) => r.postUrl || r.uploadPostRequestId || r.platformPostId);
  const needsBackfill = clipsDue.filter((r) => !r.postUrl && !r.uploadPostRequestId && !r.platformPostId);

  // Total is known the instant both due-lists resolve — every row across all
  // three passes increments the SAME `scanned` counter exactly once, so this
  // is a real denominator, not an estimate.
  const total = clipsDue.length + subsDue.length + schedDue.length;
  onProgress?.(0, total);
  const reportProgress = () => onProgress?.(scanned, total);

  // Passes are disjoint row-sets (direct vs backfill vs campaign) writing to
  // independent Convex rows, so they run CONCURRENTLY rather than sequentially.
  await Promise.all([runDirectPass(), runBackfillPass(), runCampaignPass(), runScheduledPass()]);

  // ── Pass 1: direct, per-row (has a handle already) ──────────────────────
  async function runDirectPass() {
    let idx = 0;
    async function runOne() {
      while (idx < withHandle.length) {
        if (Date.now() - startedAt > deadlineMs) break;
        const row = withHandle[idx++];
        scanned += 1;
        reportProgress();
        try {
          const r = await fetchUploadPostViews({
            platform: row.platform,
            requestId: row.uploadPostRequestId,
            postUrl: row.postUrl,
            mintAddress: row.mintAddress,
          });
          if (r.ok) {
            measured += 1;
            const rec = (await convex.mutation(CLIPS_RECORD, {
              authSecret: secret,
              id: row._id as never,
              viewCount: r.views,
              ...(r.postUrl ? { postUrl: r.postUrl } : {}),
              ...(r.platformPostId ? { platformPostId: r.platformPostId } : {}),
            })) as { ok: boolean; updated: boolean };
            if (rec.updated) updated += 1;
            pushDebug(row._id, "direct", row.platform, `ok:${r.views}views${rec.updated ? "" : ":not-newer"}`);
          } else {
            pushDebug(row._id, "direct", row.platform, `fail:${r.reason}`);
          }
        } catch (e) {
          errors += 1;
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[analyticsSync] direct row ${row._id} errored:`, msg);
          pushDebug(row._id, "direct", row.platform, `throw:${msg}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, withHandle.length)) }, () => runOne()));
  }

  // ── Pass 2: backfill — no handle, match against the agent's connected-account
  // recent-media list, then pull real metrics for the matched id ────────────
  async function runBackfillPass() {
    if (needsBackfill.length === 0) return;
    // Group by (mint, platform) — /media needs a platform, and a row with no
    // platform recorded can't be looked up this way at all.
    const byGroup = new Map<string, DueRow[]>();
    for (const row of needsBackfill) {
      if (!row.platform) { pushDebug(row._id, "backfill", row.platform, "fail:no_platform"); continue; }
      const key = `${row.mintAddress}::${row.platform}`;
      const list = byGroup.get(key) ?? [];
      list.push(row);
      byGroup.set(key, list);
    }

    // Stage A — fetch each group's media list (one cheap request per group,
    // no per-row work yet) and resolve the best match for every row.
    type Matched = { row: DueRow; platform: string; username: string; postId: string; postUrl: string | null; diffMs: number };
    const matched: Matched[] = [];
    const groups = [...byGroup.entries()];
    let gidx = 0;
    async function fetchOneGroup() {
      while (gidx < groups.length) {
        if (Date.now() - startedAt > deadlineMs) break;
        const [key, rows] = groups[gidx++];
        const [mint, platform] = key.split("::");
        const username = resolveUsername(mint);
        let media: RecentMediaItem[] = [];
        try {
          media = await getRecentMedia(username, platform, { timeoutMs: 8_000 });
        } catch (e) {
          console.warn(`[analyticsSync] media fetch failed for ${mint}/${platform}:`, e instanceof Error ? e.message : e);
        }
        const claimed = new Set<number>(); // media index already matched to a row this group
        for (const row of rows) {
          scanned += 1;
          reportProgress();
          if (!row.postedAt || media.length === 0) {
            pushDebug(row._id, "backfill", platform, media.length === 0 ? "fail:no_media" : "fail:no_postedAt");
            continue;
          }
          let bestIdx = -1;
          let bestDiff = Infinity;
          media.forEach((p, i) => {
            if (claimed.has(i) || p.uploadedAt == null) return;
            const diff = Math.abs(p.uploadedAt - row.postedAt!);
            if (diff <= MATCH_WINDOW_MS && diff < bestDiff) { bestDiff = diff; bestIdx = i; }
          });
          if (bestIdx === -1) {
            pushDebug(row._id, "backfill", platform, "fail:no_match");
            continue;
          }
          claimed.add(bestIdx);
          const m = media[bestIdx];
          matched.push({ row, platform, username, postId: m.postId, postUrl: m.postUrl, diffMs: bestDiff });
        }
      }
    }
    // Groups are cheap (one list call each) — high fan-out is fine.
    await Promise.all(Array.from({ length: Math.min(8, groups.length) }, () => fetchOneGroup()));

    // Stage B — the actual metrics call per matched row, as a FLAT worker
    // pool so the deadline is checked per-row instead of only once per group.
    let midx = 0;
    async function runOneMatch() {
      while (midx < matched.length) {
        if (Date.now() - startedAt > deadlineMs) break;
        const { row, platform, username, postId, postUrl, diffMs } = matched[midx++];
        try {
          const a = await getPostAnalytics({ platformPostId: postId, platform, username });
          if (!a.ok) {
            pushDebug(row._id, "backfill", platform, `fail:metrics_${a.reason}`);
            continue;
          }
          measured += 1;
          const views = a.metrics.views ?? a.metrics.play_count ?? a.metrics.plays ?? a.metrics.video_views ?? a.metrics.view_count ?? a.metrics.impressions ?? 0;
          const resolvedPostUrl = a.postUrl ?? postUrl ?? null;
          const rec = (await convex.mutation(CLIPS_RECORD, {
            authSecret: secret,
            id: row._id as never,
            viewCount: views,
            ...(resolvedPostUrl ? { postUrl: resolvedPostUrl } : {}),
            platformPostId: postId,
          })) as { ok: boolean; updated: boolean };
          if (rec.updated) updated += 1;
          pushDebug(row._id, "backfill", platform, `ok:${views}views:matched(${Math.round(diffMs / 1000)}s)${rec.updated ? "" : ":not-newer"}`);
        } catch (e) {
          errors += 1;
          const msg = e instanceof Error ? e.message : String(e);
          pushDebug(row._id, "backfill", platform, `throw:${msg}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, matched.length)) }, () => runOneMatch()));
  }

  // ── Pass 3: campaign submissions ─────────────────────────────────────────
  async function runCampaignPass() {
    const rows = subsDue.map((s) => ({ ...s, mintAddress: s.influencerMint }));
    let idx = 0;
    async function runOne() {
      while (idx < rows.length) {
        if (Date.now() - startedAt > deadlineMs) break;
        const row = rows[idx++];
        scanned += 1;
        reportProgress();
        try {
          const r = await fetchUploadPostViews({
            platform: row.platform,
            requestId: row.uploadPostRequestId,
            postUrl: row.postUrl,
            mintAddress: row.mintAddress,
          });
          if (r.ok) {
            measured += 1;
            const rec = (await convex.mutation(SUBS_RECORD, {
              authSecret: secret,
              id: row._id as never,
              viewCount: r.views,
              ...(r.postUrl ? { postUrl: r.postUrl } : {}),
              ...(r.platformPostId ? { platformPostId: r.platformPostId } : {}),
            })) as { ok: boolean; updated: boolean };
            if (rec.updated) updated += 1;
            pushDebug(row._id, "campaign", row.platform, `ok:${r.views}views${rec.updated ? "" : ":not-newer"}`);
          } else {
            pushDebug(row._id, "campaign", row.platform, `fail:${r.reason}`);
          }
        } catch (e) {
          errors += 1;
          console.warn(`[analyticsSync] campaign row ${row._id} errored:`, e instanceof Error ? e.message : e);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, rows.length)) }, () => runOne()));
  }

  // ── Pass 4: scheduled / auto-posted generated videos ─────────────────────
  async function runScheduledPass() {
    let idx = 0;
    async function runOne() {
      while (idx < schedDue.length) {
        if (Date.now() - startedAt > deadlineMs) break;
        const row = schedDue[idx++];
        scanned += 1;
        reportProgress();
        try {
          const r = await fetchUploadPostViews({ platform: row.platform, requestId: row.uploadPostRequestId, postUrl: row.postUrl, mintAddress: row.mintAddress });
          if (r.ok) {
            measured += 1;
            const rec = (await convex.mutation(SCHED_RECORD, {
              authSecret: secret, id: row._id as never, viewCount: r.views,
              ...(r.postUrl ? { postUrl: r.postUrl } : {}), ...(r.platformPostId ? { platformPostId: r.platformPostId } : {}),
            })) as { ok: boolean; updated: boolean };
            if (rec.updated) updated += 1;
            pushDebug(row._id, "scheduled", row.platform, `ok:${r.views}views${rec.updated ? "" : ":not-newer"}`);
          } else pushDebug(row._id, "scheduled", row.platform, `fail:${r.reason}`);
        } catch (e) {
          errors += 1;
          console.warn(`[analyticsSync] scheduled row ${row._id} errored:`, e instanceof Error ? e.message : e);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, schedDue.length)) }, () => runOne()));
  }

  return {
    scanned, measured, updated, errors,
    clipsDueCount: clipsDue.length,
    withHandleCount: withHandle.length,
    backfillCount: needsBackfill.length,
    subsDueCount: subsDue.length,
    debug,
  };
}
