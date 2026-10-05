import { describe, it, expect } from "vitest";
import { DRIP_STAGGER_MS, computeScheduleTimes, orderClips, existingPerDayFromRows } from "./dripStagger";
import { zonedParts, zonedTimeToEpoch } from "./timezone";
import { normalizeClipConfig } from "./clipConfig";

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed local-midnight instant keeps startOfDay deterministic across the suite.
const MIDNIGHT = new Date(2026, 5, 16, 0, 0, 0, 0).getTime();

describe("computeScheduleTimes — flat path (no daily cap)", () => {
  it("spaces clips at now + (i+1)*intervalMs", () => {
    const now = MIDNIGHT + 5 * 60 * 1000; // arbitrary
    const t = computeScheduleTimes(3, { intervalMs: DRIP_STAGGER_MS, maxPerDay: 0, now });
    expect(t).toEqual([
      now + 1 * DRIP_STAGGER_MS,
      now + 2 * DRIP_STAGGER_MS,
      now + 3 * DRIP_STAGGER_MS,
    ]);
  });

  it("treats undefined maxPerDay as flat", () => {
    const now = MIDNIGHT;
    const t = computeScheduleTimes(2, { intervalMs: 900000, now });
    expect(t).toEqual([now + 900000, now + 2 * 900000]);
  });

  it("returns [] for count <= 0", () => {
    expect(computeScheduleTimes(0, { intervalMs: 900000, now: MIDNIGHT })).toEqual([]);
    expect(computeScheduleTimes(-3, { intervalMs: 900000, now: MIDNIGHT })).toEqual([]);
  });
});

describe("auto-post cadence contract (Bug B: stagger, never post instantly)", () => {
  // finalizeJob's cloud auto-post reads normalizeClipConfig(agent.clipConfig) then
  // feeds postIntervalMs / maxPerDay into computeScheduleTimes — the exact path the
  // "Auto-post: one every 2h" Publish node advertises. The bug published every clip
  // at `now` (a tight inline loop); the contract is a DRIP_STAGGER_MS-spaced queue.
  it("default clip config staggers by DRIP_STAGGER_MS with the FIRST post one interval out (never now)", () => {
    const cfg = normalizeClipConfig({});
    const now = MIDNIGHT + 7 * 60 * 1000;
    const times = computeScheduleTimes(3, {
      intervalMs: cfg.postIntervalMs ?? DRIP_STAGGER_MS,
      maxPerDay: cfg.maxPerDay,
      now,
    });
    // No clip is scheduled at or before `now` — never an instant post.
    for (const t of times) expect(t).toBeGreaterThan(now);
    // First post one full 2h interval out; consecutive posts 2h apart.
    expect(times[0]).toBe(now + DRIP_STAGGER_MS);
    expect(times[1] - times[0]).toBe(DRIP_STAGGER_MS);
    expect(times[2] - times[1]).toBe(DRIP_STAGGER_MS);
  });

  it("a custom 30-min interval staggers at 30-min spacing (honors the configured cadence)", () => {
    const cfg = normalizeClipConfig({ postIntervalMs: 30 * 60 * 1000 } as never);
    const now = MIDNIGHT;
    const times = computeScheduleTimes(4, {
      intervalMs: cfg.postIntervalMs ?? DRIP_STAGGER_MS,
      maxPerDay: cfg.maxPerDay,
      now,
    });
    const step = 30 * 60 * 1000;
    expect(times).toEqual([now + step, now + 2 * step, now + 3 * step, now + 4 * step]);
  });
});

describe("computeScheduleTimes — cap bucketing", () => {
  it("buckets 7 clips at maxPerDay 3 into days of size [3,3,1]", () => {
    const interval = 900000;
    const t = computeScheduleTimes(7, { intervalMs: interval, maxPerDay: 3, now: MIDNIGHT });
    // Bucket by day-offset from local midnight.
    const counts: Record<number, number> = {};
    for (const ts of t) {
      const dayOffset = Math.floor((ts - MIDNIGHT) / DAY_MS);
      counts[dayOffset] = (counts[dayOffset] ?? 0) + 1;
    }
    expect(counts[0]).toBe(3);
    expect(counts[1]).toBe(3);
    expect(counts[2]).toBe(1);
  });

  it("places each day's slots at midnight + (slot+1)*interval", () => {
    const interval = 900000;
    const t = computeScheduleTimes(4, { intervalMs: interval, maxPerDay: 2, now: MIDNIGHT });
    // day0 slots 0,1 ; day1 slots 0,1 — each with the one-interval first-slot offset.
    expect(t[0]).toBe(MIDNIGHT + interval + 0 * interval);
    expect(t[1]).toBe(MIDNIGHT + interval + 1 * interval);
    expect(t[2]).toBe(MIDNIGHT + DAY_MS + interval + 0 * interval);
    expect(t[3]).toBe(MIDNIGHT + DAY_MS + interval + 1 * interval);
  });

  it("seeds from existingPerDay so a re-run does not exceed the cap", () => {
    const interval = 900000;
    // Today already has 2 of a cap of 3 → only 1 free slot today, rest spills to day1.
    const t = computeScheduleTimes(3, {
      intervalMs: interval,
      maxPerDay: 3,
      existingPerDay: [2],
      now: MIDNIGHT,
    });
    const counts: Record<number, number> = {};
    for (const ts of t) {
      const dayOffset = Math.floor((ts - MIDNIGHT) / DAY_MS);
      counts[dayOffset] = (counts[dayOffset] ?? 0) + 1;
    }
    expect(counts[0]).toBe(1); // the single remaining slot today
    expect(counts[1]).toBe(2); // remainder rolls to tomorrow
    // The day-0 clip takes slot index 2 (after the 2 existing).
    expect(t[0]).toBe(MIDNIGHT + interval + 2 * interval);
  });

  it("skips fully-booked existing days entirely", () => {
    const interval = 900000;
    // Today full (3/3) → first clip must land tomorrow at slot 0.
    const t = computeScheduleTimes(1, {
      intervalMs: interval,
      maxPerDay: 3,
      existingPerDay: [3],
      now: MIDNIGHT,
    });
    expect(t[0]).toBe(MIDNIGHT + DAY_MS + interval);
  });

  it("day-0 anchors at NOW (capped, no daily-start) so today's slots are never in the past", () => {
    const interval = 10 * 60 * 1000; // 10 min
    const now = MIDNIGHT + 61 * 60 * 1000; // 01:01 — past the old midnight+interval anchor
    const t = computeScheduleTimes(8, { intervalMs: interval, maxPerDay: 4, now });
    // EVERY slot must be in the future (the bug shipped 00:10/00:20/00:30/00:40).
    for (const ts of t) expect(ts).toBeGreaterThanOrEqual(now);
    // Today's first slot = now + one interval (matches the flat path's first-post offset).
    expect(t[0]).toBe(now + interval);
    expect(t[3]).toBe(now + 4 * interval); // 4th of today's 4
    // Day 1 (slot 5) rolls to TOMORROW's local midnight + interval (calendar-aligned cap).
    expect(t[4]).toBe(MIDNIGHT + DAY_MS + interval);
  });

  it("late-night start (now+interval crosses midnight) never exceeds the cap on any calendar day + no duplicate epochs", () => {
    const interval = 60 * 60 * 1000; // 1h
    const now = MIDNIGHT + 23 * 60 * 60 * 1000 + 30 * 60 * 1000; // 23:30 today
    const t = computeScheduleTimes(6, { intervalMs: interval, maxPerDay: 5, now });
    expect(new Set(t).size).toBe(6); // no duplicate timestamps
    for (const ts of t) expect(ts).toBeGreaterThanOrEqual(now); // all future
    const perDay: Record<number, number> = {};
    for (const ts of t) { const d = Math.floor((ts - MIDNIGHT) / DAY_MS); perDay[d] = (perDay[d] ?? 0) + 1; }
    for (const d of Object.keys(perDay)) expect(perDay[Number(d)]).toBeLessThanOrEqual(5); // no calendar day over cap
  });

  it("a 24h interval WITH a cap terminates (no infinite loop) and stays 1/day", () => {
    const interval = 24 * 60 * 60 * 1000;
    const t = computeScheduleTimes(3, { intervalMs: interval, maxPerDay: 4, now: MIDNIGHT });
    expect(t.length).toBe(3);
    expect(new Set(t).size).toBe(3);
    const perDay: Record<number, number> = {};
    for (const ts of t) { const d = Math.floor((ts - MIDNIGHT) / DAY_MS); perDay[d] = (perDay[d] ?? 0) + 1; }
    for (const d of Object.keys(perDay)) expect(perDay[Number(d)]).toBeLessThanOrEqual(1);
  });
});

describe("normalizeClipConfig — postIntervalMs >=15min clamp + maxPerDay", () => {
  it("snaps postIntervalMs onto the 15-min grid", () => {
    // 20 minutes is not a 15-min multiple → snaps to the nearest grid point (15min).
    const c = normalizeClipConfig({ postIntervalMs: 20 * 60 * 1000 } as never);
    expect(c.postIntervalMs).toBe(15 * 60 * 1000);
  });

  it("allows a 1-min test interval (sub-15-min snaps to whole minutes)", () => {
    const c = normalizeClipConfig({ postIntervalMs: 60 * 1000 } as never); // 1 min
    expect(c.postIntervalMs).toBe(60 * 1000);
    // 7 min stays 7 min (whole-minute grid below 15 min).
    expect(normalizeClipConfig({ postIntervalMs: 7 * 60 * 1000 } as never).postIntervalMs).toBe(7 * 60 * 1000);
  });

  it("floors a sub-1-min interval up to 1 min", () => {
    const c = normalizeClipConfig({ postIntervalMs: 30 * 1000 } as never); // 30s
    expect(c.postIntervalMs).toBe(60 * 1000);
  });

  it("clamps a too-large interval down to 24h", () => {
    const c = normalizeClipConfig({ postIntervalMs: 72 * 60 * 60 * 1000 } as never); // 3 days
    expect(c.postIntervalMs).toBe(24 * 60 * 60 * 1000);
  });

  it("defaults postIntervalMs to DRIP_STAGGER_MS and maxPerDay to 0", () => {
    const c = normalizeClipConfig({});
    expect(c.postIntervalMs).toBe(DRIP_STAGGER_MS);
    expect(c.maxPerDay).toBe(0);
  });

  it("defaults postOrder to 'best' and coerces junk; omits daily start unless set", () => {
    expect(normalizeClipConfig({}).postOrder).toBe("best");
    expect(normalizeClipConfig({ postOrder: "newest" } as never).postOrder).toBe("newest");
    expect(normalizeClipConfig({ postOrder: "garbage" } as never).postOrder).toBe("best");
    expect(normalizeClipConfig({}).dailyStartHour).toBeUndefined();
    const withStart = normalizeClipConfig({ dailyStartHour: 9, dailyStartMinute: 30 } as never);
    expect(withStart.dailyStartHour).toBe(9);
    expect(withStart.dailyStartMinute).toBe(30);
    // out-of-range hour clamps; minute defaults 0
    expect(normalizeClipConfig({ dailyStartHour: 99 } as never).dailyStartHour).toBe(23);
    expect(normalizeClipConfig({ dailyStartHour: 9 } as never).dailyStartMinute).toBe(0);
  });
});

describe("orderClips", () => {
  const clips = [
    { id: "a", viralScore: 10, createdAt: 100 },
    { id: "b", viralScore: 90, createdAt: 200 },
    { id: "c", viralScore: 50, createdAt: 300 },
  ];
  it("best = viralScore desc", () => {
    expect(orderClips(clips, "best").map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
  it("newest = createdAt desc, oldest = createdAt asc", () => {
    expect(orderClips(clips, "newest").map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect(orderClips(clips, "oldest").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("does not mutate the input array", () => {
    const copy = [...clips];
    orderClips(clips, "best");
    expect(clips).toEqual(copy);
  });
  it("random returns the same set (a permutation)", () => {
    const r = orderClips(clips, "random");
    expect(r.map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("computeScheduleTimes — daily start trigger", () => {
  it("flat path anchors the first post at the daily start clock time", () => {
    const now = MIDNIGHT + 6 * 60 * 60 * 1000; // 06:00
    const t = computeScheduleTimes(2, { intervalMs: 60 * 60 * 1000, maxPerDay: 0, now, dailyStartHour: 9, dailyStartMinute: 0 });
    expect(t[0]).toBe(MIDNIGHT + 9 * 60 * 60 * 1000); // today 09:00
    expect(t[1]).toBe(MIDNIGHT + 10 * 60 * 60 * 1000); // +1h
  });
  it("rolls to tomorrow when the start time already passed today", () => {
    const now = MIDNIGHT + 14 * 60 * 60 * 1000; // 14:00, past 09:00
    const t = computeScheduleTimes(1, { intervalMs: 60 * 60 * 1000, maxPerDay: 0, now, dailyStartHour: 9 });
    expect(t[0]).toBe(MIDNIGHT + DAY_MS + 9 * 60 * 60 * 1000); // tomorrow 09:00
  });
  it("capped path buckets per day from the daily start anchor", () => {
    const now = MIDNIGHT + 6 * 60 * 60 * 1000;
    const t = computeScheduleTimes(3, { intervalMs: 60 * 60 * 1000, maxPerDay: 2, now, dailyStartHour: 9 });
    expect(t[0]).toBe(MIDNIGHT + 9 * 60 * 60 * 1000); // day0 slot0 = 09:00
    expect(t[1]).toBe(MIDNIGHT + 10 * 60 * 60 * 1000); // day0 slot1 = 10:00
    expect(t[2]).toBe(MIDNIGHT + DAY_MS + 9 * 60 * 60 * 1000); // day1 slot0 = next 09:00
  });
  it("effCap: maxPerDay x interval > 24h never crosses midnight (no same-ts collision, <=slotsPerDay/day)", () => {
    const now = MIDNIGHT + 60 * 1000;
    // 3h interval → only 8 slots fit a day; ask for maxPerDay 50 + 20 clips.
    const t = computeScheduleTimes(20, { intervalMs: 3 * 60 * 60 * 1000, maxPerDay: 50, now });
    expect(new Set(t).size).toBe(t.length); // no duplicate timestamps
    // No more than 8 (=24h/3h) land on any single calendar day.
    const perDay = new Map<string, number>();
    for (const ms of t) {
      const d = new Date(ms);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    for (const c of perDay.values()) expect(c).toBeLessThanOrEqual(8);
  });
  it("daily-start anchored to tomorrow ignores TODAY's existingPerDay count", () => {
    // 14:00, past the 09:00 start → anchor rolls to tomorrow. Today is already
    // full (2), but that must NOT push tomorrow's first post to slot 1.
    const now = MIDNIGHT + 14 * 60 * 60 * 1000;
    const t = computeScheduleTimes(2, { intervalMs: 60 * 60 * 1000, maxPerDay: 2, now, dailyStartHour: 9, existingPerDay: [2] });
    expect(t[0]).toBe(MIDNIGHT + DAY_MS + 9 * 60 * 60 * 1000); // tomorrow 09:00 slot0
    expect(t[1]).toBe(MIDNIGHT + DAY_MS + 10 * 60 * 60 * 1000);
  });

  it("clamps maxPerDay to 0..48 and floors fractional values", () => {
    expect(normalizeClipConfig({ maxPerDay: 99 } as never).maxPerDay).toBe(48);
    expect(normalizeClipConfig({ maxPerDay: -5 } as never).maxPerDay).toBe(0);
    expect(normalizeClipConfig({ maxPerDay: 3.9 } as never).maxPerDay).toBe(3);
  });
});

describe("computeScheduleTimes — late-now day-0 overrun (no double-post, cap holds)", () => {
  // Bucket epoch-ms timestamps by HOST-local calendar day (matches the no-tz
  // scheduler's day boundary and the rest of this suite).
  const perHostDay = (times: number[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const ms of times) {
      const d = new Date(ms);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };

  it("no-daily-start, now late (22:00): no two timestamps share an epoch and no calendar day exceeds the cap", () => {
    const interval = 60 * 60 * 1000; // 1h
    const maxPerDay = 5; // 5×1h = 5h fits well inside a day (slotsPerDay = 24)
    const now = MIDNIGHT + 22 * 60 * 60 * 1000; // 22:00 — day-0 anchor (now+1h) spills past midnight
    const t = computeScheduleTimes(20, { intervalMs: interval, maxPerDay, now });
    // No EXACT-duplicate epochs (the old bug aliased day-0 slot k onto day-1 slot 0).
    expect(new Set(t).size).toBe(t.length);
    // Every timestamp is in the future.
    for (const ts of t) expect(ts).toBeGreaterThanOrEqual(now);
    // No CALENDAR day exceeds the per-day cap.
    for (const c of perHostDay(t).values()) expect(c).toBeLessThanOrEqual(maxPerDay);
  });

  it("dailyStartHour late (22:00): no shared epoch and no calendar day exceeds the cap", () => {
    const interval = 60 * 60 * 1000; // 1h
    const maxPerDay = 5;
    const now = MIDNIGHT + 12 * 60 * 60 * 1000; // noon
    const t = computeScheduleTimes(20, {
      intervalMs: interval,
      maxPerDay,
      now,
      dailyStartHour: 22, // anchor 22:00 → a full 5-slot day would cross local midnight
      dailyStartMinute: 0,
    });
    expect(new Set(t).size).toBe(t.length);
    for (const ts of t) expect(ts).toBeGreaterThanOrEqual(now);
    for (const c of perHostDay(t).values()) expect(c).toBeLessThanOrEqual(maxPerDay);
  });
});

describe("existingPerDayFromRows + computeScheduleTimes — zoned day bucketing", () => {
  it("buckets rows by the ZONED day and the per-zoned-day total respects the cap", () => {
    // Pick a zone far from UTC so 'today in zone' vs 'today in host' can diverge.
    const tz = "Pacific/Auckland"; // UTC+12/+13 — well ahead of most hosts.
    // 'now' = 2026-06-16 20:00 in the zone: there's still room for one more slot
    // before the zoned midnight, the rest must roll to the 17th.
    const now = zonedTimeToEpoch(2026, 6, 16, 20, 0, tz);
    const interval = 60 * 60 * 1000; // 1h
    const maxPerDay = 3;

    // Build two existing rows that are 'today' (the 16th) IN THE ZONE: 22:00 and
    // 23:00. In a host BEHIND the zone these instants can read as a DIFFERENT
    // (earlier) host-local calendar day — the seam the tz arg fixes.
    const rowsToday = [
      { scheduledFor: zonedTimeToEpoch(2026, 6, 16, 22, 0, tz), status: "scheduled" },
      { scheduledFor: zonedTimeToEpoch(2026, 6, 16, 23, 0, tz), status: "scheduled" },
    ];

    const existingZoned = existingPerDayFromRows(rowsToday, now, tz);
    // Both rows fall on the zoned 'today' (index 0).
    expect(existingZoned[0]).toBe(2);
    expect(existingZoned.length).toBe(1);

    // Schedule 4 more clips in the same zone, seeded with the zoned existing.
    const times = computeScheduleTimes(4, {
      intervalMs: interval,
      maxPerDay,
      existingPerDay: existingZoned,
      now,
      timeZone: tz,
    });
    expect(new Set(times).size).toBe(times.length); // no double-post
    // Every new slot is in the future.
    for (const ts of times) expect(ts).toBeGreaterThanOrEqual(now);

    // Bucket the NEW times by the ZONED calendar day, then add the seeded
    // existing COUNT for that zoned day (existingPerDayFromRows already bucketed
    // the real rows). The TOTAL per zoned day must respect the cap: the zoned
    // 16th already has 2 → only 1 more new clip may land there, the rest roll fwd.
    const newPerZonedDay = new Map<string, number>();
    for (const ms of times) {
      const p = zonedParts(ms, tz);
      const key = `${p.year}-${p.month}-${p.day}`;
      newPerZonedDay.set(key, (newPerZonedDay.get(key) ?? 0) + 1);
    }
    const seededOn16th = existingZoned[0]; // 2
    expect((newPerZonedDay.get("2026-6-16") ?? 0) + seededOn16th).toBeLessThanOrEqual(maxPerDay);
    // Exactly the 1 remaining slot lands on the zoned 16th; 3 roll to the 17th+.
    expect(newPerZonedDay.get("2026-6-16")).toBe(1);
    for (const c of newPerZonedDay.values()) expect(c).toBeLessThanOrEqual(maxPerDay);
  });

  it("with timeZone omitted, existingPerDayFromRows keeps exact host-local bucketing", () => {
    // Two rows on host-local 'today' and one on host-local 'tomorrow'.
    const now = MIDNIGHT + 10 * 60 * 60 * 1000; // 10:00 host-local
    const rows = [
      { scheduledFor: MIDNIGHT + 11 * 60 * 60 * 1000, status: "scheduled" }, // today
      { scheduledFor: MIDNIGHT + 23 * 60 * 60 * 1000, status: "scheduled" }, // today
      { scheduledFor: MIDNIGHT + DAY_MS + 60 * 60 * 1000, status: "scheduled" }, // tomorrow
      { scheduledFor: MIDNIGHT - 60 * 60 * 1000, status: "scheduled" }, // yesterday → dropped
      { scheduledFor: MIDNIGHT + 12 * 60 * 60 * 1000, status: "cancelled" }, // excluded
    ];
    expect(existingPerDayFromRows(rows, now)).toEqual([2, 1]);
  });

  it("zoned bucketing is DST-proof across a spring-forward (23h local day)", () => {
    // US spring-forward 2026: 2026-03-08, clocks jump 02:00→03:00 (a 23h day).
    const tz = "America/New_York";
    const now = zonedTimeToEpoch(2026, 3, 8, 0, 30, tz); // just after midnight, DST day
    // One row later the SAME zoned day (after the jump), one the next zoned day.
    const rows = [
      { scheduledFor: zonedTimeToEpoch(2026, 3, 8, 20, 0, tz), status: "scheduled" }, // today (post-jump)
      { scheduledFor: zonedTimeToEpoch(2026, 3, 9, 1, 0, tz), status: "scheduled" }, // tomorrow
    ];
    // Differencing zoned midnights (not raw ms) keeps the 23h day from bumping
    // the day-0 row into a phantom bucket.
    expect(existingPerDayFromRows(rows, now, tz)).toEqual([1, 1]);
  });
});

describe("computeScheduleTimes — first slot is never before now (anchor regression)", () => {
  // The scheduler must NEVER back-date the first slot below `now`, on ANY path:
  // flat, capped, daily-start, and at every hour of the day (incl. late-night when
  // now+interval crosses midnight). This pins the "anchored to the present" rule
  // the schedule-preview anchor bug surfaced.
  const interval = 2 * 60 * 60 * 1000; // 2h
  const oneMin = 60 * 1000; // the 1-min test spacing must hold too
  const base = new Date(2026, 5, 25, 0, 0, 0, 0).getTime(); // local midnight, 25th

  it("flat / capped / daily-start: first slot >= now at every hour of the day", () => {
    for (let h = 0; h < 24; h++) {
      for (const min of [0, 13, 58]) {
        const now = base + h * 60 * 60 * 1000 + min * 60 * 1000;
        for (const intv of [interval, oneMin]) {
          const flat = computeScheduleTimes(5, { intervalMs: intv, maxPerDay: 0, now });
          expect(flat[0]).toBeGreaterThanOrEqual(now);
          expect(flat[0]).toBe(now + intv); // exactly one interval out

          const capped = computeScheduleTimes(5, { intervalMs: intv, maxPerDay: 3, now });
          for (const ts of capped) expect(ts).toBeGreaterThanOrEqual(now);

          // Daily-start anchored to a PAST clock hour (00:00) must roll forward to
          // the next valid occurrence >= now, never a back-dated slot today.
          const dstart = computeScheduleTimes(5, {
            intervalMs: intv, maxPerDay: 0, now, dailyStartHour: 0, dailyStartMinute: 0,
          });
          for (const ts of dstart) expect(ts).toBeGreaterThanOrEqual(now);
        }
      }
    }
  });
});

describe("computeScheduleTimes — no prior-day bucketing when compute zone == bucket zone (UTC+8)", () => {
  // The reported symptom: a chip whose epoch is correct (now + spacing) renders in
  // the PRIOR day cell. The defect was a tz mismatch between the zone the slot was
  // stamped in and the zone the calendar buckets it into. When those zones are the
  // SAME (the invariant the fix pins by persisting one zone), the first slot must
  // bucket into the SAME zoned calendar day as `now + spacing` — never the day
  // before. Reproduce in Asia/Kuala_Lumpur (UTC+8), now = 25th 11:58, interval 2h.
  const tz = "Asia/Kuala_Lumpur";
  const dayKey = (ms: number) => { const p = zonedParts(ms, tz); return `${p.year}-${p.month}-${p.day}`; };

  it("first preview slot lands on the same UTC+8 day as now+interval (flat)", () => {
    const now = zonedTimeToEpoch(2026, 6, 25, 11, 58, tz);
    const interval = 2 * 60 * 60 * 1000;
    const times = computeScheduleTimes(3, { intervalMs: interval, maxPerDay: 0, now, timeZone: tz });
    expect(times[0]).toBe(now + interval); // 13:58, same day
    // Bucketing the slot in the SAME zone it was computed in keeps it on the 25th.
    expect(dayKey(times[0])).toBe("2026-6-25");
    expect(dayKey(times[0])).not.toBe("2026-6-24"); // never the prior day
    for (const ts of times) expect(ts).toBeGreaterThanOrEqual(now);
  });

  it("first capped slot also stays on the current UTC+8 day", () => {
    const now = zonedTimeToEpoch(2026, 6, 25, 11, 58, tz);
    const interval = 2 * 60 * 60 * 1000;
    const times = computeScheduleTimes(3, { intervalMs: interval, maxPerDay: 4, now, timeZone: tz });
    expect(times[0]).toBe(now + interval);
    expect(dayKey(times[0])).toBe("2026-6-25");
  });
});
