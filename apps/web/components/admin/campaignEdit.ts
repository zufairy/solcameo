/* Pure helpers for the admin Campaigns table inline editors. Side-effect-free
 * (no React / Convex) so the funded-campaign predicate + the deadline<->date-input
 * conversions can be unit-tested in isolation.
 *
 * All edits from the Campaigns table are DB-ONLY (they patch the Convex row via
 * admin.updateCampaign; they never move on-chain USDC or touch escrow terms).
 * `campaignIsFunded` flags the rows where that distinction is load-bearing. */

/** Narrow shape of the on-chain funding fields we key off of. */
export type FundingFields = {
  pdaAddress?: string | null;
  onchainVersion?: number | null;
};

/**
 * A campaign is FUNDED on-chain when it has an escrow PDA AND is on the v2
 * treasury rail. For such a campaign the ON-CHAIN terms are authoritative:
 * the deadline is IMMUTABLE and the rate can only move via update_campaign_rate.
 * So a DB rate/deadline edit here is DISPLAY-ONLY — the real payout uses the
 * on-chain terms. Mirrors the FUNDED-vault predicate used by Reclaim/oracle
 * everywhere (`pdaAddress && version >= 2`).
 */
export function campaignIsFunded(c: FundingFields): boolean {
  return !!c.pdaAddress && (c.onchainVersion ?? 1) >= 2;
}

/** Format a stored deadline (ISO, or any Date-parseable string) as the
 *  `YYYY-MM-DD` value an <input type="date"> expects. Unparseable/empty → "". */
export function deadlineToDateInput(deadline: string | null | undefined): string {
  if (!deadline) return "";
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** Convert a date-input `YYYY-MM-DD` value back to the ISO string we persist.
 *  Empty/unparseable → null (caller should skip the patch). Mirrors the
 *  campaign-form date→ISO round-trip. */
export function dateInputToDeadline(value: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}
