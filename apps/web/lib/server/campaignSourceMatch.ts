import { getContentRewards } from "@/lib/content-rewards";
import { resolveCampaignSources } from "@/lib/server/campaignSources";
import { sourceKey } from "@/lib/server/sourceKey";

/**
 * Server-side AUTO-MATCH of a clip's source video to the clipping campaign it
 * belongs to.
 *
 * The boss's rule: when the SOURCE a user clips is within a clipping campaign,
 * every posted clip must be counted as a submission to that campaign. The canvas
 * only attaches a `contentRewardId` when the user explicitly picks the reward
 * (and a manual URL edit / local entry drops it). This closes that gap on the
 * server: given any source URL, resolve which ACTIVE `type==="clipping"`
 * content_reward contains it — so a clip auto-submits regardless of how the
 * source was chosen, and ONLY when it genuinely belongs to a clipping campaign.
 *
 * Cost is bounded by a short-TTL reverse index (drive folders rarely change), so
 * the active campaigns' folders are listed at most once per TTL, not per clip.
 */

let cache: { at: number; index: Map<string, string> } | null = null;
const TTL_MS = 5 * 60_000;

/** Build sourceKey(video URL) -> contentRewardId over active clipping campaigns.
 *  Each campaign's `available_content` is expanded to member videos (folders →
 *  files) by the same resolver the "Create with AI" handoff uses. Graceful: a
 *  campaign that fails to resolve is skipped, never throws. */
async function buildIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let rewards: Awaited<ReturnType<typeof getContentRewards>>;
  try {
    rewards = await getContentRewards();
  } catch {
    return index; // Supabase down / unconfigured → no matches (degrade, never throw)
  }
  const clipping = rewards.filter((r) => r.type?.toLowerCase() === "clipping");
  for (const r of clipping) {
    try {
      const res = await resolveCampaignSources(r.id);
      if (!res) continue;
      for (const v of res.videos) {
        const k = sourceKey(v.url);
        // First active campaign wins if two list the same source (deterministic).
        if (!index.has(k)) index.set(k, r.id);
      }
    } catch {
      /* a single campaign failing to resolve must not sink the whole index */
    }
  }
  return index;
}

/**
 * Which ACTIVE clipping campaign does this source video belong to? Returns the
 * `contentRewardId`, or null when the source is not part of any clipping campaign
 * (a plain organic source — correctly left untracked).
 */
export async function matchSourceToContentReward(sourceUrl: string): Promise<string | null> {
  const url = String(sourceUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const now = Date.now();
  if (!cache || now - cache.at >= TTL_MS) {
    cache = { at: now, index: await buildIndex() };
  }
  // A campaign that closes within the TTL window can still match for up to TTL —
  // accepted: a clip started while the campaign was live should still submit, and
  // submitContentRewardLink fails gracefully if the reward is gone.
  return cache.index.get(sourceKey(url)) ?? null;
}

/** Drop the cached reverse index (tests / after a campaign source changes). */
export function clearCampaignSourceMatchCache(): void {
  cache = null;
}
