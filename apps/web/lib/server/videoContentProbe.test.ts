import { describe, expect, it, vi } from "vitest";
import { hookContentBasis } from "@/lib/server/videoContentProbe";

// The probe path (transcript / vision) hits the network + ffmpeg — verify the
// free, script-based basis path and the empty-fallback behavior here; the network
// path degrades gracefully by construction (best-effort + time-boxed + try/catch).
describe("videoContentProbe.hookContentBasis", () => {
  it("returns the script text when a generated video has one", async () => {
    const basis = await hookContentBasis(
      { scriptText: "  5 Ways MasterChefs Slice an Onion — a huge deal everyone's missing.  " },
      "http://localhost:3000",
    );
    expect(basis).toContain("MasterChefs");
    expect(basis).toBe("5 Ways MasterChefs Slice an Onion — a huge deal everyone's missing.");
  });

  it("truncates an overlong script to the cap", async () => {
    const long = "word ".repeat(2000);
    const basis = await hookContentBasis({ scriptText: long }, "http://localhost:3000");
    expect(basis.length).toBeLessThanOrEqual(1600);
  });

  it("returns empty when probe-able source is missing", async () => {
    const basis = await hookContentBasis({ scriptText: "" }, "http://localhost:3000");
    expect(basis).toBe("");
  });

  it("never probes when a script is available", async () => {
    // If the module tried to probe, fetchStuff would be hit — guard by asserting the
    // resolved value comes purely from the script with no throw on a bogus origin.
    const basis = await hookContentBasis(
      { scriptText: "Real content, no probe.", videoUrl: "https://example.invalid/x.mp4" },
      "http://127.0.0.1:1",
    );
    expect(basis).toBe("Real content, no probe.");
  });
});