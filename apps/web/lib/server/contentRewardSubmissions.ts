import { createClient } from "@supabase/supabase-js";

/**
 * Service-role helpers for syncing view counts onto AI clippers' content-reward
 * submissions (Supabase `content_rewards_submissions` — the same rows the public
 * reward page and the admin Submissions page display).
 *
 * The view-sync worker (`/api/oracle/scrape-views`) lists the due rows for a
 * platform, scrapes the live view count for each `content_url` via vello's
 * residential-proxy yt-dlp scraper, and writes it back here — never lowering an
 * existing count (matches jobtepi's data-integrity rule).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Platform label as stored in content_rewards_submissions.platform (CHECK enum). */
export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

// Hostnames that are real social-post permalinks. Mirrors the admin table's
// `isSocialPostUrl` (submissions-section.tsx): anything else — a Convex/Supabase
// storage url, an .mp4, a KIE render link — is the raw clip, NOT a post link.
const SOCIAL_POST_HOST =
  /(?:^|\.)(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|twitter\.com|x\.com)$/i;

/** True only for a real social-platform post permalink (not a media/clip URL). */
export function isSocialPermalink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return SOCIAL_POST_HOST.test(new URL(url.trim()).hostname);
  } catch {
    return false; // not a valid absolute URL → definitely not a post link
  }
}

export type DueRewardSubmission = {
  id: string;
  contentUrl: string;
  platform: string;
  views: number;
};

function srv() {
  if (!SUPABASE_URL || !SUPABASE_SRV_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SRV_KEY);
}

/** Approximate FX → USD so a content-reward payout (often in MYR) lands in the
 *  agent's USDC-denominated earnings consistently with the rest of the market page.
 *  Override per-currency via CONTENT_REWARD_FX_<CCY> env (e.g. CONTENT_REWARD_FX_MYR=0.21). */
const FX_TO_USD: Record<string, number> = { USD: 1, USDC: 1, MYR: 0.21, SGD: 0.74, IDR: 0.000063, INR: 0.012, EUR: 1.08, GBP: 1.27 };
export function payoutToUsd(amount: number, currency: string): number {
  const ccy = (currency || "USD").toUpperCase();
  const envRate = Number(process.env[`CONTENT_REWARD_FX_${ccy}`]);
  const rate = Number.isFinite(envRate) && envRate > 0 ? envRate : (FX_TO_USD[ccy] ?? 1);
  return Math.round(amount * rate * 100) / 100;
}

/** One content-reward earning to mirror into the Convex distributions ledger. The
 *  route resolves `agentName` + `ownerWallet` → the agent mint before recording. */
export type EarningItem = {
  contentRewardSubmissionId: string;
  usdc: number;
  agentName: string;
  ownerWallet: string;
  postedAtMs?: number;
};

/** Owner wallet encoded in a vello user email: `${wallet}-${nameSlug}@wallet.vello.gg`
 *  or `${wallet}@wallet.vello.gg`. Wallet is base58 (no `-`), so split before it. */
export function walletFromVelloEmail(email: string | null | undefined): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  return local.split("-")[0] ?? "";
}

/**
 * VELLO-AGENT submissions on `platform` whose views are worth re-reading: have a
 * content_url, not paid, not rejected. Scoped to vello-agent users only (never
 * jobtepi/human rows). Newest first (recent posts gain views fastest). Bounded.
 */
export async function listDueRewardSubmissions(
  platform: "tiktok" | "instagram" | "youtube",
  limit = 200,
): Promise<{ ok: boolean; rows: DueRewardSubmission[]; error?: string }> {
  const supabase = srv();
  if (!supabase) return { ok: false, rows: [], error: "supabase_service_role_not_configured" };
  const label = PLATFORM_LABEL[platform];
  if (!label) return { ok: false, rows: [], error: `unsupported_platform:${platform}` };

  // Vello-agent user ids (email ends in vello.gg) — the sync only ever touches
  // THESE users' submissions, never jobtepi / human submitters.
  const { data: vUsers } = await supabase.from("users").select("id").like("email", "%vello.gg").limit(5000);
  const vIds = ((vUsers ?? []) as Array<{ id: string }>).map((u) => u.id);
  if (vIds.length === 0) return { ok: true, rows: [] };

  const { data, error } = await supabase
    .from("content_rewards_submissions")
    .select("id, content_url, platform, views, status, payout_status")
    .eq("platform", label)
    .in("user_id", vIds)
    .not("content_url", "is", null)
    .neq("status", "rejected")
    .neq("payout_status", "paid")
    .order("submitted_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 1000));
  if (error) return { ok: false, rows: [], error: error.message };

  const rows = ((data ?? []) as Array<{ id: string; content_url: string | null; platform: string | null; views: number | null }>)
    .filter((r) => !!r.content_url)
    .map((r) => ({ id: r.id, contentUrl: r.content_url as string, platform: r.platform ?? label, views: Number(r.views) || 0 }));
  return { ok: true, rows };
}

/**
 * LINEAR per-view payout from a campaign reward: `views × (reward_rate / 1000)`,
 * pro-rated from the first view (no 1000-view minimum) — e.g. 500 views at a rate
 * of 8/1000 → 4.00. Adds an optional flat bonus and caps at max_payout. Rejected → 0.
 */
export function computePayout(
  views: number,
  status: string | null,
  reward: { reward_rate?: number | string | null; max_payout?: number | string | null; flat_fee_bonus?: number | string | null },
): number {
  if (status === "rejected") return 0;
  const rate = parseFloat(String(reward.reward_rate ?? 0)) || 0;
  const maxP = parseFloat(String(reward.max_payout ?? 0)) || 0;
  const flat = parseFloat(String(reward.flat_fee_bonus ?? 0)) || 0;
  if (views <= 0 || rate <= 0) return 0;
  let p = views * (rate / 1000);
  if (flat > 0) p += flat;
  if (maxP > 0) p = Math.min(p, maxP);
  return Math.round(p * 100) / 100;
}

/**
 * Recalculate ONE submission's payout from its campaign reward rate × its current
 * views and persist it to `calculated_payout` (never touches actual_payout / paid).
 * Returns the fresh views + computed payout for the row's per-row refresh button.
 */
export async function recalcSubmissionPayout(
  submissionId: string,
): Promise<{ ok: boolean; views?: number; payout?: number; currency?: string; error?: string; items?: EarningItem[] }> {
  const supabase = srv();
  if (!supabase) return { ok: false, error: "supabase_service_role_not_configured" };

  const { data: row, error } = await supabase
    .from("content_rewards_submissions")
    .select("id, views, status, content_reward_id, user_id, submitted_at, created_at")
    .eq("id", submissionId)
    .single();
  if (error || !row) return { ok: false, error: error?.message ?? "submission_not_found" };

  const r = row as { views: number | null; status: string | null; content_reward_id: string | null; user_id: string | null; submitted_at: string | null; created_at: string | null };
  const views = Number(r.views) || 0;

  // Resolve the submitter (vello agent): name + owner wallet → mint (done in route).
  let agentName = "";
  let ownerWallet = "";
  if (r.user_id) {
    const { data: u } = await supabase.from("users").select("name, email").eq("id", r.user_id).single();
    if (u) { agentName = (u.name as string) || ""; ownerWallet = walletFromVelloEmail(u.email as string); }
  }
  const postedAtMs = r.submitted_at || r.created_at ? new Date((r.submitted_at || r.created_at)!).getTime() : undefined;

  let reward: { reward_rate?: number | string | null; max_payout?: number | string | null; flat_fee_bonus?: number | string | null; currency?: string | null } = {};
  if (r.content_reward_id) {
    const { data: rw } = await supabase
      .from("content_rewards")
      .select("reward_rate, max_payout, flat_fee_bonus, currency")
      .eq("id", r.content_reward_id)
      .single();
    if (rw) reward = rw;
  }

  const payout = computePayout(views, r.status, reward);
  const currency = (reward.currency || "USD").toString();
  await supabase
    .from("content_rewards_submissions")
    .update({ calculated_payout: payout, updated_at: new Date().toISOString() })
    .eq("id", submissionId);

  return {
    ok: true,
    views,
    payout,
    currency,
    items: [{ contentRewardSubmissionId: submissionId, usdc: payoutToUsd(payout, currency), agentName, ownerWallet, postedAtMs }],
  };
}

/**
 * "Sync Payout": recompute + persist the payout for EVERY vello-agent submission
 * from its campaign reward rate × current views, in one pass. Returns how many
 * rows were updated and the total payout across them.
 */
export async function recalcAllPayouts(): Promise<{ ok: boolean; scanned?: number; updated?: number; total?: number; error?: string; items?: EarningItem[] }> {
  const supabase = srv();
  if (!supabase) return { ok: false, error: "supabase_service_role_not_configured" };

  const { data: vUsers } = await supabase.from("users").select("id, name, email").like("email", "%vello.gg").limit(5000);
  const userRows = (vUsers ?? []) as Array<{ id: string; name: string | null; email: string | null }>;
  const userMap = new Map(userRows.map((u) => [u.id, { name: u.name || "", wallet: walletFromVelloEmail(u.email) }]));
  const vIds = userRows.map((u) => u.id);
  if (vIds.length === 0) return { ok: true, scanned: 0, updated: 0, total: 0, items: [] };

  const { data, error } = await supabase
    .from("content_rewards_submissions")
    .select("id, views, status, content_reward_id, calculated_payout, user_id, submitted_at, created_at")
    .in("user_id", vIds)
    .limit(5000);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<{ id: string; views: number | null; status: string | null; content_reward_id: string | null; calculated_payout: number | null; user_id: string | null; submitted_at: string | null; created_at: string | null }>;

  // Batch-fetch the rewards once (incl. currency for the USD conversion).
  const rewardIds = [...new Set(rows.map((r) => r.content_reward_id).filter(Boolean))] as string[];
  type RewardRow = { id: string; reward_rate?: number | string | null; max_payout?: number | string | null; flat_fee_bonus?: number | string | null; currency?: string | null };
  const rewardMap = new Map<string, RewardRow>();
  if (rewardIds.length) {
    const { data: rws } = await supabase.from("content_rewards").select("id, reward_rate, max_payout, flat_fee_bonus, currency").in("id", rewardIds);
    for (const rw of (rws ?? []) as RewardRow[]) rewardMap.set(rw.id, rw);
  }

  let updated = 0;
  let total = 0;
  const items: EarningItem[] = [];
  for (const r of rows) {
    const reward: RewardRow = (r.content_reward_id ? rewardMap.get(r.content_reward_id) : undefined) ?? { id: "" };
    const payout = computePayout(Number(r.views) || 0, r.status, reward);
    total += payout;
    const u = r.user_id ? userMap.get(r.user_id) : undefined;
    const postedAtMs = r.submitted_at || r.created_at ? new Date((r.submitted_at || r.created_at)!).getTime() : undefined;
    items.push({
      contentRewardSubmissionId: r.id,
      usdc: payoutToUsd(payout, (reward.currency || "USD").toString()),
      agentName: u?.name || "",
      ownerWallet: u?.wallet || "",
      postedAtMs,
    });
    if (payout !== (Number(r.calculated_payout) || 0)) {
      await supabase
        .from("content_rewards_submissions")
        .update({ calculated_payout: payout, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      updated += 1;
    }
  }
  return { ok: true, scanned: rows.length, updated, total: Math.round(total * 100) / 100, items };
}

/**
 * Decide the write-back patch for a freshly-measured submission. Pure (no I/O) so
 * the never-lower + permalink-backfill rules are unit-testable.
 *
 *  - `views`: only written when strictly HIGHER than the stored count (a transient
 *    under-read can't roll a clipper's views backward — jobtepi's data-integrity rule).
 *  - `content_url`: BACKFILLED with the real social permalink the upload-post
 *    analytics resolved, but ONLY when the resolved url is a genuine post link AND
 *    the stored one is NOT (i.e. it's the raw clip/CDN url a post-time permalink
 *    fallback wrote). This is what stops a genuinely-posted clip from showing
 *    "not posted"/no-link on /admin/submissions. It never overwrites an existing
 *    real permalink, and content_url is display/scrape-target only (not a money
 *    field — payouts key on views × rate), so this can't open a payout path.
 */
export function planRewardSubmissionUpdate(args: {
  views: number;
  currentViews: number;
  resolvedPostUrl?: string | null;
  currentContentUrl?: string | null;
}): { views?: number; content_url?: string } {
  const patch: { views?: number; content_url?: string } = {};
  const next = Number.isFinite(args.views) ? Math.max(0, Math.floor(args.views)) : 0;
  if (next > args.currentViews) patch.views = next;
  const resolved = args.resolvedPostUrl?.trim();
  if (resolved && isSocialPermalink(resolved) && !isSocialPermalink(args.currentContentUrl)) {
    patch.content_url = resolved;
  }
  return patch;
}

/**
 * Write the freshly-scraped view count (and, when the analytics resolved one, the
 * real social permalink) onto a submission. NEVER lowers an existing count and
 * NEVER overwrites an existing real permalink. Touches only `views` / `content_url`
 * / `updated_at` — leaves status/payout untouched so it can't open a payout path.
 */
export async function setRewardSubmissionViews(
  id: string,
  views: number,
  currentViews: number,
  opts?: { resolvedPostUrl?: string | null; currentContentUrl?: string | null },
): Promise<{ ok: boolean; updated: boolean; linkUpdated: boolean; error?: string }> {
  const supabase = srv();
  if (!supabase) return { ok: false, updated: false, linkUpdated: false, error: "supabase_service_role_not_configured" };
  const patch = planRewardSubmissionUpdate({
    views,
    currentViews,
    resolvedPostUrl: opts?.resolvedPostUrl,
    currentContentUrl: opts?.currentContentUrl,
  });
  if (patch.views === undefined && patch.content_url === undefined) {
    return { ok: true, updated: false, linkUpdated: false };
  }
  const { error } = await supabase
    .from("content_rewards_submissions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, updated: false, linkUpdated: false, error: error.message };
  return { ok: true, updated: patch.views !== undefined, linkUpdated: patch.content_url !== undefined };
}
