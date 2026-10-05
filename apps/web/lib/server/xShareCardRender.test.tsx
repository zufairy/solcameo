// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderShareCard, renderShareGif } from "./xShareCardRender";
import { videoFrames } from "./videoThumbnails";

describe("agent milestone image", () => {
  it("renders a full-size card with placeholder clip panels when an agent has no clips", async () => {
    const image = await renderShareCard({
      mint: "11111111111111111111111111111111",
      avatarUrl: null,
      stats: { name: "Rainier Clips", views: 32_870, videos: 15, posted: 12, bestViews: 8_405, platforms: ["youtube", "tiktok", "instagram", "x"] },
    }, "test");
    const buffer = Buffer.from(await image.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 1200, height: 675 });
    expect(buffer.byteLength).toBeGreaterThan(20_000);
  }, 30_000);

  it("exports an animated, looping GIF from real clip frames, small enough for X", async () => {
    const frames = await videoFrames("/hero-bg.mp4", 5);
    const gif = await renderShareGif({
      mint: "11111111111111111111111111111111",
      avatarUrl: "/vello-flash-mascot.png",
      clips: frames ? [{ frames, views: 410_000 }] : [],
      stats: { name: "Rainier Clips", views: 1_500_000_000, videos: 15, posted: 12, bestViews: 420_000_000, platforms: ["youtube", "x"] },
    }, "gif-test");
    const metadata = await sharp(gif, { animated: true }).metadata();
    // The encoder merges identical neighbouring frames (the resolve intro), so
    // the page count is at most SHARE_FRAMES rather than exactly it.
    expect(metadata).toMatchObject({ format: "gif", width: 1200, pageHeight: 675, loop: 0 });
    expect(metadata.pages).toBeGreaterThan(20);
    expect(gif.byteLength).toBeLessThan(5 * 1024 * 1024);
  }, 60_000);
});
