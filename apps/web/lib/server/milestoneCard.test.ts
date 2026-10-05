// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), store: vi.fn(), frames: vi.fn(), validate: vi.fn() }));
vi.mock("./xShareCardRender", () => ({ loadShareAgent: mocks.load, renderShareCard: mocks.render }));
vi.mock("./imageStorage", () => ({ putImage: mocks.store }));
vi.mock("./videoThumbnails", () => ({ videoFrames: mocks.frames }));
vi.mock("./downloader", () => ({ assertPublicHttpUrl: mocks.validate }));
import { createMilestoneCard } from "./milestoneCard";
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue({ mint: "agent", avatarUrl: "https://example.com/a.jpg", stats: { name: "mila", handle: "mila", views: 900000, videos: 100, posted: 90, bestViews: 200000, platforms: ["x", "tiktok"] } });
  const png = await sharp({ create: { width: 1200, height: 675, channels: 3, background: "#07070a" } }).png().toBuffer();
  mocks.render.mockResolvedValue(new Response(new Uint8Array(png)));
  mocks.frames.mockResolvedValue([Buffer.from("frame")]);
  mocks.store.mockResolvedValue({ url: "https://example.com/milestone.png" });
});
describe("video milestone X card", () => {
  it("uses the real gallery renderer with only the qualifying video's measured stats", async () => {
    const url = await createMilestoneCard({ _id: "job", agentMint: "agent", milestoneViews: 12345, videoUrl: "https://example.com/video.mp4", platform: "tiktok" });
    expect(url).toContain("milestone.png");
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ stats: expect.objectContaining({ name: "mila", views: 12345, bestViews: 12345, videos: 1, posted: 1, platforms: ["tiktok"] }), clips: [{ frames: [Buffer.from("frame")], views: 12345 }] }), "job");
    const bytes = mocks.store.mock.calls[0][0] as Buffer;
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1200, height: 675, format: "png" });
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ look: "silver", headline: expect.stringContaining("10,000+") }), "job");
    expect(mocks.store.mock.calls[0][2]).toEqual({ key: "marketing/milestones/job.png" });
  });
  it("rejects an unqualified view count before rendering", async () => {
    await expect(createMilestoneCard({ _id: "job", agentMint: "agent", milestoneViews: 10000 })).rejects.toThrow("Invalid video milestone");
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("rejects deleted agents and never posts a fabricated card", async () => {
    mocks.load.mockResolvedValue(null);
    await expect(createMilestoneCard({ _id: "job", agentMint: "agent", milestoneViews: 10001 })).rejects.toThrow("no longer exists");
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
