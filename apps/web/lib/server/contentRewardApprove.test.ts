import { describe, it, expect } from "vitest";
import { buildViewsBackfillPatch } from "./contentRewardApprove";

describe("buildViewsBackfillPatch", () => {
  it("re-affirms approved + floors views", () => {
    const p = buildViewsBackfillPatch(1234.9);
    expect(p.status).toBe("approved");
    expect(p.views).toBe(1234);
    expect(typeof p.updated_at).toBe("string");
  });

  it("NEVER writes payout_status — the backfill cannot open the RM pay path", () => {
    // The double-pay guard depends on this: a row only RM-pays at
    // payout_status==='requested'; the backfill must never touch payout_status.
    const p = buildViewsBackfillPatch(500);
    expect(Object.prototype.hasOwnProperty.call(p, "payout_status")).toBe(false);
  });

  it("clamps negative / non-finite views to 0", () => {
    expect(buildViewsBackfillPatch(-5).views).toBe(0);
    expect(buildViewsBackfillPatch(Number.NaN).views).toBe(0);
    expect(buildViewsBackfillPatch(Number.POSITIVE_INFINITY).views).toBe(0);
  });

  it("passes through a clean integer view count", () => {
    expect(buildViewsBackfillPatch(0).views).toBe(0);
    expect(buildViewsBackfillPatch(42).views).toBe(42);
  });
});
