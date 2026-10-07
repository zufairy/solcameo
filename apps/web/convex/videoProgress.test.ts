import { describe, expect, it } from "vitest";
import { progressOf } from "./videoProgress";

describe("progressOf", () => {
  it("moves forward through the pipeline and ends at 100", () => {
    const steps = [
      progressOf(null, "pending"),
      progressOf({ phase: "storyboard" }, "running"),
      progressOf({ phase: "video", clipIndex: 0, totalSegments: 4 }, "running"),
      progressOf({ phase: "video", clipIndex: 2, totalSegments: 4 }, "running"),
      progressOf({ phase: "video", clipIndex: 4, totalSegments: 4 }, "running"),
      progressOf({ phase: "posting" }, "running"),
      progressOf(null, "succeeded"),
    ];
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps[0]).toBeLessThan(10);
    expect(steps.at(-1)).toBe(100);
  });
  it("never reads past 100 or below 0 on bad clip counters", () => {
    expect(progressOf({ phase: "video", clipIndex: 99, totalSegments: 2 }, "running")).toBeLessThanOrEqual(100);
    expect(progressOf({ phase: "video", clipIndex: -3, totalSegments: 0 }, "running")).toBeGreaterThanOrEqual(0);
  });
});
