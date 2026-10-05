import { expect, it } from "vitest";
import { videoMilestoneIdentity } from "./videoMilestoneKey";
it("keeps distinct YouTube video IDs and equates short/watch URLs", () => {
  const key = "fallback";
  expect(videoMilestoneIdentity({ key, postUrl: "https://www.youtube.com/watch?v=abc&utm_source=x" })).toBe("youtube:abc");
  expect(videoMilestoneIdentity({ key, postUrl: "https://youtu.be/abc?si=tracking" })).toBe("youtube:abc");
  expect(videoMilestoneIdentity({ key, postUrl: "https://youtube.com/shorts/abc" })).toBe("youtube:abc");
  expect(videoMilestoneIdentity({ key, postUrl: "https://youtube.com/watch?v=def" })).toBe("youtube:def");
});
it("equates X/Twitter URLs and native post IDs", () => {
  const key = "fallback";
  expect(videoMilestoneIdentity({ key, postUrl: "https://twitter.com/account/status/123?s=20" })).toBe("x:123");
  expect(videoMilestoneIdentity({ key, postUrl: "https://x.com/account/status/123" })).toBe("x:123");
  expect(videoMilestoneIdentity({ key, platform: "x", platformPostId: "123" })).toBe("x:123");
});
