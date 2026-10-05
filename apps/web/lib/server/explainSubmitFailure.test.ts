import { describe, it, expect } from "vitest";
import { explainSubmitFailure } from "./explainSubmitFailure";

describe("explainSubmitFailure", () => {
  // characterization — existing behavior we must keep
  it("maps no_jobtepi_user_for_wallet to an actionable hint", () => {
    expect(explainSubmitFailure("no_jobtepi_user_for_wallet")).toContain("VELLO_FALLBACK_JOBTEPI_USER_ID");
  });
  it("maps supabase_not_configured", () => {
    expect(explainSubmitFailure("supabase_not_configured")).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
  it("passes an unmapped reason through unchanged", () => {
    expect(explainSubmitFailure("some_unknown_reason")).toBe("some_unknown_reason");
  });

  // NEW: when the reason carries the real DB error after the code (from the
  // self-diagnose change in contentRewardSubmit), surface it in the run-log line.
  it("appends the real DB detail for no_jobtepi_user_for_wallet so it's diagnosable in one glance", () => {
    const out = explainSubmitFailure('no_jobtepi_user_for_wallet: permission denied for table "community_members"');
    expect(out).toContain("VELLO_FALLBACK_JOBTEPI_USER_ID"); // keeps the actionable hint
    expect(out).toContain('permission denied for table "community_members"'); // …AND the real cause
  });
});
