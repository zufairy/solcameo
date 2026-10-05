import { describe, it, expect } from "vitest";
import { fillFormatPrompt, composeBeatFormatPrompt } from "./formatPromptBuilder";

const bible = {
  premise: "a solo founder building an AI clipper in public",
  voice: { tone: "casual Manglish", language: "Malay" },
  visualWorld: { style: "warm handheld realism", settings: [], moods: [] },
  cast: [{ name: "Aiman", role: "founder", visualIdentity: "young Malay man, black tee" }],
  cadence: { perFormatDuration: { skit: { min: 20, max: 40 } } },
};

describe("fillFormatPrompt", () => {
  it("fills every placeholder and clamps duration to the format band", () => {
    const r = fillFormatPrompt({ formatId: "founder-talk", topic: "our first 100 users", bible, durationSec: 9999 });
    expect(r.prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(r.prompt).toContain("our first 100 users");
    expect(r.prompt).toContain("casual Manglish");
    expect(r.prompt).toContain("Aiman");
    expect(r.durationSec).toBe(60); // clamped to founder-talk max
    expect(r.voice).toBe("on-camera");
    expect(r.engines[0]).toBe("grok-imagine-15"); // Grok is now the wizard's default engine (formatCatalog.ts engines[0])
  });
  it("prefers the bible's perFormatDuration midpoint when no explicit duration is given", () => {
    const r = fillFormatPrompt({ formatId: "skit", topic: "x", bible });
    expect(r.durationSec).toBe(30); // midpoint of bible's 20-40, inside 15-45 band
  });
  it("throws on unknown or non-generate formats", () => {
    expect(() => fillFormatPrompt({ formatId: "nope", topic: "x", bible })).toThrow(/unknown format/);
    expect(() => fillFormatPrompt({ formatId: "clipper", topic: "x", bible })).toThrow(/not a generate/);
  });
  it("defaults cta and empty cast without leaving placeholders", () => {
    const r = fillFormatPrompt({ formatId: "case-study", topic: "y", bible: { ...bible, cast: [] } });
    expect(r.prompt).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});

// This is the composition kie-video-pipeline.ts's format-prompt injection uses
// to overwrite every StoryBeat's `videoPrompt`/`scene` — the fields
// buildSegmentPrompt/buildGrokPrompt/buildExtendPrompt actually read to build
// the request POSTed to Kie. Guards that the format template text (not just
// the beat's own scene) survives into the per-beat engine prompt, for every
// engine dialect.
describe("composeBeatFormatPrompt", () => {
  const formatPrompt = "A founder-talk video about our first 100 users, casual Manglish tone.";
  const beatScene = "Aiman leans into the camera, grinning, holding his phone up.";

  it("folds the format template AND the beat's own scene into a Veo-dialect prompt", () => {
    const composed = composeBeatFormatPrompt({ engineId: "veo3_fast", formatPrompt, beatScene });
    expect(composed).toContain(formatPrompt);
    expect(composed).toContain(beatScene);
    expect(composed).toContain("(no subtitles)");
  });

  it("folds the format template into a Seedance-dialect shot line", () => {
    const composed = composeBeatFormatPrompt({ engineId: "seedance-1-5-pro", formatPrompt, beatScene });
    expect(composed).toContain(formatPrompt);
    expect(composed).toContain("Shot 1:");
    expect(composed).toContain(beatScene);
  });

  it("folds the format template into a Grok-dialect flowing paragraph", () => {
    const composed = composeBeatFormatPrompt({ engineId: "grok-imagine", formatPrompt, beatScene });
    expect(composed).toContain(formatPrompt);
    expect(composed).toContain(beatScene);
  });

  it("differs per beat scene — the same format template composed with two different beats produces two different prompts", () => {
    const a = composeBeatFormatPrompt({ engineId: "veo3_fast", formatPrompt, beatScene: "Beat one action" });
    const b = composeBeatFormatPrompt({ engineId: "veo3_fast", formatPrompt, beatScene: "Beat two action" });
    expect(a).not.toBe(b);
    expect(a).toContain("Beat one action");
    expect(b).toContain("Beat two action");
  });
});
