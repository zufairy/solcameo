/**
 * Pure gating + deadline math for the "Migrate to on-chain vault" action —
 * escrow-ifying an EXISTING off-chain campaign (a jobtepi/content-reward or v1
 * row that has no funded vault) without re-entering any metadata. The operator
 * enters only a deposit + a per-1k rate; this module decides WHETHER a campaign
 * is migratable and picks a program-valid deadline.
 *
 * Side-effect-free (no wallet / RPC / React) so the money-safety gates are
 * unit-tested in isolation. The on-chain program is the real authority —
 * `create_campaign` re-checks the deadline window and the creator seed; this
 * mirror only decides what the UI shows/enables and pre-computes a valid
 * deadline so the wallet is never prompted for a tx that reverts on simulation.
 */

import {
  CAMPAIGN_MIN_DURATION_MS,
  CAMPAIGN_MAX_DURATION_MS,
} from "@/lib/client/launchMachine";

/** Default vault duration when the campaign's existing deadline can't be reused
 *  (missing, in the past, or beyond the program's 365d ceiling). 30d always
 *  falls inside the on-chain [now + 6h, now + 365d] window. */
export const MIGRATION_DEFAULT_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30d

/**
 * A campaign is migratable when it has NO funded on-chain vault yet — i.e. its
 * `pdaAddress` is unset OR it's still on the legacy rail (`onchainVersion < 2`)
 * — AND the caller owns it (creator wallet) or is a platform admin. Mirrors the
 * FUNDED-vault predicate used by Reclaim/oracle (`pdaAddress && version >= 2`),
 * negated: a campaign that already has a vault is NOT migratable (idempotent —
 * the button is hidden and the server refuses a re-point).
 */
export function canMigrate(opts: {
  pdaAddress?: string | null;
  onchainVersion?: number | null;
  isOwner: boolean;
}): boolean {
  const { pdaAddress, onchainVersion, isOwner } = opts;
  if (!isOwner) return false;
  const hasFundedVault = !!pdaAddress && (onchainVersion ?? 1) >= 2;
  return !hasFundedVault;
}

/**
 * Pick a program-valid deadline (wall-clock ms) for the migrated vault: REUSE
 * the campaign's existing deadline when it falls inside the on-chain window
 * [now + 6h, now + 365d], else default to now + 30d. Never returns a value
 * outside the window (defensively clamped), so `create_campaign` cannot revert
 * `InvalidDeadline`. Mirrors the resume-draft deadline refresh in lib/clippingFr.
 *
 * `existingDeadlineMs` null/NaN (no deadline on the row) → the default.
 */
export function deadlineForMigrationMs(
  existingDeadlineMs: number | null | undefined,
  nowMs: number,
): number {
  const min = nowMs + CAMPAIGN_MIN_DURATION_MS;
  const max = nowMs + CAMPAIGN_MAX_DURATION_MS;
  if (
    typeof existingDeadlineMs === "number" &&
    Number.isFinite(existingDeadlineMs) &&
    existingDeadlineMs >= min &&
    existingDeadlineMs <= max
  ) {
    return existingDeadlineMs;
  }
  // 30d is always within [6h, 365d]; clamp anyway so the invariant is bullet-proof
  // even if the constants are ever retuned.
  const fallback = nowMs + MIGRATION_DEFAULT_DURATION_MS;
  return Math.min(Math.max(fallback, min), max);
}

/** Unix-SECONDS variant (what `createCampaignTx` / the program's
 *  `deadline_unix` expect). Floors to a whole second. */
export function deadlineForMigrationUnix(
  existingDeadlineMs: number | null | undefined,
  nowMs: number,
): number {
  return Math.floor(deadlineForMigrationMs(existingDeadlineMs, nowMs) / 1000);
}
