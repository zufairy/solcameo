import { describe, expect, it } from "vitest";
import {
  dedupeSubmissions,
  submissionEarningsUsdc,
  submissionStatusPill,
  formatUsdc,
  type EnrichedSubmission,
} from "./campaignSubmissions";

const row = (over: Partial<EnrichedSubmission> = {}): EnrichedSubmission => ({
  _id: "s1",
  influencerName: "Pro Maxer",
  influencerMint: "mint1",
  submitterWallet: "wallet1",
  avatarUrl: null,
  platform: "tiktok",
  postUrl: null,
  platformPostId: null,
  viewCount: 0,
  earningsUsdc: 0,
  payoutAmountUsdc: 0,
  attestationTx: null,
  status: "submitted",
  payoutTxSignature: null,
  createdAt: 1_700_000_000_000,
  ...over,
});

describe("dedupeSubmissions", () => {
  it("collapses repeated _ids to one row (the marquee-repetition symptom)", () => {
    const one = row({ _id: "s1" });
    const repeated = [one, one, one, one, one]; // what the old marquee rendered
    const out = dedupeSubmissions(repeated);
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe("s1");
  });

  it("keeps distinct submissions and preserves newest-first order", () => {
    const a = row({ _id: "a", createdAt: 3 });
    const b = row({ _id: "b", createdAt: 2 });
    const c = row({ _id: "c", createdAt: 1 });
    const out = dedupeSubmissions([a, b, c, b, a]);
    expect(out.map((r) => r._id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for no rows", () => {
    expect(dedupeSubmissions([])).toEqual([]);
  });
});

describe("submissionEarningsUsdc", () => {
  it("prefers the real settled earnings when present", () => {
    expect(submissionEarningsUsdc(row({ earningsUsdc: 12.5, viewCount: 9999 }), 0.2)).toBe(12.5);
  });

  it("is 0 for a freshly posted clip (0 views, unsettled) — real, not a bug", () => {
    expect(submissionEarningsUsdc(row({ earningsUsdc: 0, viewCount: 0 }), 0.2)).toBe(0);
  });

  it("estimates from views×rate when not yet settled", () => {
    // 10,000 views at $0.20 / 1K = $2.00
    expect(submissionEarningsUsdc(row({ earningsUsdc: 0, viewCount: 10_000 }), 0.2)).toBeCloseTo(2, 6);
  });

  it("never returns a negative number", () => {
    expect(submissionEarningsUsdc(row({ earningsUsdc: 0, viewCount: -50 }), 0.2)).toBe(0);
    expect(submissionEarningsUsdc(row({ earningsUsdc: 0, viewCount: 1000 }), -5)).toBe(0);
  });
});

describe("submissionStatusPill", () => {
  it("colors verified AND approved green (emerald) — the 'earning' states", () => {
    const emerald = "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
    expect(submissionStatusPill("verified")).toBe(emerald);
    expect(submissionStatusPill("approved")).toBe(emerald);
  });

  it("colors pending amber, submitted neutral, rejected red", () => {
    expect(submissionStatusPill("pending")).toContain("amber");
    expect(submissionStatusPill("submitted")).toContain("zinc");
    expect(submissionStatusPill("rejected")).toContain("red");
  });

  it("falls back to neutral zinc for an unknown status", () => {
    expect(submissionStatusPill("weird")).toBe("bg-zinc-700/40 text-zinc-300 border-zinc-700");
  });
});

describe("formatUsdc", () => {
  it("keeps sub-dollar precision so tiny per-view payouts don't collapse to $0.00", () => {
    expect(formatUsdc(0.0005)).toBe("$0.0005");
    expect(formatUsdc(0.2)).toBe("$0.20");
  });

  it("uses 2 decimals + thousands separators for $1 and above", () => {
    expect(formatUsdc(5)).toBe("$5.00");
    expect(formatUsdc(1234.5)).toBe("$1,234.50");
  });

  it("renders $0.00 for zero, negative, or non-finite input", () => {
    expect(formatUsdc(0)).toBe("$0.00");
    expect(formatUsdc(-3)).toBe("$0.00");
    expect(formatUsdc(NaN)).toBe("$0.00");
  });
});
