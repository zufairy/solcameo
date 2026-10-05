import { describe, it, expect, vi, beforeEach } from "vitest";

// The credit-saving contract: a retry that carries a persisted KIE task id
// must POLL that task first and only create (pay for) a fresh task when the
// resumed one is dead — "Nano Banana 2 did not finish in time" used to
// re-create all tasks from scratch on every retry.

const createImageTask = vi.fn();
const pollNftTaskOnce = vi.fn();
vi.mock("@/lib/server/imagePost", () => ({ createImageTask: (...a: unknown[]) => createImageTask(...a) }));
vi.mock("@/lib/server/nftKie", () => ({
  persistStill: vi.fn(async (u: string) => u),
  pollNftTaskOnce: (...a: unknown[]) => pollNftTaskOnce(...a),
  sleep: vi.fn(async () => {}),
  MAX_ATTEMPTS: 2,
}));

import { generateCarouselImage } from "./carouselImage";

const engine = { id: "nano-banana-2", label: "Nano Banana 2", kieModel: "nano-banana-2" } as never;

beforeEach(() => {
  createImageTask.mockReset();
  pollNftTaskOnce.mockReset();
});

describe("generateCarouselImage resume", () => {
  it("re-polls the persisted task and creates NO new task when it finished", async () => {
    pollNftTaskOnce.mockResolvedValue({ status: "success", url: "https://kie/img.png" });
    const res = await generateCarouselImage({ prompt: "p", engine, resumeTaskId: "old-task" });
    expect(res.imageUrl).toBe("https://kie/img.png");
    expect(createImageTask).not.toHaveBeenCalled();
    expect(pollNftTaskOnce).toHaveBeenCalledWith("old-task");
  });

  it("falls back to a fresh task when the resumed task reports failure", async () => {
    pollNftTaskOnce
      .mockResolvedValueOnce({ status: "fail", error: "expired" })
      .mockResolvedValue({ status: "success", url: "https://kie/fresh.png" });
    createImageTask.mockResolvedValue("new-task");
    const onTaskCreated = vi.fn();
    const res = await generateCarouselImage({ prompt: "p", engine, resumeTaskId: "old-task", onTaskCreated });
    expect(res.imageUrl).toBe("https://kie/fresh.png");
    expect(createImageTask).toHaveBeenCalledTimes(1);
    expect(onTaskCreated).toHaveBeenCalledWith("new-task");
  });

  it("persists every fresh task id BEFORE polling so a timeout death is resumable", async () => {
    const order: string[] = [];
    createImageTask.mockImplementation(async () => { order.push("create"); return "t1"; });
    pollNftTaskOnce.mockImplementation(async () => { order.push("poll"); return { status: "success", url: "https://kie/x.png" }; });
    await generateCarouselImage({ prompt: "p", engine, onTaskCreated: async () => { order.push("persist"); } });
    expect(order.slice(0, 3)).toEqual(["create", "persist", "poll"]);
  });
});
