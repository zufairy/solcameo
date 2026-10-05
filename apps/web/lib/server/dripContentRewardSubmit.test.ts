// @vitest-environment node
import { describe, it, expect } from "vitest";
import { dripContentRewardSubmitBody, durablePostIdsFromOutput } from "./dripContentRewardSubmit";

// Gap #2 (drip content-reward submit): the drip poster (scheduledContent.drainDueClips)
// forwards only campaignId to post_content, so DRIP-posted CONTENT-REWARD clips never
// reach their /stage/reward page — the scheduledContent row has no contentRewardId
// field. After the drip marks the clip posted, markClipPostedByUrl returns the clip's
// JOB provenance (which still has contentRewardId). This helper turns that provenance
// into the /api/content-rewards/submit body — or null when it isn't a content-reward
// clip, or lacks a field the route requires (→ 400).
describe("dripContentRewardSubmitBody", () => {
  const ctx = { postUrl: "https://www.tiktok.com/@a/video/1", clipUrl: "https://clips/c1.mp4", platform: "tiktok" };

  it("builds the submit body for a content-reward clip (contentUrl = the live post URL)", () => {
    expect(dripContentRewardSubmitBody({ contentRewardId: "cr_1", ownerWallet: "wallet1" }, ctx)).toEqual({
      contentRewardId: "cr_1", ownerWallet: "wallet1",
      contentUrl: "https://www.tiktok.com/@a/video/1", videoUrl: "https://clips/c1.mp4", platform: "tiktok",
    });
  });

  it("falls back contentUrl to the clip URL when no live post URL resolved", () => {
    expect(
      dripContentRewardSubmitBody({ contentRewardId: "cr_1", ownerWallet: "wallet1" }, { ...ctx, postUrl: undefined })?.contentUrl,
    ).toBe("https://clips/c1.mp4");
  });

  it("returns null for a NON-content-reward (campaign) clip — campaignId is handled by post_content", () => {
    expect(dripContentRewardSubmitBody({ contentRewardId: null, ownerWallet: "wallet1" }, ctx)).toBeNull();
  });

  it("returns null when the clip has no job/owner (mark returned 'clip not found' or no provenance)", () => {
    expect(dripContentRewardSubmitBody(null, ctx)).toBeNull();
    expect(dripContentRewardSubmitBody({ contentRewardId: "cr_1", ownerWallet: null }, ctx)).toBeNull();
  });

  it("returns null when no platform resolved (the submit route requires platform → would 400)", () => {
    expect(dripContentRewardSubmitBody({ contentRewardId: "cr_1", ownerWallet: "wallet1" }, { ...ctx, platform: undefined })).toBeNull();
  });

  // Regression (2026-07-15): this body used to drop platformPostId/uploadPostRequestId/
  // mintAddress entirely, so /api/content-rewards/submit never registered a measurement
  // handle for a drip-posted content-reward clip — its real permalink and views could
  // never be resolved, permanently "not posted" with 0 views even though it posted.
  it("forwards platformPostId/uploadPostRequestId/mintAddress when the caller has them", () => {
    expect(dripContentRewardSubmitBody(
      { contentRewardId: "cr_1", ownerWallet: "wallet1" },
      { ...ctx, platformPostId: "tt_1", uploadPostRequestId: "req_1", mintAddress: "mintABC" },
    )).toEqual({
      contentRewardId: "cr_1", ownerWallet: "wallet1",
      contentUrl: "https://www.tiktok.com/@a/video/1", videoUrl: "https://clips/c1.mp4", platform: "tiktok",
      platformPostId: "tt_1", uploadPostRequestId: "req_1", mintAddress: "mintABC",
    });
  });

  it("omits the durable-id fields entirely when the caller doesn't have them (no undefined keys)", () => {
    const body = dripContentRewardSubmitBody({ contentRewardId: "cr_1", ownerWallet: "wallet1" }, ctx);
    expect(body).not.toHaveProperty("platformPostId");
    expect(body).not.toHaveProperty("uploadPostRequestId");
    expect(body).not.toHaveProperty("mintAddress");
  });
});

// The DURABLE post ids (platformPostId + uploadPostRequestId) are what make a
// submission PAYABLE: submissions.dueForVerification only measures a row that
// carries one of them (a postUrl-only row is never attested on-chain → the claim
// keeper never pays). run-task returns them in its post_content output; the drip
// poster must forward whatever is present into submitClipToCampaign +
// bridgeContentRewardToCampaign. This helper does the guarded extraction the drip
// used to skip — dropping the ids stranded every auto-posted content_reward clip.
describe("durablePostIdsFromOutput", () => {
  it("extracts both durable ids from a run-task post_content output", () => {
    expect(
      durablePostIdsFromOutput({ status: "posted", postUrl: "u", postPlatform: "tiktok", platformPostId: "tt_1", uploadPostRequestId: "req_1" }),
    ).toEqual({ platformPostId: "tt_1", uploadPostRequestId: "req_1" });
  });

  it("extracts just the one id that is present", () => {
    expect(durablePostIdsFromOutput({ uploadPostRequestId: "req_1" })).toEqual({ uploadPostRequestId: "req_1" });
    expect(durablePostIdsFromOutput({ platformPostId: "tt_1" })).toEqual({ platformPostId: "tt_1" });
  });

  it("returns {} (safe to spread — no undefined) when ids are absent, empty, or non-string", () => {
    expect(durablePostIdsFromOutput({ status: "posted", postUrl: "u" })).toEqual({});
    expect(durablePostIdsFromOutput({ platformPostId: "", uploadPostRequestId: "" })).toEqual({});
    expect(durablePostIdsFromOutput({ platformPostId: 5, uploadPostRequestId: {} })).toEqual({});
    expect(durablePostIdsFromOutput(null)).toEqual({});
    expect(durablePostIdsFromOutput(undefined)).toEqual({});
  });
});
