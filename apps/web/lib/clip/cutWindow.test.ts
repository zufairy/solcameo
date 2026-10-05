import { describe, expect, it } from "vitest";
import { boundCutWindow } from "./cutWindow";

describe("final clip duration bounds", () => {
  it("keeps an AI window inside 20–45 seconds even after phrase snapping", () => {
    expect(boundCutWindow(12, 58, 300, { min: 20, max: 45 })).toEqual({ startSeconds: 12, endSeconds: 57 });
    expect(boundCutWindow(12, 15, 300, { min: 20, max: 45 })).toEqual({ startSeconds: 12, endSeconds: 32 });
  });
  it("moves an end-of-source moment back to preserve the minimum", () => {
    expect(boundCutWindow(99, 120, 100, { min: 20, max: 45 })).toEqual({ startSeconds: 80, endSeconds: 100 });
  });
  it("never extends a short source or an out-of-bounds AI timestamp", () => {
    expect(boundCutWindow(900, 950, 12.5, { min: 20, max: 45 })).toEqual({ startSeconds: 0, endSeconds: 12.5 });
  });
});
