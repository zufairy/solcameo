import { describe, it, expect } from "vitest";
import { isKilledBySignal, threadArgs } from "./clipRender";

// A clip run reported `ffmpeg null: … frame= 1 … [Parsed_subtitles_6] fontselect:`
// — an exit CODE of null means the process died on a SIGNAL (the container's OOM
// killer), not that the filtergraph was wrong. The old message named neither, so
// the fix was aimed at the innocent-looking subtitles line at the end of the log.
describe("isKilledBySignal", () => {
  it("recognizes an OOM/SIGKILL death", () => {
    expect(isKilledBySignal(new Error("ffmpeg killed by SIGKILL — killed from outside the process: almost always the container's OOM killer"))).toBe(true);
  });

  it("still recognizes the legacy 'ffmpeg null' shape", () => {
    expect(isKilledBySignal(new Error("ffmpeg null: frame=    1 fps=0.0 q=0.0"))).toBe(true);
  });

  it("does NOT treat a normal non-zero exit as a kill — that one gets the simplify retry", () => {
    expect(isKilledBySignal(new Error("ffmpeg 1: Error initializing filter 'zoompan'"))).toBe(false);
  });

  it("does NOT treat the wall-clock timeout as an external kill", () => {
    expect(isKilledBySignal(new Error("ffmpeg killed: exceeded 280000ms wall clock."))).toBe(false);
  });
});

describe("threadArgs", () => {
  it("caps encode AND filtergraph threads — x264 buffers are per-thread", () => {
    expect(threadArgs(1)).toEqual(["-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1"]);
  });

  it("defaults to a bounded thread count rather than one-per-core", () => {
    const n = Number(threadArgs()[1]);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(4);
  });
});
