import { describe, it, expect } from "vitest";
import { composePostCaptionInstruction, readPostCaptionSettings } from "@/lib/builder/postCaptionInstruction";

describe("composePostCaptionInstruction", () => {
  it("joins prompt, mood and language in the order the generate route always used", () => {
    expect(composePostCaptionInstruction({ prompt: "tag @vello", mood: "Hype", language: "Malay" }))
      .toBe("tag @vello Mood/tone: Hype. Write it in Malay.");
  });
  it("omits blank parts", () => {
    expect(composePostCaptionInstruction({ prompt: "  ", mood: "", language: "English" })).toBe("Write it in English.");
  });
});

describe("readPostCaptionSettings", () => {
  it("reads only string fields, tolerates junk", () => {
    expect(readPostCaptionSettings({ postCaptionPrompt: "x", postCaptionMood: 3, postCaptionLanguage: "Malay" }))
      .toEqual({ prompt: "x", mood: undefined, language: "Malay" });
    expect(readPostCaptionSettings(null)).toEqual({ prompt: undefined, mood: undefined, language: undefined });
  });
});
