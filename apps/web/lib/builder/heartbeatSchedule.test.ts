/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import {
  hashString,
  heartbeatPhase,
  nextHeartbeatFireAt,
  resolveIntervalMs,
  videosPerDayToCron,
  evaluateHeartbeatClaim,
  cronForMinGapHours,
} from "./heartbeatSchedule";

const M15 = 15 * 60_000;
const MINT_A = "Aaaa1111111111111111111111111111111111111111";
const MINT_B = "Bbbb2222222222222222222222222222222222222222";

describe("resolveIntervalMs", () => {
  it("maps known crons, defaults unknown to 15m, manual to 0", () => {
    expect(resolveIntervalMs("every_5m")).toBe(5 * 60_000);
    expect(resolveIntervalMs("manual")).toBe(0);
    expect(resolveIntervalMs(undefined)).toBe(M15);
    expect(resolveIntervalMs("nonsense")).toBe(M15);
  });
});

describe("heartbeatPhase", () => {
  it("is deterministic and within the interval window", () => {
    const p = heartbeatPhase(MINT_A, M15);
    expect(p).toBe(heartbeatPhase(MINT_A, M15)); // stable
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(M15);
  });

  it("differs across accounts (staggering)", () => {
    expect(heartbeatPhase(MINT_A, M15)).not.toBe(heartbeatPhase(MINT_B, M15));
  });
});

describe("nextHeartbeatFireAt", () => {
  it("returns a strictly-future, persistent slot (no mount drift)", () => {
    const now = 1_700_000_123_456;
    const t1 = nextHeartbeatFireAt(now, M15, MINT_A);
    expect(t1).toBeGreaterThan(now);
    // Recomputing a bit later within the SAME window yields the SAME slot —
    // this is what makes a page reload not reset the countdown.
    const t2 = nextHeartbeatFireAt(now + 30_000, M15, MINT_A);
    expect(t2).toBe(t1);
  });

  it("lands on the account's phase within the epoch grid", () => {
    const now = 1_700_000_123_456;
    const phase = heartbeatPhase(MINT_A, M15);
    const t = nextHeartbeatFireAt(now, M15, MINT_A);
    expect(t % M15).toBe(phase);
  });

  it("two accounts on the same cadence fire at different instants", () => {
    const now = 1_700_000_123_456;
    expect(nextHeartbeatFireAt(now, M15, MINT_A)).not.toBe(nextHeartbeatFireAt(now, M15, MINT_B));
  });

  it("after a slot passes, advances to the next future slot (no catch-up storms)", () => {
    const now = 1_700_000_123_456;
    const t1 = nextHeartbeatFireAt(now, M15, MINT_A);
    const t2 = nextHeartbeatFireAt(t1, M15, MINT_A);
    expect(t2).toBe(t1 + M15);
    // Even if the server was down for hours, we jump to one slot ahead, not many.
    const tFar = nextHeartbeatFireAt(t1 + 5 * M15 + 1, M15, MINT_A);
    expect(tFar).toBe(t1 + 6 * M15);
  });

  it("returns 0 for non-positive interval (manual/disabled)", () => {
    expect(nextHeartbeatFireAt(Date_now(), 0, MINT_A)).toBe(0);
  });
});

describe("hashString", () => {
  it("is a stable unsigned 32-bit value", () => {
    const h = hashString(MINT_A);
    expect(h).toBe(hashString(MINT_A));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("videosPerDayToCron", () => {
  it("maps common rates to the nearest heartbeat bucket", () => {
    expect(videosPerDayToCron(24)).toBe("every_1h");
    expect(videosPerDayToCron(12)).toBe("every_2h");
    expect(videosPerDayToCron(6)).toBe("every_4h");
    expect(videosPerDayToCron(2)).toBe("every_12h");
    expect(videosPerDayToCron(1)).toBe("every_24h");
  });
  it("0 (or less) means manual / no auto-post", () => {
    expect(videosPerDayToCron(0)).toBe("manual");
    expect(videosPerDayToCron(-3)).toBe("manual");
  });
  it("snaps in-between rates to the nearest bucket", () => {
    expect(videosPerDayToCron(3)).toBe("every_4h");
    expect(videosPerDayToCron(20)).toBe("every_1h");
  });
});

// Local helper — tests pass a fixed timestamp everywhere else; this avoids
// importing a clock just for the one manual-interval case.
function Date_now(): number {
  return 1_700_000_000_000;
}

describe("evaluateHeartbeatClaim", () => {
  const NOW = 1_000_000_000_000;

  it("does not claim a disabled/manual agent (intervalMs 0)", () => {
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: 0, mintAddress: MINT_A, storedNextFireAt: undefined });
    expect(r.claimed).toBe(false);
    expect(r.nextFireAt).toBeUndefined();
  });

  it("seeds (does not fire) an agent with no stored slot", () => {
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: M15, mintAddress: MINT_A, storedNextFireAt: undefined });
    expect(r.claimed).toBe(false);
    expect(r.nextFireAt).toBe(nextHeartbeatFireAt(NOW, M15, MINT_A));
  });

  it("claims and advances when the slot is due", () => {
    const due = NOW - 1;
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: M15, mintAddress: MINT_A, storedNextFireAt: due });
    expect(r.claimed).toBe(true);
    expect(r.nextFireAt).toBe(nextHeartbeatFireAt(NOW, M15, MINT_A));
    expect(r.nextFireAt!).toBeGreaterThan(NOW);
  });

  it("does not claim before the slot arrives", () => {
    const future = NOW + 60_000;
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: M15, mintAddress: MINT_A, storedNextFireAt: future });
    expect(r.claimed).toBe(false);
    expect(r.nextFireAt).toBeUndefined();
  });
});

// ─── Posting time + gap (Director tab "Posting Schedule") ─────────────────────

describe("every_24h interval", () => {
  it("resolves to 24 hours, not the unknown-cron 15m fallback", () => {
    // videosPerDayToCron(1) returns "every_24h" — before this entry existed the
    // resolver silently fell back to 15 MINUTES and daily agents fired 96×/day.
    expect(resolveIntervalMs(videosPerDayToCron(1))).toBe(24 * 3_600_000);
  });
});

describe("cronForMinGapHours", () => {
  it("returns null when no gap is requested", () => {
    expect(cronForMinGapHours(undefined)).toBeNull();
    expect(cronForMinGapHours(0)).toBeNull();
  });
  it("picks the smallest bucket that covers the gap", () => {
    expect(cronForMinGapHours(1)).toBe("every_1h");
    expect(cronForMinGapHours(2)).toBe("every_2h");
    expect(cronForMinGapHours(3)).toBe("every_3h");
    expect(cronForMinGapHours(5)).toBe("every_12h");
    expect(cronForMinGapHours(24)).toBe("daily");
    expect(cronForMinGapHours(99)).toBe("daily");
  });
});

describe("posting-time phase override", () => {
  const DAY = 24 * 3_600_000;
  const NINE_THIRTY = (9 * 60 + 30) * 60_000; // 09:30 UTC as ms past midnight

  it("anchors daily fires to the requested UTC time", () => {
    const now = Date.UTC(2026, 5, 11, 8, 0, 0); // 08:00 — before the anchor
    const t = nextHeartbeatFireAt(now, DAY, MINT_A, NINE_THIRTY);
    expect(t).toBe(Date.UTC(2026, 5, 11, 9, 30, 0));
    // already past the anchor → tomorrow, same time
    const now2 = Date.UTC(2026, 5, 11, 10, 0, 0);
    expect(nextHeartbeatFireAt(now2, DAY, MINT_A, NINE_THIRTY)).toBe(Date.UTC(2026, 5, 12, 9, 30, 0));
  });

  it("mods the anchor into shorter intervals (every 4h passes through it)", () => {
    const H4 = 4 * 3_600_000;
    const now = Date.UTC(2026, 5, 11, 8, 0, 0);
    const t = nextHeartbeatFireAt(now, H4, MINT_A, NINE_THIRTY);
    // grid: 01:30, 05:30, 09:30, 13:30 … UTC
    expect(t).toBe(Date.UTC(2026, 5, 11, 9, 30, 0));
  });

  it("evaluateHeartbeatClaim seeds and advances on the overridden grid", () => {
    const now = Date.UTC(2026, 5, 11, 8, 0, 0);
    const seed = evaluateHeartbeatClaim({
      now, intervalMs: DAY, mintAddress: MINT_A, storedNextFireAt: undefined, phaseOverrideMs: NINE_THIRTY,
    });
    expect(seed.claimed).toBe(false);
    expect(seed.nextFireAt).toBe(Date.UTC(2026, 5, 11, 9, 30, 0));
    const fire = evaluateHeartbeatClaim({
      now: Date.UTC(2026, 5, 11, 9, 31, 0), intervalMs: DAY, mintAddress: MINT_A,
      storedNextFireAt: seed.nextFireAt, phaseOverrideMs: NINE_THIRTY,
    });
    expect(fire.claimed).toBe(true);
    expect(fire.nextFireAt).toBe(Date.UTC(2026, 5, 12, 9, 30, 0));
  });
});
