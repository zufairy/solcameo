import { describe, expect, it } from "vitest";
import { buildClipRunProgress, findEditorClipRun } from "./clip-run-progress";

describe("findEditorClipRun", () => {
  it("reattaches to the existing active source job returned by enqueue deduplication", () => {
    const job = { _id: "existing", sourceUrl: "https://video.example/source", createdAt: 1000, status: "transcribing", updatedAt: 9000 };
    expect(findEditorClipRun([job], 10000, job.sourceUrl)).toBe(job);
    expect(findEditorClipRun([job], 10000, "https://youtu.be/alias", job._id)).toBe(job);
  });

  it("does not show another source's run as this editor run", () => {
    const other = { _id: "other", sourceUrl: "https://video.example/other", createdAt: 10100, status: "clipping", updatedAt: 10200 };
    expect(findEditorClipRun([other], 10000, "https://video.example/source")).toBeNull();
  });
  it("selects the freshly-created job for the editor's source instead of an older run", () => {
    const job = findEditorClipRun([
      { _id: "old", sourceUrl: "https://video.example/old", createdAt: 1_000, status: "completed", updatedAt: 2_000 },
      { _id: "new", sourceUrl: "https://video.example/source", createdAt: 10_100, status: "transcribing", updatedAt: 10_200 },
    ], 10_000, "https://video.example/source");

    expect(job?._id).toBe("new");
  });
});

describe("buildClipRunProgress", () => {
  it("stops pending slots when kickoff fails, instead of showing endless moment selection", () => {
    const progress = buildClipRunProgress({ startedAt: 1000, now: 4000, target: 2, clips: [], job: {
      _id: "local", sourceUrl: "https://video.example/source", createdAt: 1000, updatedAt: 4000, status: "error", error: "Couldn't save clip settings",
    } });
    expect(progress.isComplete).toBe(true);
    expect(progress.items).toHaveLength(2);
    expect(progress.items.every((item) => item.state === "failed" && item.detail === "Couldn't save clip settings")).toBe(true);
  });
  it("keeps every requested clip visible while the batch is still rendering", () => {
    const progress = buildClipRunProgress({
      startedAt: 1_000,
      now: 121_000,
      target: 15,
      job: {
        _id: "job-1",
        sourceUrl: "https://video.example/source",
        createdAt: 1_100,
        updatedAt: 120_000,
        status: "clipping",
        durationSeconds: 1_800,
        clipsTotal: 15,
        clipsReady: 4,
        progressNote: "Cutting 15 clips from one stored copy…",
      },
      clips: [
        { _id: "clip-1", jobId: "job-1", title: "Strong opening", status: "ready", createdAt: 2_000 },
        { _id: "clip-2", jobId: "job-1", title: "Key takeaway", status: "rendering", createdAt: 2_100 },
        { _id: "clip-3", jobId: "job-1", title: "Closing hook", status: "failed", failReason: "render timed out", createdAt: 2_200 },
      ],
    });

    expect(progress.items).toHaveLength(15);
    expect(progress.items[0]).toMatchObject({ label: "Strong opening", state: "ready" });
    expect(progress.items[1]).toMatchObject({ label: "Key takeaway", state: "rendering" });
    expect(progress.items[2]).toMatchObject({ label: "Closing hook", state: "failed", detail: "render timed out" });
    expect(progress.items[14]).toMatchObject({ label: "Clip 15", state: "rendering" });
    expect(progress.etaSeconds).toBeGreaterThan(0);
  });
});
