import { describe, it, expect } from "vitest";
import { buildPitchPrompt, coercePitches } from "./showDesigner";

describe("buildPitchPrompt", () => {
  it("carries the concept, archetype ids, and the JSON contract", () => {
    const { system, user } = buildPitchPrompt({
      concept: "anime girl reviews crypto scams, sassy",
      agent: { name: "Yuki", niche: "crypto" },
      hasRefImages: true,
    });
    expect(system.toLowerCase()).toContain("show");
    expect(user).toContain("anime girl reviews crypto scams");
    expect(user).toContain("anime-series");
    expect(user).toContain("talking-head");
    expect(user).toContain('"styleFramePrompt"');
    expect(user).toContain('"sampleIdeas"');
    expect(user).toContain("reference images");
  });
});

describe("coercePitches", () => {
  it("keeps valid pitches, fills defaults, caps at 3", () => {
    const out = coercePitches([
      { name: "Scam Court", premise: "p1", archetype: "anime-series", formatKinds: ["anime-episode"], sampleIdeas: [{ headline: "h", angle: "a" }], styleFramePrompt: "sp" },
      { name: "", premise: "no name" },
      { name: "X", premise: "p2", archetype: "hologram", sampleIdeas: [] },
      { name: "Y", premise: "p3", archetype: "skit", sampleIdeas: [{ headline: "h", angle: "a" }], styleFramePrompt: "s" },
      { name: "Z", premise: "p4", archetype: "skit", sampleIdeas: [{ headline: "h", angle: "a" }], styleFramePrompt: "s" },
    ]);
    expect(out.length).toBe(3);
    expect(out[0].archetype).toBe("anime-series");
    expect(out[1].archetype).toBe("custom");            // unknown coerced
    expect(out[1].formatKinds.length).toBeGreaterThan(0); // archetype defaults fill in
    expect(out[1].styleFramePrompt.length).toBeGreaterThan(0);
  });
});

describe("archetypeHint", () => {
  it("locks all pitches to the chosen type and injects its craft hint", () => {
    const { user } = buildPitchPrompt({
      concept: "lawyer show",
      agent: { name: "Lex", niche: "law" },
      hasRefImages: false,
      archetypeHint: "cartoon-series",
    });
    expect(user).toContain('MUST be "cartoon-series"');
    expect(user).toContain("Recurring visual gags");
  });
});
