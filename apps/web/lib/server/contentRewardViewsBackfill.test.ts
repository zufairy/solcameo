import { describe, it, expect } from "vitest";
import { isSocialPermalink, planRewardSubmissionUpdate } from "./contentRewardSubmissions";

describe("isSocialPermalink", () => {
  it("accepts real social post permalinks", () => {
    expect(isSocialPermalink("https://www.instagram.com/reel/DaM1pKbk7X8/")).toBe(true);
    expect(isSocialPermalink("https://www.tiktok.com/@x/video/123")).toBe(true);
    expect(isSocialPermalink("https://youtube.com/shorts/abc")).toBe(true);
    expect(isSocialPermalink("https://youtu.be/abc")).toBe(true);
  });
  it("rejects raw clip / CDN / storage urls", () => {
    expect(isSocialPermalink("https://bold-ram-39.convex.cloud/api/storage/c7eccbaf")).toBe(false);
    expect(isSocialPermalink("https://slmlubxaclmoqxivcurz.supabase.co/storage/v1/x.mp4")).toBe(false);
    expect(isSocialPermalink("")).toBe(false);
    expect(isSocialPermalink(null)).toBe(false);
    expect(isSocialPermalink("not a url")).toBe(false);
  });
  it("does not match a lookalike host as a substring", () => {
    expect(isSocialPermalink("https://tiktok.com.evil.example/x")).toBe(false);
  });
});

describe("planRewardSubmissionUpdate", () => {
  it("writes a strictly-higher view count (never lowers)", () => {
    expect(planRewardSubmissionUpdate({ views: 100, currentViews: 50 })).toEqual({ views: 100 });
    expect(planRewardSubmissionUpdate({ views: 50, currentViews: 50 })).toEqual({});
    expect(planRewardSubmissionUpdate({ views: 10, currentViews: 50 })).toEqual({});
  });

  it("backfills the permalink when stored content_url is a raw clip url", () => {
    const patch = planRewardSubmissionUpdate({
      views: 10716,
      currentViews: 0,
      resolvedPostUrl: "https://www.instagram.com/reel/DaM1pKbk7X8/",
      currentContentUrl: "https://bold-ram-39.convex.cloud/api/storage/abc",
    });
    expect(patch).toEqual({ views: 10716, content_url: "https://www.instagram.com/reel/DaM1pKbk7X8/" });
  });

  it("never overwrites an existing real permalink", () => {
    const patch = planRewardSubmissionUpdate({
      views: 5,
      currentViews: 0,
      resolvedPostUrl: "https://www.instagram.com/reel/NEW/",
      currentContentUrl: "https://www.instagram.com/reel/OLD/",
    });
    expect(patch).toEqual({ views: 5 }); // content_url untouched
  });

  it("does not write a resolved url that isn't a real permalink", () => {
    const patch = planRewardSubmissionUpdate({
      views: 0,
      currentViews: 0,
      resolvedPostUrl: "https://cdn.example/raw.mp4",
      currentContentUrl: "https://bold-ram-39.convex.cloud/api/storage/abc",
    });
    expect(patch).toEqual({});
  });

  it("can backfill the link even when views did not increase", () => {
    const patch = planRewardSubmissionUpdate({
      views: 0,
      currentViews: 0,
      resolvedPostUrl: "https://www.tiktok.com/@a/video/1",
      currentContentUrl: "https://bold-ram-39.convex.cloud/api/storage/abc",
    });
    expect(patch).toEqual({ content_url: "https://www.tiktok.com/@a/video/1" });
  });
});
