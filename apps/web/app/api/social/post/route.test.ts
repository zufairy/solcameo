// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

/**
 * PAYOUT WIRING (manual "Post now"): a content_reward / campaign clip posted via
 * this route is only PAID when its Convex submission carries a DURABLE post
 * identity — dueForVerification requires `uploadPostRequestId || platformPostId`,
 * and a postUrl-only row is never attested on-chain → never claimed → agent $0.
 *
 * run-task's upload returns those ids (`result.postIds[platform]` +
 * `result.requestId`) and this route already reads them into `ppid`/`reqId` for
 * the permalink poll — but used to forward ONLY postUrl to submitForCampaign /
 * bridgeContentRewardToCampaign, dropping the ids. These tests drive the real
 * handler (Convex + uploadPost mocked) and assert the ids reach both mutations.
 * FunctionReferences are matched by getFunctionName (anyApi proxies aren't
 * identity-stable).
 */

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.INTERNAL_CRON_SECRET = "cron-secret";
  return {
    chargeMock: vi.fn(),
    refundMock: vi.fn(),
    queryMock: vi.fn(),
    mutationMock: vi.fn(),
    uploadVideoMock: vi.fn(),
    submitCRLinkMock: vi.fn(),
    authMock: vi.fn(),
    runGuardrailsMock: vi.fn(),
    prepareYouTubeShortMock: vi.fn(),
    generatePostCaptionMock: vi.fn(),
  };
});

vi.mock("@/lib/server/agentGenerationBilling", () => ({ chargeAgentGeneration: h.chargeMock }));
vi.mock("@/lib/server/imageBilling", () => ({ refundImage: h.refundMock }));
vi.mock("@/lib/server/guardrails", () => ({
  runGuardrails: h.runGuardrailsMock,
  // Mirrors the real gate: an influencer install (installedSkills) OR a clipper
  // install (an agentSkillFiles row whose canvas node is still wired).
  guardrailsEnabled: (args: { installedSkills?: string[] | null; clipSkillRows?: { skillId: string; wired?: boolean }[] | null }) =>
    !!args.installedSkills?.some((id) => id === "video.guardrails" || id === "clip.guardrails")
    || (Array.isArray(args.clipSkillRows)
      && args.clipSkillRows.some((r) => (r.skillId === "video.guardrails" || r.skillId === "clip.guardrails") && r.wired !== false)),
  // Word-scrubber — same masking the real guardrails.ts does ("shit" → "s***").
  scrubProfanity: (text: string | null | undefined) => (text ?? "").replace(/\b(fuck|shit|bitch|asshole|cunt|nigger|nigga|faggot|retard|whore|slut|motherfucker|dumbass|bastard)\b/gi, (w: string) => `${w[0]}${"*".repeat(Math.max(0, w.length - 1))}`),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: h.queryMock, mutation: h.mutationMock })),
}));
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: h.authMock,
  requireOwnerWithSiws: vi.fn(() => null),
}));
vi.mock("@/lib/server/contentRewardSubmit", () => ({ submitContentRewardLink: h.submitCRLinkMock }));
vi.mock("@/lib/server/captionTransform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/captionTransform")>()),
  generateYoutubeTitle: vi.fn(async () => "Short clip"),
  generatePostCaption: h.generatePostCaptionMock,
}));
vi.mock("@/lib/server/verticalizeForShorts", () => ({
  prepareYouTubeShort: h.prepareYouTubeShortMock,
  ShortsPreparationError: class ShortsPreparationError extends Error {},
}));
vi.mock("@/lib/server/uploadPost", () => ({
  isConfigured: () => true,
  NotConfiguredError: class NotConfiguredError extends Error {},
  uploadText: vi.fn(),
  uploadPhotos: vi.fn(),
  uploadVideo: h.uploadVideoMock,
  UPLOAD_POST_PLATFORMS: [
    { id: "tiktok", video: true, photo: true, text: false },
    { id: "youtube", video: true, photo: false, text: false },
    { id: "x", video: true, photo: true, text: true },
  ],
  PLATFORM_IDS: ["tiktok", "youtube", "x"],
  resolveUsername: (m: string) => `user_${m}`,
  // Return a permalink so the route skips the getLatestPostLink poll (fast test).
  extractPostUrlFromResult: () => "https://www.tiktok.com/@x/video/1",
  getLatestPostLink: vi.fn(),
  getProfile: vi.fn(async () => ({ connected: {}, exists: true })),
  formatPlatformFailures: () => "",
}));

import { POST } from "./route";

const MINT = "MintAAA";
const GET_BY_MINT = "influencers:getByMintServer";
const CLAIM = "clipJobs:claimClipForPostingByUrl";
const MARK = "clipJobs:markClipPostedByUrl";
const SUBMIT_FOR_CAMPAIGN = "submissions:submitForCampaign";
const BRIDGE = "submissions:bridgeContentRewardToCampaign";

function makeReq(body: unknown) {
  return { json: async () => body } as unknown as import("next/server").NextRequest;
}
const videoBody = { username: MINT, platforms: ["tiktok"], type: "video", title: "hi", mediaUrls: ["https://clip.mp4"] };

/** The args of the mutation call whose ref resolves to `name` (or undefined). */
const mutationArgs = (name: string) => {
  const call = h.mutationMock.mock.calls.find(
    (c) => getFunctionName(c[0] as Parameters<typeof getFunctionName>[0]) === name,
  );
  return call?.[1] as Record<string, unknown> | undefined;
};

/** markClipPostedByUrl provenance the route branches on; overridden per test. */
let markedResult: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  h.chargeMock.mockResolvedValue({ ok: true, costUsdc: 0.05 });
  h.authMock.mockResolvedValue({ internal: true }); // internal caller → skip SIWS owner gate
  h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent Zed", avatarUrl: "https://a/z.png", mintAddress: MINT });
  h.mutationMock.mockImplementation(async (ref: unknown) => {
    switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
      case CLAIM: return { claimed: true };
      case MARK: return markedResult;
      default: return { ok: true };
    }
  });
  h.submitCRLinkMock.mockResolvedValue({ ok: true });
  // A real publish that returns the durable ids (post id keyed by platform + request id).
  h.uploadVideoMock.mockResolvedValue({
    ok: true, status: 200, data: { ok: true }, postIds: { tiktok: "tt_1" }, requestId: "req_1",
  });
  // Passes by default — Guardrails only actually runs for agents with the skill
  // installed (see the dedicated describe block below), and even then defaults
  // to a clean pass unless a test overrides it.
  h.runGuardrailsMock.mockResolvedValue({ pass: true, reasons: [], checked: [] });
  h.prepareYouTubeShortMock.mockResolvedValue("https://vertical-short.mp4");
});

describe("POST /api/social/post — YouTube Shorts", () => {
  it("posts the prepared vertical file to YouTube and the original to other platforms", async () => {
    const res = await POST(makeReq({ ...videoBody, platforms: ["youtube", "tiktok"] }));
    expect(res.status).toBe(200);
    expect(h.prepareYouTubeShortMock).toHaveBeenCalledWith("https://clip.mp4");
    expect(h.uploadVideoMock).toHaveBeenCalledTimes(2);
    expect(h.uploadVideoMock).toHaveBeenCalledWith(expect.objectContaining({ platforms: ["youtube"], videoUrl: "https://vertical-short.mp4" }));
    expect(h.uploadVideoMock).toHaveBeenCalledWith(expect.objectContaining({ platforms: ["tiktok"], videoUrl: "https://clip.mp4" }));
  });

  it("does not publish to any platform when the Short cannot be prepared", async () => {
    h.prepareYouTubeShortMock.mockRejectedValue(new Error("Video exceeds Shorts duration"));
    const res = await POST(makeReq({ ...videoBody, platforms: ["youtube", "tiktok"] }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.posted).toEqual([]);
    expect(h.uploadVideoMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/social/post — empty platforms fall back to connected accounts", () => {
  it("no platforms in the body → posts to the agent's connected accounts (no 400)", async () => {
    // Agent has tiktok connected (cached on the influencer row). "Post everywhere"
    // with no pinned channels sends an empty list — the route must resolve it.
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, connectedPlatforms: ["tiktok"] });
    const res = await POST(makeReq({ ...videoBody, platforms: [] }));
    expect(res.status).toBe(200);
    expect(h.uploadVideoMock).toHaveBeenCalled();
  });

  it("no platforms AND nothing connected → a clear 400, not a cryptic one", async () => {
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, connectedPlatforms: [] });
    const res = await POST(makeReq({ ...videoBody, platforms: [] }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/connect/i);
  });

  it("upload-post rejects the video → surfaces its REAL error (not 'HTTP 400'/502)", async () => {
    // The route must return 200 with ok:false + the upstream reason so the client
    // shows WHY, instead of a scary gateway 502 with a useless "Post failed (HTTP 400)".
    h.uploadVideoMock.mockResolvedValue({ ok: false, status: 400, data: { error: "video URL not accessible" }, failed: undefined });
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200); // completed request → 200, ok:false in the body
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).toBe("video URL not accessible");
  });
});

describe("POST /api/social/post — forwards durable post ids to the payout rail", () => {
  it("content_reward clip: bridgeContentRewardToCampaign carries platformPostId + uploadPostRequestId", async () => {
    markedResult = { contentRewardId: "cr_1", ownerWallet: "W", clipId: "clip_1" };
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    const bridge = mutationArgs(BRIDGE);
    expect(bridge).toBeDefined();
    expect(bridge).toMatchObject({
      contentRewardId: "cr_1",
      platformPostId: "tt_1",
      uploadPostRequestId: "req_1",
      postUrl: "https://www.tiktok.com/@x/video/1",
    });
  });

  it("campaign clip: submitForCampaign carries platformPostId + uploadPostRequestId", async () => {
    markedResult = { campaignId: "camp_1", ownerWallet: "W", clipId: "clip_1" };
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    const submit = mutationArgs(SUBMIT_FOR_CAMPAIGN);
    expect(submit).toBeDefined();
    expect(submit).toMatchObject({
      campaignId: "camp_1",
      platformPostId: "tt_1",
      uploadPostRequestId: "req_1",
    });
  });

  it("omits the id keys entirely when the upload returned none (no undefined injected)", async () => {
    markedResult = { contentRewardId: "cr_1", ownerWallet: "W", clipId: "clip_1" };
    h.uploadVideoMock.mockResolvedValue({ ok: true, status: 200, data: { ok: true }, postIds: undefined, requestId: undefined });
    await POST(makeReq(videoBody));
    const bridge = mutationArgs(BRIDGE);
    expect(bridge).toBeDefined();
    expect(bridge).not.toHaveProperty("platformPostId");
    expect(bridge).not.toHaveProperty("uploadPostRequestId");
  });
});

// THE GAP: an ordinary posted clip was marked status:"posted" with NO postUrl —
// the permalink was only ever resolved for CAMPAIGN clips, and even then it went to
// the submission rather than the clip row. Anything offering to open the post (the
// Generations card's "View post") had nothing to open.
describe("POST /api/social/post — the permalink lands on the clip row", () => {
  it("writes postUrl + the durable ids for a plain (non-campaign) clip", async () => {
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, connectedPlatforms: ["tiktok"] });
    markedResult = { clipId: "clip_1" }; // no campaignId / contentRewardId
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    const mark = mutationArgs(MARK);
    expect(mark).toMatchObject({ status: "posted" });
    expect(mark?.postUrl, "no permalink on the clip row — View post would open nothing").toBeTruthy();
  });
});

describe("POST /api/social/post — Guardrails gate", () => {
  it("agent without the skill installed → guardrails never runs, upload proceeds normally", async () => {
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, installedSkills: [] });
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    expect(h.runGuardrailsMock).not.toHaveBeenCalled();
    expect(h.uploadVideoMock).toHaveBeenCalled();
  });

  it("agent with video.guardrails installed + a passing check → posts normally", async () => {
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, installedSkills: ["video.guardrails"] });
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(h.runGuardrailsMock).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://clip.mp4" }));
    expect(h.uploadVideoMock).toHaveBeenCalled();
  });

  // THE CLIPPER PATH: a clipper's installs are agentSkillFiles ROWS — its
  // influencers row has an empty installedSkills. Gating on installedSkills alone
  // meant Guardrails sat in the App Store and on the canvas enforcing nothing.
  it("clipper install (agentSkillFiles row, empty installedSkills) → guardrails still runs", async () => {
    h.queryMock.mockImplementation((_fn: unknown, args: { authSecret?: string }) =>
      Promise.resolve(args?.authSecret !== undefined
        ? { creatorWallet: "W", name: "Agent", mintAddress: MINT, installedSkills: [] }
        : [{ skillId: "clip.guardrails", wired: true }]));
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    expect(h.runGuardrailsMock).toHaveBeenCalled();
  });

  it("clipper row whose canvas node was removed (wired:false) → guardrails does NOT run", async () => {
    h.queryMock.mockImplementation((_fn: unknown, args: { authSecret?: string }) =>
      Promise.resolve(args?.authSecret !== undefined
        ? { creatorWallet: "W", name: "Agent", mintAddress: MINT, installedSkills: [] }
        : [{ skillId: "clip.guardrails", wired: false }]));
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    expect(h.runGuardrailsMock).not.toHaveBeenCalled();
  });

  it("agent with clip.guardrails installed + a FAILING check → blocks the post, never calls uploadVideo", async () => {
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, installedSkills: ["clip.guardrails"] });
    h.runGuardrailsMock.mockResolvedValue({ pass: false, reasons: ["too short (0.5s)"], checked: ["technical_quality"] });
    markedResult = { clipId: "clip_1" };
    const res = await POST(makeReq(videoBody));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).toBe("guardrails_blocked");
    expect(h.uploadVideoMock).not.toHaveBeenCalled();
    // Rejected clip is marked distinctly (never released back to "ready"), so the
    // drip cron can't loop retrying the same never-fixable clip forever.
    const mark = mutationArgs(MARK);
    expect(mark).toMatchObject({ status: "guardrail_rejected" });
    expect(mark?.failReason).toMatch(/too short/);
  });

  // THE WORD-SCRUB: with Guardrails installed, a flagged caption word used to
  // BLOCK the whole clip (guardrail_rejected) — a dropped clip, so fewer videos
  // went out than the operator requested. The caption is now scrubbed BEFORE the
  // gate, so the same clip posts with a clean caption (count preserved).
  it("flagged word in the caption → caption is scrubbed (masked) before posting, count preserved", async () => {
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, installedSkills: ["video.guardrails"] });
    h.runGuardrailsMock.mockResolvedValue({ pass: true, reasons: [], checked: ["profanity", "technical_quality"] });
    const res = await POST(makeReq({ ...videoBody, title: "this is shit fr", description: "motherfucker you all" }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
    // The PROFANITY check saw a scrubbed caption → passes → the clip posts.
    expect(h.runGuardrailsMock).toHaveBeenCalledWith(
      expect.objectContaining({ captionText: expect.stringMatching(/s\*\*\*/) }),
    );
    // And what actually reaches the platform is the CLEAN caption, not the raw word.
    const uploadCall = h.uploadVideoMock.mock.calls[0];
    expect(String(uploadCall?.[0]?.title ?? "")).not.toMatch(/\bshit\b/);
    expect(String(uploadCall?.[0]?.description ?? "")).not.toMatch(/\bmotherfucker\b/);
  });

  it("guardrails NOT installed → caption is NOT scrubbed (raw text posts as-is)", async () => {
    h.queryMock.mockResolvedValue({ creatorWallet: "W", name: "Agent", mintAddress: MINT, installedSkills: [] });
    h.runGuardrailsMock.mockResolvedValue({ pass: true, reasons: [], checked: [] });
    const res = await POST(makeReq({ ...videoBody, title: "raw shit title" }));
    expect(res.status).toBe(200);
    const uploadCall = h.uploadVideoMock.mock.calls[0];
    expect(String(uploadCall?.[0]?.title ?? "")).toContain("shit");
  });
});


describe("influencer X captions", () => {
  beforeEach(() => {
    h.queryMock.mockImplementation(async (ref: unknown) => getFunctionName(ref as Parameters<typeof getFunctionName>[0]) === GET_BY_MINT
      ? { creatorWallet: "W", name: "Zed", agentType: "influencer", archetype: "witty", niche: "tech", language: "Malay", mintAddress: MINT }
      : []);
    h.generatePostCaptionMock.mockResolvedValue("A specific hook about the demo.");
  });
  it("generates persona copy without requiring the clipper captions skill", async () => {
    const res = await POST(makeReq({ ...videoBody, platforms: ["x"], description: "A demo of the new camera" }));
    expect(res.status).toBe(200);
    expect(h.generatePostCaptionMock).toHaveBeenCalledWith(expect.objectContaining({
      instruction: expect.stringMatching(/Zed.*witty.*tech.*Malay.*280/),
      basis: "A demo of the new camera",
    }));
    expect(h.uploadVideoMock).toHaveBeenCalledWith(expect.objectContaining({ title: "A specific hook about the demo." }));
  });
  it("preserves operator approved copy", async () => {
    await POST(makeReq({ ...videoBody, platforms: ["x"], title: "My approved caption", captionLocked: true }));
    expect(h.generatePostCaptionMock).not.toHaveBeenCalled();
    expect(h.uploadVideoMock).toHaveBeenCalledWith(expect.objectContaining({ title: "My approved caption" }));
  });
  it("keeps content copy when generation is unavailable", async () => {
    h.generatePostCaptionMock.mockResolvedValue("");
    await POST(makeReq({ ...videoBody, platforms: ["x"], title: "The camera demo" }));
    expect(h.uploadVideoMock).toHaveBeenCalledWith(expect.objectContaining({ title: "The camera demo" }));
  });
});

it("does not publish when the agent transfer is unconfirmed", async () => {
  h.chargeMock.mockResolvedValue({ ok: false, reason: "payment_failed" });
  const res = await POST(makeReq(videoBody));
  expect(res.status).toBe(502);
  expect(h.uploadVideoMock).not.toHaveBeenCalled();
  expect(h.refundMock).toHaveBeenCalled();
});
