import { describe, it, expect } from "vitest";
import { scoreCampaignFit, rankCampaigns, nicheFit, median, DEFAULT_EXPECTED_VIEWS, type FitAgent, type FitCampaign } from "./campaignFit";

const NOW = 1_800_000_000_000;
const agent: FitAgent = { niche: "crypto", estCostUsdc: 0.5, connectedPlatforms: ["tiktok", "instagram"], medianViews: 2000, sampleCount: 5 };
const camp = (over: Partial<FitCampaign> = {}): FitCampaign => ({
  id: "c1", rail: "onchain", title: "Test", ratePerThousandViews: 3, budgetRemainingUsdc: 500, budgetUsdc: 1000,
  targetNiche: ["crypto"], platforms: ["tiktok"], deadlineAt: NOW + 7 * 86_400_000, sourceCount: 4, ...over,
});

describe("nicheFit", () => {
  it("exact > overlap > all > none", () => {
    expect(nicheFit("crypto", ["crypto"])).toBe(1);
    expect(nicheFit("crypto trading", ["crypto"])).toBe(0.85);
    expect(nicheFit("cooking", ["all"])).toBe(0.7);
    expect(nicheFit("cooking", ["crypto"])).toBe(0);
  });
});

describe("scoreCampaignFit", () => {
  it("joins a profitable, matching, funded campaign and explains why", () => {
    const v = scoreCampaignFit(agent, camp(), NOW);
    expect(v.verdict).toBe("join");
    expect(v.expectedViews).toBe(2000);
    expect(v.expectedPayoutUsdc).toBeCloseTo(6, 2);
    expect(v.netUsdc).toBeCloseTo(5.5, 2);
    expect(v.reasons.join(" ")).toMatch(/niche matches exactly/);
    expect(v.reasons.join(" ")).toMatch(/can post on tiktok/);
  });
  it("skips when the rate can't cover the clip cost", () => {
    const v = scoreCampaignFit(agent, camp({ ratePerThousandViews: 0.2 }), NOW);
    expect(v.verdict).toBe("skip");
    expect(v.reasons.at(-1)).toMatch(/below the .* floor/);
  });
  it("skips a niche mismatch, a platform mismatch, a near deadline, an empty treasury, no sources", () => {
    expect(scoreCampaignFit(agent, camp({ targetNiche: ["cooking"] }), NOW).reasons.at(-1)).toMatch(/niche mismatch/);
    expect(scoreCampaignFit(agent, camp({ platforms: ["youtube"] }), NOW).reasons.at(-1)).toMatch(/none connected/);
    expect(scoreCampaignFit(agent, camp({ deadlineAt: NOW + 3_600_000 }), NOW).reasons.at(-1)).toMatch(/deadline in/);
    expect(scoreCampaignFit(agent, camp({ budgetRemainingUsdc: 0.5 }), NOW).reasons.at(-1)).toMatch(/treasury nearly empty/);
    expect(scoreCampaignFit(agent, camp({ sourceCount: 0 }), NOW).reasons.at(-1)).toMatch(/no source videos/);
    expect(scoreCampaignFit(agent, camp({ blocked: "restricted to invited agents" }), NOW).reasons.at(-1)).toMatch(/restricted/);
  });
  it("new agent uses the default prior and per-clip cap applies", () => {
    const fresh: FitAgent = { niche: "crypto", estCostUsdc: 0.5 };
    const v = scoreCampaignFit(fresh, camp({ ratePerThousandViews: 10, maxPayoutUsdc: 2 }), NOW);
    expect(v.expectedViews).toBe(DEFAULT_EXPECTED_VIEWS);
    expect(v.expectedPayoutUsdc).toBe(2); // 8 uncapped → capped to 2
    expect(v.verdict).toBe("join");
  });
  it("ranks: higher net first, urgency and treasury health shape the score, skips last", () => {
    const ranked = rankCampaigns(agent, [
      camp({ id: "low", ratePerThousandViews: 1 }),
      camp({ id: "high", ratePerThousandViews: 5 }),
      camp({ id: "urgent", ratePerThousandViews: 5, deadlineAt: NOW + 2 * 86_400_000 }),
      camp({ id: "drained", ratePerThousandViews: 5, budgetRemainingUsdc: 100 }),
      camp({ id: "bad", targetNiche: ["cooking"] }),
    ], NOW);
    expect(ranked.map((r) => r.campaignId)).toEqual(["urgent", "high", "drained", "low", "bad"]);
    expect(ranked.at(-1)!.verdict).toBe("skip");
  });
});

describe("median", () => {
  it("handles odd, even, empty", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
