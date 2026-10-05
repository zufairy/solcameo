import type { AdminRewardSubmission } from "@/lib/content-rewards";

// Hostnames that are real social-post permalinks. Mirrors `isSocialPostUrl` in
// submissions-section.tsx and `isSocialPermalink` in lib/server/contentRewardSubmissions.ts
// (duplicated on purpose — that one is server-only via @supabase/supabase-js and this
// module is imported into the client bundle): anything else — a Convex/Supabase storage
// url, an .mp4, a KIE render link — is the raw clip, NOT a post link.
const SOCIAL_POST_HOST =
  /(?:^|\.)(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|twitter\.com|x\.com)$/i;

function isSocialPermalink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return SOCIAL_POST_HOST.test(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

/** Which store a merged admin submission row came from. Drives the type badge
 *  and gates the content-reward-only action buttons (per-row refresh / inject,
 *  which need a Supabase submission id + the recalc endpoint). */
export type SubmissionSource = "content_reward" | "campaign" | "hire";

/** An admin submission row tagged with its origin store and (for campaign rows)
 *  the agent type so the UI can label UGC vs clipping vs worker output. */
export type MergedAdminSubmission = AdminRewardSubmission & {
  source: SubmissionSource;
  agentType?: string;
  /** USDC disbursed on-chain — only meaningful for campaign rows (the on-chain
   *  column reads it directly instead of the content-reward `onchain` map). */
  paidUsdc?: number;
  /** TRUE when the post was actually PUBLISHED — proven by a durable upload-post
   *  identity (platformPostId / uploadPostRequestId) even when no inline permalink
   *  was captured (Instagram/TikTok often return the id but no URL for a while).
   *  The admin uses this so a genuinely-posted clip isn't shown "not posted" just
   *  because the permalink hasn't resolved yet. Undefined ⇒ fall back to the link. */
  postedProof?: boolean;
};

/** Shape of a row returned by the Convex `submissions:listAllAdmin` query. */
export interface ConvexAdminSubmission {
  _id: string;
  campaignId?: string;
  contentRewardSubmissionId?: string | null;
  status: string;
  platform: string;
  postUrl: string;
  viewCount: number;
  payoutAmountUsdc: number;
  paidUsdc: number;
  influencerName: string;
  agentName: string;
  agentAvatar: string;
  agentType?: string;
  campaignTitle: string;
  brandName: string;
  postedAt: number | null;
  createdAt: number;
  /** Durable proof-of-publish ids from upload-post — present once the post is
   *  accepted even if no permalink resolved. Drive the "posted" derivation. */
  platformPostId?: string | null;
  uploadPostRequestId?: string | null;
}

/** Shape of a row returned by the Convex `submissions:listAllHireAdmin` query.
 *  A hire is a flat, pre-paid per-video commission — not a campaign or content
 *  reward — surfaced in admin as its own source. */
export interface HireAdminSubmission {
  taskId: string;
  mintAddress: string;
  agentName: string;
  agentAvatar: string;
  agentType?: string;
  platform: string;
  postUrl: string;
  videoUrl: string | null;
  title: string;
  commissionUsdc: number;
  createdAt: number;
}

/** Map a Convex `listAllHireAdmin` row into the shared AdminRewardSubmission shape,
 *  tagged `source: "hire"`. The commission (pre-paid to the agent) is shown as the
 *  payout; there is no per-view accounting for a hire, so views are 0. */
export function mapHireToAdmin(h: HireAdminSubmission): MergedAdminSubmission {
  return {
    id: `hire:${h.taskId}`,
    contentRewardId: null,
    campaignName: h.title || "Commissioned video",
    platform: h.platform || null,
    contentUrl: h.postUrl || null,
    videoUrl: h.videoUrl,
    title: h.title || null,
    views: 0,
    likes: 0,
    status: "paid",
    payoutStatus: "paid",
    payout: h.commissionUsdc ?? 0,
    supposedPayout: h.commissionUsdc ?? 0,
    currency: "USDC",
    submittedAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
    submitterName: h.agentName || "Agent",
    submitterImage: h.agentAvatar || "",
    source: "hire",
    agentType: h.agentType,
    // Pre-paid commission — surfaced in the on-chain column for hire rows.
    paidUsdc: h.commissionUsdc ?? 0,
    // A hire is pre-paid on a delivered video — always treated as published.
    postedProof: true,
  };
}

/** Normalize a post URL for cross-store dedup: lowercase, strip protocol, `www.`,
 *  query/hash, and any trailing slash. Two links to the same post collapse to one
 *  key even if one carries tracking params or a scheme difference. */
export function normalizePostUrl(url: string | null | undefined): string {
  if (!url) return "";
  let s = url.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("#")[0].split("?")[0];
  s = s.replace(/\/+$/, "");
  return s;
}

/** Map a Convex `listAllAdmin` row into the shared AdminRewardSubmission shape,
 *  tagged `source: "campaign"`. Campaign payouts are always USDC. */
export function mapConvexToAdmin(c: ConvexAdminSubmission): MergedAdminSubmission {
  const submittedAtMs = c.postedAt ?? c.createdAt;
  return {
    id: c._id,
    contentRewardId: c.campaignId ?? null,
    campaignName: c.brandName || c.campaignTitle || "",
    platform: c.platform || null,
    contentUrl: c.postUrl || null,
    videoUrl: null,
    title: c.campaignTitle || null,
    views: c.viewCount ?? 0,
    likes: 0,
    status: c.status,
    payoutStatus: c.status,
    payout: c.payoutAmountUsdc ?? 0,
    supposedPayout: c.payoutAmountUsdc ?? 0,
    currency: "USDC",
    submittedAt: submittedAtMs ? new Date(submittedAtMs).toISOString() : null,
    submitterName: c.agentName || c.influencerName || "",
    submitterImage: c.agentAvatar || "",
    source: "campaign",
    agentType: c.agentType,
    // Carried through so the on-chain column can read it for campaign rows.
    paidUsdc: c.paidUsdc ?? 0,
    // Published if a permalink OR a durable upload-post identity exists.
    postedProof: Boolean(c.postUrl || c.platformPostId || c.uploadPostRequestId),
  };
}

/**
 * Merge Supabase content-reward submissions with Convex campaign/UGC submissions
 * into one newest-first list. Supabase rows win on any overlap:
 *   1) a Convex row whose `contentRewardSubmissionId` matches a Supabase row id
 *      (a bridged clipping submission — same logical post in both stores), and
 *   2) a Convex row whose normalized postUrl collides with a Supabase contentUrl,
 * are dropped. Pure UGC rows (Convex campaigns, no content-reward mirror) always
 * pass through. Hire rows (pre-paid per-video commissions) are appended as their
 * own source, deduped by post URL against the other two stores. Sorted by
 * submittedAt descending.
 */
export function mergeAdminSubmissions(
  supabaseRows: AdminRewardSubmission[],
  convexRows: ConvexAdminSubmission[],
  hireRows: HireAdminSubmission[] = [],
): MergedAdminSubmission[] {
  const supabaseIds = new Set(supabaseRows.map((r) => r.id));
  const supabaseUrls = new Set(
    supabaseRows.map((r) => normalizePostUrl(r.contentUrl)).filter(Boolean),
  );

  // Index the Convex money-rail rows by their bridged content-reward id AND by
  // normalized postUrl, so a kept Supabase display row can INHERIT its twin's
  // proof-of-publish + resolved permalink. Without this a bridged clip that was
  // genuinely posted (its Convex row carries uploadPostRequestId / platformPostId,
  // and often a resolved postUrl) shows "not posted" — the kept Supabase row has
  // only the raw video URL, no permalink and no proof of its own.
  const convexById = new Map<string, ConvexAdminSubmission>();
  const convexByUrl = new Map<string, ConvexAdminSubmission>();
  for (const c of convexRows) {
    if (c.contentRewardSubmissionId) convexById.set(c.contentRewardSubmissionId, c);
    const k = normalizePostUrl(c.postUrl);
    if (k && !convexByUrl.has(k)) convexByUrl.set(k, c);
  }

  const tagged: MergedAdminSubmission[] = supabaseRows.map((r) => {
    const twin = convexById.get(r.id) ?? convexByUrl.get(normalizePostUrl(r.contentUrl));
    const twinProof = !!twin && !!(twin.postUrl || twin.platformPostId || twin.uploadPostRequestId);
    return {
      ...r,
      source: "content_reward" as const,
      // A bridged, genuinely-published clip must not read "not posted".
      ...(twinProof ? { postedProof: true } : {}),
      // Backfill the real permalink from the twin whenever this display row's own
      // contentUrl ISN'T already a real social permalink — not just when it's empty.
      // The common broken case has contentUrl SET to the raw clip/CDN url (the
      // write-side `postUrl || clipUrl` fallback), which is non-empty but still not
      // a post link — `!r.contentUrl` alone never caught that, so the twin's real
      // permalink never replaced it and the platform button kept opening the clip.
      ...(!isSocialPermalink(r.contentUrl) && twin?.postUrl ? { contentUrl: twin.postUrl } : {}),
    };
  });

  for (const c of convexRows) {
    if (c.contentRewardSubmissionId && supabaseIds.has(c.contentRewardSubmissionId)) continue;
    const urlKey = normalizePostUrl(c.postUrl);
    if (urlKey && supabaseUrls.has(urlKey)) continue;
    tagged.push(mapConvexToAdmin(c));
  }

  // Hire posts — append unless the same post already appeared from another store.
  const seenUrls = new Set(tagged.map((r) => normalizePostUrl(r.contentUrl)).filter(Boolean));
  for (const h of hireRows) {
    const urlKey = normalizePostUrl(h.postUrl);
    if (urlKey && seenUrls.has(urlKey)) continue;
    if (urlKey) seenUrls.add(urlKey);
    tagged.push(mapHireToAdmin(h));
  }

  return tagged.sort((a, b) => {
    const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return tb - ta;
  });
}
