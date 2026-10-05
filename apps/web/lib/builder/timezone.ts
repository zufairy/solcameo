/**
 * Pure, dependency-free IANA-timezone math built on `Intl.DateTimeFormat`.
 *
 * The clipper scheduler stores every `scheduledFor` as an ABSOLUTE epoch-ms
 * instant — a timezone never changes WHEN something is stored, only what
 * WALL-CLOCK time a slot lands on and which calendar DAY it buckets into.
 * These helpers convert between an epoch instant and the wall-clock parts in a
 * given zone (DST-correct), so the schedule + calendar can follow an operator's
 * chosen zone without the cron needing any zone awareness.
 *
 * Note: `Intl.DateTimeFormat.formatToParts` accepts an epoch-ms NUMBER directly,
 * so none of these build a `Date` object for formatting.
 */

/** The wall-clock date/time components an `epoch` instant has in zone `tz`. */
export function zonedParts(epoch: number, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(epoch)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Offset (ms) of zone `tz` from UTC at instant `epoch` (e.g. UTC+8 → +28800000). */
function zoneOffsetMs(epoch: number, tz: string): number {
  const p = zonedParts(epoch, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - epoch;
}

/**
 * The epoch-ms instant for a WALL-CLOCK time in zone `tz`. Month/day overflow is
 * handled by `Date.UTC` (e.g. day 32 → next month); the DST edge is resolved
 * with a single correction pass (the offset at the first guess may differ from
 * the offset at the resulting instant across a transition).
 */
export function zonedTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const off = zoneOffsetMs(utcGuess, tz);
  const epoch = utcGuess - off;
  const off2 = zoneOffsetMs(epoch, tz);
  return off2 === off ? epoch : utcGuess - off2;
}

/** True if `tz` is a valid IANA zone id accepted by `Intl`. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The host browser's IANA zone (falls back to "UTC" if unavailable). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A human "UTC+8" / "UTC-5:30" offset chip for zone `tz` at instant `at`. */
export function zoneOffsetLabel(tz: string, at: number): string {
  const m = Math.round(zoneOffsetMs(at, tz) / 60000);
  const sign = m >= 0 ? "+" : "-";
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  const mm = a % 60;
  return "UTC" + sign + h + (mm ? ":" + String(mm).padStart(2, "0") : "");
}

/** A timezone option for the operator dropdown. */
export interface TimeZoneOption {
  /** IANA zone id, e.g. "Asia/Kuala_Lumpur". */
  tz: string;
  /** Display label (the IANA id; the UTC-offset chip is computed at render via
   *  `zoneOffsetLabel(tz, Date.now())`). */
  label: string;
}

/** The curated zone list for the scheduler dropdown. */
export const COMMON_TIMEZONES: TimeZoneOption[] = [
  { tz: "Asia/Kuala_Lumpur", label: "Asia/Kuala_Lumpur" },
  { tz: "Asia/Singapore", label: "Asia/Singapore" },
  { tz: "Asia/Jakarta", label: "Asia/Jakarta" },
  { tz: "Asia/Tokyo", label: "Asia/Tokyo" },
  { tz: "Asia/Kolkata", label: "Asia/Kolkata" },
  { tz: "Asia/Dubai", label: "Asia/Dubai" },
  { tz: "Europe/London", label: "Europe/London" },
  { tz: "Europe/Paris", label: "Europe/Paris" },
  { tz: "America/New_York", label: "America/New_York" },
  { tz: "America/Chicago", label: "America/Chicago" },
  { tz: "America/Denver", label: "America/Denver" },
  { tz: "America/Los_Angeles", label: "America/Los_Angeles" },
  { tz: "America/Sao_Paulo", label: "America/Sao_Paulo" },
  { tz: "Australia/Sydney", label: "Australia/Sydney" },
  { tz: "Pacific/Auckland", label: "Pacific/Auckland" },
  { tz: "UTC", label: "UTC" },
];
