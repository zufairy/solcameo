/**
 * Spacing between consecutive drip posts — one clip every 2 hours by default.
 * Shared by the manual DripBar ("Start drip") in output-preview.tsx and the
 * canvas auto-post scheduler in ClippingFlowCanvas.tsx so the two paths can
 * never drift apart. This is also the default value of clipConfig.postIntervalMs
 * (see DEFAULT_CLIP_CONFIG in lib/builder/clipConfig.ts).
 *
 * The flat (no daily cap) scheduler computes
 * `scheduledFor = now + (i + 1) * intervalMs` for the i-th clip (1-indexed
 * offset — the first clip posts ~1 interval out, not immediately).
 */
export const DRIP_STAGGER_MS = 2 * 60 * 60 * 1000;

import { zonedParts, zonedTimeToEpoch, isValidTimeZone } from "@/lib/builder/timezone";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Selectable publish order for the auto-post drip (clipConfig.postOrder). */
export type PostOrder = "best" | "newest" | "oldest" | "random";

/**
 * Order clips for publishing. The drip then stamps ASCENDING timestamps onto
 * this order (first element = earliest slot), so this is the single place that
 * decides which clip goes out first. Shared by every producer so they agree.
 *  - best   : viralScore desc (tie-break createdAt desc) — the default.
 *  - newest : createdAt desc.  - oldest : createdAt asc.  - random : shuffle.
 * Items missing createdAt sort as 0 (keeps their incoming order for newest/oldest
 * — e.g. canvas items arrive already viralScore-ranked).
 */
export function orderClips<T extends { viralScore?: number; createdAt?: number }>(
  items: T[],
  mode: PostOrder = "best",
): T[] {
  const arr = [...items];
  switch (mode) {
    case "newest":
      return arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    case "oldest":
      return arr.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    case "random": {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    case "best":
    default:
      return arr.sort(
        (a, b) => ((b.viralScore ?? 0) - (a.viralScore ?? 0)) || ((b.createdAt ?? 0) - (a.createdAt ?? 0)),
      );
  }
}

/** A scheduledContent row as far as day-bucketing cares — the slot time plus a
 *  status we can exclude on. Both the manual DripBar and the canvas auto-post
 *  path pass live `scheduledContent.listByMint` rows here. */
type ScheduledRowLike = { scheduledFor?: number; status?: string };

/**
 * Build the per-day counts of clips ALREADY scheduled for an agent, bucketed by
 * calendar day: index 0 = today (the day containing `now`), 1 = tomorrow…
 * Feed the result into `computeScheduleTimes({ existingPerDay })` so a second
 * drip seeds the earliest free slot and never exceeds the daily cap.
 *
 * Counts any not-cancelled/failed row on TODAY-or-later — INCLUDING rows whose
 * slot already elapsed but are still 'scheduled'/'posting' (the cron lags up to
 * 5 min). Past-DAY rows are dropped (dayOffset < 0). This mirrors the canvas
 * auto-scheduler so the manual and auto paths bucket identically.
 *
 * `timeZone` (optional): when set, each row is bucketed by its ZONED calendar
 * day — the day boundary is the operator's chosen zone's midnight, so a row that
 * is "tomorrow" in host-local but still "today" in the zone (or vice-versa) lands
 * in the same bucket the zoned `computeScheduleTimes` will fill, keeping the
 * per-zoned-day cap honest. When omitted, the EXACT host-local behavior is kept
 * (so the existing unit tests are unaffected). A bad IANA string falls back to
 * host-local rather than throwing inside Intl.
 */
export function existingPerDayFromRows(
  rows: ScheduledRowLike[] | undefined | null,
  now: number,
  timeZone?: string,
): number[] {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : undefined;
  const startOfToday = startOfDay(now, tz);
  const out: number[] = [];
  for (const r of rows ?? []) {
    const ts = r.scheduledFor;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (r.status === "cancelled" || r.status === "failed") continue;
    // Bucket by the number of CALENDAR days between today's start and the row's
    // start, both taken in the effective zone. Differencing two zoned midnights
    // (each already snapped to a real local-midnight instant) and rounding makes
    // the bucket DST-proof — a 23h/25h local day can't push a row off-by-one.
    const dayOffset = tz
      ? Math.round((startOfDay(ts, tz) - startOfToday) / DAY_MS)
      : Math.floor((ts - startOfToday) / DAY_MS);
    if (dayOffset < 0) continue;
    out[dayOffset] = (out[dayOffset] ?? 0) + 1;
  }
  return out;
}

export interface ComputeScheduleOpts {
  /** Spacing between slots, in ms (normalized clipConfig.postIntervalMs). */
  intervalMs: number;
  /** Max posts per calendar day. Falsy/0 = OFF/unlimited (flat spacing). */
  maxPerDay?: number;
  /**
   * Optional per-day counts of clips ALREADY scheduled, index 0 = today (the day
   * containing `now`), index 1 = tomorrow, etc. Used to seed the earliest free
   * day/slot so a re-run does not exceed the daily cap. Ignored when maxPerDay
   * is falsy.
   */
  existingPerDay?: number[];
  /** Current epoch ms — passed in by the caller (the helper never reads the clock). */
  now: number;
  /** Optional daily START hour 0..23 (clipConfig.dailyStartHour). When set, each
   *  day's first slot is anchored to this local clock time instead of now+interval
   *  / midnight+interval. */
  dailyStartHour?: number;
  /** Daily start minute 0..59, paired with dailyStartHour (default 0). */
  dailyStartMinute?: number;
  /** Optional IANA zone the schedule + day-bucketing should follow (DST-correct).
   *  When omitted, every wall-clock helper keeps the EXACT host-local behavior. */
  timeZone?: string;
}

/** Start-of-day (midnight) for an epoch-ms instant, returned as epoch ms. With a
 *  `tz`, midnight is computed in that zone (DST-correct); otherwise host-local. */
function startOfDay(now: number, tz?: string): number {
  if (tz) {
    const P = zonedParts(now, tz);
    return zonedTimeToEpoch(P.year, P.month, P.day, 0, 0, tz);
  }
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The next occurrence of clock time h:m at-or-after `now` (today if it hasn't
 *  passed, else tomorrow). Built from wall-clock date COMPONENTS (not a fixed-ms
 *  offset) so the anchor lands on the right clock time across DST. With a `tz`,
 *  the wall-clock is interpreted in that zone; otherwise host-local. */
function startOfDayAt(now: number, h: number, m: number, tz?: string): number {
  if (tz) {
    const P = zonedParts(now, tz);
    let t = zonedTimeToEpoch(P.year, P.month, P.day, h, m, tz);
    if (t < now) t = zonedTimeToEpoch(P.year, P.month, P.day + 1, h, m, tz);
    return t;
  }
  const d = new Date(now);
  let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
  if (t < now) t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m, 0, 0).getTime();
  return t;
}

/** `anchorMs` advanced by `days` calendar days, re-anchored to clock h:m.
 *  Using date COMPONENTS (not + days*DAY_MS) keeps the clock time correct across
 *  a DST transition — a fixed 24h step would slip ±1h on a 23h/25h local day.
 *  With a `tz`, the calendar walk + wall-clock are interpreted in that zone. */
export function addLocalDays(anchorMs: number, days: number, h: number, m: number, tz?: string): number {
  if (tz) {
    const P = zonedParts(anchorMs, tz);
    return zonedTimeToEpoch(P.year, P.month, P.day + days, h, m, tz);
  }
  const d = new Date(anchorMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, h, m, 0, 0).getTime();
}

/**
 * Compute `scheduledFor` epoch-ms timestamps for `count` clips.
 *
 * Strategy A — schedule-time day-bucketing, so the cron needs NO change (it just
 * fires whatever is due). Two modes:
 *
 *  - No daily cap (maxPerDay falsy/0): flat spacing, `now + (i + 1) * intervalMs`.
 *  - With a daily cap: clip index i lands on day `floor(i/maxPerDay)` in slot
 *    `i % maxPerDay`. DAY 0 (today) anchors at `now + intervalMs` so today's slots
 *    are never scheduled in the past; later days anchor at their local midnight +
 *    intervalMs (calendar-aligned cap). A daily-start time overrides the anchor.
 *    When `existingPerDay` is provided, already-used slots are consumed first so
 *    the per-day cap holds across re-runs.
 *
 *    Each day's slots are additionally clamped to those that land STRICTLY BEFORE
 *    the next day's anchor: when `now` (or the daily-start hour) is late in the
 *    day, a full day's worth of slots would otherwise run past the next local
 *    midnight/anchor — breaching the next CALENDAR day's cap and even producing an
 *    EXACT-duplicate epoch (slot k of day d == day d+1's slot 0 → double-post).
 *    The overflow rolls forward as additional day buckets so the per-calendar-day
 *    cap holds and no two timestamps are ever equal.
 */
export function computeScheduleTimes(count: number, opts: ComputeScheduleOpts): number[] {
  const { intervalMs, maxPerDay, existingPerDay, now, dailyStartHour, dailyStartMinute } = opts;
  // Validate the zone ONCE here so a bad/legacy IANA string (clipConfig is v.any(),
  // so a hand-edited Convex doc can bypass normalizeClipConfig) can never make Intl
  // throw inside the wall-clock helpers and crash the real queue — fall back to
  // host-local instead. Covers all callers (forecast + canvas auto-post + DripBar).
  const timeZone = opts.timeZone && isValidTimeZone(opts.timeZone) ? opts.timeZone : undefined;
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];

  // When a daily start time is set, each day's first slot is anchored to that
  // local clock time (e.g. 09:00) instead of now+interval / midnight+interval.
  const hasStart = typeof dailyStartHour === "number" && dailyStartHour >= 0 && dailyStartHour <= 23;
  const startAnchor = hasStart ? startOfDayAt(now, dailyStartHour as number, dailyStartMinute ?? 0, timeZone) : null;

  // Flat path — no daily cap.
  if (!maxPerDay || maxPerDay <= 0) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      // With a daily start: first post AT the anchor, then spaced. Without: the
      // legacy one-interval-out offset (first post ~1 interval from now).
      out.push(startAnchor !== null ? startAnchor + i * intervalMs : now + (i + 1) * intervalMs);
    }
    return out;
  }

  // Effective per-day cap: never schedule more slots than fit within a day at
  // this interval, so a day's slots can't cross midnight (cap × interval > 24h
  // would otherwise collide with the next day's slot-0 / post out of order).
  const slotsPerDay = Math.max(1, Math.floor(DAY_MS / Math.max(1, intervalMs)));
  const cap = Math.max(1, Math.min(Math.floor(maxPerDay), slotsPerDay));

  // The CALENDAR day index counts whole days from today (the day containing
  // `now`); dayIdx 0 = today, 1 = tomorrow… `dayMidnight(d)` is that day's local
  // midnight, walked DST-safely via wall-clock COMPONENTS (not d*DAY_MS, which
  // slips ±1h across a DST transition). The per-day cap is keyed off this real
  // calendar day so two anchors can never share a day and double its budget.
  const today0 = startOfDay(now, timeZone);
  const dayMidnight = (d: number): number => (d === 0 ? today0 : addLocalDays(today0, d, 0, 0, timeZone));

  // Each calendar day's slot-0 anchor:
  //  - daily-start set: that local clock time on day d (rolls fwd day-by-day).
  //  - else day 0 (today): `now + intervalMs` so a fresh drip's first slot is
  //    ~now and never in the past; later days: their local midnight + interval.
  // existingPerDay is indexed from TODAY (index 0 = today) — the SAME calendar
  // day index — so it lines up directly (no anchor shift needed now that the
  // index is the calendar day rather than a free-running bucket).
  // The first anchor's calendar day: 0 = today, or rolls to tomorrow when the
  // anchor (a daily-start hour already passed, or now+interval crossing midnight)
  // lands on the next day. Keying the WHOLE walk to the REAL calendar day prevents
  // two day-indices from stacking on the same physical day and doubling its cap.
  const day0Anchor = startAnchor !== null ? startAnchor : now + intervalMs;
  const firstCalDay = Math.round((startOfDay(day0Anchor, timeZone) - today0) / DAY_MS);
  // Slot-0 anchor for calendar day `cd` (counted from today). The FIRST real day
  // uses the exact now/daily-start anchor; later days anchor at their daily-start
  // clock time, else local midnight + one interval — clamped so a degenerate 24h
  // interval can't push slot-0 onto the next midnight (which would loop forever).
  const anchorForCalDay = (cd: number): number =>
    cd === firstCalDay
      ? day0Anchor
      : startAnchor !== null
        ? addLocalDays(today0, cd, dailyStartHour as number, dailyStartMinute ?? 0, timeZone)
        : Math.min(dayMidnight(cd) + intervalMs, dayMidnight(cd + 1) - intervalMs);
  const existing = existingPerDay ?? [];
  // existingPerDay is indexed by calendar day from today (index 0 = today) — the
  // SAME index as `cd`, so it lines up directly (no anchor-shift needed).
  const existAt = (cd: number) => existing[cd] ?? 0;

  // Walk calendar days from the first anchor day, filling each up to `cap`, seeded
  // from the existing counts. A slot is emitted only while it lands BEFORE that
  // day's next local midnight; overflow rolls to the next calendar day (its OWN cap
  // + existing budget), so no calendar day exceeds the cap and no two timestamps
  // share an epoch. `cd` only ever increases and is bounded by `maxCd`, so the walk
  // can never loop forever (a monotonic backstop against any future edge case).
  const out: number[] = [];
  const maxCd = firstCalDay + n + existing.length + 2;
  let cd = firstCalDay;
  while (existAt(cd) >= cap && cd < maxCd) cd++;
  let slot = existAt(cd);
  for (let i = 0; i < n; i++) {
    while ((slot >= cap || anchorForCalDay(cd) + slot * intervalMs >= dayMidnight(cd + 1)) && cd < maxCd) {
      cd++;
      while (existAt(cd) >= cap && cd < maxCd) cd++;
      slot = existAt(cd);
    }
    out.push(anchorForCalDay(cd) + slot * intervalMs);
    slot++;
  }
  return out;
}
