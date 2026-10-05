/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { __test } from "./kie-video-pipeline";

describe("storyboard helper", () => {
  it("upgrades long storyboards to 2K", () => {
    expect(__test.selectStoryboardResolution(4)).toBe("1K");
    expect(__test.selectStoryboardResolution(5)).toBe("2K");
  });

  it("writes a continuity-first fallback storyboard prompt", () => {
    const prompt = __test.buildFallbackStoryboardPrompt(
      { topic: "launch", agentName: "Vello", agentNiche: "AI agents", avatarUrl: "https://example.com/a.png", hook: "hook", scriptText: "one two three" } as never,
      [
        { index: 1, scene: "opens in a studio", voiceover: "Hello there", camera: "push in", seconds: 3 },
        { index: 2, scene: "moves into product demo", voiceover: "Then we show the product", camera: "pan right", seconds: 3 },
      ],
    );

    expect(prompt).toContain("high-resolution multi-panel STORYBOARD keyframe sheet");
    expect(prompt).toContain("CONTINUITY LOCK");
    expect(prompt).toContain("large readable panels");
  });

  it("threads engine-specific reference maps into clip prompts", () => {
    const baseArgs = {
      agentName: "Vello",
      agentNiche: "AI agents",
      avatarUrl: "https://example.com/avatar.png",
      hook: "hook",
      scriptText: "one two three four five six seven eight",
    } as never;
    const beats = [{ index: 1, scene: "opens", voiceover: "hello there", camera: "push in", seconds: 3 }];

    const seedancePrompt = __test.buildSegmentPrompt(baseArgs, beats, 0, 1, "VOICE", undefined, 8, {
      engine: "seedance",
      extraBlocks: ["@Image1 = Character: canonical anchor", "@Image2 = Scene: storyboard guide"],
    });
    expect(seedancePrompt).toContain("ENGINE TARGET: seedance");
    expect(seedancePrompt).toContain("BUILDER INTENT");
    expect(seedancePrompt).toContain("Reference @Image1 for the character anchor");

    const grokPrompt = __test.buildGrokPrompt(baseArgs, beats, 8, "VOICE", undefined, {
      extraBlocks: ["@Image1 = Character: canonical anchor only"],
    });
    expect(grokPrompt).toContain("@Image1 = Character");
  });

  it("keeps the continuation prompt builder-aware", () => {
    const prompt = __test.buildExtendPrompt(
      {
        agentName: "Vello",
        agentNiche: "AI agents",
        avatarUrl: "https://example.com/avatar.png",
        hook: "hook",
        scriptText: "one two three four five six seven eight",
      } as never,
      [{ index: 1, scene: "keeps moving", voiceover: "hello there", camera: "push in", seconds: 3 }],
      8,
      "VOICE",
      { voiceover: "prior line", scene: "prior scene", camera: "prior camera", seconds: 3 } as never,
      false,
    );

    expect(prompt).toContain("BUILDER INTENT");
    expect(prompt).toContain("CONTINUE THE EXISTING TAKE");
  });
});
