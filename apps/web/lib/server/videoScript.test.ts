/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { buildVideoScriptPrompt, computeScriptLengthPlan, operatorRequestLine, enforceScriptBudget } from "./videoScript";

describe("enforceScriptBudget", () => {
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

  it("leaves a script that already fits unchanged (just whitespace-collapsed)", () => {
    const s = "One two three. Four five six.";
    expect(enforceScriptBudget(s, 20)).toBe(s);
  });

  it("trims an overshooting script down to the budget", () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i + 1}`).join(" ") + ".";
    const out = enforceScriptBudget(long, 12);
    expect(words(out)).toBeLessThanOrEqual(12);
    expect(out.length).toBeGreaterThan(0);
  });

  it("prefers ending on a complete sentence", () => {
    const s = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here.";
    const out = enforceScriptBudget(s, 9);
    expect(out.endsWith(".")).toBe(true);
    expect(words(out)).toBeLessThanOrEqual(9);
  });

  it("hard-cuts and marks an over-long single sentence", () => {
    const oneSentence = Array.from({ length: 40 }, (_, i) => `x${i}`).join(" ");
    const out = enforceScriptBudget(oneSentence, 10);
    expect(words(out)).toBeLessThanOrEqual(11);
    expect(out).toMatch(/…$/);
  });
});

describe("computeScriptLengthPlan", () => {
  it("8s -> 1 window", () => {
    const p = computeScriptLengthPlan(8);
    expect(p.targetSeconds).toBe(8);
    expect(p.windowCount).toBe(1);
  });
  it("24s -> 3 windows, ~60 words", () => {
    const p = computeScriptLengthPlan(24);
    expect(p.windowCount).toBe(3);
    expect(p.targetWords).toBe(60);
  });
  it("60s -> 8 windows and larger token budget", () => {
    const p = computeScriptLengthPlan(60);
    expect(p.windowCount).toBe(8);
    expect(p.maxTokens).toBeGreaterThanOrEqual(1200);
    expect(p.maxTokens).toBeGreaterThan(computeScriptLengthPlan(8).maxTokens);
  });
  it("clamps to [5,60] and floors sub-5 to a usable value", () => {
    expect(computeScriptLengthPlan(2).targetSeconds).toBe(5);
    expect(computeScriptLengthPlan(120).targetSeconds).toBe(60);
  });
  it("low/high bound the target words", () => {
    const p = computeScriptLengthPlan(24);
    expect(p.lowWords).toBeLessThan(p.targetWords);
    expect(p.highWords).toBeGreaterThan(p.targetWords);
  });
});

describe("operatorRequestLine", () => {
  it("returns an OPERATOR REQUEST line when refinement present", () => {
    expect(operatorRequestLine("funnier")).toContain("OPERATOR REQUEST");
    expect(operatorRequestLine("funnier")).toContain("funnier");
  });
  it("returns empty string when no refinement", () => {
    expect(operatorRequestLine("")).toBe("");
    expect(operatorRequestLine("   ")).toBe("");
  });
});

describe("buildVideoScriptPrompt", () => {
  const agent = { name: "Vello", niche: "AI agents", archetype: "creator" };
  const ctx = {
    knowledge: [],
    memories: [],
    draft: { questionnaire: { contentPillars: ["launch content"] }, characterBible: "Friendly and experimental." },
  };

  it("defaults to a human, imperfect visual style", () => {
    const prompt = buildVideoScriptPrompt(agent, ctx, { topic: "launch content", targetSeconds: 12 });
    expect(prompt).toContain("VISUAL RULES");
    expect(prompt).toContain("slight camera shake");
    expect(prompt).toContain("human, imperfect, and slightly unpolished");
  });

  it("keeps polished personas explicitly polished", () => {
    const prompt = buildVideoScriptPrompt(agent, ctx, {
      topic: "launch content",
      targetSeconds: 12,
      brief: { format: "premium brand film", angle: "hero launch", visualTreatment: "luxury editorial polish" },
    });
    expect(prompt).toContain("premium");
    expect(prompt).toContain("polish");
  });
});

describe("anti-repetition + news grounding blocks", () => {
  const agent = { name: "Lex", niche: "law" };
  const ctx = { knowledge: [], memories: [], draft: null };
  it("injects avoidScripts as do-not-reuse content", () => {
    const p = buildVideoScriptPrompt(agent, ctx, {
      topic: "AI copyright ruling",
      avoidScripts: ["Yo what's up, today we talk about tort reform...", "Objection! Here's the wildest law..."],
    });
    expect(p).toContain("DO NOT REUSE");
    expect(p).toContain("tort reform");
    expect(p).toContain("wildest law");
  });
  it("injects newsRefs as grounded facts", () => {
    const p = buildVideoScriptPrompt(agent, ctx, {
      topic: "AI copyright ruling",
      newsRefs: ["Court ruled 6-3 on Aug 19 that fair use covers training"],
    });
    expect(p).toContain("LIVE FACTS");
    expect(p).toContain("6-3");
  });
  it("omits the blocks when absent", () => {
    const p = buildVideoScriptPrompt(agent, ctx, { topic: "x" });
    expect(p).not.toContain("DO NOT REUSE");
    expect(p).not.toContain("LIVE FACTS");
  });
});

describe("show-bible persona + silent mode in the script prompt", () => {
  const agent = { name: "Lisa", niche: "food", language: "English" };
  const ctx = {
    knowledge: [], memories: [],
    draft: { questionnaire: { traits: ["old trait: crypto bro"], beliefs: ["old belief"] }, characterBible: "OLD PERSONA: a crypto day-trader" },
  };
  const bible = {
    premise: "A street-food hunter reviewing night markets.",
    voiceTone: "warm, curious",
    language: "Malay",
    catchphrases: ["Sedap gila!"],
    visualStyle: "handheld realistic",
    cast: [{ name: "Lisa", role: "host", visualIdentity: "young woman, denim jacket" }],
  };

  it("bible persona REPLACES the old draft persona (no old characterBible text)", () => {
    const p = buildVideoScriptPrompt(agent, ctx, { topic: "nasi lemak stall", bible });
    expect(p).toContain("street-food hunter");
    expect(p).toContain("warm, curious");
    expect(p).toContain("denim jacket");
    expect(p).toContain("Sedap gila!");
    expect(p).not.toContain("crypto day-trader");   // old characterBible dropped
    expect(p).not.toContain("crypto bro");           // old questionnaire traits dropped
  });

  it("bible language wins for the spoken lines", () => {
    const p = buildVideoScriptPrompt(agent, ctx, { topic: "t", bible });
    expect(p).toContain("Malay");
  });

  it("no bible → draft persona still used (legacy path unchanged)", () => {
    const p = buildVideoScriptPrompt(agent, ctx, { topic: "t" });
    expect(p).toContain("crypto day-trader");
  });

  it("speech: silent → no voiceover; script becomes on-screen text + visual beats", () => {
    const p = buildVideoScriptPrompt(agent, ctx, { topic: "t", speech: "silent" });
    expect(p).toMatch(/SILENT/i);
    expect(p).toMatch(/never speaks|no spoken|no voiceover/i);
    expect(p).toMatch(/on-screen text/i);
    expect(p).not.toContain("Script = the spoken voiceover only");
  });

  it("default (no speech directive) keeps the spoken-voiceover rule", () => {
    const p = buildVideoScriptPrompt(agent, ctx, { topic: "t" });
    expect(p).toContain("Script = the spoken voiceover only");
  });
});
