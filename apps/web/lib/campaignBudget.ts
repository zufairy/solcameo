/**
 * Money-safety helper for campaign creation.
 *
 * A MARKETING campaign pays `ratePerThousandViews` USDC per 1,000 verified
 * views out of its on-chain treasury. If the deposited budget is smaller than
 * that rate, the treasury cannot cover even a single 1,000-view payout — the
 * campaign is UNPAYABLE, yet the launch flow still takes the user's USDC and
 * locks it in escrow. This pure helper is the single source of truth for the
 * "is this budget sane?" check, shared by the client launch gate
 * (components/campaign/campaign-form.tsx) and the backend defense-in-depth
 * (convex/campaigns.ts `create`).
 *
 * CLIENT-SAFE: no imports, no secrets, no server-only code.
 */

/**
 * True when a campaign's budget can actually pay out.
 *
 * The minimum sane threshold for a per-1K-views campaign is `budget >= rate`
 * (the treasury must cover at least one 1,000-view reward). Non-marketing
 * campaigns (bounty / agent_task) don't price per-view, and a marketing
 * campaign with no configured rate has nothing to compare against, so both are
 * exempt (return true). Non-finite or negative inputs are treated as
 * insufficient (return false) — the safest default is to block.
 */
export function isBudgetSufficient(
  budget: number,
  ratePerThousandViews: number,
  campaignType: string,
): boolean {
  // Only marketing campaigns price per-1K-views — everything else is exempt.
  if (campaignType !== "marketing") return true;
  // Reject junk inputs (NaN/Infinity) rather than let them slip through.
  if (!Number.isFinite(budget) || !Number.isFinite(ratePerThousandViews)) return false;
  // No per-view rate configured → nothing to under-fund against → exempt.
  if (ratePerThousandViews <= 0) return true;
  // The treasury must cover at least one 1,000-view payout.
  return budget >= ratePerThousandViews;
}

/** Smallest campaign treasury we accept from the create form (USDC). Below this a
 *  campaign can't reach enough creators to be worth the on-chain setup. UI + zod
 *  enforced; Convex `create` is intentionally unchanged (admin/mirror callers). */
export const MIN_CAMPAIGN_BUDGET_USDC = 1000;
