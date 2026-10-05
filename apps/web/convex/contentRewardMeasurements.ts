import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

/** Delay before the one-off first sync of a freshly-posted clip (see `upsert`). */
const FIRST_SYNC_DELAY_MS = 60 * 60 * 1000;

/**
 * Content-reward (Stage /reward) clip post → analytics-handle registry.
 *
 * A row is created for every content-reward clip the moment it posts (`upsert`,
 * called from clipJobs), carrying the upload-post handles (request_id /
 * platform_post_id). The admin view-sync oracle (`/api/oracle/scrape-views`,
 * mode "all") reads these via `activeHandles` to fetch each post's live views from
 * the FAST upload-post analytics API before falling back to the residential-proxy
 * scrape. This table NEVER carries money and can never trigger a payout — it only
 * feeds analytics handles to the oracle.
 *
 * Secret-gated (INTERNAL_CRON_SECRET): the clip posting action passes the secret on
 * `upsert`; the oracle worker reads `activeHandles` with it.
 */

function gate(authSecret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

/** Register/refresh a measurement row for a posted content-reward clip. Idempotent
 *  on `contentRewardSubmissionId`: a re-post only fills in any newly-resolved
 *  analytics handle, never resets status. */
export const upsert = mutation({
  args: {
    authSecret: v.string(),
    contentRewardId: v.string(),
    contentRewardSubmissionId: v.string(),
    mintAddress: v.string(),
    platform: v.string(),
    platformPostId: v.optional(v.string()),
    uploadPostRequestId: v.optional(v.string()),
    postedAt: v.number(),
  },
  handler: async (ctx, args) => {
    gate(args.authSecret);
    const existing = await ctx.db
      .query("contentRewardMeasurements")
      .withIndex("by_submission", (q) => q.eq("contentRewardSubmissionId", args.contentRewardSubmissionId))
      .first();
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.platformPostId && args.platformPostId) patch.platformPostId = args.platformPostId;
      if (!existing.uploadPostRequestId && args.uploadPostRequestId) patch.uploadPostRequestId = args.uploadPostRequestId;
      if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch);
      return { ok: true, created: false };
    }
    await ctx.db.insert("contentRewardMeasurements", {
      contentRewardId: args.contentRewardId,
      contentRewardSubmissionId: args.contentRewardSubmissionId,
      mintAddress: args.mintAddress,
      platform: args.platform,
      ...(args.platformPostId ? { platformPostId: args.platformPostId } : {}),
      ...(args.uploadPostRequestId ? { uploadPostRequestId: args.uploadPostRequestId } : {}),
      postedAt: args.postedAt,
      status: "active",
    });
    // Don't make this new post wait for the next 6h sweep — sync just its
    // platform 1h after posting so /admin/submissions shows "posted" fast.
    await ctx.scheduler.runAfter(FIRST_SYNC_DELAY_MS, internal.crons.syncOnePlatformThenRecalc, {
      platform: args.platform,
    });
    return { ok: true, created: true };
  },
});

/** Upload-post handles for active measurement rows, keyed by the ryze submission
 *  id. The admin scrape-views worker (mode "all") uses these to read views via the
 *  FAST upload-post analytics API (by request_id) before falling back to proxy
 *  scrape. */
export const activeHandles = query({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    gate(authSecret);
    // Bounded read (bug-hunt #28 `dueformeasurement-unbounded-collect-crash`):
    // the status:"active" set grows with 30-day posting volume, so an unbounded
    // `.collect()` throws past Convex's per-query read ceiling once it
    // accumulates, failing this handle lookup. `.take` caps the read — any
    // overflow simply falls back to proxy scrape in the worker (which already
    // catches a failed handle query).
    const rows = await ctx.db
      .query("contentRewardMeasurements")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(5000);
    return rows.map((r) => ({
      contentRewardSubmissionId: r.contentRewardSubmissionId,
      uploadPostRequestId: r.uploadPostRequestId ?? null,
      platformPostId: r.platformPostId ?? null,
      mintAddress: r.mintAddress,
      platform: r.platform,
    }));
  },
});
