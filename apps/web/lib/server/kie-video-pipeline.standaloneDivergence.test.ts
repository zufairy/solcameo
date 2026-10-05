import { describe, it, expect } from "vitest";
import { __test, type GenerateVideoArgs, type StoryBeat } from "./kie-video-pipeline";

// Regression: "the same video 3 times". When native /veo/extend is blocked (the
// prominent-people filter), each window falls back to a fresh STANDALONE Veo
// generate. Those clips collapsed into near-identical takes because they were
// driven by the LEAN extend-continuation prompt (no distinct scene) instead of a
// scene-establishing generate prompt. buildVeoChainPlan must therefore expose a
// per-window `standalonePrompts` array whose entries are DISTINCT (each carries its
// own window's scene / spoken line) so the stitch fallback renders varied clips.

function argsFor(): GenerateVideoArgs {
  return {
    agentName: "Nova",
    agentNiche: "skincare",
    avatarUrl: "https://x/a.png",
    topic: "hydration",
    hook: "Stop drying out your skin",
    scriptText: "Hydration first. Then the serum. That is the routine.",
    videoModel: "veo3_fast",
    personaKernel: "IVORY CLINICAL KERNEL",
  } as GenerateVideoArgs;
}

describe("buildVeoChainPlan standalone fallback prompts", () => {
  const beats: StoryBeat[] = [
    { index: 1, scene: "close up on a dewy face at a marble sink", voiceover: "Hydration first thing every single morning matters.", camera: "static", seconds: 7 },
    { index: 2, scene: "wide shot in a sunlit bathroom applying serum", voiceover: "Then lock it in with the lightweight serum before you leave.", camera: "push in", seconds: 7 },
    { index: 3, scene: "product hero shot on a stone shelf", voiceover: "That is the whole routine, simple, fast, and effective.", camera: "pan", seconds: 7 },
  ];

  it("exposes one standalone (scene-establishing) prompt per window", () => {
    const plan = __test.buildVeoChainPlan({ ...argsFor(), storyboardImageUrl: "https://x/sb.png" }, beats);
    expect(plan.standalonePrompts).toBeDefined();
    expect(plan.standalonePrompts!.length).toBe(plan.segmentPrompts.length);
  });

  it("makes every standalone window prompt DISTINCT (no duplicate takes)", () => {
    const plan = __test.buildVeoChainPlan({ ...argsFor(), storyboardImageUrl: "https://x/sb.png" }, beats);
    const prompts = plan.standalonePrompts!;
    const unique = new Set(prompts);
    expect(unique.size).toBe(prompts.length);
  });

  it("carries each window's own scene into its standalone prompt", () => {
    const plan = __test.buildVeoChainPlan({ ...argsFor(), storyboardImageUrl: "https://x/sb.png" }, beats);
    const prompts = plan.standalonePrompts!;
    // Each standalone prompt is a scene-establishing GENERATE prompt, so it must
    // contain that window's spoken line (distinct per window) — not a scene-less
    // "continue the existing take" continuation.
    expect(prompts[0]).toContain("Hydration first thing every single morning");
    expect(prompts[prompts.length - 1]).toContain("That is the whole routine");
  });
});
