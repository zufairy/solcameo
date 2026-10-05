import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

/**
 * Register (or refresh) the upload-post analytics handle for a content-reward clip
 * that just posted, so the view-sync worker (`/api/oracle/scrape-views`, mode "all")
 * can later read its live views AND resolve its real social permalink by request_id.
 *
 * WHY THIS EXISTS: the content-reward submit paths write `content_url = postUrl ||
 * clipUrl`, so when the live permalink hasn't resolved at post time the row is
 * stored with the raw clip/CDN url — showing "not posted"/no-link with 0 views on
 * /admin/submissions. The ONLY durable way to recover the real permalink + views
 * afterward is upload-post's post-analytics API keyed by the `request_id` captured
 * at post time. That handle used to be registered at post time ("from clipJobs" per
 * the schema comment) but the call was dropped — so newer content-reward posts
 * became permanently unmeasurable. This restores it at the submit chokepoints.
 *
 * Best-effort and fail-open: a missing id / config / Convex error never fails the
 * post or the submit. The mutation itself is idempotent per contentRewardSubmissionId
 * and carries NO money — it only feeds analytics handles to the sync worker.
 */
const UPSERT = makeFunctionReference<"mutation">("contentRewardMeasurements:upsert");

export async function registerMeasurementHandle(args: {
  contentRewardId: string;
  contentRewardSubmissionId: string;
  mintAddress: string;
  platform: string;
  uploadPostRequestId?: string | null;
  platformPostId?: string | null;
  postedAt?: number;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET;
  // Nothing measurable without a durable handle → skip (a bare postUrl isn't
  // analytics-queryable, so there is no handle to register).
  if (!url || !secret) return;
  if (!args.uploadPostRequestId && !args.platformPostId) return;
  if (!args.contentRewardId || !args.contentRewardSubmissionId || !args.mintAddress) return;
  try {
    await new ConvexHttpClient(url).mutation(UPSERT, {
      authSecret: secret,
      contentRewardId: args.contentRewardId,
      contentRewardSubmissionId: args.contentRewardSubmissionId,
      mintAddress: args.mintAddress,
      platform: args.platform,
      ...(args.uploadPostRequestId ? { uploadPostRequestId: args.uploadPostRequestId } : {}),
      ...(args.platformPostId ? { platformPostId: args.platformPostId } : {}),
      postedAt: args.postedAt ?? Date.now(),
    });
  } catch (e) {
    console.warn("[registerMeasurementHandle] failed:", e instanceof Error ? e.message : e);
  }
}
