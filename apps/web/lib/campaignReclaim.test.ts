import { describe, expect, it } from "vitest";
import {
  canReclaim,
  reclaimUnlockMs,
  REFUND_GRACE_MS,
  REFUND_GRACE_SECS,
} from "./campaignReclaim";

const NOW = Date.UTC(2026, 6, 4, 12, 0, 0); // 2026-07-04T12:00Z
const HOUR = 60 * 60 * 1000;

/** A funded v2 campaign whose deadline is already 1 day in the past (so grace
 *  has elapsed) — the "all good" baseline each test perturbs one field of. */
const good = () => ({
  isCreator: true,
  pdaAddress: "PDAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  onchainVersion: 2,
  deadlineMs: NOW - 24 * HOUR,
  nowMs: NOW,
  escrowUsdc: 42.5,
});

describe("REFUND_GRACE constant mirrors the on-chain value", () => {
  it("is 6 hours in seconds and ms", () => {
    expect(REFUND_GRACE_SECS).toBe(6 * 60 * 60);
    expect(REFUND_GRACE_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("reclaimUnlockMs = deadline + 6h", () => {
    expect(reclaimUnlockMs(NOW)).toBe(NOW + 6 * HOUR);
  });
});

describe("canReclaim", () => {
  it("allows when creator, funded v2, past deadline+grace, positive balance", () => {
    const g = canReclaim(good());
    expect(g.ok).toBe(true);
    expect(g.unlocksAtMs).toBe(good().deadlineMs + REFUND_GRACE_MS);
  });

  it("blocks a non-creator wallet", () => {
    const g = canReclaim({ ...good(), isCreator: false });
    expect(g).toMatchObject({ ok: false, blocked: "not-creator" });
  });

  it("blocks a v1 campaign (onchainVersion < 2)", () => {
    const g = canReclaim({ ...good(), onchainVersion: 1 });
    expect(g).toMatchObject({ ok: false, blocked: "not-funded" });
  });

  it("blocks when onchainVersion is missing (defaults to v1)", () => {
    const g = canReclaim({ ...good(), onchainVersion: null });
    expect(g).toMatchObject({ ok: false, blocked: "not-funded" });
  });

  it("blocks when there is no vault PDA", () => {
    expect(canReclaim({ ...good(), pdaAddress: undefined })).toMatchObject({
      ok: false,
      blocked: "not-funded",
    });
    expect(canReclaim({ ...good(), pdaAddress: null })).toMatchObject({
      ok: false,
      blocked: "not-funded",
    });
  });

  it("blocks before the deadline with reason before-deadline", () => {
    const g = canReclaim({ ...good(), deadlineMs: NOW + 3 * HOUR });
    expect(g).toMatchObject({ ok: false, blocked: "before-deadline" });
  });

  it("blocks within the 6h grace after the deadline with reason grace-active", () => {
    // Deadline was 1h ago → still 5h of grace left.
    const g = canReclaim({ ...good(), deadlineMs: NOW - 1 * HOUR });
    expect(g).toMatchObject({ ok: false, blocked: "grace-active" });
  });

  it("unlocks exactly at deadline + 6h (boundary)", () => {
    const deadlineMs = NOW - REFUND_GRACE_MS; // grace ends exactly at NOW
    expect(canReclaim({ ...good(), deadlineMs }).ok).toBe(true);
    // One ms before the boundary is still grace-active.
    expect(
      canReclaim({ ...good(), deadlineMs: deadlineMs + 1 }),
    ).toMatchObject({ ok: false, blocked: "grace-active" });
  });

  it("blocks when the escrow balance is 0 (all budget paid out)", () => {
    const g = canReclaim({ ...good(), escrowUsdc: 0 });
    expect(g).toMatchObject({ ok: false, blocked: "nothing-left" });
  });

  it("treats a dust balance as nothing-left", () => {
    expect(canReclaim({ ...good(), escrowUsdc: 1e-12 })).toMatchObject({
      ok: false,
      blocked: "nothing-left",
    });
  });

  it("does NOT block on an unread (null) balance — component gates loading", () => {
    // A flaky/pending balance read must not false-block the gate; the amount check
    // is skipped and the other gates pass.
    expect(canReclaim({ ...good(), escrowUsdc: null }).ok).toBe(true);
  });

  it("prioritises the earliest failing gate (non-creator over time/amount)", () => {
    const g = canReclaim({
      ...good(),
      isCreator: false,
      deadlineMs: NOW + 100 * HOUR,
      escrowUsdc: 0,
    });
    expect(g).toMatchObject({ ok: false, blocked: "not-creator" });
  });
});
