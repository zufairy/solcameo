import { describe, it, expect } from "vitest";
import { CLIP_PHASES, clipPhaseState, isClipActive, hasClipModule } from "./clipPhase";

describe("hasClipModule", () => {
  it("is always true for a clipping agent, regardless of skills", () => {
    expect(hasClipModule("clipping", [])).toBe(true);
    expect(hasClipModule("clipping", undefined)).toBe(true);
  });
  it("requires video.clip for any other agent type", () => {
    expect(hasClipModule("influencer", ["ai.reasoning"])).toBe(false);
    expect(hasClipModule("influencer", ["video.clip", "ai.reasoning"])).toBe(true);
    expect(hasClipModule("trader", undefined)).toBe(false);
  });
});

describe("clipPhaseState", () => {
  it("marks earlier phases done, the current one active, later ones pending", () => {
    const s = clipPhaseState("analyzing"); // → "Find moments" active
    expect(s.map((p) => p.label)).toEqual([...CLIP_PHASES]);
    expect(s[0].state).toBe("done");   // Download
    expect(s[1].state).toBe("done");   // Transcribe
    expect(s[2].state).toBe("active"); // Find moments
    expect(s[3].state).toBe("pending");// Cut
    expect(s[4].state).toBe("pending");// Post
  });

  it("treats queued/downloading as the first (Download) phase active", () => {
    expect(clipPhaseState("queued")[0].state).toBe("active");
    expect(clipPhaseState("downloading")[0].state).toBe("active");
  });

  it("marks every phase done when completed", () => {
    expect(clipPhaseState("completed").every((p) => p.state === "done")).toBe(true);
  });

  it("does not mark any phase active on error", () => {
    expect(clipPhaseState("error").some((p) => p.state === "active")).toBe(false);
  });
});

describe("isClipActive", () => {
  it("is true while a job is mid-pipeline, false when finished/errored/absent", () => {
    expect(isClipActive("downloading")).toBe(true);
    expect(isClipActive("posting")).toBe(true);
    expect(isClipActive("completed")).toBe(false);
    expect(isClipActive("error")).toBe(false);
    expect(isClipActive(undefined)).toBe(false);
  });
});
