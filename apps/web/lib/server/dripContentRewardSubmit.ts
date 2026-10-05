type Marked = { contentRewardId?: string | null; ownerWallet?: string | null } | null | undefined;
type DripCtx = {
  postUrl?: string; clipUrl?: string; platform?: string;
  // Durable upload-post identities + the agent mint — REQUIRED for the submit
  // route to register a measurement handle (see the big comment below).
  platformPostId?: string; uploadPostRequestId?: string; mintAddress?: string;
};

/**
 * Gap #2: the drip poster forwards only campaignId to post_content (Convex campaigns
 * are submitted there). A DRIP-posted CONTENT-REWARD clip would otherwise never reach
 * its /stage/reward page — the scheduledContent row has no contentRewardId. But
 * markClipPostedByUrl returns the clip's JOB provenance (contentRewardId recovered
 * from the job), so the drip can submit it, parity with the inline finalizeJob path.
 *
 * Returns the /api/content-rewards/submit body, or null when this isn't a
 * content-reward clip (campaign clip / clip not found) or lacks a field the route
 * REQUIRES (contentRewardId, ownerWallet, contentUrl, platform — a missing one → 400).
 *
 * ROOT CAUSE (fixed 2026-07-15): this used to return ONLY the route's required
 * fields and silently dropped platformPostId/uploadPostRequestId/mintAddress even
 * when the caller had them. Without those three, `/api/content-rewards/submit`
 * never registers a measurement handle (its gate is
 * `(uploadPostRequestId || platformPostId) && mintAddress`) — so for every
 * DRIP-posted content-reward clip (the actual clipping-agent auto-post cron,
 * `scheduledContent.drainDueClips`, every 5 min) the view-sync worker had NOTHING
 * to resolve the real permalink or views from. contentUrl stayed the raw clip URL
 * and views stayed stuck at 0, permanently — "not posted" even though it posted.
 * Now forwarded straight through whenever the caller has them.
 */
export function dripContentRewardSubmitBody(marked: Marked, ctx: DripCtx): {
  contentRewardId: string; ownerWallet: string; contentUrl: string; videoUrl: string; platform: string;
  platformPostId?: string; uploadPostRequestId?: string; mintAddress?: string;
} | null {
  const contentRewardId = marked?.contentRewardId?.trim();
  const ownerWallet = marked?.ownerWallet?.trim();
  const platform = ctx.platform?.trim();
  const contentUrl = (ctx.postUrl || ctx.clipUrl)?.trim(); // live permalink, else the clip URL
  const videoUrl = ctx.clipUrl?.trim();
  if (!contentRewardId || !ownerWallet || !contentUrl || !platform || !videoUrl) return null;
  return {
    contentRewardId, ownerWallet, contentUrl, videoUrl, platform,
    ...(ctx.platformPostId ? { platformPostId: ctx.platformPostId } : {}),
    ...(ctx.uploadPostRequestId ? { uploadPostRequestId: ctx.uploadPostRequestId } : {}),
    ...(ctx.mintAddress ? { mintAddress: ctx.mintAddress } : {}),
  };
}

/**
 * Extract the DURABLE upload-post identities — the platform post id + the
 * upload-post request id — from a run-task post_content `output` object, using
 * the same guarded "non-empty string" pattern the drip uses for postUrl/postPlatform.
 *
 * These are what make a submission PAYABLE: dueForVerification only measures a
 * submission that carries `uploadPostRequestId || platformPostId` (a postUrl-only
 * row is never attested on-chain → never claimed → the agent earns $0). run-task
 * returns them in its output, so the drip poster MUST forward whatever is present
 * into submitClipToCampaign + bridgeContentRewardToCampaign. The result is safe to
 * spread straight into those mutation args ({} when neither id is present, so no
 * `undefined` is ever injected).
 */
export function durablePostIdsFromOutput(output: unknown): {
  platformPostId?: string;
  uploadPostRequestId?: string;
} {
  const o = output as { platformPostId?: unknown; uploadPostRequestId?: unknown } | null | undefined;
  const ids: { platformPostId?: string; uploadPostRequestId?: string } = {};
  if (typeof o?.platformPostId === "string" && o.platformPostId) ids.platformPostId = o.platformPostId;
  if (typeof o?.uploadPostRequestId === "string" && o.uploadPostRequestId) ids.uploadPostRequestId = o.uploadPostRequestId;
  return ids;
}
