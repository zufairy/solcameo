/**
 * Pure gating for the creator-facing "Reclaim remaining" action (return the
 * unspent campaign-escrow USDC to the creator after expiry).
 *
 * Kept side-effect-free (no wallet / RPC / React) so the money-safety gate can be
 * unit-tested in isolation. The component wires this to the live on-chain escrow
 * balance (getEscrowBalance) and the connected wallet; this function only encodes
 * WHETHER a reclaim is allowed given already-observed facts. The ON-CHAIN program
 * is the real authority — `refund_remaining` re-checks the deadline + grace and
 * the creator seed — this mirror just decides what the UI shows/enables.
 */

/**
 * Grace window (SECONDS) after `deadline_unix` before the creator may sweep the
 * remainder. MUST mirror `REFUND_GRACE_SECS` in
 * programs/vello-escrow/src/lib.rs (currently `6 * 60 * 60`). Single-sourced here
 * so the client hint and the on-chain rule can't silently drift — if the on-chain
 * constant changes, change this too.
 */
export const REFUND_GRACE_SECS = 6 * 60 * 60; // 6h — mirrors lib.rs REFUND_GRACE_SECS
export const REFUND_GRACE_MS = REFUND_GRACE_SECS * 1000;

/** Wall-clock ms at which `refund_remaining` unlocks: deadline + 6h grace. */
export function reclaimUnlockMs(deadlineMs: number): number {
  return deadlineMs + REFUND_GRACE_MS;
}

export type ReclaimBlockedReason =
  /** Active signing wallet is not the campaign creator (PDA seed binds it). */
  | "not-creator"
  /** No on-chain vault to refund (v1 / unfunded — pdaAddress unset or version < 2). */
  | "not-funded"
  /** The campaign deadline has not passed yet. */
  | "before-deadline"
  /** Within the 6h dispute grace after the deadline — keeper may still crank. */
  | "grace-active"
  /** Escrow balance is 0 — everything was earned/paid, nothing to reclaim. */
  | "nothing-left";

export type ReclaimGate =
  | { ok: true; unlocksAtMs: number }
  | { ok: false; blocked: ReclaimBlockedReason; unlocksAtMs: number };

/**
 * Decide whether the connected creator may reclaim the remaining escrow now.
 *
 * Order (first failing gate wins, so the UI shows the most relevant hint):
 *   1. must be the creator's ACTIVE wallet (the on-chain seed binds it),
 *   2. must be a funded v2 vault (pdaAddress + onchainVersion >= 2),
 *   3. deadline must have passed,
 *   4. the 6h dispute grace after the deadline must have elapsed,
 *   5. the escrow must hold a positive balance.
 *
 * `escrowUsdc === null` = balance not yet read: it does NOT block here (the amount
 * gate is skipped) — the component keeps the button disabled while the read is in
 * flight and never false-blocks on a flaky read. A CONFIRMED 0 blocks with
 * "nothing-left".
 */
export function canReclaim(opts: {
  isCreator: boolean;
  pdaAddress?: string | null;
  onchainVersion?: number | null;
  deadlineMs: number;
  nowMs: number;
  escrowUsdc: number | null;
}): ReclaimGate {
  const { isCreator, pdaAddress, onchainVersion, deadlineMs, nowMs, escrowUsdc } = opts;
  const unlocksAtMs = reclaimUnlockMs(deadlineMs);

  if (!isCreator) return { ok: false, blocked: "not-creator", unlocksAtMs };
  if (!pdaAddress || (onchainVersion ?? 1) < 2) {
    return { ok: false, blocked: "not-funded", unlocksAtMs };
  }
  if (nowMs < deadlineMs) return { ok: false, blocked: "before-deadline", unlocksAtMs };
  if (nowMs < unlocksAtMs) return { ok: false, blocked: "grace-active", unlocksAtMs };
  // Amount gate LAST. Null = unknown/loading → don't block (component gates the
  // loading state). A read that resolved to ~0 means the budget was fully paid out.
  if (escrowUsdc !== null && escrowUsdc <= 1e-9) {
    return { ok: false, blocked: "nothing-left", unlocksAtMs };
  }
  return { ok: true, unlocksAtMs };
}
