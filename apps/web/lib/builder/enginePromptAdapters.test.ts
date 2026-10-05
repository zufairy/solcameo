// lib/builder/enginePromptAdapters.test.ts
import { describe, it, expect } from "vitest";
import { adaptPromptForEngine } from "./enginePromptAdapters";

describe("adaptPromptForEngine", () => {
  it("veo: appends (no subtitles) once and formats dialogue as Character says:", () => {
    const out = adaptPromptForEngine({
      engineId: "veo3_fast",
      prompt: "A presenter talks about launch day.",
      dialogue: [{ speaker: "Aiman", line: "we hit 100 users" }],
    });
    expect(out).toContain("Aiman says: we hit 100 users");
    expect(out.match(/\(no subtitles\)/g)?.length).toBe(1);
    expect(out).not.toContain('"we hit 100 users"');
  });
  it("seedance: labels beats Shot N with Cut to: transitions and stays under 200 words", () => {
    const out = adaptPromptForEngine({
      engineId: "seedance-1-5-pro",
      prompt: "An anime scene about a rooftop duel.",
      beats: ["hero arrives on the rooftop", "swords clash in the rain", "hero wins, sheathes sword"],
    });
    expect(out).toContain("Shot 1:");
    expect(out).toContain("Shot 3:");
    expect(out).toContain("Cut to:");
    expect(out.split(/\s+/).length).toBeLessThan(200);
  });
  it("grok: returns one flowing paragraph without shot labels", () => {
    const out = adaptPromptForEngine({
      engineId: "grok-imagine",
      prompt: "A comedic skit about meetings.",
      beats: ["boss schedules a meeting about meetings", "everyone groans"],
    });
    expect(out).not.toContain("Shot 1:");
    expect(out).toContain("meetings");
  });
  it("unknown engine: passes prompt through unchanged", () => {
    expect(adaptPromptForEngine({ engineId: "whatever", prompt: "abc" })).toBe("abc");
  });
});
