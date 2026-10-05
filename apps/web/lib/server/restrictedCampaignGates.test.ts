// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The two SYMMETRIC provenance gates for the restricted 12. `isRestrictedCampaign`
 * runs REAL (against the real UUID/title list); the Convex campaign resolve
 * (`getById`) and the allow check are mocked.
 *
 * FIX 1 focus: `gateRestrictedCampaignForOwner` must gate the Convex `campaignId`
 * USDC rail exactly like the sibling `contentRewardId` rail — a non-allowed owner
 * passing a restricted mirror's campaignId gets it STRIPPED (no vault binding),
 * while allowed owners and every non-restricted campaign pass through untouched.
 */

const RESTRICTED_ID = "879d3634-f98f-43f4-b2ac-0c228d80f4a8"; // Trade with Shrimp (restricted)
const RESTRICTED_TITLE = "Trade with Shrimp Clipping Push";
const PLAIN_ID = "plain-non-restricted-reward"; // NOT restricted

const h = vi.hoisted(() => ({
  queryMock: vi.fn(),
  allowMock: vi.fn(),
}));

// A minimal ConvexHttpClient whose .query resolves the mocked campaign row.
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = h.queryMock;
  },
}));
vi.mock("@/lib/server/restrictedCampaignsAuth", () => ({
  isAccountAllowedForRestricted: h.allowMock,
}));

import {
  gateRestrictedCampaignForOwner,
  gateRestrictedRewardForOwner,
} from "./restrictedCampaignGates";

beforeEach(() => {
  vi.clearAllMocks();
  h.allowMock.mockResolvedValue(false); // default: NOT the allowed account
});

describe("gateRestrictedCampaignForOwner — Convex campaignId USDC rail (FIX 1)", () => {
  it("STRIPS a restricted-mirror campaignId for a NON-allowed owner", async () => {
    h.queryMock.mockResolvedValue({ contentRewardId: RESTRICTED_ID, title: RESTRICTED_TITLE });
    const out = await gateRestrictedCampaignForOwner("cmp_restricted", "W_not_allowed");
    expect(out).toBeUndefined();
    expect(h.allowMock).toHaveBeenCalledWith({ wallet: "W_not_allowed" });
  });

  it("KEEPS a restricted-mirror campaignId for the ALLOWED owner", async () => {
    h.queryMock.mockResolvedValue({ contentRewardId: RESTRICTED_ID, title: RESTRICTED_TITLE });
    h.allowMock.mockResolvedValue(true);
    const out = await gateRestrictedCampaignForOwner("cmp_restricted", "W_allowed");
    expect(out).toBe("cmp_restricted");
  });

  it("KEEPS a NON-restricted campaignId without consulting the allow check", async () => {
    h.queryMock.mockResolvedValue({ contentRewardId: PLAIN_ID, title: "Some Public Campaign" });
    const out = await gateRestrictedCampaignForOwner("cmp_plain", "W_anyone");
    expect(out).toBe("cmp_plain");
    expect(h.allowMock).not.toHaveBeenCalled();
  });

  it("prefer-UUID (FIX 3): a DIFFERENT-uuid campaign that only SHARES a restricted title is NOT gated", async () => {
    h.queryMock.mockResolvedValue({ contentRewardId: "some-other-real-uuid", title: "Argos Clipping" });
    const out = await gateRestrictedCampaignForOwner("cmp_lookalike", "W_anyone");
    expect(out).toBe("cmp_lookalike");
    expect(h.allowMock).not.toHaveBeenCalled();
  });

  it("still gates a restricted mirror that carries NO contentRewardId but a matching TITLE", async () => {
    // No definitive UUID → preferUuid short-circuit does not fire → title match gates.
    h.queryMock.mockResolvedValue({ contentRewardId: null, title: RESTRICTED_TITLE });
    const out = await gateRestrictedCampaignForOwner("cmp_titleonly", "W_not_allowed");
    expect(out).toBeUndefined();
  });

  it("leaves an UNRESOLVABLE campaignId unchanged (no such campaign)", async () => {
    h.queryMock.mockResolvedValue(null);
    const out = await gateRestrictedCampaignForOwner("cmp_missing", "W_anyone");
    expect(out).toBe("cmp_missing");
    expect(h.allowMock).not.toHaveBeenCalled();
  });

  it("leaves the campaignId unchanged when the Convex read THROWS", async () => {
    h.queryMock.mockRejectedValue(new Error("convex down"));
    const out = await gateRestrictedCampaignForOwner("cmp_x", "W_anyone");
    expect(out).toBe("cmp_x");
    expect(h.allowMock).not.toHaveBeenCalled();
  });

  it("returns empty/undefined inputs untouched WITHOUT a query", async () => {
    expect(await gateRestrictedCampaignForOwner(undefined, "W")).toBeUndefined();
    expect(await gateRestrictedCampaignForOwner("", "W")).toBe("");
    expect(h.queryMock).not.toHaveBeenCalled();
  });
});

describe("post_content wiring contract (FIX A) — skip submitForCampaign when the gate strips a restricted campaignId", () => {
  it("does NOT submit for a restricted mirror + non-allowed owner, but DOES for the allowed owner", async () => {
    // Mirrors the run-task `post_content` branch: gate the RAW campaignId through
    // gateRestrictedCampaignForOwner and only call submitForCampaign when it
    // returns a (truthy) id — otherwise skip entirely (the reachable money vector).
    h.queryMock.mockResolvedValue({ contentRewardId: RESTRICTED_ID, title: RESTRICTED_TITLE });
    const submitForCampaign = vi.fn();

    async function postContentSubmit(campaignId: string, ownerWallet: string) {
      const gated = await gateRestrictedCampaignForOwner(campaignId, ownerWallet);
      if (!gated) return; // route logs: "post_content submit skipped — restricted campaign, owner not allowed"
      submitForCampaign({ campaignId: gated });
    }

    await postContentSubmit("cmp_restricted", "W_not_allowed");
    expect(submitForCampaign).not.toHaveBeenCalled();

    h.allowMock.mockResolvedValue(true);
    await postContentSubmit("cmp_restricted", "W_allowed");
    expect(submitForCampaign).toHaveBeenCalledWith({ campaignId: "cmp_restricted" });
  });

  it("does NOT gate a non-restricted campaignId (submit proceeds with the id unchanged)", async () => {
    h.queryMock.mockResolvedValue({ contentRewardId: PLAIN_ID, title: "Some Public Campaign" });
    const submitForCampaign = vi.fn();
    const gated = await gateRestrictedCampaignForOwner("cmp_plain", "W_anyone");
    if (gated) submitForCampaign({ campaignId: gated });
    expect(submitForCampaign).toHaveBeenCalledWith({ campaignId: "cmp_plain" });
    expect(h.allowMock).not.toHaveBeenCalled();
  });
});

describe("gateRestrictedRewardForOwner — contentRewardId rail (relocated, unchanged)", () => {
  it("STRIPS a restricted contentRewardId for a NON-allowed owner", async () => {
    const out = await gateRestrictedRewardForOwner(RESTRICTED_ID, "W_not_allowed");
    expect(out).toBeUndefined();
    expect(h.allowMock).toHaveBeenCalledWith({ wallet: "W_not_allowed" });
  });

  it("KEEPS a restricted contentRewardId for the ALLOWED owner", async () => {
    h.allowMock.mockResolvedValue(true);
    const out = await gateRestrictedRewardForOwner(RESTRICTED_ID, "W_allowed");
    expect(out).toBe(RESTRICTED_ID);
  });

  it("KEEPS a NON-restricted contentRewardId without consulting the allow check", async () => {
    const out = await gateRestrictedRewardForOwner(PLAIN_ID, "W_anyone");
    expect(out).toBe(PLAIN_ID);
    expect(h.allowMock).not.toHaveBeenCalled();
  });
});
