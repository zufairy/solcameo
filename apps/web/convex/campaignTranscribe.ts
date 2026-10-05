"use node";

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { appFetch } from "./lib/appFetch";

/**
 * Post-expansion cap on the number of per-video sources one campaign fans out to
 * (BUG-032b). The raw stored links are already capped at MAX_CAMPAIGN_SOURCES=100
 * (convex/campaigns.ts), but a SINGLE Drive FOLDER link expands (below) into all
 * its member videos — so without a cap AFTER expansion, one folder link could
 * dispatch thousands of paid STT calls per campaign create. 100 mirrors the raw
 * cap; anything past it is transcribed lazily on first clip (cache miss) instead
 * of eagerly here. Env-tunable for a genuinely large library.
 */
const MAX_EXPANDED_SOURCES = Number(globalThis.process?.env?.CLIP_MAX_EXPANDED_SOURCES) || 100;

/**
 * Resolve a campaign's raw sources (pasted `contentLinks` + resolved
 * `contentFileUrls`) into the final, de-duped list of per-video URLs that get
 * transcribed: every Drive FOLDER link is expanded into its member video files;
 * every other source passes through unchanged. Shared by `pretranscribe` (which
 * POSTs each URL) and `backfillStatus` (which keys each URL into the cache).
 * With no service account a folder expands to [] and is dropped gracefully.
 *
 * The result is capped at MAX_EXPANDED_SOURCES so a Drive-folder link can't fan
 * out to an unbounded number of paid transcriptions (BUG-032b) — each folder is
 * itself already bounded by MAX_FOLDER_VIDEOS in driveDownload.
 */
async function expandCampaignSources(
  contentLinks: string[],
  contentFileUrls: string[],
  tag: string,
): Promise<string[]> {
  const rawSources = [...contentLinks, ...contentFileUrls].filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  );
  const { driveFolderId, listDriveFolderVideos, driveFileUrl } = await import("../lib/server/driveDownload");
  const expanded: string[] = [];
  for (const src of rawSources) {
    const folderId = driveFolderId(src);
    if (folderId) {
      try {
        const files = await listDriveFolderVideos(folderId);
        for (const f of files) expanded.push(driveFileUrl(f.fileId));
        if (files.length === 0) console.warn(`[campaignTranscribe.${tag}] Drive folder ${folderId} expanded to 0 videos (no service account, or empty)`);
      } catch (e) {
        console.warn(`[campaignTranscribe.${tag}] Drive folder ${folderId} expand failed: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      expanded.push(src);
    }
  }
  const unique = [...new Set(expanded)];
  if (unique.length > MAX_EXPANDED_SOURCES) {
    console.warn(`[campaignTranscribe.${tag}] ${unique.length} expanded sources exceeds ${MAX_EXPANDED_SOURCES} — capping the paid-transcription fan-out (BUG-032b; raise CLIP_MAX_EXPANDED_SOURCES if intentional)`);
    return unique.slice(0, MAX_EXPANDED_SOURCES);
  }
  return unique;
}

/**
 * Feature E — SHARED CAMPAIGN-TRANSCRIPTION DB.
 *
 * Pre-transcribe a clipping campaign's sources into the shared transcript cache
 * the moment the campaign is created, so the first agent to clip from it gets a
 * cache HIT instead of paying the cold STT + analysis cost.
 *
 * Scheduled fire-and-forget from `campaigns.create` (marketing campaign with at
 * least one source). For every source we POST to the Next `/api/video/transcribe-clip`
 * route with `{ sourceUrl, campaignSource: true }` and the internal secret. The
 * route caches by `sourceKey()`, so this is IDEMPOTENT — re-running (or two
 * sources resolving to the same video) just re-hits the cache. Every source is
 * best-effort: a failure is logged and we continue to the next.
 *
 * Drive FOLDER links are expanded into their member video files first (each
 * file is transcribed + cached individually), using the existing service-account
 * token. With no service account configured the folder expands to [] and is
 * skipped gracefully.
 *
 * Mirrors the cron `dispatchAllPending` → Next POST shape (NEXT_PUBLIC_APP_URL +
 * X-Internal-Secret). Without NEXT_PUBLIC_APP_URL set in the Convex env there is
 * nowhere to POST, so we log and no-op (graceful, matches the cron).
 */
export const pretranscribe = internalAction({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<{ dispatched: number; sources: number }> => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!appUrl) {
      console.warn("[campaignTranscribe.pretranscribe] NEXT_PUBLIC_APP_URL not set in Convex env — cannot pre-transcribe");
      return { dispatched: 0, sources: 0 };
    }

    const campaign = await ctx.runQuery(internal.campaigns.getSourcesInternal, { id: campaignId });
    if (!campaign) {
      console.warn(`[campaignTranscribe.pretranscribe] campaign ${campaignId} not found`);
      return { dispatched: 0, sources: 0 };
    }

    const sources = await expandCampaignSources(campaign.contentLinks, campaign.contentFileUrls, "pretranscribe");

    let dispatched = 0;
    // Sequential, fire-and-forget per source — caching the master row is cheap to
    // serialize and avoids hammering the STT vendor with a folder's worth of
    // parallel transcribes. Each catch+continue so one bad source can't abort the rest.
    for (const sourceUrl of sources) {
      try {
        const r = await appFetch(`/api/video/transcribe-clip`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { "X-Internal-Secret": secret } : {}),
          },
          body: JSON.stringify({ sourceUrl, campaignSource: true, campaignId }),
        });
        if (r.ok) dispatched += 1;
        else console.warn(`[campaignTranscribe.pretranscribe] transcribe-clip ${r.status} for ${sourceUrl} — skipped (cached on a later run)`);
      } catch (e) {
        console.warn(`[campaignTranscribe.pretranscribe] dispatch failed for ${sourceUrl}: ${e instanceof Error ? e.message : e}`);
      }
    }

    console.warn(`[campaignTranscribe.pretranscribe] campaign ${campaignId}: ${dispatched}/${sources.length} sources transcribed`);
    return { dispatched, sources: sources.length };
  },
});

/**
 * ONE-SHOT BACKFILL — pre-transcribe EVERY existing clipping campaign.
 *
 * Campaigns created before pre-transcribe-on-create existed never seeded the
 * shared transcript cache. This enumerates every qualifying clipping campaign
 * (`campaignType "marketing"` with at least one `contentLinks`/`contentFileUrls`
 * source) and schedules one `pretranscribe` pass per campaign.
 *
 * IDEMPOTENT: `pretranscribe` POSTs each source to `/api/video/transcribe-clip`,
 * which caches by `sourceKey()` — already-transcribed sources are $0 cache no-ops,
 * so re-running this is safe and cheap.
 *
 * SECRET-GATED (mirrors the `INTERNAL_CRON_SECRET` gate on `usage.*`/`clipJobs.*`):
 * a public action callable from the dashboard or a server, never the browser.
 *
 *   `limit`    — cap how many campaigns are enqueued this call (newest-first by
 *                creation order from the query). Omit to enqueue all.
 *   `onlyOpen` — restrict to still-running campaigns (status "open").
 *
 * Returns the number of campaigns enqueued (NOT sources — each enqueued campaign
 * fans out to its own sources inside `pretranscribe`).
 */
export const backfillAll = action({
  args: {
    authSecret: v.string(),
    limit: v.optional(v.number()),
    onlyOpen: v.optional(v.boolean()),
  },
  handler: async (
    ctx: ActionCtx,
    { authSecret, limit, onlyOpen },
  ): Promise<{ enqueued: number; totalQualifying: number; appUrlConfigured: boolean }> => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }

    const campaigns: Array<{ id: Id<"campaigns">; status: string }> = await ctx.runQuery(
      internal.campaigns.listClippingForBackfill,
      { onlyOpen },
    );

    const slice = typeof limit === "number" && limit >= 0 ? campaigns.slice(0, limit) : campaigns;
    for (const c of slice) {
      await ctx.scheduler.runAfter(0, internal.campaignTranscribe.pretranscribe, { campaignId: c.id });
    }

    const appUrlConfigured = !!process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrlConfigured) {
      console.warn("[campaignTranscribe.backfillAll] NEXT_PUBLIC_APP_URL not set — pretranscribe passes will no-op until it is");
    }
    console.warn(`[campaignTranscribe.backfillAll] enqueued ${slice.length}/${campaigns.length} qualifying clipping campaigns (onlyOpen=${!!onlyOpen})`);

    return { enqueued: slice.length, totalQualifying: campaigns.length, appUrlConfigured };
  },
});

/**
 * BACKFILL STATUS — how many campaign sources are already warm in the shared
 * transcript cache vs. still pending. Secret-gated, read-only; safe to call any
 * time to gauge backfill progress.
 *
 * Mirrors how the route keys sources: every source is expanded (Drive folders →
 * member files) and reduced to its stable `sourceKey()` (no modifiedTime suffix,
 * exactly as `/api/video/transcribe-clip` computes it), then checked against the
 * cache. Note: with no Google service account, Drive FOLDER links expand to []
 * here just as they do in the transcribe pass, so they contribute 0 sources.
 */
export const backfillStatus = action({
  args: {
    authSecret: v.string(),
    onlyOpen: v.optional(v.boolean()),
  },
  handler: async (
    ctx: ActionCtx,
    { authSecret, onlyOpen },
  ): Promise<{ campaigns: number; sources: number; cached: number; pending: number; appUrlConfigured: boolean }> => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }

    const campaigns: Array<{ id: Id<"campaigns">; status: string }> = await ctx.runQuery(
      internal.campaigns.listClippingForBackfill,
      { onlyOpen },
    );

    const { sourceKey } = await import("../lib/server/sourceKey");
    const allKeys = new Set<string>();
    for (const c of campaigns) {
      const campaign = await ctx.runQuery(internal.campaigns.getSourcesInternal, { id: c.id });
      if (!campaign) continue;
      const sources = await expandCampaignSources(campaign.contentLinks, campaign.contentFileUrls, "backfillStatus");
      for (const url of sources) allKeys.add(sourceKey(url));
    }

    const keys = [...allKeys];
    const hits: string[] = keys.length > 0
      ? await ctx.runQuery(internal.transcriptCache.cachedKeys, { sourceKeys: keys })
      : [];

    return {
      campaigns: campaigns.length,
      sources: keys.length,
      cached: hits.length,
      pending: keys.length - hits.length,
      appUrlConfigured: !!process.env.NEXT_PUBLIC_APP_URL,
    };
  },
});

/**
 * AUTO-LINK CONTENT REWARD — resolve a newly-created marketing campaign's source
 * URLs against the active jobtepi/ryze clipping content_rewards and, if a match
 * is found, persist the `contentRewardId` on the campaign row.
 *
 * This is the server-side "W7 link": when a brand funds a v2 on-chain campaign
 * whose source video is also listed in a clipping content_reward, agents clipping
 * that reward automatically get USDC payouts via the funded vault. Without this
 * link `getFundedByContentRewardId` returns null and the bridge in clipJobs never
 * fires.
 *
 * Scheduled fire-and-forget from `campaigns.create` for marketing campaigns that
 * don't already have a `contentRewardId` (explicit picks are respected).
 * Idempotent: `patchContentRewardId` is a no-op when the row already has a link.
 *
 * Delegates the URL→contentRewardId lookup to the Next.js app via
 * `/api/campaigns/match-content-reward` (same pattern as `pretranscribe` →
 * `/api/video/transcribe-clip`). Without `NEXT_PUBLIC_APP_URL` in the Convex env
 * this is a no-op; the campaign stays v1-only until a manual link is set.
 */
export const autoLinkContentReward = internalAction({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<void> => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!appUrl) {
      console.warn("[campaignTranscribe.autoLinkContentReward] NEXT_PUBLIC_APP_URL not set — cannot resolve content reward");
      return;
    }

    const campaign = await ctx.runQuery(internal.campaigns.getSourcesInternal, { id: campaignId });
    if (!campaign || campaign.campaignType !== "marketing") return;

    const sources = [...(campaign.contentLinks ?? []), ...(campaign.contentFileUrls ?? [])].filter(
      (s) => typeof s === "string" && /^https?:\/\//i.test(s.trim()),
    );
    if (sources.length === 0) return;

    // Try each source URL until one matches a clipping content_reward.
    for (const url of sources) {
      try {
        const r = await appFetch(
          `/api/campaigns/match-content-reward?url=${encodeURIComponent(url)}`,
          { headers: secret ? { "X-Internal-Secret": secret } : {} },
        );
        if (!r.ok) continue;
        const j = (await r.json()) as { contentRewardId?: string | null };
        if (j.contentRewardId) {
          await ctx.runMutation(internal.campaigns.patchContentRewardId, {
            campaignId,
            contentRewardId: j.contentRewardId,
          });
          console.log(`[campaignTranscribe.autoLinkContentReward] campaign ${campaignId} linked to content reward ${j.contentRewardId} via ${url}`);
          return; // first match wins
        }
      } catch (e) {
        console.warn(`[campaignTranscribe.autoLinkContentReward] match failed for ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }
  },
});
