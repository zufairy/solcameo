import { describe, it, expect } from "vitest";
import { fillFormatPrompt } from "./formatPromptBuilder";
import { adaptPromptForEngine } from "./enginePromptAdapters";

// The exact composition ideaPipeline performs: fill from bible, then adapt to
// the format's default engine. Guards the two modules against drift.
describe("format prompt end-to-end composition", () => {
  const bible = {
    premise: "an anime studio persona",
    voice: { tone: "dramatic", language: "English" },
    visualWorld: { style: "dark seinen", settings: [], moods: [] },
    cast: [{ name: "Kira", role: "lead", visualIdentity: "silver-haired swordswoman" }],
    cadence: { perFormatDuration: {} },
  };
  it("anime topic → seedance dialect with shots and no unresolved braces", () => {
    const filled = fillFormatPrompt({ formatId: "anime", topic: "the rooftop duel finale", bible });
    const adapted = adaptPromptForEngine({
      engineId: filled.engines[0],
      prompt: filled.prompt,
      beats: ["Kira arrives on the rooftop", "blades clash in the rain", "final strike at sunset"],
    });
    expect(filled.engines[0]).toBe("seedance-1-5-pro");
    expect(adapted).toContain("Shot 1:");
    expect(adapted).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(adapted).toContain("Kira");
  });
});
