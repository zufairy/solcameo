import { describe, it, expect } from "vitest";
import { __test, type GenerateVideoArgs, type StoryBeat } from "./kie-video-pipeline";

const beat: StoryBeat = { index: 1, scene: "close up", voiceover: "Hydration first.", camera: "static", seconds: 4 };

function argsFor(name: string, kernel: string): GenerateVideoArgs {
  return {
    agentName: name,
    agentNiche: "skincare",
    avatarUrl: "https://x/a.png",
    topic: "hydration",
    hook: "Stop drying out your skin",
    scriptText: "Hydration first.",
    personaKernel: kernel,
  } as GenerateVideoArgs;
}

describe("buildSegmentPrompt persona injection", () => {
  it("embeds the persona kernel in the clip prompt", () => {
    const p = __test.buildSegmentPrompt(argsFor("Nova", "IVORY-TAILORED CLINICAL LUXURY KERNEL"), [beat], 0, 1, "voice");
    expect(p).toContain("IVORY-TAILORED CLINICAL LUXURY KERNEL");
  });

  it("two personas with the same script produce DIVERGENT prompts", () => {
    const a = __test.buildSegmentPrompt(argsFor("Nova", "KERNEL-A ivory clinic gold"), [beat], 0, 1, "voice");
    const b = __test.buildSegmentPrompt(argsFor("Blitz", "KERNEL-B neon cyberpunk RGB"), [beat], 0, 1, "voice");
    expect(a).not.toEqual(b);
    expect(a).toContain("KERNEL-A");
    expect(b).toContain("KERNEL-B");
  });
});

describe("buildSegmentPrompt authored shot", () => {
  it("uses beat.videoPrompt as the shot direction when present", () => {
    const authored: StoryBeat = { ...beat, videoPrompt: "Macro dolly across dewy skin under soft window light." };
    const p = __test.buildSegmentPrompt(argsFor("Nova", "K"), [authored], 0, 1, "voice");
    expect(p).toContain("Macro dolly across dewy skin");
  });

  it("falls back to template scene text when videoPrompt is absent", () => {
    const p = __test.buildSegmentPrompt(argsFor("Nova", "K"), [{ ...beat, videoPrompt: undefined, scene: "sunlit kitchen" }], 0, 1, "voice");
    expect(p).toContain("sunlit kitchen");
  });
});

describe("extend prompt continuity", () => {
  it("carries the persona kernel + a prior-window continuity cue into the (Grok/Veo) extend prompt", () => {
    const a = argsFor("Nova", "IVORY CLINICAL KERNEL");
    const prevLastBeat: StoryBeat = { ...beat, voiceover: "previous window recap" };
    const p = __test.buildExtendPrompt(a, [beat], 8, "voice", prevLastBeat, false);
    expect(p).toContain("IVORY CLINICAL KERNEL");
    expect(p.toLowerCase()).toContain("continu");
  });
});

describe("buildVeoChainPlan persona supply path (regression: default Veo engine)", () => {
  it("threads the persona kernel into every Veo segment prompt when the caller supplies it", () => {
    const beats: StoryBeat[] = [
      { index: 1, scene: "close up", voiceover: "Hydration first thing every morning matters a lot.", camera: "static", seconds: 6 },
      { index: 2, scene: "wide shot", voiceover: "Then lock it in with the serum before you leave.", camera: "push in", seconds: 6 },
      { index: 3, scene: "product shot", voiceover: "That is the whole routine, simple and fast.", camera: "pan", seconds: 6 },
    ];
    const args = {
      ...argsFor("Nova", "IVORY-TAILORED CLINICAL LUXURY KERNEL"),
      videoModel: "veo3_fast",
      storyboardImageUrl: "https://x/storyboard.png",
    };
    const plan = __test.buildVeoChainPlan(args, beats);
    expect(plan.isVeo).toBe(true);
    expect(plan.segmentPrompts.length).toBeGreaterThan(0);
    for (const prompt of plan.segmentPrompts) {
      expect(prompt).toContain("IVORY-TAILORED CLINICAL LUXURY KERNEL");
    }
  });
});
