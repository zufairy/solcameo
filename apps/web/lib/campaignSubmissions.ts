/**
 * Pure helpers for the Convex campaign detail's Submissions table.
 *
 * Context: the campaign detail used to show submissions as an auto-scrolling
 * "Recent Earners" marquee that REPEATED the single submission row to fill its
 * viewport and loop seamlessly — so one real submission read on screen as "5
 * identical earners". These helpers back a proper, de-duplicated Submissions
 * table (parity with the content_reward detail) so the display is always honest.
 */

/** Row shape returned by `api.submissions.listByCampaignEnriched`. Mirrors the
 *  query's projection; kept in this pure module so it's testable without Convex. */
export type EnrichedSubmission = {
  _id: string;
  influencerName: string;
  influencerMint: string;
  submitterWallet: string;
  avatarUrl: string | null;
  platform: string | null;
  postUrl: string | null;
  /** Native platform post id — deep-links the View modal when postUrl lags. */
  platformPostId: string | null;
  viewCount: number;
  /** Actual paid/claimable/accrued USDC the query resolved (0 until settled). */
  earningsUsdc: number;
  /** Per-post payout estimate (USDC) the oracle recorded for this row. */
  payoutAmountUsdc: number;
  /** On-chain record_performance signature for this post's ClaimRecord. */
  attestationTx: string | null;
  status: string;
  payoutTxSignature: string | null;
  createdAt: number;
};

/**
 * De-duplicate enriched submission rows by their submission `_id`, preserving
 * input order (the query returns newest-first).
 *
 * The backend already enforces ONE submission per (campaign, agent), so this is
 * defense-in-depth against any accidental duplicate row — and, crucially, it
 * guarantees the Submissions table renders each submission exactly once. (The old
 * "5 identical rows for 1 submission" symptom came from a marquee that repeated
 * the single row, not from real duplicates; this keeps the table honest even if a
 * duplicate ever slipped through.)
 */
export function dedupeSubmissions<T extends { _id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r._id)) continue;
    seen.add(r._id);
    out.push(r);
  }
  return out;
}

/**
 * Display earnings for a submission row, in USDC.
 *
 * Prefers the real paid/claimable/accrued figure the query already computed
 * (`earningsUsdc`); when that is still 0 — a freshly posted clip the oracle
 * hasn't measured yet — falls back to a views×rate estimate. Never negative.
 *
 * A brand-new post legitimately shows $0 until its views are measured: that is
 * REAL (0 measured views, no payout), not a display bug.
 */
export function submissionEarningsUsdc(
  row: { earningsUsdc: number; viewCount: number },
  ratePerThousandViews: number,
): number {
  if (row.earningsUsdc > 0) return row.earningsUsdc;
  const rate = ratePerThousandViews > 0 ? ratePerThousandViews : 0;
  const views = row.viewCount > 0 ? row.viewCount : 0;
  const est = (views / 1000) * rate;
  return est > 0 ? est : 0;
}

/**
 * Submission status → Badge palette (Tailwind bg/text/border classes).
 *
 * "Earning" states (verified, approved) read GREEN (emerald); an in-flight join is
 * amber (pending) or neutral (submitted); a rejection is red. Shared by the
 * campaign detail's Submissions table AND its View modal so both surfaces speak one
 * color language — and it mirrors the content-reward detail page's green "Approved"
 * pill. Unknown statuses fall back to neutral zinc.
 */
const SUBMISSION_STATUS_PILL: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  submitted: "bg-zinc-700/40 text-zinc-300 border-zinc-700",
  verified: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  rejected: "bg-red-500/15 text-red-400 border-red-500/25",
};

export function submissionStatusPill(status: string): string {
  return SUBMISSION_STATUS_PILL[status] ?? "bg-zinc-700/40 text-zinc-300 border-zinc-700";
}

/**
 * Format a USDC amount for display: `$0.0005`, `$0.20`, `$5.00`, `$1,234.50`.
 *
 * Sub-dollar amounts (e.g. a tiny per-view accrual) keep up to 4 decimals so they
 * don't collapse to `$0.00`; $1+ uses 2 decimals with thousands separators.
 * Non-finite / negative inputs render as `$0.00`.
 */
export function formatUsdc(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? n : 0;
  const maxDecimals = v > 0 && v < 1 ? 4 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: maxDecimals })}`;
}
