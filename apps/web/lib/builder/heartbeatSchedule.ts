// ─── Heartbeat schedule math (pure, no React/Convex deps) ─────────────────────
// Shared by the /agents countdown (client) and the Convex cron driver (server)
// so both agree on EXACTLY when an agent's next heartbeat fires.
//
// Goals:
//  • Wall-clock anchored — a fire time is a real epoch instant on a fixed grid,
//    not a value relative to when a page mounted. Surviving reloads is automatic.
//  • Per-account phase — each account is offset by a deterministic amount derived
//    from its mintAddress, so accounts are spread across the interval window and
//    never all fire (or all show the same countdown) at once.

// Per-cron interval table (ms). Mirrors the cadence values in HEARTBEAT_CRON_OPTIONS
// (lib/builder/agentTypes.ts) but lives here as a pure, dependency-free table so the
// Convex bundle can import it without pulling in client code.
export const CRON_INTERVAL_MS: Record<string, number> = {
  every_1m:  60_000,
  every_5m:  5  * 60_000,
  every_15m: 15 * 60_000,
  every_30m: 30 * 60_000,
  every_1h:  60 * 60_000,
  every_2h:  2  * 60 * 60_000,
  every_3h:  3  * 60 * 60_000,
  every_4h:  4  * 60 * 60_000,
  every_12h: 12 * 60 * 60_000,
  // Alias emitted by videosPerDayToCron(1). Without this entry the resolver
  // silently fell back to 15 MINUTES and "1 video/day" agents fired 96×/day.
  every_24h: 24 * 60 * 60_000,
  daily:     24 * 60 * 60_000,
  manual:    0, // never auto-fires
};

/** Interval in ms for a cron value. Defaults to 15m for unknown values, 0 for manual. */
export function resolveIntervalMs(cron: string | undefined): number {
  if (cron === "manual") return 0;
  return CRON_INTERVAL_MS[cron ?? "every_15m"] ?? 15 * 60_000;
}

/** Stable 32-bit hash of a string (FNV-1a). Deterministic across client/server. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in unsigned range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Per-account phase offset within the interval window, in ms.
 * Deterministic for a given (mintAddress, intervalMs): the same account always
 * lands on the same point inside every window (e.g. :07:12 past each quarter-hour).
 */
export function heartbeatPhase(mintAddress: string, intervalMs: number): number {
  if (intervalMs <= 0) return 0;
  return hashString(mintAddress) % intervalMs;
}

/**
 * The next wall-clock-aligned fire instant strictly after `now` for this account.
 *
 * Slots are positioned on the epoch grid at `k * intervalMs + phase`. We return
 * the first slot strictly greater than `now`, so:
 *  • reloading the page never changes the answer (no mount anchor),
 *  • a server that was down for several windows resumes at the NEXT future slot
 *    rather than firing repeatedly to "catch up".
 *
 * Returns 0 when the interval is non-positive (manual / disabled) — callers treat
 * 0 as "no scheduled fire".
 */
export function nextHeartbeatFireAt(
  now: number,
  intervalMs: number,
  mintAddress: string,
  phaseOverrideMs?: number,
): number {
  if (intervalMs <= 0) return 0;
  // `phaseOverrideMs` pins the grid to a wall-clock anchor instead of the
  // hash-derived stagger — ms past UTC midnight, so a daily interval fires at
  // exactly that UTC time and shorter intervals pass through it (mod interval).
  const phase = phaseOverrideMs != null
    ? ((phaseOverrideMs % intervalMs) + intervalMs) % intervalMs
    : heartbeatPhase(mintAddress, intervalMs);
  const k = Math.floor((now - phase) / intervalMs) + 1;
  return k * intervalMs + phase;
}

/**
 * Smallest cron bucket whose interval covers a requested minimum gap between
 * posts (hours). Returns null when no gap is requested. Gaps beyond the largest
 * bucket clamp to "daily".
 */
export function cronForMinGapHours(gapHours: number | undefined): string | null {
  if (!gapHours || gapHours <= 0) return null;
  const ladder: Array<{ cron: string; hours: number }> = [
    { cron: "every_1h", hours: 1 },
    { cron: "every_2h", hours: 2 },
    { cron: "every_3h", hours: 3 },
    { cron: "every_4h", hours: 4 },
    { cron: "every_12h", hours: 12 },
    { cron: "daily", hours: 24 },
  ];
  for (const b of ladder) if (b.hours >= gapHours) return b.cron;
  return "daily";
}

/**
 * Map a "videos per day" target to the nearest heartbeat cron bucket. The
 * heartbeat fires the autonomy loop which auto-creates+posts a video per fire,
 * so cadence === posts/day. 0 → "manual" (no auto-post).
 */
export function videosPerDayToCron(perDay: number): string {
  if (!Number.isFinite(perDay) || perDay <= 0) return "manual";
  // Compare on the interval (hours between fires) rather than on posts/day, so a
  // rate that sits between two buckets snaps to the nearest interval window. Ties
  // resolve to the higher-frequency (first-listed) bucket via a strict `<`.
  const buckets: { cron: string; hours: number }[] = [
    { cron: "every_1h", hours: 1 },
    { cron: "every_2h", hours: 2 },
    { cron: "every_4h", hours: 4 },
    { cron: "every_12h", hours: 12 },
    { cron: "every_24h", hours: 24 },
  ];
  const targetHours = 24 / perDay;
  let best = buckets[buckets.length - 1];
  let bestDelta = Infinity;
  for (const b of buckets) {
    const d = Math.abs(b.hours - targetHours);
    if (d < bestDelta) { bestDelta = d; best = b; }
  }
  return best.cron;
}

/**
 * Result of deciding whether a caller may fire an agent's heartbeat right now.
 * `claimed` true means THIS caller won the slot and should run the autonomy loop.
 * `nextFireAt` is the slot to persist (the advanced slot on a claim, or the
 * seeded slot when an agent is first seen). Undefined means "leave the stored
 * value unchanged".
 */
export interface HeartbeatClaim {
  claimed: boolean;
  nextFireAt?: number;
}

/**
 * Pure compare-and-advance decision shared by the Convex `claimHeartbeat`
 * mutation and any client that wants to fire. Deterministic given its inputs so
 * cron and client agree exactly.
 *
 *  • intervalMs <= 0 (manual/disabled) → never claims.
 *  • no stored slot → seed the next slot, do NOT fire (avoids a first-sight
 *    stampede; the agent fires on its own staggered clock from here).
 *  • now >= stored slot → claim and advance to the next future slot.
 *  • otherwise → not yet due.
 */
export function evaluateHeartbeatClaim(args: {
  now: number;
  intervalMs: number;
  mintAddress: string;
  storedNextFireAt: number | undefined;
  /** Wall-clock anchor (ms past UTC midnight) — see nextHeartbeatFireAt. */
  phaseOverrideMs?: number;
}): HeartbeatClaim {
  const { now, intervalMs, mintAddress, storedNextFireAt, phaseOverrideMs } = args;
  if (intervalMs <= 0) return { claimed: false };
  if (storedNextFireAt === undefined) {
    return { claimed: false, nextFireAt: nextHeartbeatFireAt(now, intervalMs, mintAddress, phaseOverrideMs) };
  }
  if (now >= storedNextFireAt) {
    return { claimed: true, nextFireAt: nextHeartbeatFireAt(now, intervalMs, mintAddress, phaseOverrideMs) };
  }
  return { claimed: false };
}
