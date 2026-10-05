// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isRestrictedCampaign,
  isAllowedRestrictedEmail,
  normalizeTitle,
  RESTRICTED_CAMPAIGNS,
  RESTRICTED_CAMPAIGN_EMAIL,
} from "./restrictedCampaigns";

/**
 * Pure-logic guarantees for the restricted-campaign matcher. No mocks — the real
 * config list is exercised so a bad UUID/title in the list is caught here.
 */

const SHRIMP_UUID = "879d3634-f98f-43f4-b2ac-0c228d80f4a8"; // Trade with Shrimp Clipping Push
const MADGTR_UUID = "6f841af4-cd88-460b-bddc-0662dc31bda0"; // Clip for MadGTR

describe("normalizeTitle", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeTitle("  Argos   Clipping  ")).toBe("argos clipping");
    expect(normalizeTitle(null)).toBe("");
    expect(normalizeTitle(undefined)).toBe("");
  });
});

describe("isRestrictedCampaign — UUID match", () => {
  it("matches a restricted campaign by exact UUID", () => {
    expect(isRestrictedCampaign({ contentRewardId: SHRIMP_UUID })).toBe(true);
    expect(isRestrictedCampaign({ contentRewardId: MADGTR_UUID })).toBe(true);
  });

  it("matches a UUID case-insensitively", () => {
    expect(isRestrictedCampaign({ contentRewardId: SHRIMP_UUID.toUpperCase() })).toBe(true);
  });

  it("matches a UUID with surrounding whitespace", () => {
    expect(isRestrictedCampaign({ contentRewardId: `  ${SHRIMP_UUID}  ` })).toBe(true);
  });

  it("does NOT match a random/other UUID", () => {
    expect(isRestrictedCampaign({ contentRewardId: "00000000-0000-0000-0000-000000000000" })).toBe(false);
    expect(isRestrictedCampaign({ contentRewardId: "not-a-restricted-id" })).toBe(false);
  });
});

describe("isRestrictedCampaign — title match (re-created rows)", () => {
  it("matches by normalized title when the UUID is unknown", () => {
    // A row re-created under a fresh UUID but the same campaign_name stays gated.
    expect(isRestrictedCampaign({ contentRewardId: "fresh-uuid", title: "Argos Clipping" })).toBe(true);
    expect(isRestrictedCampaign({ title: "  argos   clipping " })).toBe(true);
  });

  it("matches the doubled-'Clipping Clipping' title exactly as listed", () => {
    expect(
      isRestrictedCampaign({ title: "Mimie Scalping Derhaka Clipping Clipping Push" }),
    ).toBe(true);
  });

  it("does NOT match a non-restricted title", () => {
    expect(isRestrictedCampaign({ title: "Some Other Public Clipping Campaign" })).toBe(false);
    expect(isRestrictedCampaign({ title: "" })).toBe(false);
    expect(isRestrictedCampaign({})).toBe(false);
  });

  it("does NOT match a near-miss title (single 'Clipping', not the doubled one is fine; unrelated stays out)", () => {
    expect(isRestrictedCampaign({ title: "Argos" })).toBe(false); // partial ≠ match
  });
});

describe("isRestrictedCampaign — config integrity", () => {
  it("has exactly 12 restricted campaigns, each with a UUID", () => {
    expect(RESTRICTED_CAMPAIGNS).toHaveLength(12);
    for (const c of RESTRICTED_CAMPAIGNS) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      // Every listed campaign is matched by both its UUID and its title.
      expect(isRestrictedCampaign({ contentRewardId: c.uuid })).toBe(true);
      expect(isRestrictedCampaign({ title: c.title })).toBe(true);
    }
  });
});

describe("isAllowedRestrictedEmail", () => {
  it("accepts the allowed email case-insensitively / trimmed", () => {
    expect(isAllowedRestrictedEmail(RESTRICTED_CAMPAIGN_EMAIL)).toBe(true);
    expect(isAllowedRestrictedEmail(RESTRICTED_CAMPAIGN_EMAIL.toUpperCase())).toBe(true);
    expect(isAllowedRestrictedEmail(`  ${RESTRICTED_CAMPAIGN_EMAIL}  `)).toBe(true);
  });

  it("rejects any other / missing email (fail closed)", () => {
    expect(isAllowedRestrictedEmail("someone@else.com")).toBe(false);
    expect(isAllowedRestrictedEmail(null)).toBe(false);
    expect(isAllowedRestrictedEmail(undefined)).toBe(false);
    expect(isAllowedRestrictedEmail("")).toBe(false);
  });
});
