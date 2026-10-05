import { describe, it, expect } from "vitest";
import { evaluateCampaignEligibility, preferredPostPlatform } from "./campaignEligibility";

const SKILLS = ["vello.campaigns", "social.uploadpost"];

describe("evaluateCampaignEligibility", () => {
  it("blocks when the Vello Campaigns skill is missing", () => {
    const e = evaluateCampaignEligibility({ installedSkills: ["social.uploadpost"], connectedPlatforms: ["tiktok"], campaignPlatforms: ["tiktok"] });
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe("need_campaigns_skill");
  });

  it("blocks when the social skill is missing", () => {
    const e = evaluateCampaignEligibility({ installedSkills: ["vello.campaigns"], connectedPlatforms: [], campaignPlatforms: [] });
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe("need_social_skill");
  });

  it("blocks when no social account is connected", () => {
    const e = evaluateCampaignEligibility({ installedSkills: SKILLS, connectedPlatforms: [], campaignPlatforms: ["tiktok"] });
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe("need_connection");
  });

  it("blocks when the connected platform doesn't match the campaign's required platform", () => {
    const e = evaluateCampaignEligibility({ installedSkills: SKILLS, connectedPlatforms: ["instagram"], campaignPlatforms: ["tiktok"] });
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe("need_platform");
    expect(e.missingPlatforms).toEqual(["tiktok"]);
  });

  it("allows when a connected platform matches the campaign requirement", () => {
    const e = evaluateCampaignEligibility({ installedSkills: SKILLS, connectedPlatforms: ["instagram", "tiktok"], campaignPlatforms: ["tiktok"] });
    expect(e.eligible).toBe(true);
    expect(e.eligiblePlatforms).toEqual(["tiktok"]);
    expect(preferredPostPlatform(e)).toBe("tiktok");
  });

  it("treats an empty platform requirement as any connected platform", () => {
    const e = evaluateCampaignEligibility({ installedSkills: SKILLS, connectedPlatforms: ["threads"], campaignPlatforms: [] });
    expect(e.eligible).toBe(true);
    expect(e.eligiblePlatforms).toEqual(["threads"]);
  });

  it("normalizes platform aliases (twitter→x, ig→instagram)", () => {
    const e = evaluateCampaignEligibility({ installedSkills: SKILLS, connectedPlatforms: ["x"], campaignPlatforms: ["twitter"] });
    expect(e.eligible).toBe(true);
    expect(e.eligiblePlatforms).toEqual(["x"]);
  });
});
