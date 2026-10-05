// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ContentReward } from "@/lib/content-rewards";

/**
 * Two guarantees this route/resolver must hold, both regression-tested here:
 *
 *  1. resolveCampaignSources DEGRADES to `videos: []` (never throws) for a reward
 *     whose free-text `available_content` holds only NON-clippable links (a bare
 *     brand website + a telegram invite). The builder's Source picker relies on
 *     this empty list to show its "no clippable source yet" hint instead of a
 *     silent no-op — so the emptiness must be reported, not an error.
 *
 *  2. The route no longer forces a wallet signature (SIWS). It returns ONLY public
 *     campaign content, so a logged-in user (a valid Privy Bearer) — WITHOUT a
 *     SIWS session / provenWallet — must get 200, not a 401 `siws_required` that
 *     pops a needless Ed25519 prompt. The internal secret and the Bearer gate
 *     itself still apply.
 *
 * Only the two leaf dependencies are mocked (Supabase reward lookup + auth); the
 * real resolver, sourceKey, and Drive classifier run so the empty-collapse is the
 * genuine code path, not a stub.
 */

const h = vi.hoisted(() => ({
  getRewardMock: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock("@/lib/content-rewards", () => ({
  getContentRewardById: h.getRewardMock,
}));
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: h.authMock,
}));

import { resolveCampaignSources } from "@/lib/server/campaignSources";
import { GET } from "./route";

function makeReq(rewardId?: string): NextRequest {
  const qs = rewardId ? `?rewardId=${encodeURIComponent(rewardId)}` : "";
  return { nextUrl: new URL(`https://vello.test/api/clip/campaign-sources${qs}`) } as unknown as NextRequest;
}

function reward(id: string, availableContent: string): ContentReward {
  return {
    id,
    campaign_name: "Test Campaign",
    type: "clipping",
    available_content: availableContent,
    content_requirements: [],
  } as unknown as ContentReward;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default caller: a logged-in user WITHOUT a SIWS session (no provenWallet).
  h.authMock.mockResolvedValue({ user: { id: "u1" }, token: "tok", internal: false });
});

describe("resolveCampaignSources — empty degrade", () => {
  it("returns videos:[] for a reward with only a bare website + telegram link", async () => {
    h.getRewardMock.mockResolvedValue(
      reward("r-bare", "Grab the brief at https://brand.example and join https://t.me/brandchat"),
    );
    const res = await resolveCampaignSources("r-bare");
    expect(res).not.toBeNull();
    expect(res?.contentRewardId).toBe("r-bare");
    expect(res?.videos).toEqual([]);
  });

  it("still resolves a genuine clippable link (sanity that not everything collapses)", async () => {
    h.getRewardMock.mockResolvedValue(reward("r-mp4", "Clip this: https://cdn.example/video.mp4 — thanks!"));
    const res = await resolveCampaignSources("r-mp4");
    expect(res?.videos.map((v) => v.url)).toEqual(["https://cdn.example/video.mp4"]);
  });

  it("returns null when the reward can't be found", async () => {
    h.getRewardMock.mockResolvedValue(null);
    expect(await resolveCampaignSources("r-missing")).toBeNull();
  });
});

describe("GET /api/clip/campaign-sources — auth", () => {
  it("200s a logged-in user with NO SIWS session (no signature prompt required)", async () => {
    h.getRewardMock.mockResolvedValue(reward("r-route-user", "https://brand.example"));
    const res = await GET(makeReq("r-route-user"));
    expect(res.status).toBe(200);
    // Public content resolved even though provenWallet was undefined — the old
    // requireSiwsSession gate would have 401'd here and forced an Ed25519 sign.
    expect(await res.json()).toMatchObject({ contentRewardId: "r-route-user", videos: [] });
  });

  it("still 401s an unauthenticated caller (the Bearer gate stays)", async () => {
    h.authMock.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await GET(makeReq("r1"));
    expect(res.status).toBe(401);
    expect(h.getRewardMock).not.toHaveBeenCalled();
  });

  it("200s an internal-secret caller (cron/backfill)", async () => {
    h.authMock.mockResolvedValue({ internal: true });
    h.getRewardMock.mockResolvedValue(reward("r-int", "https://cdn.example/x.mp4"));
    const res = await GET(makeReq("r-int"));
    expect(res.status).toBe(200);
  });

  it("400s a missing rewardId", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
    expect(h.getRewardMock).not.toHaveBeenCalled();
  });

  it("404s when the reward doesn't exist", async () => {
    h.getRewardMock.mockResolvedValue(null);
    const res = await GET(makeReq("r-nope"));
    expect(res.status).toBe(404);
  });
});
