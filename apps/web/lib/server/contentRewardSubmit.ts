import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * Record a generated video link into jobtepi-web's content-rewards system
 * (the `content_rewards_submissions` table in the shared Supabase project).
 *
 * This is how a Vello agent submits its deliverable back to the main platform:
 * the agent owner's wallet is resolved to a jobtepi user, the campaign's
 * community is read from the content reward, and a submission row is inserted
 * via the service-role client (RLS-bypassing, server-only).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// content_rewards_submissions.platform is a CHECK enum — map upload-post /
// internal platform ids to the exact accepted labels. Platforms with no enum
// value (threads, linkedin) can't be recorded as a content-reward submission.
const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  ig: "Instagram",
  youtube: "YouTube",
  yt: "YouTube",
  facebook: "Facebook",
  fb: "Facebook",
  x: "X",
  twitter: "X",
};

export type ContentRewardSubmitResult =
  | { ok: true; submissionId: string; calculatedPayout: number; communityId: string }
  | { ok: false; reason: string };

export interface ContentRewardSubmitArgs {
  contentRewardId: string;
  /** The agent owner's Solana wallet — resolved to a jobtepi user id. */
  ownerWallet: string;
  /** Optional human label for an auto-created jobtepi user (the agent's name). */
  ownerName?: string;
  /** Optional avatar URL for an auto-created jobtepi user (the agent's avatar) —
   *  so the campaign Submissions list shows the agent's face, not a placeholder. */
  ownerAvatar?: string;
  /** The public post/clip URL (preferred) — what reviewers open. */
  contentUrl: string;
  /** Direct URL to the rendered video file (optional). */
  videoUrl?: string;
  platform: string;
  title?: string;
  description?: string;
  views?: number;
  /** Trusted AI-agent post → auto-approve the submission on insert (status +
   *  payout_status = "approved"). The boss's rule: an agent post counts as an
   *  approved submission immediately (no manual brand review). It is paid in USDC
   *  from the on-chain campaign treasury, NOT jobtepi's RM rail — and jobtepi's
   *  `pay-submission` only pays a row whose payout_status === "requested", which
   *  an agent row never reaches, so this can never double-pay (RM + USDC). */
  autoApprove?: boolean;
}

/**
 * Resolve (or auto-provision) the jobtepi user id for an agent owner's wallet, so
 * a Vello creator who never linked their wallet on jobtepi-web can still submit to
 * campaigns. Order:
 *   1. existing wallet_auth_bindings row → its user_id;
 *   2. else AUTO-CREATE a wallet-keyed jobtepi `users` row + binding;
 *   3. if the create is rejected (jobtepi schema FK/constraint), fall back to the
 *      configured VELLO_FALLBACK_JOBTEPI_USER_ID system user (so submissions never
 *      silently drop), else null.
 */
/** Build a NON-EMPTY, diagnosable string from a Supabase/PostgREST error — the raw
 *  `.message` is sometimes blank (the empty-error case seen in prod), so also carry
 *  `code`/`details`/`hint`. Without this the failure logs as just "users-table
 *  insert was rejected" with no cause. */
function describeSupabaseError(where: string, e: unknown): string {
  const o = (e ?? {}) as { message?: string; code?: string; details?: string; hint?: string; name?: string };
  const parts = [o.message, o.code ? `code=${o.code}` : "", o.details, o.hint ? `hint=${o.hint}` : ""].filter(Boolean);
  return `${where}: ${parts.join(" · ") || `(empty error — ${o.name ?? typeof e})`}`;
}

// The jobtepi tables (users, wallet_auth_bindings) aren't in a generated schema
// type, so the typed client narrows them to `never`; treat the client loosely
// (the whole module already casts its query results).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureJobtepiUserId(supabase: any, wallet: string, ownerName?: string, ownerAvatar?: string): Promise<{ userId: string | null; error?: string }> {
  // Key the jobtepi user PER-AGENT, not just per-wallet: one wallet can own many
  // agents, which would otherwise SHARE one user (named after whichever agent
  // submitted FIRST) → every agent's clips showed that one name. Fold the agent
  // name into the deterministic email so each agent gets its own named user. Cap
  // the local-part ≤ 64 chars (RFC) — fit the slug into the room the wallet leaves.
  const nameSlug = (ownerName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, Math.max(0, 62 - wallet.length));
  const email = nameSlug ? `${wallet}-${nameSlug}@wallet.vello.gg` : `${wallet}@wallet.vello.gg`;
  try {
    // Find an existing wallet-keyed user. Prefer the wallet_auth_bindings map, but
    // jobtepi may NOT have that table (it doesn't, in prod — a 42P01 here used to
    // abort provisioning AFTER the user was already created). So PRIMARILY match the
    // deterministic email we mint below: repeat runs stay idempotent (no duplicate
    // users, no unique-email loop) WITHOUT depending on wallet_auth_bindings.
    const bound = await supabase.from("wallet_auth_bindings").select("user_id").eq("wallet_address", wallet).maybeSingle();
    if (bound?.data?.user_id) return { userId: bound.data.user_id as string };
    const byEmail = await supabase.from("users").select("id").eq("email", email).maybeSingle();
    if (byEmail?.data?.id) return { userId: byEmail.data.id as string };

    const id = randomUUID();
    const short = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
    // name + avatar_url drive the campaign Submissions list's CREATOR column.
    const row: Record<string, unknown> = {
      id,
      username: nameSlug ? `vello_${wallet.slice(0, 6).toLowerCase()}_${nameSlug.replace(/-/g, "").slice(0, 18)}` : `vello_${wallet.slice(0, 8).toLowerCase()}`,
      name: ownerName?.slice(0, 80) || `Vello Creator ${short}`,
      email, // users.email is NOT NULL + unique — the deterministic wallet placeholder
    };
    if (ownerAvatar && /^https?:\/\//i.test(ownerAvatar)) { row.avatar_url = ownerAvatar; row.profile_image = ownerAvatar; }
    const { error: uErr } = await supabase.from("users").insert([row]);
    if (uErr) {
      // Lost the unique-email race to a concurrent create → re-read by email + use the winner.
      const raced = await supabase.from("users").select("id").eq("email", email).maybeSingle();
      if (raced?.data?.id) return { userId: raced.data.id as string };
      console.warn(`[contentRewardSubmit] auto-create jobtepi user failed for ${wallet}: ${describeSupabaseError("users insert", uErr)}`);
      const fallback = (process.env.VELLO_FALLBACK_JOBTEPI_USER_ID ?? "").trim();
      if (fallback) return { userId: fallback };
      return { userId: null, error: describeSupabaseError("users insert", uErr) };
    }
    // Best-effort wallet binding — jobtepi may not have this table; NEVER fail the
    // provisioning on it (the email lookup above already covers repeat runs).
    await supabase.from("wallet_auth_bindings").insert([{ wallet_address: wallet, user_id: id }]).then(() => {}, () => {});
    return { userId: id };
  } catch (e) {
    // Unexpected throw (network/etc.) — surface, don't crash the submit.
    const errMsg = (e instanceof Error ? (e.message || e.name) : String(e)) || "unknown error";
    console.warn(`[contentRewardSubmit] jobtepi user provisioning threw for ${wallet}: ${errMsg}`);
    const fallback = (process.env.VELLO_FALLBACK_JOBTEPI_USER_ID ?? "").trim();
    if (fallback) return { userId: fallback };
    return { userId: null, error: errMsg };
  }
}

export async function submitContentRewardLink(
  args: ContentRewardSubmitArgs,
): Promise<ContentRewardSubmitResult> {
  if (!SUPABASE_URL || !SUPABASE_SRV_KEY) return { ok: false, reason: "supabase_not_configured" };

  const platform = PLATFORM_LABELS[args.platform.toLowerCase().trim()];
  if (!platform) return { ok: false, reason: `unsupported_platform:${args.platform}` };
  if (!args.contentUrl || !/^https?:\/\//i.test(args.contentUrl)) return { ok: false, reason: "invalid_content_url" };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRV_KEY);

  // 1) Resolve (or auto-provision) the agent owner's wallet → jobtepi user id, so
  //    a creator who never linked on jobtepi-web can still submit (no manual step).
  const { userId, error: provisionError } = await ensureJobtepiUserId(supabase, args.ownerWallet, args.ownerName, args.ownerAvatar);
  if (!userId) {
    return { ok: false, reason: provisionError ? `no_jobtepi_user_for_wallet: ${provisionError}` : "no_jobtepi_user_for_wallet" };
  }

  // 2) Read the campaign to get its community + payout rate.
  const { data: reward } = await supabase
    .from("content_rewards")
    .select("id, community_id, reward_rate, max_payout, flat_fee_bonus, status")
    .eq("id", args.contentRewardId)
    .maybeSingle();
  const r = reward as {
    community_id?: string; reward_rate?: number | string;
    max_payout?: number | string; flat_fee_bonus?: number | string; status?: string;
  } | null;
  if (!r || !r.community_id) return { ok: false, reason: "content_reward_not_found" };
  if (r.status && r.status !== "active") return { ok: false, reason: `campaign_${r.status}` };

  // 3) Payout estimate (mirrors jobtepi-web: per-1k-views, +flat bonus, capped).
  const views = Math.max(0, Math.floor(args.views ?? 0));
  const rate = parseFloat(String(r.reward_rate ?? 0)) || 0;
  const maxP = parseFloat(String(r.max_payout ?? 0)) || 0;
  const flat = parseFloat(String(r.flat_fee_bonus ?? 0)) || 0;
  let calculatedPayout = views >= 1000 && rate > 0
    ? Math.max(Math.floor(views / 1000) * 1000, 1000) * (rate / 1000)
    : 0;
  if (flat > 0 && calculatedPayout > 0) calculatedPayout += flat;
  if (maxP > 0) calculatedPayout = Math.min(calculatedPayout, maxP);

  // 4) Idempotency guard. A clip can be submitted twice for the SAME
  //    (content_reward_id, user_id, content_url): an inline auto-post stalls
  //    "posting" → reapStaleJobs reverts it to ready → the drip re-claims and
  //    posts+submits AGAIN (also reachable via drip + a later manual re-post of the
  //    same clip). Without a check the unconditional insert below mints a duplicate
  //    /stage/reward display row. Pre-read for an existing submission on that triple;
  //    if one exists, return it (no-op the duplicate) — never a money-path change,
  //    these rows are auto-approved and never enter jobtepi's RM pay rail.
  //    NOTE (human follow-up): the fully race-safe closure is a Postgres UNIQUE INDEX
  //    on content_rewards_submissions (content_reward_id, user_id, content_url) in the
  //    jobtepi DB + an upsert onConflict. This code-side pre-read closes the common
  //    SEQUENTIAL duplicate; a rare concurrent double-insert still makes 2 rows (same
  //    as today) until that index lands.
  const { data: existingSub } = await supabase
    .from("content_rewards_submissions")
    .select("id")
    .eq("content_reward_id", args.contentRewardId)
    .eq("user_id", userId)
    .eq("content_url", args.contentUrl)
    .maybeSingle();
  if (existingSub && (existingSub as { id?: string }).id) {
    return { ok: true, submissionId: (existingSub as { id: string }).id, calculatedPayout, communityId: r.community_id };
  }

  // 5) Insert the submission (pending review). The DB trigger fills the
  //    platform-fee columns; the oracle reviews views/status afterwards.
  const { data: inserted, error } = await supabase
    .from("content_rewards_submissions")
    .insert([{
      content_reward_id: args.contentRewardId,
      user_id: userId,
      community_id: r.community_id,
      platform,
      content_url: args.contentUrl,
      video_url: args.videoUrl ?? null,
      content_title: args.title?.slice(0, 255),
      content_description: args.description?.slice(0, 2000),
      views,
      calculated_payout: calculatedPayout,
      // Trusted agent posts land APPROVED (no manual review); their money is the
      // USDC treasury, so payout_status is "approved" — deliberately NEVER
      // "requested", the only state jobtepi's RM pay-submission acts on.
      status: args.autoApprove ? "approved" : "pending",
      payout_status: args.autoApprove ? "approved" : "pending",
    }])
    .select("id")
    .single();

  if (error || !inserted) return { ok: false, reason: error?.message ?? "insert_failed" };
  return { ok: true, submissionId: (inserted as { id: string }).id, calculatedPayout, communityId: r.community_id };
}
