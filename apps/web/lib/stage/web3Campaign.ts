/**
 * Pure predicate: does an organic `campaigns` row belong to the (now-removed)
 * Web3 board on /stage?
 *
 * The board routes organic campaigns by `origin` + `category`:
 *   - origin === "clipping_fr"                       → Clipping FR tab
 *   - category === "ugc"                             → UGC tab
 *   - category === "clipping"                        → Clipping tab
 *   - everything else (category "web3", absent, or   → Web3 (deleted)
 *     any unknown value)
 *
 * The Web3 concept is being deleted, so this predicate now identifies exactly the
 * rows that are NO LONGER shown anywhere on the board — and the precise set the
 * secret-gated cleanup tool (convex/adminCampaigns.ts) hard-deletes. Kept pure and
 * dependency-free so the Convex mutation, the /stage page, and the unit test all
 * share ONE rule.
 */

/** Mirror of lib/clippingFr.CLIPPING_FR_ORIGIN, duplicated as a bare literal so
 *  this stays a zero-dependency module the Convex bundler can pull in cheaply. */
export const CLIPPING_FR_ORIGIN = "clipping_fr";

export type CampaignRouting = {
  origin?: string | null;
  category?: string | null;
};

/**
 * True ONLY for a Web3-board campaign: not a Clipping FR mirror AND whose
 * `category` is neither "ugc" nor "clipping" (i.e. "web3", absent, or unknown).
 * Returns false for UGC, Clipping, and Clipping FR campaigns — so it can never
 * select one of those for deletion.
 */
export function isWeb3Campaign(c: CampaignRouting): boolean {
  if (c.origin === CLIPPING_FR_ORIGIN) return false;
  const category = (c.category ?? "").toLowerCase();
  return category !== "ugc" && category !== "clipping";
}
