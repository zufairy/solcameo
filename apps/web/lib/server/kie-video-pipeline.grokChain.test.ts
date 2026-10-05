import { describe, it, expect } from "vitest";
import { buildGrokChainPlan, type GenerateVideoArgs, type StoryBeat } from "./kie-video-pipeline";

// The Recreate app's chunked Grok chain: beats mirror the SOURCE video's scenes
// (seconds = original scene durations, onScreenText = the original's captions),
// and the plan must reproduce that pacing, total length, and on-screen text.

function args(over: Partial<GenerateVideoArgs> = {}): GenerateVideoArgs {
  return {
    agentName: "Recreate",
    agentNiche: "general",
    avatarUrl: "https://cdn/presenter.png",
    productImageUrl: "https://cdn/product.jpg",
    topic: "Recreated video",
    hook: "hook",
    scriptText: "line one line two line three",
    videoModel: "grok-imagine/image-to-video",
    aspectRatio: "9:16",
    allowOnScreenText: true,
    ...over,
  } as GenerateVideoArgs;
}

const beats: StoryBeat[] = [
  { index: 0, scene: "presenter opens box on desk", voiceover: "Look at this.", camera: "push-in", seconds: 6, onScreenText: "50% OFF TODAY" },
  { index: 1, scene: "close-up of the product label", voiceover: "It really works.", camera: "macro", seconds: 8 },
  { index: 2, scene: "presenter smiles holding product", voiceover: "Grab yours now.", camera: "static", seconds: 10, onScreenText: "LINK IN BIO" },
];

describe("buildGrokChainPlan", () => {
  it("packs beats into a ≤15s base + ≤15s extend windows summing to the source length", () => {
    const plan = buildGrokChainPlan(args(), beats);
    // 6+8=14s base, 10s extend → 2 segments, 24s total.
    expect(plan.totalSegments).toBe(2);
    expect(plan.baseSeconds).toBe(14);
    expect(plan.extendSeconds).toEqual([10]);
    expect(plan.baseSeconds + plan.extendSeconds.reduce((a, b) => a + b, 0)).toBe(24);
  });

  it("a ≤15s recreation is ONE single take (no extends)", () => {
    const plan = buildGrokChainPlan(args(), beats.slice(0, 2));
    expect(plan.totalSegments).toBe(1);
    expect(plan.extendPrompts).toEqual([]);
    expect(plan.baseSeconds).toBe(14);
  });

  it("uses the grok slug, portrait aspect, and the presenter+product references", () => {
    const plan = buildGrokChainPlan(args(), beats);
    expect(plan.model).toBe("grok-imagine/image-to-video");
    expect(plan.aspectRatio).toBe("9:16");
    expect(plan.refImages).toEqual(["https://cdn/presenter.png", "https://cdn/product.jpg"]);
  });

  it("carries each beat's ON-SCREEN TEXT verbatim into its window's prompt", () => {
    const plan = buildGrokChainPlan(args(), beats);
    expect(plan.basePrompt).toContain('ON-SCREEN TEXT overlay reads exactly: "50% OFF TODAY"');
    expect(plan.extendPrompts[0]).toContain('ON-SCREEN TEXT overlay reads exactly: "LINK IN BIO"');
  });

  it("allowOnScreenText swaps the no-captions rules for render-exactly rules", () => {
    const plan = buildGrokChainPlan(args(), beats);
    expect(plan.basePrompt).toContain("Render every ON-SCREEN TEXT overlay exactly as quoted");
    expect(plan.basePrompt).not.toContain("clean frame with no captions or logos");
    expect(plan.extendPrompts[0]).not.toContain("ABSOLUTELY NO on-screen text");
    expect(plan.extendPrompts[0]).toContain("quoted ON-SCREEN TEXT overlay exactly as written");
  });

  it("threads the uploaded product's vision description into base AND extend prompts", () => {
    const desc = "matte black cylindrical serum bottle, gold dropper cap, label reads \"GLOW+\"";
    const plan = buildGrokChainPlan(args({ productDescription: desc }), beats);
    // Base clip: named in the reference map + a hard show-THIS-product block.
    expect(plan.basePrompt).toContain(`the product to feature: ${desc}`);
    expect(plan.basePrompt).toContain("PRODUCT (show THIS exact product, never a different or generic one)");
    // Extends get NO images — the words are the only product anchor there.
    expect(plan.extendPrompts[0]).toContain(`SAME PRODUCT throughout`);
    expect(plan.extendPrompts[0]).toContain(desc);
  });

  it("no product description → no product blocks (old generic behavior)", () => {
    const plan = buildGrokChainPlan(args({ productDescription: undefined }), beats);
    expect(plan.basePrompt).not.toContain("PRODUCT (show THIS exact product");
    expect(plan.extendPrompts[0]).not.toContain("SAME PRODUCT throughout");
  });

  it("default (no allowOnScreenText) keeps the clean-frame rules and drops overlays", () => {
    const plan = buildGrokChainPlan(args({ allowOnScreenText: undefined }), beats);
    expect(plan.basePrompt).toContain("clean frame with no captions or logos");
    expect(plan.basePrompt).not.toContain("50% OFF TODAY");
    expect(plan.extendPrompts[0]).toContain("ABSOLUTELY NO on-screen text");
  });
});
