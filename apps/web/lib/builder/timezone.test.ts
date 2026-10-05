import { describe, it, expect } from "vitest";
import {
  zonedParts,
  zonedTimeToEpoch,
  isValidTimeZone,
  zoneOffsetLabel,
  COMMON_TIMEZONES,
} from "./timezone";
import { computeScheduleTimes } from "./dripStagger";
import { normalizeClipConfig } from "./clipConfig";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

describe("zonedTimeToEpoch <-> zonedParts round-trip", () => {
  it("round-trips for Asia/Kuala_Lumpur (UTC+8, no DST)", () => {
    const tz = "Asia/Kuala_Lumpur";
    const epoch = zonedTimeToEpoch(2026, 6, 16, 9, 30, tz);
    const p = zonedParts(epoch, tz);
    expect(p).toMatchObject({ year: 2026, month: 6, day: 16, hour: 9, minute: 30 });
  });

  it("round-trips for UTC", () => {
    const tz = "UTC";
    const epoch = zonedTimeToEpoch(2026, 1, 1, 14, 0, tz);
    // UTC wall-clock == the absolute UTC instant.
    expect(epoch).toBe(Date.UTC(2026, 0, 1, 14, 0, 0, 0));
    const p = zonedParts(epoch, tz);
    expect(p).toMatchObject({ year: 2026, month: 1, day: 1, hour: 14, minute: 0 });
  });

  it("round-trips across an America/New_York DST boundary (spring-forward week)", () => {
    const tz = "America/New_York";
    // 2026-03-08 is the US spring-forward day; pick the afternoon AFTER the gap.
    const epoch = zonedTimeToEpoch(2026, 3, 8, 15, 0, tz);
    const p = zonedParts(epoch, tz);
    expect(p).toMatchObject({ year: 2026, month: 3, day: 8, hour: 15, minute: 0 });
    // Same wall-clock the week before (before DST) and the week after (after DST).
    const before = zonedTimeToEpoch(2026, 3, 1, 15, 0, tz); // EST (UTC-5)
    const after = zonedTimeToEpoch(2026, 3, 15, 15, 0, tz); // EDT (UTC-4)
    expect(zonedParts(before, tz)).toMatchObject({ hour: 15, day: 1 });
    expect(zonedParts(after, tz)).toMatchObject({ hour: 15, day: 15 });
    // The post-DST 15:00 is offset by 4h from UTC, the pre-DST one by 5h, so two
    // weeks (14 days) of same wall-clock differ by 14*24h MINUS the lost hour.
    expect(after - before).toBe(14 * DAY_MS - HOUR_MS);
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones and UTC", () => {
    expect(isValidTimeZone("Asia/Kuala_Lumpur")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });
  it("rejects junk", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("zoneOffsetLabel", () => {
  it("renders whole-hour and half-hour offsets", () => {
    const at = Date.UTC(2026, 5, 16, 0, 0, 0, 0); // June (no MY DST anyway)
    expect(zoneOffsetLabel("Asia/Kuala_Lumpur", at)).toBe("UTC+8");
    expect(zoneOffsetLabel("UTC", at)).toBe("UTC+0");
    expect(zoneOffsetLabel("Asia/Kolkata", at)).toBe("UTC+5:30");
    expect(zoneOffsetLabel("America/New_York", at)).toBe("UTC-4"); // EDT in June
  });
});

describe("COMMON_TIMEZONES", () => {
  it("lists ~16 valid zones, label === tz, includes KL + UTC", () => {
    expect(COMMON_TIMEZONES.length).toBe(16);
    for (const z of COMMON_TIMEZONES) {
      expect(z.label).toBe(z.tz);
      expect(isValidTimeZone(z.tz)).toBe(true);
    }
    const ids = COMMON_TIMEZONES.map((z) => z.tz);
    expect(ids).toContain("Asia/Kuala_Lumpur");
    expect(ids).toContain("UTC");
  });
});

describe("computeScheduleTimes — TZ-aware daily start", () => {
  it("daily-start 09:00 in Asia/Kuala_Lumpur (UTC+8) lands at 01:00 UTC on the right day", () => {
    const tz = "Asia/Kuala_Lumpur";
    // Pick a 'now' early on 2026-06-16 KL time (00:30 KL == 2026-06-15 16:30 UTC).
    const now = zonedTimeToEpoch(2026, 6, 16, 0, 30, tz);
    const t = computeScheduleTimes(1, {
      intervalMs: HOUR_MS,
      maxPerDay: 0,
      now,
      dailyStartHour: 9,
      dailyStartMinute: 0,
      timeZone: tz,
    });
    // 09:00 KL on 2026-06-16 == 01:00 UTC same day.
    expect(t[0]).toBe(Date.UTC(2026, 5, 16, 1, 0, 0, 0));
    // And it reads back as 09:00 in KL.
    expect(zonedParts(t[0], tz)).toMatchObject({ year: 2026, month: 6, day: 16, hour: 9, minute: 0 });
  });

  it("capped path buckets per KL day from the daily-start anchor", () => {
    const tz = "Asia/Kuala_Lumpur";
    const now = zonedTimeToEpoch(2026, 6, 16, 6, 0, tz);
    const t = computeScheduleTimes(3, {
      intervalMs: HOUR_MS,
      maxPerDay: 2,
      now,
      dailyStartHour: 9,
      timeZone: tz,
    });
    expect(zonedParts(t[0], tz)).toMatchObject({ day: 16, hour: 9 });
    expect(zonedParts(t[1], tz)).toMatchObject({ day: 16, hour: 10 });
    expect(zonedParts(t[2], tz)).toMatchObject({ day: 17, hour: 9 }); // rolls to next KL day
  });
});

describe("normalizeClipConfig — timezone", () => {
  it("keeps a valid IANA timezone", () => {
    expect(normalizeClipConfig({ timezone: "Asia/Kuala_Lumpur" } as never).timezone).toBe("Asia/Kuala_Lumpur");
    expect(normalizeClipConfig({ timezone: "UTC" } as never).timezone).toBe("UTC");
  });
  it("omits an invalid/missing timezone (host-local default)", () => {
    expect(normalizeClipConfig({ timezone: "Not/AZone" } as never).timezone).toBeUndefined();
    expect(normalizeClipConfig({ timezone: 123 } as never).timezone).toBeUndefined();
    expect(normalizeClipConfig({}).timezone).toBeUndefined();
  });
});
