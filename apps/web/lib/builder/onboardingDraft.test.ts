import { describe, it, expect } from "vitest";
import { emptyDraft, draftFromBible, draftToBible, draftStepComplete } from "./onboardingDraft";
import { normalizeShowBible } from "./showBible";

describe("draftToBible", () => {
  it("maps every draft field onto the bible and normalizes clean", () => {
    const d = { ...emptyDraft(),
      premise: "solo founder builds in public", archetype: "friend",
      formats: ["founder-talk", "anime"], perFormatDuration: { "founder-talk": 30, anime: 20 },
      tunables: { "founder-talk": { framing: "selfie handheld", cta: "follow for more" } },
      tone: "casual", language: "Malay", energy: "high", postsPerDay: 2,
    };
    const bible = draftToBible(d);
    expect(bible.premise).toBe("solo founder builds in public");
    expect(bible.format.kinds).toEqual(["founder-talk", "anime"]);
    expect(bible.cadence.perFormatDuration["founder-talk"]).toEqual({ min: 30, max: 30 });
    expect(bible.cadence.postsPerDay).toBe(2);
    expect(bible.voice.tone).toContain("casual");
    expect(bible.voice.language).toBe("Malay");
    expect(normalizeShowBible(bible)).not.toBeNull(); // survives the server normalizer
  });
  it("clamps durations into the wizard band (30s cap, engine floors)", () => {
    const d = { ...emptyDraft(), premise: "x", formats: ["skit"], perFormatDuration: { skit: 500 } };
    expect(draftToBible(d).cadence.perFormatDuration.skit.min).toBe(30); // wizard cap
    const grok = { ...emptyDraft(), premise: "x", formats: ["skit"], engine: "grok-imagine-15", perFormatDuration: { skit: 5 } };
    expect(draftToBible(grok).cadence.perFormatDuration.skit.min).toBe(5); // grok floor survives
    const omni = { ...emptyDraft(), premise: "x", formats: ["skit"], engine: "gemini-omni", perFormatDuration: { skit: 5 } };
    expect(draftToBible(omni).cadence.perFormatDuration.skit.min).toBe(10); // omni floor
  });
  it("merges over an existing bible without losing unrelated fields", () => {
    const existing = normalizeShowBible({ premise: "old", visualRefs: [{ url: "https://x/y.png", kind: "real-photo", role: "cast:A", locked: true }], format: { kinds: ["skit"] }, cast: [], visualWorld: { style: "s", settings: [], moods: [] }, voice: { tone: "t" }, contentEngine: { newsQueries: [], evergreenPools: [], seriesArcs: false }, contentMix: { entertain: 1, value: 0, promo: 0 }, variationAxes: { hookStyles: [], structures: [] }, cadence: { perFormatDuration: {} }, version: 1 })!;
    const d = { ...emptyDraft(), premise: "new premise", formats: ["anime"] };
    const merged = draftToBible(d, existing);
    expect(merged.premise).toBe("new premise");
    expect(merged.visualRefs?.length).toBe(1); // preserved
  });
});

describe("draftFromBible", () => {
  it("round-trips formats and durations", () => {
    const d1 = { ...emptyDraft(), premise: "p", formats: ["cartoon"], perFormatDuration: { cartoon: 15 } };
    const d2 = draftFromBible(draftToBible(d1));
    expect(d2.formats).toEqual(["cartoon"]);
    expect(d2.perFormatDuration.cartoon).toBe(15);
    expect(d2.premise).toBe("p");
  });
  it("null bible → empty draft", () => {
    expect(draftFromBible(null)).toEqual(emptyDraft());
  });
  it("round-trips per-format tunables through draftToBible → draftFromBible, and survives normalizeShowBible (I1)", () => {
    const d1 = {
      ...emptyDraft(), premise: "p", formats: ["founder-talk", "anime"],
      perFormatDuration: { "founder-talk": 30, anime: 20 },
      tunables: { "founder-talk": { framing: "selfie handheld", cta: "follow for more" }, anime: { palette: "neon" } },
    };
    const bible = draftToBible(d1);
    expect(bible.videoStyles?.find((s) => s.id === "founder-talk")?.tunables).toEqual({ framing: "selfie handheld", cta: "follow for more" });
    expect(bible.videoStyles?.find((s) => s.id === "anime")?.tunables).toEqual({ palette: "neon" });

    // survives the server normalizer (the real persistence path)
    const normalized = normalizeShowBible(bible);
    expect(normalized).not.toBeNull();
    expect(normalized!.videoStyles?.find((s) => s.id === "founder-talk")?.tunables).toEqual({ framing: "selfie handheld", cta: "follow for more" });

    const d2 = draftFromBible(normalized);
    expect(d2.tunables).toEqual({ "founder-talk": { framing: "selfie handheld", cta: "follow for more" }, anime: { palette: "neon" } });
  });
});

describe("draftStepComplete", () => {
  it("gates each step on its required fields", () => {
    const d = emptyDraft();
    expect(draftStepComplete(d, 1)).toBe(false);           // premise required
    expect(draftStepComplete({ ...d, premise: "x" }, 1)).toBe(true);
    expect(draftStepComplete(d, 2)).toBe(true);            // face pick optional
    expect(draftStepComplete(d, 3)).toBe(false);           // ≥1 format
    expect(draftStepComplete({ ...d, formats: ["skit"] }, 3)).toBe(true);
    expect(draftStepComplete(d, 5)).toBe(false);           // tone+language
    expect(draftStepComplete({ ...d, tone: "casual", language: "English" }, 5)).toBe(true);
    expect(draftStepComplete(d, 6)).toBe(true);            // postsPerDay has default
  });
});
