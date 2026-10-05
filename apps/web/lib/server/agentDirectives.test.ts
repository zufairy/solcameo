import { describe, it, expect } from "vitest";
import {
  parseDirectives, encodeDirectiveSummary, decodeDirectiveSummary, resolveAgentDirectives,
  applyDirectivesToBrief, directiveBlock, forbidsLipSync, isEmptyDirective,
  DIRECTIVE_KIND,
} from "./agentDirectives";

describe("parseDirectives — the copilot instruction the builder kept ignoring", () => {
  it("reads broken-English onboarding phrasings as silent", () => {
    expect(parseDirectives("make sure the video not speaker not saying anything, and its a one shot").speech).toBe("silent");
    expect(parseDirectives("no speaker in the video").speech).toBe("silent");
    expect(parseDirectives("nobody talks, just the product").speech).toBe("silent");
    expect(parseDirectives("no voice, visuals only").speech).toBe("silent");
    expect(parseDirectives("no script no narration just b-roll").speech).toBe("silent");
    expect(parseDirectives("tiada suara dalam video").speech).toBe("silent");
  });

  it("reads 'only commercial videos, no need to speak' as commercial + silent", () => {
    const d = parseDirectives("from now on only make commercial videos for my product, no need to speak");
    expect(d.format).toBe("commercial");
    expect(d.speech).toBe("silent");
  });

  it("a commercial with no speech instruction implies OFF-CAMERA voice, not a talking head", () => {
    const d = parseDirectives("make it a tv commercial for the brand");
    expect(d.format).toBe("commercial");
    expect(d.speech).toBe("voiceover");
  });

  it("'no talking head' means voiceover, not silence", () => {
    const d = parseDirectives("no talking-head shots please");
    expect(d.speech).toBe("voiceover");
  });

  it("reverses back to on-camera when the operator asks for it", () => {
    expect(parseDirectives("go back to talking to camera").speech).toBe("on_camera");
  });

  it("understands Malay phrasing for 'no speaking'", () => {
    expect(parseDirectives("tak perlu bercakap dalam video").speech).toBe("silent");
  });

  it("captures language, always/never rules and style", () => {
    const d = parseDirectives("always show the product box. avoid loud music. speak in Malay. style should be clean minimal studio");
    expect(d.language).toBe("Malay");
    expect(d.mustInclude?.[0]).toMatch(/product box/i);
    expect(d.avoid?.[0]).toMatch(/loud music/i);
    expect(d.visualStyle).toMatch(/clean minimal studio/i);
  });

  it("returns nothing for ordinary chatter (no write, no prompt bloat)", () => {
    expect(isEmptyDirective(parseDirectives("hey, how's it going?"))).toBe(true);
    expect(isEmptyDirective(parseDirectives("make me a video about coffee"))).toBe(true);
  });

  it("does not double-store 'never talk' as a free-text avoid line", () => {
    const d = parseDirectives("never talk in the videos");
    expect(d.speech).toBe("silent");
    expect(d.avoid ?? []).toHaveLength(0);
  });
});

describe("canonical memory line round-trips", () => {
  it("encode → decode preserves every field", () => {
    const d = parseDirectives("only commercial videos, no need to speak, always show the logo, speak in Malay");
    const decoded = decodeDirectiveSummary(encodeDirectiveSummary(d));
    expect(decoded.speech).toBe("silent");
    expect(decoded.format).toBe("commercial");
    expect(decoded.language).toBe("Malay");
    expect(decoded.mustInclude?.[0]).toMatch(/logo/i);
  });

  it("a non-directive memory summary decodes to nothing", () => {
    expect(isEmptyDirective(decodeDirectiveSummary("Posted a clip that got 12k views"))).toBe(true);
  });
});

describe("resolveAgentDirectives — latest instruction wins, field by field", () => {
  const mem = (summary: string, at: number) => ({ kind: DIRECTIVE_KIND, summary, importance: 98, at });

  it("newest speech instruction overrides the older one, keeping the format", () => {
    const d = resolveAgentDirectives([
      // Deliberately NOT in chronological order — recallMemories returns rows ranked
      // by importance, so the merge must sort by `at` itself.
      mem("[DIRECTIVE] speech=on_camera", 2_000),
      mem("[DIRECTIVE] speech=silent; format=commercial", 1_000),
    ]);
    expect(d.speech).toBe("on_camera");
    expect(d.format).toBe("commercial");
  });

  it("accumulates always/never rules across turns", () => {
    const d = resolveAgentDirectives([
      mem("[DIRECTIVE] must=show the box", 1_000),
      mem("[DIRECTIVE] must=end with the website; avoid=loud music", 2_000),
    ]);
    expect(d.mustInclude).toEqual(["show the box", "end with the website"]);
    expect(d.avoid).toEqual(["loud music"]);
  });

  it("ignores ordinary memories and an empty list", () => {
    expect(isEmptyDirective(resolveAgentDirectives([
      { kind: "lesson", summary: "format=talking_head performed well", importance: 60, at: 5 },
    ]))).toBe(true);
    expect(isEmptyDirective(resolveAgentDirectives([]))).toBe(true);
    expect(isEmptyDirective(resolveAgentDirectives(undefined))).toBe(true);
  });

  it("picks up a directive row even if its kind was written differently", () => {
    const d = resolveAgentDirectives([{ kind: "preference", summary: "[DIRECTIVE] speech=silent", at: 1 }]);
    expect(d.speech).toBe("silent");
  });
});

describe("application to the brief + prompts", () => {
  const brief = { format: "talking_head", angle: "hot take", structureNotes: "hook then payoff", visualTreatment: "studio, natural grade" };

  it("a forced format REPLACES the rotating style preset (the actual bug)", () => {
    const d = parseDirectives("only commercial videos, no need to speak");
    const out = applyDirectivesToBrief(brief, d);
    expect(out.format).toBe("commercial");           // was "talking_head"
    expect(out.structureNotes).toMatch(/No spoken words/i);
  });

  it("leaves the brief untouched when there are no directives", () => {
    expect(applyDirectivesToBrief(brief, {})).toBe(brief);
  });

  it("directiveBlock states the no-speech rule in terms a video model obeys", () => {
    const block = directiveBlock(parseDirectives("from now on no talking, commercial only"));
    expect(block).toMatch(/NO SPEECH/);
    expect(block).toMatch(/no lip-sync/i);
    expect(block).toMatch(/OVERRIDE the persona defaults/i);
    expect(block).toMatch(/FORMAT IS FIXED: every video is a commercial/i);
  });

  it("forbidsLipSync covers silent AND voiceover, not on-camera", () => {
    expect(forbidsLipSync({ speech: "silent" })).toBe(true);
    expect(forbidsLipSync({ speech: "voiceover" })).toBe(true);
    expect(forbidsLipSync({ speech: "on_camera" })).toBe(false);
    expect(forbidsLipSync({})).toBe(false);
  });

  it("empty directives produce an empty prompt block (no dead text in prompts)", () => {
    expect(directiveBlock({})).toBe("");
  });
});
