import { describe, expect, it } from "vitest";
import { toAutoClipCandidates, type EvaluatedCampaign } from "./campaignEvaluate";

function campaign(overrides: Partial<EvaluatedCampaign> = {}): EvaluatedCampaign {
  return {
    id: "campaign-1", campaignId: "campaign-1", rail: "onchain", title: "Test campaign",
    verdict: "join", score: 1, reasons: [], expectedViews: 1000, expectedPayoutUsdc: 1,
    estCostUsdc: 0.1, netUsdc: 0.9, ratePerThousandViews: 1,
    budgetRemainingUsdc: 10, sources: [{ sourceUrl: "https://example.com/video.mp4", name: "Source" }],
    membership: "active", decidedBy: "agent", ...overrides,
  };
}

describe("autonomous campaign candidates", () => {
  it("requires auto-join consent for agent-made memberships", () => {
    expect(toAutoClipCandidates([campaign()], 6, false)).toEqual([]);
    expect(toAutoClipCandidates([campaign()], 6, true)).toHaveLength(1);
  });

  it("allows owner-approved campaigns without auto-join consent", () => {
    expect(toAutoClipCandidates([campaign({ decidedBy: "operator" })], 6, false)).toHaveLength(1);
  });

  it("requires a specific owner approval for profile-link CTA campaigns", () => {
    expect(toAutoClipCandidates([campaign({ requiresProfileCta: true })], 6, true)).toEqual([]);
    expect(toAutoClipCandidates([campaign({ requiresProfileCta: true, decidedBy: "operator" })], 6, true)).toHaveLength(1);
  });

  it("never picks off-chain rewards, unfunded skips, or campaigns without a source", () => {
    expect(toAutoClipCandidates([
      campaign({ id: "reward", rail: "content_reward", contentRewardId: "reward", campaignId: undefined }),
      campaign({ id: "skipped", membership: "skipped" }),
      campaign({ id: "source-less", sources: [] }),
    ], 6, true)).toEqual([]);
  });

  it("always works a campaign the OPERATOR joined, even if the agent scored it a skip, and puts it first", () => {
    const out = toAutoClipCandidates([
      campaign({ id: "agent-pick", campaignId: "agent-pick", title: "Agent pick" }),
      campaign({ id: "mine", campaignId: "mine", title: "Operator pick", verdict: "skip", decidedBy: "operator" }),
    ], 6, true);
    expect(out.map((c) => c.campaignId)).toEqual(["mine", "agent-pick"]);
    // ...but never one the operator LEFT, and never a source-less one.
    expect(toAutoClipCandidates([campaign({ decidedBy: "operator", membership: "left" })], 6, true)).toEqual([]);
    expect(toAutoClipCandidates([campaign({ decidedBy: "operator", sources: [] })], 6, true)).toEqual([]);
  });
});
