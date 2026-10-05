import type { ClipConfig } from "../server/clipTypes";
import { computeScheduleTimes, existingPerDayFromRows } from "./dripStagger";

type Row = { scheduledFor: number; status: string; campaignId?: string };

/** Allocate atomically in the queue mutation. Campaign and own content have
 * independent daily allowances but share accounts, so never occupy one slot. */
export function allocatePostingSlot(requested: number, rows: Row[], campaignId: string | undefined, config: ClipConfig): number {
  const active = rows.filter((r) => !["cancelled", "failed"].includes(r.status));
  const policy = config.campaignPosting ? (campaignId ? config.campaignPosting : config) : undefined;
  let candidate = requested;
  if (policy) {
    const sameKind = active.filter((r) => !!r.campaignId === !!campaignId);
    const intervalMs = policy.postIntervalMs ?? 2 * 3_600_000;
    let cursor = Math.max(Date.now(), requested - intervalMs * (sameKind.length + 1));
    for (let attempt = 0; attempt <= active.length; attempt++) {
      const candidates = computeScheduleTimes(active.length + 2, {
        now: cursor, intervalMs, maxPerDay: policy.maxPerDay,
        dailyStartHour: policy.dailyStartHour, dailyStartMinute: policy.dailyStartMinute,
        timeZone: config.timezone,
        existingPerDay: existingPerDayFromRows(sameKind, cursor, config.timezone),
      });
      const free = candidates.find((slot) => slot >= requested && !active.some((r) => Math.abs(r.scheduledFor - slot) < 60_000));
      if (free !== undefined) return free;
      cursor = candidates[candidates.length - 1] + 60_000;
    }
    throw new Error("No available posting slot");
  }
  // A colliding clip must be queued too, never silently replaced by another row.
  while (active.some((r) => Math.abs(r.scheduledFor - candidate) < 60_000)) candidate += 60_000;
  return candidate;
}
