import { describe, it, expect } from "vitest";
import { __test, type GenerateVideoArgs, type StoryBeat } from "./kie-video-pipeline";
import { directiveBlock, parseDirectives } from "./agentDirectives";

// The reported bug, at the layer that actually talks to KIE: the operator told the
// builder copilot "only commercial videos, no need to speak" and the render still
// asked Veo for a lip-synced talking head. These assert the clip prompt itself.

const beat: StoryBeat = { index: 1, scene: "hero shot of the bottle", voiceover: "Hydration first.", camera: "static", seconds: 4 };

function args(over: Partial<GenerateVideoArgs> = {}): GenerateVideoArgs {
  return {
    agentName: "Nova",
    agentNiche: "skincare",
    avatarUrl: "https://x/a.png",
    topic: "hydration",
    hook: "Stop drying out your skin",
    scriptText: "Hydration first.",
    ...over,
  } as GenerateVideoArgs;
}

describe("clip prompts obey the speech standing order", () => {
  it("DEFAULT (no order) is still the lip-synced talking head — no behaviour change", () => {
    const p = __test.buildSegmentPrompt(args(), [beat], 0, 1, "voice");
    expect(p).toMatch(/talking straight to camera/i);
    expect(p).toMatch(/lip-sync EXACTLY/i);
  });

  it("speech=silent produces a SILENT clip prompt — no dialogue, no lip-sync, nobody addressing camera", () => {
    const p = __test.buildSegmentPrompt(args({ speech: "silent" }), [beat], 0, 1, "voice");
    expect(p).toMatch(/NOBODY SPEAKS/);
    expect(p).toMatch(/no lip-sync/i);
    expect(p).toMatch(/Do NOT show a person addressing the camera/i);
    // The talking-head template must be entirely gone, not merely contradicted.
    expect(p).not.toMatch(/talking straight to camera/i);
    expect(p).not.toMatch(/lip-sync EXACTLY/i);
    // The line the model must NOT speak is also absent from the prompt.
    expect(p).not.toContain("Hydration first.");
  });

  it("speech=silent wins even when the format says commercial (order beats inference)", () => {
    const p = __test.buildSegmentPrompt(
      args({ speech: "silent", creativeBrief: { format: "commercial", angle: "product hero" } }),
      [beat], 0, 1, "voice",
    );
    expect(p).toMatch(/NOBODY SPEAKS/);
    expect(p).not.toMatch(/VOICEOVER —/);
  });

  it("speech=voiceover narrates off-camera on a NON-commercial format", () => {
    const p = __test.buildSegmentPrompt(
      args({ speech: "voiceover", creativeBrief: { format: "day in the life", angle: "relatable" } }),
      [beat], 0, 1, "voice",
    );
    expect(p).toMatch(/off-camera narration/i);
    expect(p).toMatch(/NEVER film them talking to camera/i);
    expect(p).toContain("Hydration first.");   // still spoken, just not on camera
    expect(p).not.toMatch(/lip-sync EXACTLY/i);
  });

  it("speech=on_camera restores the talking head even for a commercial format", () => {
    const p = __test.buildSegmentPrompt(
      args({ speech: "on_camera", creativeBrief: { format: "commercial", angle: "product hero" } }),
      [beat], 0, 1, "voice",
    );
    // The ad branch is format-driven, so a commercial stays an ad — but its audio is
    // no longer forced off-camera when the operator explicitly asked for on-camera.
    expect(p).toMatch(/commercial/i);
  });

  it("a commercial with NO explicit order keeps the existing off-camera inference", () => {
    const p = __test.buildSegmentPrompt(
      args({ creativeBrief: { format: "commercial", angle: "product hero" } }),
      [beat], 0, 1, "voice",
    );
    expect(p).toMatch(/OFF-CAMERA NARRATION/i);
    expect(p).not.toMatch(/lip-sync EXACTLY/i);
  });
});

describe("standing orders ride on every prompt", () => {
  const orders = directiveBlock(parseDirectives("from now on only commercial videos, no need to speak, always show the bottle"));

  it("appends the verbatim orders block to the segment prompt", () => {
    const p = __test.buildSegmentPrompt(args({ speech: "silent", standingOrders: orders }), [beat], 0, 1, "voice");
    expect(p).toContain("OPERATOR STANDING ORDERS");
    expect(p).toMatch(/ALWAYS: show the bottle/i);
  });

  it("appends them to the EXTEND prompt too (clip 2+ of a chained render)", () => {
    const p = __test.buildExtendPrompt(
      args({ speech: "silent", standingOrders: orders }), [beat], 8, "voice", beat, false,
    );
    expect(p).toContain("OPERATOR STANDING ORDERS");
    expect(p).toMatch(/NO SPEECH/);
  });

  it("adds nothing when there are no orders (prompts stay byte-identical)", () => {
    const withEmpty = __test.buildSegmentPrompt(args({ standingOrders: "" }), [beat], 0, 1, "voice");
    const without = __test.buildSegmentPrompt(args(), [beat], 0, 1, "voice");
    expect(withEmpty).toEqual(without);
  });
});
