// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_CRON_SECRET = "test-secret";
  return { requireAuth: vi.fn(), requireOwner: vi.fn(), query: vi.fn(), mutation: vi.fn(), hasActiveSubscription: vi.fn() };
});
vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: mocks.query, mutation: mocks.mutation })),
}));
vi.mock("@/lib/server/requireAuth", () => ({ requireInternalOrUserAuth: mocks.requireAuth, requireOwnerWithSiws: mocks.requireOwner }));
vi.mock("@/lib/server/subscriptionStatus", () => ({ hasActiveSubscription: mocks.hasActiveSubscription }));
vi.mock("@/convex/_generated/api", () => ({
  api: { influencers: { getByMintServer: "getByMintServer", setAvatarUrl: "setAvatarUrl", update: "update", setClipConfig: "setClipConfig" } },
}));

import { POST } from "./route";

const mint = "941XE5tHZ9o7rR1gepuPDMcPbpk5WEynki8hntVGt9Ak";
const newUrl = "https://r2.example/ref/new.png";
const request = (avatarUrl: string) => ({ json: async () => ({ mintAddress: mint, kind: "avatar", payload: { avatarUrl } }) }) as never;
const agent = {
  _id: "agent1", name: "Rainier Clips", handle: "rainier", niche: "clips", language: "en", archetype: "hype",
  description: "desc", personality: { warmth: 60, humor: 70, authority: 40, boldness: 80 }, avatarUrl: "https://old.png",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ user: { id: "owner" }, provenWallet: "wallet" });
  mocks.requireOwner.mockReturnValue(null);
  mocks.query.mockResolvedValue(agent);
});

describe("POST /api/agents/config kind=avatar", () => {
  it("saves through setAvatarUrl when it is deployed", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, avatarUrl: newUrl });
    const res = await POST(request(newUrl));
    expect(res.status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith("setAvatarUrl", { mintAddress: mint, avatarUrl: newUrl, authSecret: "test-secret" });
  });

  it("falls back to update (keeping the persona) when setAvatarUrl is missing on Convex", async () => {
    mocks.mutation.mockImplementation(async (fn: string) => {
      if (fn === "setAvatarUrl") throw new Error("[Request ID: x] Server Error");
      return null;
    });
    const res = await POST(request(newUrl));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, avatarUrl: newUrl });
    expect(mocks.mutation).toHaveBeenLastCalledWith("update", {
      id: "agent1", name: "Rainier Clips", handle: "rainier", avatarUrl: newUrl, niche: "clips", language: "en",
      archetype: "hype", description: "desc", personality: agent.personality, authSecret: "test-secret",
    });
  });

  it("rejects a non-https avatar url", async () => {
    const res = await POST(request("data:image/png;base64,AAA"));
    expect(res.status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("refuses non-owners", async () => {
    mocks.requireOwner.mockReturnValue(new Response("Forbidden", { status: 403 }));
    const res = await POST(request(newUrl));
    expect(res.status).toBe(403);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});

describe("POST /api/agents/config kind=clip — free-plan watermark gate", () => {
  const clipAgent = { ...agent, creatorWallet: "owner-wallet", clipConfig: { velloWatermark: true, captionsOn: true } };
  const clipRequest = (velloWatermark: boolean) =>
    ({ json: async () => ({ mintAddress: mint, kind: "clip", payload: { velloWatermark } }) }) as never;

  beforeEach(() => { mocks.query.mockResolvedValue(clipAgent); mocks.mutation.mockResolvedValue({ ok: true }); });

  it("free plan: forces velloWatermark back to true and tells the client why", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false);
    const res = await POST(clipRequest(false));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, velloWatermark: true, forcedFreePlan: true });
    expect(mocks.mutation).toHaveBeenCalledWith("setClipConfig", {
      mintAddress: mint, clipConfig: expect.objectContaining({ velloWatermark: true, captionsOn: true }), authSecret: "test-secret",
    });
    expect(mocks.hasActiveSubscription).toHaveBeenCalledWith("owner-wallet");
  });

  it("paid plan: honors turning the watermark off", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(true);
    const res = await POST(clipRequest(false));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forcedFreePlan).toBeUndefined();
    expect(mocks.mutation).toHaveBeenCalledWith("setClipConfig", {
      mintAddress: mint, clipConfig: expect.objectContaining({ velloWatermark: false }), authSecret: "test-secret",
    });
  });

  it("does not force velloWatermark back on for a save that isn't trying to turn it off", async () => {
    // hasActiveSubscription now runs on every clip save (the clip-count gate
    // below needs it too), so it IS called here — just asserting it has no
    // effect on a request that never attempted to disable the watermark.
    mocks.hasActiveSubscription.mockResolvedValue(false);
    const res = await POST(clipRequest(true));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.velloWatermark).not.toBe(false);
  });

  it("internal/server callers bypass the gate (not a user trying to cheat)", async () => {
    mocks.requireAuth.mockResolvedValue({ internal: true });
    mocks.hasActiveSubscription.mockResolvedValue(false);
    const res = await POST(clipRequest(false));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forcedFreePlan).toBeUndefined();
    expect(mocks.hasActiveSubscription).not.toHaveBeenCalled();
    expect(mocks.mutation).toHaveBeenCalledWith("setClipConfig", {
      mintAddress: mint, clipConfig: expect.objectContaining({ velloWatermark: false }), authSecret: "test-secret",
    });
  });
});

describe("POST /api/agents/config kind=clip — free-plan clip-count cap", () => {
  const clipAgent = { ...agent, creatorWallet: "owner-wallet", clipConfig: { velloWatermark: true, maxClipsPerSource: 3 } };
  const clipCountRequest = (maxClipsPerSource: number, extra: Record<string, unknown> = {}) =>
    ({ json: async () => ({ mintAddress: mint, kind: "clip", payload: { maxClipsPerSource, ...extra } }) }) as never;

  beforeEach(() => { mocks.query.mockResolvedValue(clipAgent); mocks.mutation.mockResolvedValue({ ok: true }); });

  it("free plan: clamps a requested clip count above 10 down to 10 (the reported abuse: up to 30)", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false);
    const res = await POST(clipCountRequest(30));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, maxClipsPerSource: 10, forcedFreePlan: true, freePlanMaxClips: 10 });
    expect(mocks.mutation).toHaveBeenCalledWith("setClipConfig", {
      mintAddress: mint,
      clipConfig: expect.objectContaining({ maxClipsPerSource: 10, autoPlanMaxClips: 10 }),
      authSecret: "test-secret",
    });
  });

  it("free plan: also caps the persisted autoPlanMaxClips even for a request already under 10", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(false);
    await POST(clipCountRequest(5));
    expect(mocks.mutation).toHaveBeenCalledWith("setClipConfig", {
      mintAddress: mint,
      clipConfig: expect.objectContaining({ maxClipsPerSource: 5, autoPlanMaxClips: 10 }),
      authSecret: "test-secret",
    });
  });

  it("paid plan: honors a clip count above 10 and clears a stale free-plan autoPlanMaxClips", async () => {
    mocks.hasActiveSubscription.mockResolvedValue(true);
    await POST(clipCountRequest(30, { autoPlanMaxClips: 10 }));
    expect(mocks.mutation).toHaveBeenCalledWith("setClipConfig", {
      mintAddress: mint,
      clipConfig: expect.not.objectContaining({ autoPlanMaxClips: expect.anything() }),
      authSecret: "test-secret",
    });
    const call = mocks.mutation.mock.calls.find((c) => c[0] === "setClipConfig");
    expect((call?.[1] as { clipConfig: { maxClipsPerSource: number } }).clipConfig.maxClipsPerSource).toBe(30);
  });
});
