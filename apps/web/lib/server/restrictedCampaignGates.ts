import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isRestrictedCampaign } from "@/lib/restrictedCampaigns";
import { isAccountAllowedForRestricted } from "@/lib/server/restrictedCampaignsAuth";

/**
 * SERVER-ONLY provenance gates for the RESTRICTED clipping campaigns, shared by the
 * agent run-task clip executors (`clip_source`, `join_clip_campaign`).
 *
 * A clip job can bind to a restricted reward through TWO sibling rails, and BOTH
 * must be gated symmetrically or a non-allowed agent stays payout-eligible:
 *   - `contentRewardId` — the jobtepi/ryze content_reward (Supabase auto-submit).
 *   - `campaignId`      — the Convex campaign whose funded on-chain vault (the
 *                         "Clipping FR" MIRROR of a restricted reward) pays USDC.
 *
 * These live in their own module (not inline in the route) so they can be
 * unit-tested in isolation without importing the whole run-task route.
 */

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Gate a clip job's content-reward provenance. When the resolved `contentRewardId`
 * (explicit pick OR source auto-match) is one of the restricted 12, only the single
 * allowed account's agents may carry it. For a NON-allowed agent we DROP the id
 * (return undefined) so the job never binds to the restricted campaign — killing
 * BOTH the Supabase auto-submit (finalizeJob) AND the on-chain USDC bridge
 * (submitClipToCampaign). Returns the id unchanged for a non-restricted campaign or
 * an allowed owner. Fail-closed: on a restricted id we drop it unless the owner is
 * positively confirmed allowed.
 */
export async function gateRestrictedRewardForOwner(
  contentRewardId: string | undefined,
  ownerWallet: string | undefined,
): Promise<string | undefined> {
  if (!contentRewardId) return contentRewardId;
  if (!isRestrictedCampaign({ contentRewardId })) return contentRewardId;
  const allowed = await isAccountAllowedForRestricted({ wallet: ownerWallet });
  return allowed ? contentRewardId : undefined;
}

/**
 * SYMMETRIC gate for the Convex `campaignId` USDC rail. A clip job's `campaignId`
 * binds it to a Convex campaign whose funded on-chain vault (the "Clipping FR"
 * MIRROR of a restricted reward — its `contentRewardId` is one of the 12) can pay
 * real USDC. If only `contentRewardId` were gated (gateRestrictedRewardForOwner), a
 * NON-allowed agent could still pass the SIBLING `campaignId` of that mirror and
 * become payout-eligible. So resolve the campaign, and when it is one of the
 * restricted 12 (matched by its DEFINITIVE contentRewardId — preferUuid, so a
 * merely-same-title public campaign is untouched) AND the owner is not the allowed
 * account, DROP the campaignId (kills the money binding at clipJobs.enqueue).
 *
 * Returns the id unchanged for a non-restricted campaign or an allowed owner.
 * Fail-closed on the allow check. A campaignId that can't be resolved to a real
 * campaign (bad id / transient read) is left as-is: it can neither hold USDC nor
 * receive a submission, and clipJobs.enqueue would fail the same way — so normal
 * non-restricted clipping is never degraded.
 */
export async function gateRestrictedCampaignForOwner(
  campaignId: string | undefined,
  ownerWallet: string | undefined,
): Promise<string | undefined> {
  if (!campaignId) return campaignId;
  let row: { contentRewardId?: string | null; title?: string | null } | null = null;
  try {
    const cvx = new ConvexHttpClient(CONVEX_URL);
    row = (await cvx.query(api.campaigns.getById, { id: campaignId as Id<"campaigns"> })) as
      | { contentRewardId?: string | null; title?: string | null }
      | null;
  } catch {
    return campaignId; // unresolvable id → nothing payable to gate (see doc above)
  }
  if (!row) return campaignId; // no such campaign → nothing payable to gate
  if (!isRestrictedCampaign({ contentRewardId: row.contentRewardId, title: row.title, preferUuid: true })) {
    return campaignId;
  }
  const allowed = await isAccountAllowedForRestricted({ wallet: ownerWallet });
  return allowed ? campaignId : undefined;
}
