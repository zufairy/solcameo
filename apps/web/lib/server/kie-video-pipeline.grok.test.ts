import { describe, it, expect } from "vitest";
import { __test, type GenerateVideoArgs, type StoryBeat } from "./kie-video-pipeline";

// Grok Imagine is a pure image-to-video model: the attached image IS the first
// frame. These lock in the Grok-only handling — no storyboard grid, the mint face
// as the sole identity anchor, and a prompt written to xAI's documented contract
// (motion → camera → AUDIO:) instead of the Veo talking-head template.

const beats: StoryBeat[] = [
  { index: 1, scene: "hand lifts the bottle into a shaft of window light", voiceover: "This changed my routine.", camera: "slow push-in", seconds: 5 },
  { index: 2, scene: "droplets bead down the glass in macro", voiceover: "Two drops, every night.", camera: "macro orbit", seconds: 5 },
];

function args(over: Partial<GenerateVideoArgs> = {}): GenerateVideoArgs {
  return {
    agentName: "Nova",
    agentNiche: "skincare",
    avatarUrl: "https://cdn/mint-face.png",
    topic: "hydration",
    hook: "Stop drying out your skin",
    scriptText: "This changed my routine. Two drops, every night.",
    videoModel: "grok-imagine/image-to-video",
    ...over,
  } as GenerateVideoArgs;
}

describe("skipsStoryboardImage", () => {
  it("keeps storyboard guidance enabled so Grok can use the portrait reference sheet", () => {
    expect(__test.skipsStoryboardImage("grok-imagine/image-to-video")).toBe(false);
    expect(__test.skipsStoryboardImage("grok-imagine/extend")).toBe(false);
  });

  it("is FALSE for every other engine — they still get the storyboard guide", () => {
    for (const m of ["veo3_fast", "veo3-fast", "kwaivgi/kling-v3", "bytedance/seedance-v2", "gemini-omni-video"]) {
      expect(__test.skipsStoryboardImage(m)).toBe(false);
    }
    expect(__test.skipsStoryboardImage(undefined)).toBe(false);
  });
});

describe("buildGrokPrompt — xAI image-to-video contract", () => {
  it("directs MOTION on the attached reference instead of re-describing it", () => {
    const p = __test.buildGrokPrompt(args(), beats, 10, "warm, confident");
    expect(p).toMatch(/^Animate the attached reference image/);
    expect(p).toMatch(/ACTION \(timed\):/);
    expect(p).toContain("hand lifts the bottle");
    // No Veo-template identity essay — Grok reads the face from the image itself.
    expect(p).not.toMatch(/the same original character shown in the attached reference/i);
    expect(p).not.toMatch(/REFERENCE IMAGES \(in order\)/);
  });

  it("gives ONE camera path and a KEEP STABLE identity line", () => {
    const p = __test.buildGrokPrompt(args(), beats, 10, "warm");
    expect(p).toMatch(/CAMERA: slow push-in — one single continuous path/);
    expect(p).toMatch(/KEEP STABLE: the face, hair, outfit and art style from the reference image/);
  });

  it("uses the AUDIO: delimiter with the spoken line in quotes (native lip-sync)", () => {
    const p = __test.buildGrokPrompt(args(), beats, 10, "warm");
    expect(p).toMatch(/AUDIO: the person in frame speaks these exact words, lip-synced: "This changed my routine\. Two drops, every night\."/);
  });

  it("silent standing order → ambience-only AUDIO and NO line anywhere in the prompt", () => {
    const p = __test.buildGrokPrompt(args({ speech: "silent" }), beats, 10, "warm");
    expect(p).toMatch(/AUDIO: ambient sound and music bed only/);
    expect(p).toMatch(/No speech, no dialogue, no narration/);
    expect(p).toMatch(/Nobody speaks or mouths words on camera/);
    expect(p).not.toContain("This changed my routine");
    expect(p).not.toMatch(/VOICE:/);          // no voice profile when nobody speaks
  });

  it("voiceover standing order → off-camera narration, still carrying the words", () => {
    const p = __test.buildGrokPrompt(args({ speech: "voiceover" }), beats, 10, "warm");
    expect(p).toMatch(/AUDIO: off-camera narration, spoken by an unseen voice/);
    expect(p).toContain("This changed my routine.");
    expect(p).not.toMatch(/lip-synced/);
  });

  it("carries the Director treatment and the persona kernel (renders stay per-agent)", () => {
    const p = __test.buildGrokPrompt(
      args({
        creativeBrief: { format: "commercial", angle: "product hero", visualTreatment: "sunlit marble bathroom, warm grade" },
        personaKernel: "IVORY CLINICAL LUXURY KERNEL",
      }),
      beats, 10, "warm",
    );
    expect(p).toMatch(/LOOK: sunlit marble bathroom, warm grade, commercial energy/);
    expect(p).toContain("IVORY CLINICAL LUXURY KERNEL");
  });

  it("keeps portrait storyboard guidance in the fallback storyboard prompt", () => {
    const prompt = __test.buildFallbackStoryboardPrompt(args(), beats, { portrait: true });
    expect(prompt).toContain("tall portrait");
    expect(prompt).toContain("portrait-first");
  });

  it("a MIDDLE window continues the take instead of restarting, and never repeats the last line", () => {
    const p = __test.buildGrokPrompt(args(), [beats[1]], 10, "warm", { index: 1, total: 3, prevBeat: beats[0] });
    expect(p).toMatch(/CONTINUES the previous clip/);
    expect(p).toMatch(/Already said, do not repeat: "This changed my routine\."/);
    expect(p).toMatch(/End with motion mid-flow/);      // more clips follow
    expect(p).not.toMatch(/End on a settled/);
  });

  it("the LAST window closes the take, the FIRST one opens it fresh", () => {
    const last = __test.buildGrokPrompt(args(), [beats[1]], 10, "warm", { index: 2, total: 3, prevBeat: beats[0] });
    expect(last).toMatch(/End on a settled, intentional final frame/);
    expect(last).toMatch(/CONTINUES the previous clip/);

    const first = __test.buildGrokPrompt(args(), [beats[0]], 10, "warm", { index: 0, total: 3 });
    expect(first).not.toMatch(/CONTINUES the previous clip/);
    expect(first).toMatch(/End with motion mid-flow/);
  });

  it("stays well inside Grok's prompt budget (short prompts are more motion-stable)", () => {
    const p = __test.buildGrokPrompt(
      args({
        creativeBrief: { format: "commercial", angle: "product hero", visualTreatment: "sunlit marble bathroom, warm cinematic grade, shallow depth of field" },
        personaKernel: "K".repeat(900),
        standingOrders: "OPERATOR STANDING ORDERS (these OVERRIDE the persona defaults…):\n- FORMAT IS FIXED: every video is a commercial.",
      }),
      beats, 30, "warm and measured",
    );
    // Grok's API rejects >5000 chars; the guides recommend far shorter for stability.
    expect(p.length).toBeLessThan(3200);
  });

  it("appends the operator's standing orders", () => {
    const p = __test.buildGrokPrompt(args({ standingOrders: "OPERATOR STANDING ORDERS\n- NEVER: hard sell." }), beats, 10, "warm");
    expect(p).toContain("OPERATOR STANDING ORDERS");
  });
});

describe("engine output normalization", () => {
  it("keeps Grok portrait and square inputs in the matching frame shape", () => {
    expect(__test.resolveOutputAspect("grok-imagine/image-to-video", "9:16")).toBe("9:16");
    expect(__test.resolveOutputAspect("grok-imagine/image-to-video", "1:1")).toBe("1:1");
  });

  it("keeps Grok resolution capped to 720p while Veo can honor 1080p", () => {
    expect(__test.resolveOutputResolution("grok-imagine/image-to-video", "1080p")).toBe("720p");
    expect(__test.resolveOutputResolution("bytedance/seedance-2-fast", "1080p")).toBe("720p");
    expect(__test.resolveOutputResolution("veo3_fast", "1080p")).toBe("1080p");
  });
});
