import { describe, it, expect, vi, beforeEach } from "vitest";

const createImageTask = vi.fn();
const pollNftTaskOnce = vi.fn();
const persistStill = vi.fn();
const sleep = vi.fn();
vi.mock("@/lib/server/imagePost", () => ({ createImageTask }));
vi.mock("@/lib/server/nftKie", () => ({
  pollNftTaskOnce, persistStill, sleep, MAX_ATTEMPTS: 3,
}));

const { generateCarouselImage } = await import("./carouselImage");

import type { ImageEngine } from "@/lib/builder/imageEngines";
const ENGINE: ImageEngine = { id: "nano-banana-2", label: "Nano Banana 2", slug: "nano-banana-2", blurb: "", resolution: "4K", acceptsReferences: true, pricePerImageUsdc: 0.04 };

beforeEach(() => {
  vi.clearAllMocks();
  createImageTask.mockResolvedValue("task-1");
  pollNftTaskOnce.mockResolvedValue({ status: "success", url: "https://cdn/img.png" });
  persistStill.mockResolvedValue("https://supabase/img.png");
  sleep.mockResolvedValue(undefined);
});

describe("generateCarouselImage — auto-retry + agent reference images", () => {
  it("forwards the agent's reference images to createImageTask (KIE image_input)", async () => {
    const out = await generateCarouselImage({
      prompt: "a flat-lay of skincare",
      engine: ENGINE,
      refImageUrls: ["https://ref/a.png", "https://ref/b.png"],
    });
    expect(out.imageUrl).toBe("https://supabase/img.png");
    expect(createImageTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "a flat-lay of skincare",
      engine: ENGINE,
      refImageUrls: ["https://ref/a.png", "https://ref/b.png"],
    }));
  });

  it("retries with a FRESH task when a render fails (auto-retry, same refs)", async () => {
    pollNftTaskOnce
      .mockResolvedValueOnce({ status: "fail", error: "model overloaded" })
      .mockResolvedValueOnce({ status: "success", url: "https://cdn/img2.png" });
    createImageTask
      .mockResolvedValueOnce("task-fail")
      .mockResolvedValueOnce("task-ok");

    const out = await generateCarouselImage({ prompt: "p", engine: ENGINE, refImageUrls: ["https://ref/a.png"] });

    expect(createImageTask).toHaveBeenCalledTimes(2);
    // Both attempts carry the refs — retry never drops the likeness.
    expect(createImageTask.mock.calls.every(([c]) => c.refImageUrls?.[0] === "https://ref/a.png")).toBe(true);
    expect(out.imageUrl).toBe("https://supabase/img.png");
    expect(persistStill).toHaveBeenCalledWith("https://cdn/img2.png", 0);
  });

  it("surfaces a clean error after MAX_ATTEMPTS failed renders", async () => {
    pollNftTaskOnce.mockResolvedValue({ status: "fail", error: "permanent rejection" });
    createImageTask.mockResolvedValue("task-x");

    await expect(generateCarouselImage({ prompt: "p", engine: ENGINE })).rejects.toThrow("permanent rejection");
    expect(createImageTask).toHaveBeenCalledTimes(3);
  });

  it("defaults aspect_ratio to 9:16 (vertical carousel)", async () => {
    await generateCarouselImage({ prompt: "p", engine: ENGINE });
    expect(createImageTask).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "9:16" }));
  });
});
