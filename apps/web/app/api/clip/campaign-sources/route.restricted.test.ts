// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { ContentReward } from "@/lib/content-rewards";

/**
 * The restricted-campaign gate on the source-resolve route: only the single
 * allowed account (or an internal-secret caller) may resolve the clippable
 * sources of one of the 12 restricted campaigns; everyone else gets 403 and NO
 * video URLs. Non-restricted campaigns are unaffected.
 *
 * `isRestrictedCampaign` runs REAL (against the real UUID list); only the auth,
 * the allow check, and the reward lookup are mocked.
 */

const SHRIMP_UUID = "879d3634-f98f-43f4-b2ac-0c228d80f4a8";  // restricted
const MADGTR_UUID = "6f841af4-cd88-460b-bddc-0662dc31bda0";  // restricted
const MIMIE_UUID = "d1e13de1-28bb-4859-98d1-a9797c4ce38a";   // restricted
const PLAIN_ID = "plain-non-restricted-reward";              // NOT restricted

const h = vi.hoisted(() => ({
  getRewardMock: vi.fn(),
  authMock: vi.fn(),
  allowMock: vi.fn(),
}));

vi.mock("@/lib/content-rewards", () => ({
  getContentRewardById: h.getRewardMock,
}));
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: h.authMock,
}));
vi.mock("@/lib/server/restrictedCampaignsAuth", () => ({
  isAccountAllowedForRestricted: h.allowMock,
}));

import { GET } from "./route";

function makeReq(rewardId: string): NextRequest {
  const qs = `?rewardId=${encodeURIComponent(rewardId)}`;
  return { nextUrl: new URL(`https://vello.test/api/clip/campaign-sources${qs}`) } as unknown as NextRequest;
}

function clippableReward(id: string): ContentReward {
  return {
    id,
    campaign_name: "Restricted Campaign",
    type: "clipping",
    available_content: "Clip this: https://cdn.example/video.mp4",
    content_requirements: [],
  } as unknown as ContentReward;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a logged-in NON-allowed user.
  h.authMock.mockResolvedValue({ user: { id: "u1", email: "someone@else.com", walletAddresses: ["W_other"] }, token: "t", internal: false });
  h.allowMock.mockResolvedValue(false);
  h.getRewardMock.mockImplementation((id: string) => Promise.resolve(clippableReward(id)));
});

describe("campaign-sources restriction gate", () => {
  it("403s a NON-allowed user for a restricted campaign, WITHOUT resolving sources", async () => {
    const res = await GET(makeReq(SHRIMP_UUID));
    expect(res.status).toBe(403);
    // Gated up-front by UUID: the (expensive) reward resolve never ran, so no
    // video URLs could leak.
    expect(h.getRewardMock).not.toHaveBeenCalled();
    expect(h.allowMock).toHaveBeenCalledTimes(1);
  });

  it("200s the ALLOWED account for a restricted campaign and returns its videos", async () => {
    h.allowMock.mockResolvedValue(true);
    const res = await GET(makeReq(MADGTR_UUID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contentRewardId: string; videos: { url: string }[] };
    expect(body.contentRewardId).toBe(MADGTR_UUID);
    expect(body.videos.map((v) => v.url)).toEqual(["https://cdn.example/video.mp4"]);
  });

  it("200s an internal-secret caller for a restricted campaign (allow check skipped)", async () => {
    h.authMock.mockResolvedValue({ internal: true });
    const res = await GET(makeReq(MIMIE_UUID));
    expect(res.status).toBe(200);
    expect(h.allowMock).not.toHaveBeenCalled();
  });

  it("200s a NON-allowed user for a NON-restricted campaign (unchanged behavior)", async () => {
    const res = await GET(makeReq(PLAIN_ID));
    expect(res.status).toBe(200);
    // Not restricted → the allow check is never consulted.
    expect(h.allowMock).not.toHaveBeenCalled();
  });
});
