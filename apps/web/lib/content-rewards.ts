import { getSupabaseClient } from "./supabase";

export interface ContentReward {
  id: string;
  campaign_name: string;
  type: string;
  category: string;
  budget: number;
  currency: string;
  reward_rate: number;
  reward_unit: string;
  min_payout?: number;
  max_payout?: number;
  flat_fee_bonus?: number;
  budget_remaining?: number | null;
  platforms: string[];
  available_content?: string;
  content_requirements: string[];
  thumbnail_url?: string;
  status: string;
  created_at: string;
  updated_at: string;
  community_id?: string | null;
  created_by?: string | null;
  // enriched
  total_views?: number;
  total_submissions?: number;
  approved_submissions?: number;
  paidOut?: number;
  progress?: number;
  communityName?: string;
  communityImage?: string;
  ownerName?: string;
  ownerImage?: string;
}

// LINEAR per-view payout: views × (reward_rate / 1000), pro-rated from the first
// view (no 1000-view minimum) — e.g. 500 views @ rate 8 → 4.00. +flat bonus, capped.
const calculatePayout = (
  sub: { status?: string | null; views?: number | null },
  reward: { reward_rate?: number | string | null; max_payout?: number | string | null; flat_fee_bonus?: number | string | null }
): number => {
  if (sub.status === "rejected") return 0;
  const views = Number(sub.views || 0);
  const rate = parseFloat(String(reward.reward_rate ?? 0)) || 0;
  const maxP = parseFloat(String(reward.max_payout ?? 0)) || 0;
  const flat = parseFloat(String(reward.flat_fee_bonus ?? 0)) || 0;
  if (views <= 0 || rate <= 0) return 0;
  let p = views * (rate / 1000);
  if (flat > 0) p += flat;
  if (maxP > 0) p = Math.min(p, maxP);
  return Math.round(p * 100) / 100;
};

function tryGetSupabase() {
  try {
    return getSupabaseClient();
  } catch {
    return null;
  }
}

const enrichWithSubmissions = async (rewards: ContentReward[]): Promise<ContentReward[]> => {
  if (!rewards.length) return [];
  const supabase = tryGetSupabase();
  if (!supabase) return rewards;

  // Fetch submissions
  const { data: submissions } = await supabase
    .from("content_rewards_submissions")
    .select("id, status, views, calculated_payout, actual_payout, payout_status, content_reward_id")
    .in("content_reward_id", rewards.map((r) => r.id));

  type SubmissionRow = {
    id: string;
    status?: string | null;
    views?: number | null;
    calculated_payout?: number | null;
    actual_payout?: number | null;
    payout_status?: string | null;
    content_reward_id: string;
  };
  const byReward = new Map<string, SubmissionRow[]>();
  for (const s of submissions || []) {
    const arr = byReward.get(s.content_reward_id) || [];
    arr.push(s);
    byReward.set(s.content_reward_id, arr);
  }

  // Fetch communities
  const communityIds = [...new Set(rewards.map((r) => r.community_id).filter(Boolean))] as string[];
  const { data: communities } = communityIds.length
    ? await supabase.from("communities").select("id,name,profile_image,avatar_image").in("id", communityIds)
    : { data: [] };
  const communityMap = new Map<string, { name: string; image: string }>();
  for (const c of communities || []) {
    communityMap.set(c.id, {
      name: c.name || "",
      image: c.profile_image || c.avatar_image || "",
    });
  }

  // Fetch owners
  const ownerIds = [...new Set(rewards.map((r) => r.created_by).filter(Boolean))] as string[];
  const { data: owners } = ownerIds.length
    ? await supabase.from("users").select("id,name,username,profile_image,avatar_url").in("id", ownerIds)
    : { data: [] };
  const ownerMap = new Map<string, { name: string; image: string }>();
  for (const u of owners || []) {
    ownerMap.set(u.id, {
      name: u.name || u.username || "",
      image: u.profile_image || u.avatar_url || "",
    });
  }

  return rewards.map((reward) => {
    const subs = byReward.get(reward.id) || [];
    const counted = subs.filter((s) => s.status !== "rejected");
    const totalViews = counted.reduce((sum: number, s) => sum + (Number(s.views) || 0), 0);
    const paidOut = counted.reduce((sum: number, s) => sum + calculatePayout(s, reward), 0);
    const budget = Number(reward.budget) || 0;
    const progress = budget > 0 ? Math.min((paidOut / budget) * 100, 100) : 0;

    const community = reward.community_id ? communityMap.get(reward.community_id) : undefined;
    const owner = reward.created_by ? ownerMap.get(reward.created_by) : undefined;

    return {
      ...reward,
      total_submissions: subs.length,
      approved_submissions: subs.filter((s) => s.status === "approved").length,
      total_views: totalViews,
      paidOut,
      progress,
      communityName: community?.name || owner?.name || "",
      communityImage: community?.image || owner?.image || "",
      ownerName: owner?.name || "",
      ownerImage: owner?.image || "",
    };
  });
};

let cache: { at: number; data: ContentReward[] | null } = { at: 0, data: null };
export function clearContentRewardsCache() { cache = { at: 0, data: null }; }
const TTL = 30_000;

export const getContentRewards = async (limit?: number): Promise<ContentReward[]> => {
  try {
    const supabase = tryGetSupabase();
    if (!supabase) return [];
    const now = Date.now();
    if (cache.data && now - cache.at < TTL) {
      return limit ? cache.data.slice(0, limit) : cache.data;
    }

    let query = supabase
      .from("content_rewards")
      .select("*")
      .eq("status", "active")
      .gt("budget", 0)
      .order("created_at", { ascending: false });

    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error || !data) return [];

    const enriched = await enrichWithSubmissions(data as ContentReward[]);
    cache = { at: now, data: enriched };
    return limit ? enriched.slice(0, limit) : enriched;
  } catch {
    return [];
  }
};

export interface RewardSubmission {
  id: string;
  platform: string | null;
  contentUrl: string | null;
  videoUrl: string | null;
  title: string | null;
  views: number;
  likes: number;
  status: string;
  payout: number;
  submittedAt: string | null;
  submitterName: string;
  submitterImage: string;
}

/**
 * All submissions for a content reward — humans and AI agents alike — enriched
 * with the submitter's name + avatar. Visible to any viewer (no owner gating).
 */
export const getContentRewardSubmissions = async (
  rewardId: string
): Promise<RewardSubmission[]> => {
  try {
    const supabase = tryGetSupabase();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("content_rewards_submissions")
      .select(
        "id, user_id, community_id, platform, content_url, video_url, content_title, views, likes, calculated_payout, actual_payout, status, submitted_at, created_at"
      )
      .eq("content_reward_id", rewardId)
      .order("submitted_at", { ascending: false });
    if (error || !data) return [];

    type SubmissionRow = {
      id: string;
      user_id?: string | null;
      community_id?: string | null;
      platform?: string | null;
      content_url?: string | null;
      video_url?: string | null;
      content_title?: string | null;
      views?: number | null;
      likes?: number | null;
      calculated_payout?: number | null;
      actual_payout?: number | null;
      status?: string | null;
      submitted_at?: string | null;
      created_at?: string | null;
    };
    const rows = data as SubmissionRow[];

    const userIds = [...new Set(rows.map((s) => s.user_id).filter(Boolean))] as string[];
    const { data: users } = userIds.length
      ? await supabase.from("users").select("id,name,username,profile_image,avatar_url").in("id", userIds)
      : { data: [] };
    const userMap = new Map<string, { name: string; image: string }>();
    for (const u of users || []) {
      userMap.set(u.id, { name: u.name || u.username || "", image: u.profile_image || u.avatar_url || "" });
    }

    const communityIds = [...new Set(rows.map((s) => s.community_id).filter(Boolean))] as string[];
    const { data: communities } = communityIds.length
      ? await supabase.from("communities").select("id,name,profile_image,avatar_image").in("id", communityIds)
      : { data: [] };
    const communityMap = new Map<string, { name: string; image: string }>();
    for (const c of communities || []) {
      communityMap.set(c.id, { name: c.name || "", image: c.profile_image || c.avatar_image || "" });
    }

    return rows.map((s): RewardSubmission => {
      const user = s.user_id ? userMap.get(s.user_id) : undefined;
      const community = s.community_id ? communityMap.get(s.community_id) : undefined;
      return {
        id: s.id,
        platform: s.platform ?? null,
        contentUrl: s.content_url ?? null,
        videoUrl: s.video_url ?? null,
        title: s.content_title ?? null,
        views: Number(s.views) || 0,
        likes: Number(s.likes) || 0,
        status: s.status || "pending",
        payout: Number(s.actual_payout ?? s.calculated_payout) || 0,
        submittedAt: s.submitted_at || s.created_at || null,
        submitterName: user?.name || community?.name || "Anonymous",
        submitterImage: user?.image || community?.image || "",
      };
    });
  } catch {
    return [];
  }
};

/** One enriched row for the admin Submissions table — a content-reward submission
 *  (AI clipper or human) joined with its submitter + the content reward it's on. */
export interface AdminRewardSubmission {
  id: string;
  contentRewardId: string | null;
  campaignName: string;
  platform: string | null;
  contentUrl: string | null;
  videoUrl: string | null;
  title: string | null;
  views: number;
  likes: number;
  status: string;
  payoutStatus: string;
  /** Recorded payout from the DB (actual_payout ?? calculated_payout). */
  payout: number;
  /** Supposed payout computed live from the campaign reward rate × current views. */
  supposedPayout: number;
  /** Campaign reward currency (e.g. "USD"/"USDC"/"MYR"). */
  currency: string;
  submittedAt: string | null;
  submitterName: string;
  submitterImage: string;
}

/**
 * Content-reward submissions made by VELLO AGENTS only — the AI clippers' posted
 * videos (NOT human / jobtepi submitters). Reads the same Supabase
 * `content_rewards_submissions` source the public reward page uses, but scoped to
 * the vello-provisioned users (their email ends in `vello.gg`, set by
 * lib/server/contentRewardSubmit.ts when an agent posts). Enriched with the
 * agent's name/avatar (users) and the campaign name. Newest first.
 */
export const getAllContentRewardSubmissions = async (
  limit = 1000
): Promise<AdminRewardSubmission[]> => {
  try {
    const supabase = tryGetSupabase();
    if (!supabase) return [];

    // 1) The vello-agent users (email ends in vello.gg). Everything else (gmail,
    //    jobtepi community accounts, …) is excluded — those aren't vello agents.
    const { data: vUsers } = await supabase
      .from("users")
      .select("id,name,username,profile_image,avatar_url,email")
      .like("email", "%vello.gg")
      .limit(2000);
    const vrows = (vUsers || []) as Array<{ id: string; name?: string | null; username?: string | null; profile_image?: string | null; avatar_url?: string | null }>;
    if (vrows.length === 0) return [];
    const userMap = new Map<string, { name: string; image: string }>();
    for (const u of vrows) {
      userMap.set(u.id, { name: u.name || u.username || "", image: u.profile_image || u.avatar_url || "" });
    }
    const vIds = vrows.map((u) => u.id);

    // 2) Their content-reward submissions, newest first.
    const { data, error } = await supabase
      .from("content_rewards_submissions")
      .select(
        "id, content_reward_id, user_id, platform, content_url, video_url, content_title, views, likes, calculated_payout, actual_payout, status, payout_status, submitted_at, created_at"
      )
      .in("user_id", vIds)
      .order("submitted_at", { ascending: false })
      .limit(Math.min(Math.max(1, limit), 5000));
    if (error || !data) return [];

    type Row = {
      id: string;
      content_reward_id?: string | null;
      user_id?: string | null;
      platform?: string | null;
      content_url?: string | null;
      video_url?: string | null;
      content_title?: string | null;
      views?: number | null;
      likes?: number | null;
      calculated_payout?: number | null;
      actual_payout?: number | null;
      status?: string | null;
      payout_status?: string | null;
      submitted_at?: string | null;
      created_at?: string | null;
    };
    const rows = data as Row[];

    const rewardIds = [...new Set(rows.map((s) => s.content_reward_id).filter(Boolean))] as string[];
    const { data: rewards } = rewardIds.length
      ? await supabase.from("content_rewards").select("id,campaign_name,reward_rate,max_payout,flat_fee_bonus,currency").in("id", rewardIds)
      : { data: [] };
    type RewardRow = { id: string; campaign_name?: string | null; reward_rate?: number | string | null; max_payout?: number | string | null; flat_fee_bonus?: number | string | null; currency?: string | null };
    const rewardMap = new Map<string, RewardRow>();
    for (const r of (rewards || []) as RewardRow[]) rewardMap.set(r.id, r);

    return rows.map((s): AdminRewardSubmission => {
      const user = s.user_id ? userMap.get(s.user_id) : undefined;
      const reward = s.content_reward_id ? rewardMap.get(s.content_reward_id) : undefined;
      const views = Number(s.views) || 0;
      // Supposed payout computed live from the campaign's reward rate × current views
      // (same per-1k-views + flat-bonus + cap formula the oracle/jobtepi use).
      const supposedPayout = reward
        ? calculatePayout({ status: s.status, views }, reward)
        : 0;
      return {
        id: s.id,
        contentRewardId: s.content_reward_id ?? null,
        campaignName: reward?.campaign_name || "",
        platform: s.platform ?? null,
        contentUrl: s.content_url ?? null,
        videoUrl: s.video_url ?? null,
        title: s.content_title ?? null,
        views,
        likes: Number(s.likes) || 0,
        status: s.status || "pending",
        payoutStatus: s.payout_status || "pending",
        payout: Number(s.actual_payout ?? s.calculated_payout) || 0,
        supposedPayout,
        currency: (reward?.currency || "USD").toString(),
        submittedAt: s.submitted_at || s.created_at || null,
        submitterName: user?.name || "Vello Agent",
        submitterImage: user?.image || "",
      };
    });
  } catch {
    return [];
  }
};

/** Live view counts for a set of post URLs (the agent's clips), read from the
 *  Supabase `content_rewards_submissions` display rows. Keyed by both the exact
 *  content_url AND a normalized form (query-string stripped) so a clip's postUrl
 *  matches regardless of utm params. Used to badge the market-page creation cards. */
export const getViewsForUrls = async (urls: string[]): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  try {
    const supabase = tryGetSupabase();
    if (!supabase || urls.length === 0) return out;
    const clean = (u: string) => u.split("?")[0].replace(/\/$/, "");
    const wanted = [...new Set(urls.filter(Boolean))];
    const { data } = await supabase
      .from("content_rewards_submissions")
      .select("content_url, views")
      .in("content_url", wanted.slice(0, 300));
    for (const r of (data || []) as Array<{ content_url: string | null; views: number | null }>) {
      if (!r.content_url) continue;
      const v = Number(r.views) || 0;
      out[r.content_url] = Math.max(out[r.content_url] ?? 0, v);
      out[clean(r.content_url)] = Math.max(out[clean(r.content_url)] ?? 0, v);
    }
  } catch { /* ignore — views just won't show */ }
  return out;
};

export const getContentRewardById = async (id: string): Promise<ContentReward | null> => {
  try {
    const supabase = tryGetSupabase();
    if (!supabase) return null;
    // Serve from the list cache when warm — avoids a round-trip on navigation.
    const cached = cache.data?.find((r) => r.id === id);
    if (cached) return cached;

    const { data, error } = await supabase
      .from("content_rewards")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return null;

    const [enriched] = await enrichWithSubmissions([data as ContentReward]);
    return enriched ?? null;
  } catch {
    return null;
  }
};
