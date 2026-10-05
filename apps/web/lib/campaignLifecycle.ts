/**
 * Campaign lifecycle + join-eligibility helpers.
 *
 * The stored `campaigns.status` field is FROZEN at "open" forever — `create`
 * sets it and nothing ever transitions it (see convex/campaigns.ts
 * `deriveCampaignStatus`). So any consumer that filters on `status === "open"`
 * (or `status !== "closed"`) is filtering on a value that never changes: ENDED
 * (past deadline) and COMPLETED (budget spent) campaigns slip straight through
 * and get surfaced as "joinable" — the "it lists deleted/removed campaigns" bug.
 *
 * This module is the SINGLE SOURCE OF TRUTH for "is this campaign live and
 * joinable right now", shared by every join surface:
 *   - app/api/agents/chat/route.ts        (minted-agent chat "join a campaign")
 *   - app/api/agents/autonomy-loop/route.ts (autonomous heartbeat planner)
 *   - app/builder/page.tsx                (influencer builder search/join tools)
 *
 * It is category-AGNOSTIC on purpose: a funded on-chain UGC campaign is exactly
 * as joinable as a clipping one (the oracle verifies views the same way for
 * both), so UGC campaigns surface identically to clipping once they are funded
 * and live.
 *
 * CLIENT-SAFE: no imports, no secrets, no server-only code. Uses a loose shape
 * so both raw Convex docs and the `Record<string, unknown>` views used by the
 * API routes can be passed without casts.
 */

/** The subset of campaign fields the lifecycle logic reads. */
export interface CampaignLifecycleFields {
  status?: unknown;
  budget?: unknown;
  spentUsdc?: unknown;
  deadline?: unknown;
  pdaAddress?: unknown;
  onchainVersion?: unknown;
  category?: unknown;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Derive a campaign's REAL lifecycle state from deadline + budget burn, since
 * the stored `status` is permanently "open". Mirrors convex/campaigns.ts
 * `deriveCampaignStatus` so on- and off-chain code agree.
 *
 * - An explicit non-"open" stored status (if one is ever written) wins.
 * - "completed" when `spentUsdc >= budget` (budget exhausted).
 * - "ended" when the deadline is in the past.
 * - "open" otherwise.
 *
 * `now` is injectable for deterministic tests (defaults to Date.now()).
 */
export function deriveCampaignStatus(
  c: CampaignLifecycleFields,
  now: number = Date.now(),
): "open" | "ended" | "completed" | string {
  if (typeof c.status === "string" && c.status && c.status !== "open") return c.status;
  const budget = num(c.budget);
  const spent = num(c.spentUsdc);
  if (budget > 0 && spent >= budget) return "completed";
  const deadlineMs = typeof c.deadline === "string" ? Date.parse(c.deadline) : NaN;
  if (!Number.isNaN(deadlineMs) && deadlineMs < now) return "ended";
  return "open";
}

/**
 * True when a campaign is FUNDED on the on-chain rail: it has a locked vault
 * (`pdaAddress`) AND is on the v2 treasury rail (`onchainVersion >= 2`). This is
 * the same predicate the clip pipeline uses (campaigns.ts
 * `getFundedByContentRewardId`) to decide a campaign can actually pay USDC.
 */
export function isFundedOnchain(c: CampaignLifecycleFields): boolean {
  const hasVault = typeof c.pdaAddress === "string" && c.pdaAddress.length > 0;
  const onchainVersion = c.onchainVersion === undefined ? 1 : num(c.onchainVersion);
  return hasVault && onchainVersion >= 2;
}

/**
 * True when an agent may join this campaign RIGHT NOW: it is funded on-chain
 * AND still live (not ended, not budget-exhausted). This is the ONE check every
 * join surface must use — never a raw `status === "open"` (frozen) comparison.
 */
export function isJoinableCampaign(
  c: CampaignLifecycleFields,
  now: number = Date.now(),
): boolean {
  return isFundedOnchain(c) && deriveCampaignStatus(c, now) === "open";
}

/**
 * True when a campaign is a UGC campaign (creators film NEW short-form content) —
 * the only kind an AI INFLUENCER can fulfil. Clipping campaigns (`category` other
 * than "ugc", e.g. "clipping") are for clipper agents, so influencer join surfaces
 * must exclude them. Board routing uses this same `category === "ugc"` check
 * (app/stage/page.tsx), so the two stay consistent.
 */
export function isUgcCampaign(c: CampaignLifecycleFields): boolean {
  return typeof c.category === "string" && c.category.toLowerCase() === "ugc";
}

/**
 * True when an AI INFLUENCER may join this campaign: joinable (funded + live) AND
 * a UGC campaign. Use on every influencer-facing join surface so the copilot never
 * offers a clipping campaign to an influencer.
 */
export function isJoinableUgcCampaign(
  c: CampaignLifecycleFields,
  now: number = Date.now(),
): boolean {
  return isUgcCampaign(c) && isJoinableCampaign(c, now);
}
