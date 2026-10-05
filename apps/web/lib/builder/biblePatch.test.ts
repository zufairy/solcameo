import { describe, it, expect } from "vitest";
import { applyBiblePatch } from "./biblePatch";
import { normalizeShowBible } from "./showBible";

const base = () => normalizeShowBible({
  version: 1, premise: "founder builds in public",
  format: { kinds: ["founder-talk"] }, cast: [],
  visualWorld: { style: "warm realism", settings: [], moods: [] },
  voice: { tone: "casual", language: "English" },
  contentEngine: { newsQueries: [], evergreenPools: [], seriesArcs: false },
  contentMix: { entertain: 60, value: 30, promo: 10 },
  variationAxes: { hookStyles: [], structures: [] },
  cadence: { perFormatDuration: { "founder-talk": { min: 30, max: 30 } }, postsPerDay: 1 },
})!;

describe("applyBiblePatch", () => {
  it("applies tone/language/premise/style with summaries", () => {
    const r = applyBiblePatch(base(), [
      { op: "setTone", value: "hype Manglish" },
      { op: "setLanguage", value: "Malay" },
      { op: "setStyle", value: "neon cyberpunk" },
    ]);
    expect(r.bible.voice.tone).toBe("hype Manglish");
    expect(r.bible.voice.language).toBe("Malay");
    expect(r.bible.visualWorld.style).toBe("neon cyberpunk");
    expect(r.applied).toEqual([
      "voice tone → hype Manglish",
      "language → Malay",
      "visual style → neon cyberpunk",
    ]);
    expect(r.rejected).toEqual([]);
  });
  it("addFormat/removeFormat validate against the catalog and dedupe", () => {
    const r = applyBiblePatch(base(), [
      { op: "addFormat", formatId: "anime" },
      { op: "addFormat", formatId: "anime" },
      { op: "addFormat", formatId: "not-a-format" },
      { op: "removeFormat", formatId: "founder-talk" },
    ]);
    expect(r.bible.format.kinds).toEqual(["anime"]);
    expect(r.applied).toContain("added format Anime");
    expect(r.applied).toContain("removed format Founder Talking Video");
    expect(r.rejected.some((x) => x.includes("not-a-format"))).toBe(true);
  });
  it("removeFormat refuses to empty the rotation", () => {
    const r = applyBiblePatch(base(), [{ op: "removeFormat", formatId: "founder-talk" }]);
    expect(r.bible.format.kinds).toEqual(["founder-talk"]);
    expect(r.rejected.some((x) => /last format/i.test(x))).toBe(true);
  });
  it("setFormatDuration clamps to the band; setPostsPerDay bounds 1-6", () => {
    const r = applyBiblePatch(base(), [
      { op: "setFormatDuration", formatId: "founder-talk", seconds: 500 },
      { op: "setPostsPerDay", seconds: 9 },
    ]);
    expect(r.bible.cadence.perFormatDuration["founder-talk"]).toEqual({ min: 60, max: 60 });
    expect(r.bible.cadence.postsPerDay).toBe(6);
    expect(r.applied).toContain("founder-talk length → 60s");
    expect(r.applied).toContain("posts per day → 6");
  });
  it("unknown ops and oversize values reject without mutating", () => {
    const b = base();
    const r = applyBiblePatch(b, [
      { op: "hackTheGibson", value: "x" },
      { op: "setTone", value: "x".repeat(200) },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.rejected.length).toBe(2);
    expect(r.bible.voice.tone).toBe(b.voice.tone);
  });
  it("result survives normalizeShowBible", () => {
    const r = applyBiblePatch(base(), [{ op: "addCatchphrase", value: "let's gooo" }]);
    expect(r.bible.voice.catchphrases).toContain("let's gooo");
    expect(normalizeShowBible(r.bible)).not.toBeNull();
  });
});

describe("setFormatDuration keeps both duration readers in sync", () => {
  it("mirrors the new length onto the format's videoStyles so resolveBibleDirectives can't keep the old one", async () => {
    const { applyBiblePatch } = await import("@/lib/builder/biblePatch");
    const { resolveBibleDirectives, normalizeShowBible, normalizeRotationState } = await import("@/lib/builder/showBible");
    const base = normalizeShowBible({
      version: 1, premise: "x", format: { kinds: ["founder-talk"], rotation: "weighted" }, cast: [],
      visualWorld: { style: "clean", settings: [], moods: [] }, voice: { tone: "calm" },
      contentEngine: { newsQueries: [], evergreenPools: [], seriesArcs: false }, contentMix: { entertain: 60, value: 30, promo: 10 },
      variationAxes: { hookStyles: [], structures: [] },
      cadence: { perFormatDuration: { "founder-talk": { min: 20, max: 20 } }, postsPerDay: 1 },
      videoStyles: [{ id: "founder-talk", name: "Founder talk", format: "founder-talk", weight: 1, durationSec: { min: 20, max: 20 } }],
    })!;
    const r = applyBiblePatch(base, [{ op: "setFormatDuration", formatId: "founder-talk", seconds: 5 }] as never);
    const d = resolveBibleDirectives(r.bible, normalizeRotationState(undefined), { engine: "grok-imagine-15" });
    expect(d.durationSeconds).toBe(5);
    expect(r.bible.videoStyles?.[0]?.durationSec).toEqual({ min: 5, max: 5 });
  });
});
