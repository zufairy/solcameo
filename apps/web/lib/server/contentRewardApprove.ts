import { createClient } from "@supabase/supabase-js";

/**
 * Backfill the oracle-measured view count onto a jobtepi/ryze
 * `content_rewards_submissions` row AFTER the on-chain USDC payout settles.
 *
 * The agent's clip is submitted to ryze auto-approved with views=0 at post time
 * (display). Once the oracle reads the real, matured view count (and pays the
 * agent USDC from the on-chain treasury), it calls this to refresh the ryze
 * display row's view count. Best-effort: the money has already moved via the
 * Convex submission + on-chain claim, so a failure here only lags the display.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type ViewsBackfillResult = { ok: true } | { ok: false; reason: string };

/**
 * The patch written to the ryze submission. Pure / unit-testable.
 *
 * Re-affirms `status: "approved"` (the agent row was inserted approved) and sets
 * the measured `views`. It deliberately does NOT write `payout_status` — the
 * agent is paid in USDC, never RM, so the row must NEVER reach "requested" (the
 * only state jobtepi's `pay-submission` acts on). Keeping payout_status out of
 * this patch is what guarantees the backfill can't open a double-pay path.
 */
export function buildViewsBackfillPatch(views: number): { status: string; views: number; updated_at: string } {
  const v = Number.isFinite(views) ? Math.max(0, Math.floor(views)) : 0;
  return { status: "approved", views: v, updated_at: new Date().toISOString() };
}

/**
 * Write the measured views onto the ryze display submission (service-role).
 * Idempotent (re-running writes the same values) and guarded to only touch a row
 * still in the agent-approved state — so it can never override a human-driven
 * payout (agent rows never reach those, but defend anyway). Never throws on a
 * config gap; returns a structured result the caller logs.
 */
export async function updateContentRewardViews(args: { submissionId: string; views: number }): Promise<ViewsBackfillResult> {
  if (!SUPABASE_URL || !SUPABASE_SRV_KEY) return { ok: false, reason: "supabase_not_configured" };
  if (!args.submissionId) return { ok: false, reason: "missing_submission_id" };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SRV_KEY);
  const { error } = await supabase
    .from("content_rewards_submissions")
    .update(buildViewsBackfillPatch(args.views))
    .eq("id", args.submissionId)
    // Only backfill a row still in OUR agent-approved state — never overwrite a
    // row a human moved to requested/paid (defense-in-depth; agent rows don't).
    .eq("payout_status", "approved");
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
