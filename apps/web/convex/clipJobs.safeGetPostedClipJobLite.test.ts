import { describe, expect, it, vi } from "vitest";
import { safeGetPostedClipJobLite } from "./clipJobs";

describe("safeGetPostedClipJobLite", () => {
  it("returns the sourceUrl when the job lookup succeeds", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => ({ sourceUrl: "https://example.com/source.mp4" })),
      },
    };

    await expect(safeGetPostedClipJobLite(ctx, "job-1")).resolves.toEqual({
      sourceUrl: "https://example.com/source.mp4",
    });
  });

  it("returns null when the job lookup throws", async () => {
    const ctx = {
      db: {
        get: vi.fn(async () => {
          throw new Error("bad job id");
        }),
      },
    };

    await expect(safeGetPostedClipJobLite(ctx, "bad-id")).resolves.toBeNull();
  });
});
