import { describe, it, expect } from "vitest";
import { buildBibleCompilerPrompt } from "./bibleCompiler";

describe("buildBibleCompilerPrompt", () => {
  it("includes the concept, persona, and the full JSON contract", () => {
    const { system, user } = buildBibleCompilerPrompt({
      concept: "cartoon lawyer reacts to today's legal news",
      agent: { name: "Lex", niche: "law", archetype: "commentator", language: "English" },
    });
    expect(system).toContain("show bible");
    expect(user).toContain("cartoon lawyer reacts to today's legal news");
    expect(user).toContain('"premise"');
    expect(user).toContain('"newsQueries"');
    expect(user).toContain('"perFormatDuration"');
    expect(user).toContain("Lex");
  });
  it("carries the existing bible for recompiles", () => {
    const { user } = buildBibleCompilerPrompt({
      concept: "more courtroom skits",
      existing: {
        version: 3, premise: "old premise", format: { kinds: ["news-react"] }, cast: [],
        visualWorld: { style: "", settings: [], moods: [] }, voice: { tone: "" },
        contentEngine: { newsQueries: [], evergreenPools: [], seriesArcs: false },
        contentMix: { entertain: 60, value: 30, promo: 10 },
        variationAxes: { hookStyles: [], structures: [] }, cadence: { perFormatDuration: {} },
      },
      agent: { name: "Lex", niche: "law" },
    });
    expect(user).toContain("old premise");
    expect(user).toContain("EXISTING BIBLE");
  });
});

describe("archetype in the compiler contract", () => {
  it("prompt lists archetype ids and requires the field", () => {
    const { user } = buildBibleCompilerPrompt({
      concept: "anime girl reviews crypto scams",
      agent: { name: "Yuki", niche: "crypto" },
    });
    expect(user).toContain('"archetype"');
    expect(user).toContain("cartoon-series");
    expect(user).toContain("talking-head");
    expect(user).toContain("faceless");
  });
});
