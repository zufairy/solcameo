import { describe, it, expect } from "vitest";
import { buildIdeationPrompt, coerceIdeaCandidates } from "./ideation";
import type { ShowBible } from "@/lib/builder/showBible";

const bible: ShowBible = {
  version: 1, premise: "Cartoon lawyer reacts to legal news.",
  format: { kinds: ["news-react", "skit"] },
  cast: [{ name: "Lex", role: "host", visualIdentity: "cartoon lawyer" }],
  visualWorld: { style: "2D cartoon", settings: ["courtroom"], moods: [] },
  voice: { tone: "witty" },
  contentEngine: { newsQueries: ["supreme court news today"], evergreenPools: ["weird laws"], seriesArcs: false },
  contentMix: { entertain: 60, value: 30, promo: 10 },
  variationAxes: { hookStyles: ["question"], structures: ["problem-twist-verdict"] },
  cadence: { perFormatDuration: { "news-react": { min: 30, max: 45 }, skit: { min: 15, max: 25 } } },
};

describe("buildIdeationPrompt", () => {
  it("carries premise, taste, news, and anti-repeat lists", () => {
    const { user } = buildIdeationPrompt({
      bible, tasteProse: "loves courtroom absurdity",
      newsContext: "- court ruled X today",
      recentHeadlines: ["Old idea about tort reform"],
      recentScriptTopics: ["tort reform explained"],
      count: 6,
    });
    expect(user).toContain("Cartoon lawyer reacts");
    expect(user).toContain("loves courtroom absurdity");
    expect(user).toContain("court ruled X today");
    expect(user).toContain("Old idea about tort reform");
    expect(user).toContain('"score"');
  });
});

describe("coerceIdeaCandidates", () => {
  it("clamps, defaults, and stamps news TTL", () => {
    const out = coerceIdeaCandidates([
      { headline: "H1", angle: "A1", source: "news", format: "news-react", suggestedDurationSec: 400, score: 150 },
      { headline: "", angle: "no headline" },
      { headline: "H2", angle: "A2", source: "weird", format: "skit" },
    ], bible);
    expect(out).toHaveLength(2);
    expect(out[0].suggestedDurationSec).toBeLessThanOrEqual(45);   // clamped to format range
    expect(out[0].score).toBe(100);
    expect(out[0].expiresAt).toBeGreaterThan(Date.now());
    expect(out[1].source).toBe("evergreen");                        // unknown source coerced
    expect(out[1].expiresAt).toBeUndefined();
  });
  it("unknown format falls back to the bible's first format", () => {
    const out = coerceIdeaCandidates([{ headline: "H", angle: "A", format: "podcast" }], bible);
    expect(out[0].format).toBe("news-react");
  });
  it("drops sourceRefs the LLM invented — only urls from the search-grounding allowlist survive", () => {
    const known = new Set(["https://real-source.example/article"]);
    const out = coerceIdeaCandidates([
      { headline: "H", angle: "A", source: "news", sourceRefs: ["https://real-source.example/article", "https://made-up-url.example/nope"] },
      { headline: "H2", angle: "A2", source: "news", sourceRefs: ["https://made-up-url.example/nope"] },
    ], bible, [], known);
    expect(out[0].sourceRefs).toEqual(["https://real-source.example/article"]);
    expect(out[1].sourceRefs).toBeUndefined();
  });
});

describe("content mix + campaigns in ideation", () => {
  it("prompt carries mix ratios, recent intents, and campaign offers", () => {
    const { user } = buildIdeationPrompt({
      bible: { ...bible, contentMix: { entertain: 50, value: 30, promo: 20 } },
      tasteProse: "", newsContext: "",
      recentHeadlines: [], recentScriptTopics: [],
      recentIntents: ["promo", "entertain"],
      campaigns: [{ id: "c1", title: "HydroFlask Summer", brandName: "HydroFlask", brief: "show the bottle outdoors" }],
      count: 6,
    });
    expect(user).toContain("50% entertain");
    expect(user).toContain("20% promo");
    expect(user).toContain("promo, entertain");
    expect(user).toContain("HydroFlask Summer");
    expect(user).toContain("campaignId");
    expect(user).toContain("never a hard ad");
  });
  it("coerce validates campaignId against offers and stamps intent", () => {
    const out = coerceIdeaCandidates([
      { headline: "H1", angle: "A", intent: "promo", campaignId: "c1", format: "skit" },
      { headline: "H2", angle: "A", intent: "promo", campaignId: "fake", format: "skit" },
      { headline: "H3", angle: "A", intent: "weird", format: "skit" },
    ], bible, [{ id: "c1", title: "HydroFlask Summer", brandName: "HydroFlask", brief: "" }]);
    expect(out[0].campaignId).toBe("c1");
    expect(out[0].campaignTitle).toBe("HydroFlask Summer");
    expect(out[1].campaignId).toBeUndefined();
    expect(out[1].intent).toBe("promo");
    expect(out[2].intent).toBe("entertain");
  });
});

describe("video styles in ideation (daily same-type content binding)", () => {
  const styled: ShowBible = {
    ...bible,
    videoStyles: [
      { id: "street", name: "Street interview", format: "news-react", structure: "question-vox-punch", durationSec: { min: 20, max: 35 }, weight: 2 },
      { id: "hot-take", name: "Hot take", format: "skit", durationSec: { min: 10, max: 20 }, weight: 1 },
    ],
  };

  it("prompt lists every style with its recipe + weight and requires styleId", () => {
    const { user } = buildIdeationPrompt({
      bible: styled, tasteProse: "", newsContext: "",
      recentHeadlines: [], recentScriptTopics: [], count: 6,
    });
    expect(user).toContain("street");
    expect(user).toContain("Street interview");
    expect(user).toContain("hot-take");
    expect(user).toContain('"styleId"');
    expect(user).toMatch(/weight/i);
  });

  it("coerce validates styleId and derives format + duration from the style", () => {
    const [ok] = coerceIdeaCandidates([
      { headline: "H", angle: "A", styleId: "street", format: "skit", suggestedDurationSec: 99 },
    ], styled);
    expect(ok.styleId).toBe("street");
    expect(ok.format).toBe("news-react");            // style's format wins
    expect(ok.suggestedDurationSec).toBeLessThanOrEqual(35); // clamped to the style's range
    expect(ok.suggestedDurationSec).toBeGreaterThanOrEqual(20);
  });

  it("unknown styleId falls back to the style matching the idea's format", () => {
    const [i] = coerceIdeaCandidates([
      { headline: "H", angle: "A", styleId: "nope", format: "skit", suggestedDurationSec: 15 },
    ], styled);
    expect(i.styleId).toBe("hot-take");
  });

  it("legacy bible (no videoStyles) still stamps the synthesized starter style", () => {
    const [i] = coerceIdeaCandidates([
      { headline: "H", angle: "A", format: "skit", suggestedDurationSec: 20 },
    ], bible);
    expect(i.styleId).toBe("skit");
  });
});
