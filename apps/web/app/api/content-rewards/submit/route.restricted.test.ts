// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The restricted-campaign gate on the submit/join route: a submission to one of
 * the 12 restricted campaigns is recorded ONLY when its ownerWallet belongs to
 * the allowed account — and this holds for EVERY caller type, including trusted
 * internal (cron/clipJobs auto-submit) callers. Non-restricted campaigns behave
 * exactly as before.
 *
 * `isRestrictedCampaign` runs REAL; auth, the ownership gate, the submit writer,
 * and the allow check are mocked.
 */

const RESTRICTED_ID = "879d3634-f98f-43f4-b2ac-0c228d80f4a8"; // Trade with Shrimp (restricted)
const PLAIN_ID = "plain-non-restricted-reward";               // NOT restricted

const h = vi.hoisted(() => ({
  submitMock: vi.fn(),
  authMock: vi.fn(),
  ownerGateMock: vi.fn(),
  allowMock: vi.fn(),
}));

vi.mock("@/lib/server/contentRewardSubmit", () => ({
  submitContentRewardLink: h.submitMock,
}));
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: h.authMock,
  requireOwnerWithSiws: h.ownerGateMock,
}));
vi.mock("@/lib/server/restrictedCampaignsAuth", () => ({
  isAccountAllowedForRestricted: h.allowMock,
}));

import { POST } from "./route";

function makeReq(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function fullBody(contentRewardId: string, ownerWallet: string): Record<string, unknown> {
  return {
    contentRewardId,
    ownerWallet,
    contentUrl: "https://tiktok.com/@x/video/1",
    platform: "tiktok",
    title: "clip",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an internal (cron/clipJobs) caller.
  h.authMock.mockResolvedValue({ internal: true });
  h.ownerGateMock.mockReturnValue(null); // owns (only consulted for user callers)
  h.allowMock.mockResolvedValue(false);
  h.submitMock.mockResolvedValue({ ok: true, submissionId: "s1", calculatedPayout: 0, communityId: "c1" });
});

describe("submit restriction gate", () => {
  it("403s an INTERNAL auto-submit to a restricted campaign whose ownerWallet is NOT allowed — nothing recorded", async () => {
    const res = await POST(makeReq(fullBody(RESTRICTED_ID, "W_not_allowed")));
    expect(res.status).toBe(403);
    expect(h.allowMock).toHaveBeenCalledWith({ wallet: "W_not_allowed" });
    expect(h.submitMock).not.toHaveBeenCalled();
  });

  it("records an INTERNAL submit to a restricted campaign when the ownerWallet IS allowed", async () => {
    h.allowMock.mockResolvedValue(true);
    const res = await POST(makeReq(fullBody(RESTRICTED_ID, "W_allowed")));
    expect(res.status).toBe(200);
    expect(h.submitMock).toHaveBeenCalledTimes(1);
    expect((await res.json()).ok).toBe(true);
  });

  it("403s a USER submit to a restricted campaign when NOT allowed (even though SIWS ownership passed)", async () => {
    h.authMock.mockResolvedValue({ user: { id: "u1" }, token: "t", internal: false, provenWallet: "W_user" });
    const res = await POST(makeReq(fullBody(RESTRICTED_ID, "W_user")));
    expect(res.status).toBe(403);
    expect(h.ownerGateMock).toHaveBeenCalled(); // SIWS ownership still enforced first
    expect(h.submitMock).not.toHaveBeenCalled();
  });

  it("records a submit to a NON-restricted campaign without consulting the allow check (unchanged)", async () => {
    const res = await POST(makeReq(fullBody(PLAIN_ID, "W_anyone")));
    expect(res.status).toBe(200);
    expect(h.allowMock).not.toHaveBeenCalled();
    expect(h.submitMock).toHaveBeenCalledTimes(1);
  });
});
