/**
 * Vello Campaigns — join-eligibility gate.
 *
 * A campaign submission is a real social post, so an agent may only join when:
 *   1. the Vello Campaigns skill is installed,
 *   2. the Social Auto-Post (Upload-Post) skill is installed,
 *   3. at least one social account is connected, AND
 *   4. a connected account matches the campaign's required platform(s).
 *
 * This pure function is the single source of truth for that decision — used by
 * the chat-route context builder (to annotate campaigns + guide the AI), the
 * client `join_campaign` executor (hard gate), and unit tests.
 */

export const VELLO_CAMPAIGNS_SKILL_ID = "vello.campaigns";
export const SOCIAL_SKILL_ID = "social.uploadpost";

export type CampaignGateReason =
  | "need_campaigns_skill"
  | "need_social_skill"
  | "need_connection"
  | "need_platform";

export interface CampaignEligibility {
  eligible: boolean;
  reason?: CampaignGateReason;
  /** Connected platforms that satisfy this campaign (what we can post to). */
  eligiblePlatforms: string[];
  /** Platforms the campaign requires ([] = any). */
  requiredPlatforms: string[];
  /** Of the required platforms, the ones still missing a connection. */
  missingPlatforms: string[];
  /** Human-readable next step for the operator (empty when eligible). */
  guidance: string;
}

const norm = (p: string) => {
  const s = (p ?? "").toLowerCase().trim();
  if (s === "twitter") return "x";
  if (s === "insta" || s === "ig") return "instagram";
  if (s === "fb") return "facebook";
  return s;
};

export function evaluateCampaignEligibility(params: {
  installedSkills: string[] | undefined;
  connectedPlatforms: string[] | undefined;
  campaignPlatforms: string[] | undefined;
}): CampaignEligibility {
  const installed = (params.installedSkills ?? []).map((s) => s.trim());
  const connected = [...new Set((params.connectedPlatforms ?? []).map(norm).filter(Boolean))];
  const required = [...new Set((params.campaignPlatforms ?? []).map(norm).filter(Boolean))];

  const base = { requiredPlatforms: required, eligiblePlatforms: [] as string[], missingPlatforms: [] as string[] };

  if (!installed.includes(VELLO_CAMPAIGNS_SKILL_ID)) {
    return { ...base, eligible: false, reason: "need_campaigns_skill",
      guidance: "Install the Vello Campaigns skill to join brand campaigns." };
  }
  if (!installed.includes(SOCIAL_SKILL_ID)) {
    return { ...base, eligible: false, reason: "need_social_skill",
      guidance: "Install the Social Auto-Post (Upload-Post) skill — joining a campaign means publishing a post." };
  }
  if (connected.length === 0) {
    return { ...base, eligible: false, reason: "need_connection",
      guidance: "Open the Connections panel and link a social account before joining campaigns." };
  }

  // No platform requirement → any connected platform works.
  if (required.length === 0) {
    return { ...base, eligible: true, eligiblePlatforms: connected, guidance: "" };
  }

  const eligiblePlatforms = required.filter((p) => connected.includes(p));
  const missingPlatforms = required.filter((p) => !connected.includes(p));
  if (eligiblePlatforms.length === 0) {
    return {
      ...base,
      eligible: false,
      reason: "need_platform",
      missingPlatforms,
      guidance: `This campaign requires ${required.join(" or ")}. Connect ${missingPlatforms.join(" or ")} in the Connections panel to join it.`,
    };
  }
  return { requiredPlatforms: required, eligiblePlatforms, missingPlatforms, eligible: true, guidance: "" };
}

/** Convenience: the platform an agent should post to for a campaign (first eligible). */
export function preferredPostPlatform(e: CampaignEligibility): string | undefined {
  return e.eligiblePlatforms[0];
}
