/**
 * Access-control config for a fixed set of jobtepi `content_reward` CLIPPING
 * campaigns that must be VISIBLE and JOINABLE by ONE account only
 * (primaliqlabs@gmail.com and its linked wallets/agents). Every other user must
 * neither see these campaigns in any picker/list, nor be able to resolve their
 * clippable sources, nor submit/join them.
 *
 * This module is CLIENT-SAFE (no secrets, no server-only imports) so the React
 * pickers can import it to hide the restricted rows. The SERVER-side allow check
 * (which account is the allowed one) lives in `lib/server/restrictedCampaignsAuth`
 * — the client filter is display-only and is NEVER the security boundary.
 */

/** The single account allowed to see/join the restricted campaigns. Overridable
 *  via env so the allow-list target can be rotated without a code change. */
export const RESTRICTED_CAMPAIGN_EMAIL = (
  process.env.NEXT_PUBLIC_RESTRICTED_CAMPAIGN_EMAIL || "primaliqlabs@gmail.com"
).trim();

export interface RestrictedCampaign {
  /** Exact jobtepi `content_rewards.campaign_name`. */
  title: string;
  /** Resolved `content_rewards.id` (UUID) — null if it could not be resolved at
   *  build time; then matching falls back to the normalized title. */
  uuid: string | null;
}

/**
 * The 12 restricted clipping campaigns (title + resolved UUID). UUIDs were
 * resolved from jobtepi Supabase `content_rewards` by exact case-insensitive,
 * trimmed `campaign_name` match. Both a UUID hit OR a normalized-title hit marks
 * a campaign restricted, so a re-created row (new UUID, same title) stays gated.
 */
export const RESTRICTED_CAMPAIGNS: RestrictedCampaign[] = [
  { title: "Trade with Shrimp Clipping Push", uuid: "879d3634-f98f-43f4-b2ac-0c228d80f4a8" },
  { title: "Izzat SuperFlip Clipping Push", uuid: "b4e1fb99-f538-47b9-9794-b3e8b44e5062" },
  { title: "ArepFlip Jutawan Team Clipping Push", uuid: "f29eff74-196d-4bc0-bace-27f623830dca" },
  { title: "Mimie Scalping Derhaka Clipping Clipping Push", uuid: "d1e13de1-28bb-4859-98d1-a9797c4ce38a" },
  { title: "Clip Otai Earn up to RM400", uuid: "9b5dac62-dce6-44c0-a604-db37bc484d8b" },
  { title: "Aqil OneMovement Clipping Army", uuid: "0477e89a-dcb9-4e59-aed6-776d7b8f83f8" },
  { title: "Clip for Queen of Dollars", uuid: "496c4cfc-768b-41a3-9e91-ecd0b5d6ec8d" },
  { title: "Clipping for Bull Isaac", uuid: "c8f1ccc2-8d94-470a-b385-7136ea3951be" },
  { title: "daddymin geng fibo", uuid: "91287f70-acc6-4dbf-b717-89fa5da05330" },
  { title: "Jamal Nusantara Clippers", uuid: "975191dd-fbb3-4baa-ab94-28066055bba3" },
  { title: "Argos Clipping", uuid: "8f6fd91f-57e7-4a22-a3e7-26f96c44a81d" },
  { title: "Clip for MadGTR", uuid: "6f841af4-cd88-460b-bddc-0662dc31bda0" },
];

/** Case-insensitive, trimmed, internal-whitespace-collapsed title key. */
export function normalizeTitle(t: string | null | undefined): string {
  return String(t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

const RESTRICTED_UUIDS: ReadonlySet<string> = new Set(
  RESTRICTED_CAMPAIGNS.map((c) => c.uuid)
    .filter((u): u is string => !!u)
    .map((u) => u.trim().toLowerCase()),
);

const RESTRICTED_TITLES: ReadonlySet<string> = new Set(
  RESTRICTED_CAMPAIGNS.map((c) => normalizeTitle(c.title)),
);

/**
 * Is this campaign one of the restricted 12? Matches on UUID (preferred, when a
 * `contentRewardId` is supplied) OR on normalized title. Either match wins so a
 * row re-created under a fresh UUID with the same name stays restricted.
 *
 * `preferUuid` (use at ENFORCEMENT boundaries where a DEFINITIVE contentRewardId
 * is known — the campaignId→campaign resolve gate, the campaigns.list strip):
 * when a `contentRewardId` is supplied that is NOT one of the restricted UUIDs,
 * treat the campaign as a genuinely DIFFERENT one and IGNORE a title collision.
 * This stops a different-UUID PUBLIC campaign that merely shares a normalized
 * title with one of the 12 from being wrongly gated (FIX 3). It never weakens
 * the gate for the real 12: all 12 UUIDs are populated in RESTRICTED_CAMPAIGNS,
 * so a real restricted reward passed with its own content_reward id always hits
 * the UUID branch above. Default (false) keeps the OR-match — used by the
 * DISPLAY-side pickers, which prefer to over-hide (a re-created row with a fresh
 * UUID + same title stays hidden) since a client filter is never the security
 * boundary. KNOWN TRADEOFF of preferUuid: a genuinely re-created restricted row
 * under a brand-new UUID with the same title is NOT caught at the enforcement
 * boundary by title alone — acceptable because a re-created row and an unrelated
 * same-title row are indistinguishable, and re-created rows are re-linked by
 * contentRewardId when the mirror/backfill re-resolves them.
 */
export function isRestrictedCampaign(opts: {
  contentRewardId?: string | null;
  title?: string | null;
  preferUuid?: boolean;
}): boolean {
  const id = String(opts.contentRewardId ?? "").trim().toLowerCase();
  if (id && RESTRICTED_UUIDS.has(id)) return true;
  // A supplied-but-unknown UUID is a definitive DIFFERENT campaign — don't fall
  // through to a (possibly coincidental) title match at enforcement boundaries.
  if (opts.preferUuid && id) return false;
  const title = normalizeTitle(opts.title);
  if (title && RESTRICTED_TITLES.has(title)) return true;
  return false;
}

/** True when `email` is the single allowed account's email (case-insensitive).
 *  A missing/blank email is NEVER allowed (fail closed). */
export function isAllowedRestrictedEmail(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  return e.length > 0 && e === RESTRICTED_CAMPAIGN_EMAIL.toLowerCase();
}
