import { describe, expect, it } from "vitest";
import {
  canMigrate,
  deadlineForMigrationMs,
  deadlineForMigrationUnix,
  MIGRATION_DEFAULT_DURATION_MS,
} from "./campaignMigrate";
import {
  CAMPAIGN_MIN_DURATION_MS,
  CAMPAIGN_MAX_DURATION_MS,
  campaignDeadlineError,
} from "./client/launchMachine";

const NOW = Date.UTC(2026, 6, 5, 12, 0, 0); // 2026-07-05T12:00Z
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("canMigrate", () => {
  it("allows an owner on a v1/unfunded campaign (no pdaAddress)", () => {
    expect(canMigrate({ pdaAddress: undefined, onchainVersion: undefined, isOwner: true })).toBe(true);
    expect(canMigrate({ pdaAddress: null, onchainVersion: 1, isOwner: true })).toBe(true);
  });

  it("allows an owner when a pdaAddress exists but the row is still v1 (< 2)", () => {
    // A forged/leftover pdaAddress on the legacy rail is NOT a funded vault.
    expect(canMigrate({ pdaAddress: "PDAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", onchainVersion: 1, isOwner: true })).toBe(true);
  });

  it("refuses when the campaign already has a funded v2 vault", () => {
    expect(canMigrate({ pdaAddress: "PDAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", onchainVersion: 2, isOwner: true })).toBe(false);
    expect(canMigrate({ pdaAddress: "PDAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", onchainVersion: 3, isOwner: true })).toBe(false);
  });

  it("refuses a non-owner even on an unfunded campaign", () => {
    expect(canMigrate({ pdaAddress: undefined, onchainVersion: undefined, isOwner: false })).toBe(false);
  });
});

describe("deadlineForMigrationMs", () => {
  it("reuses the existing deadline when inside the on-chain window", () => {
    const existing = NOW + 45 * DAY; // well within [6h, 365d]
    expect(deadlineForMigrationMs(existing, NOW)).toBe(existing);
  });

  it("keeps a deadline exactly on the min/max boundary", () => {
    const min = NOW + CAMPAIGN_MIN_DURATION_MS;
    const max = NOW + CAMPAIGN_MAX_DURATION_MS;
    expect(deadlineForMigrationMs(min, NOW)).toBe(min);
    expect(deadlineForMigrationMs(max, NOW)).toBe(max);
  });

  it("defaults to now + 30d when the existing deadline is in the past", () => {
    expect(deadlineForMigrationMs(NOW - 10 * DAY, NOW)).toBe(NOW + MIGRATION_DEFAULT_DURATION_MS);
  });

  it("defaults to now + 30d when the existing deadline is too soon (< 6h)", () => {
    expect(deadlineForMigrationMs(NOW + HOUR, NOW)).toBe(NOW + MIGRATION_DEFAULT_DURATION_MS);
  });

  it("defaults to now + 30d when the existing deadline is beyond 365d", () => {
    expect(deadlineForMigrationMs(NOW + 400 * DAY, NOW)).toBe(NOW + MIGRATION_DEFAULT_DURATION_MS);
  });

  it("defaults when there is no deadline (null / NaN)", () => {
    expect(deadlineForMigrationMs(null, NOW)).toBe(NOW + MIGRATION_DEFAULT_DURATION_MS);
    expect(deadlineForMigrationMs(undefined, NOW)).toBe(NOW + MIGRATION_DEFAULT_DURATION_MS);
    expect(deadlineForMigrationMs(Number.NaN, NOW)).toBe(NOW + MIGRATION_DEFAULT_DURATION_MS);
  });

  it("always returns a value the program accepts (campaignDeadlineError === null)", () => {
    for (const existing of [null, NOW - DAY, NOW + HOUR, NOW + 45 * DAY, NOW + 400 * DAY]) {
      const ms = deadlineForMigrationMs(existing, NOW);
      expect(campaignDeadlineError(ms, NOW)).toBeNull();
    }
  });
});

describe("deadlineForMigrationUnix", () => {
  it("is the ms result floored to whole seconds", () => {
    const existing = NOW + 45 * DAY;
    expect(deadlineForMigrationUnix(existing, NOW)).toBe(Math.floor(existing / 1000));
  });

  it("is inside the program's unix window", () => {
    const unix = deadlineForMigrationUnix(null, NOW);
    const nowSec = Math.floor(NOW / 1000);
    expect(unix).toBeGreaterThanOrEqual(nowSec + CAMPAIGN_MIN_DURATION_MS / 1000);
    expect(unix).toBeLessThanOrEqual(nowSec + CAMPAIGN_MAX_DURATION_MS / 1000);
  });
});
