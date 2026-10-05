import { CLIPPING_FR_ORIGIN } from "@/lib/clippingFr";

/**
 * Which campaigns an operator should SEE.
 *
 * `api.campaigns.list` is deliberately unfiltered — crons, the oracle and admin
 * tooling all read it, and filtering there would blind them. So every surface
 * filters client-side, and that is exactly how they drifted: the /stage board hid
 * unfunded drafts while the builder's Source picker showed anything with a source
 * URL, so campaigns long abandoned (or deleted everywhere the operator could see)
 * kept turning up in the dropdown.
 *
 * The builder may show an owner's draft for editing. Stage uses the stricter
 * isOnchainCampaign gate, so drafts and old payout rails never appear there.
 */

export interface VisibilityCampaign {
  status?: string;
  /** Set once the campaign's on-chain vault exists. The proof it is real. */
  pdaAddress?: string | null;
  onchainVersion?: number | null;
  creatorWallet?: string;
  /** The "Clipping FR" mirror rows are plumbing, never operator-pickable. */
  origin?: string;
}

/**
 * Statuses that mean "over". A campaign in one of these is not something to start
 * clipping FOR, even if its vault still exists — which is what an operator means by
 * "that one is deleted".
 */
const TERMINAL_STATUSES = new Set(["closed", "cancelled", "canceled", "completed", "deleted", "archived", "expired"]);

export function isTerminalCampaign(c: VisibilityCampaign): boolean {
  return TERMINAL_STATUSES.has((c.status ?? "").trim().toLowerCase());
}

/** Funded = a vault address exists. The only durable proof a campaign is real. */
export function isFundedCampaign(c: VisibilityCampaign): boolean {
  return !!(c.pdaAddress ?? "").trim();
}

/** Stage/payout eligibility requires the finalized v2 treasury rail, not merely
 * an address copied from an older campaign. */
export function isOnchainCampaign(c: VisibilityCampaign): boolean {
  return isFundedCampaign(c) && (c.onchainVersion ?? 1) >= 2;
}

/**
 * The builder's source-picker rule: funded, or mine. `myWallets` is the viewer's wallet set;
 * pass an empty set when the viewer is unknown, which then shows funded campaigns
 * only — the safe direction, since an unfunded stranger's draft is never useful.
 */
export function isVisibleCampaign(c: VisibilityCampaign, myWallets: ReadonlySet<string>): boolean {
  if (isTerminalCampaign(c)) return false;
  return isFundedCampaign(c) || (!!c.creatorWallet && myWallets.has(c.creatorWallet));
}

/**
 * What the builder's Source picker may offer: visible, and not a mirror row. The
 * mirror ("Clipping FR") campaigns exist to carry restricted rewards' plumbing and
 * are handled by their own picker, so offering them here is always a mistake.
 */
export function isPickableCampaign(c: VisibilityCampaign, myWallets: ReadonlySet<string>): boolean {
  return c.origin !== CLIPPING_FR_ORIGIN && isVisibleCampaign(c, myWallets);
}
