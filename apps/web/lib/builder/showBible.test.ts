import { describe, it, expect } from "vitest";
import {
  normalizeShowBible, normalizeRotationState, advanceRotation, resolveBibleDirectives,
  type ShowBible,
} from "./showBible";

const bible: ShowBible = {
  version: 1,
  premise: "A cartoon lawyer reacts to real legal news.",
  format: { kinds: ["news-react", "skit"] },
  cast: [{ name: "Lex", role: "host", visualIdentity: "2D cartoon lawyer, navy suit, round glasses" }],
  visualWorld: { style: "2D cartoon, bold outlines", settings: ["courtroom", "office desk", "news studio"], moods: ["playful"] },
  voice: { tone: "sharp, witty", language: "English", catchphrases: ["Objection!"] },
  contentEngine: { newsQueries: ["latest supreme court ruling"], evergreenPools: ["weird laws explained"], seriesArcs: false },
  contentMix: { entertain: 60, value: 30, promo: 10 },
  variationAxes: { hookStyles: ["bold_claim", "question"], structures: ["problem-twist-verdict", "list-of-3"] },
  cadence: { perFormatDuration: { "news-react": { min: 30, max: 45 }, skit: { min: 15, max: 25 } }, postsPerDay: 1 },
};

describe("normalizeShowBible", () => {
  it("returns null for junk", () => {
    expect(normalizeShowBible(null)).toBeNull();
    expect(normalizeShowBible({})).toBeNull();
    expect(normalizeShowBible({ premise: "x", format: { kinds: [] } })).toBeNull();
  });
  it("coerces missing arrays to empty and keeps a valid bible", () => {
    const n = normalizeShowBible({ premise: "p", format: { kinds: ["skit"] } });
    expect(n).not.toBeNull();
    expect(n!.visualWorld.settings).toEqual([]);
    expect(n!.contentEngine.newsQueries).toEqual([]);
    expect(n!.variationAxes.hookStyles).toEqual([]);
    expect(n!.version).toBe(1);
  });
  it("round-trips a full bible", () => {
    expect(normalizeShowBible(bible)).toEqual(bible);
  });
});

describe("rotation", () => {
  it("defaults to zeros", () => {
    expect(normalizeRotationState(undefined)).toEqual({ hookIdx: 0, structureIdx: 0, settingIdx: 0, formatIdx: 0, styleIdx: 0 });
  });
  it("advances every index mod axis length", () => {
    const s0 = normalizeRotationState(null);
    const s1 = advanceRotation(s0, bible);
    expect(s1).toEqual({ hookIdx: 1, structureIdx: 1, settingIdx: 1, formatIdx: 1, styleIdx: 1 });
    const s2 = advanceRotation(s1, bible);
    expect(s2.hookIdx).toBe(0);       // 2 hookStyles
    expect(s2.settingIdx).toBe(2);    // 3 settings
    expect(s2.formatIdx).toBe(0);     // 2 formats
  });
});

describe("resolveBibleDirectives", () => {
  it("picks format + duration from the bible's per-format policy", () => {
    const d = resolveBibleDirectives(bible, { hookIdx: 0, structureIdx: 0, settingIdx: 0, formatIdx: 0 }, {});
    expect(d.format).toBe("news-react");
    expect(d.durationSeconds).toBeGreaterThanOrEqual(30);
    expect(d.durationSeconds).toBeLessThanOrEqual(45);
    expect(d.brief.visualTreatment).toContain("courtroom");
    expect(d.brief.visualTreatment).toContain("2D cartoon");
    expect(d.brief.structureNotes).toContain("problem-twist-verdict");
  });
  it("rotated state picks the next format and setting", () => {
    const d = resolveBibleDirectives(bible, { hookIdx: 1, structureIdx: 1, settingIdx: 1, formatIdx: 1 }, {});
    expect(d.format).toBe("skit");
    expect(d.durationSeconds).toBeLessThanOrEqual(25);
    expect(d.brief.visualTreatment).toContain("office desk");
  });
  it("explicit duration wins, clamped to the format range", () => {
    const d = resolveBibleDirectives(bible, normalizeRotationState(null), { durationSeconds: 60 });
    expect(d.durationSeconds).toBeLessThanOrEqual(45);
  });
});

// ── Video Styles (Identity + Styles restructure) ─────────────────────────────
import { bibleVideoStyles, type VideoStyle } from "./showBible";

describe("bibleVideoStyles", () => {
  it("legacy bible (no videoStyles) → one synthesized starter style per format kind", () => {
    const styles = bibleVideoStyles(bible);
    expect(styles.map((s) => s.format)).toEqual(["news-react", "skit"]);
    // structures/hooks distributed round-robin across the starters
    expect(styles[0].structure).toBe("problem-twist-verdict");
    expect(styles[1].structure).toBe("list-of-3");
    expect(styles[0].hookStyle).toBe("bold_claim");
    // duration pulled from cadence.perFormatDuration
    expect(styles[0].durationSec).toEqual({ min: 30, max: 45 });
    expect(styles.every((s) => s.id && s.name)).toBe(true);
  });

  it("authored videoStyles are the source of truth (no synthesis)", () => {
    const authored: VideoStyle[] = [
      { id: "street", name: "Street interview", format: "interview", structure: "question-vox-punch", hookStyle: "question", durationSec: { min: 20, max: 35 }, weight: 2 },
      { id: "hot-take", name: "Hot take", format: "talking-head", weight: 1 },
    ];
    const b = normalizeShowBible({ ...bible, videoStyles: authored });
    expect(b?.videoStyles).toEqual(authored);
    expect(bibleVideoStyles(b!)).toEqual(authored);
  });

  it("normalize drops junk style rows and clamps weight", () => {
    const b = normalizeShowBible({ ...bible, videoStyles: [
      { id: "ok", name: "Ok", format: "skit", weight: -3 },
      { name: "no id or format" },
      "junk",
    ] });
    expect(b?.videoStyles).toHaveLength(1);
    expect(b!.videoStyles![0].weight).toBe(1);
  });
});

describe("style-driven rotation + directives", () => {
  const styled = normalizeShowBible({ ...bible, videoStyles: [
    { id: "street", name: "Street interview", format: "interview", structure: "question-vox-punch", hookStyle: "question", durationSec: { min: 20, max: 35 }, weight: 2 },
    { id: "hot-take", name: "Hot take", format: "talking-head", durationSec: { min: 10, max: 20 }, weight: 1 },
  ] })!;

  it("weighted rotation: weight-2 style appears twice per cycle", () => {
    let st = normalizeRotationState(null);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(resolveBibleDirectives(styled, st, {}).format);
      st = advanceRotation(st, styled);
    }
    expect(seen.filter((f) => f === "interview")).toHaveLength(2);
    expect(seen.filter((f) => f === "talking-head")).toHaveLength(1);
    // cycle repeats deterministically
    expect(resolveBibleDirectives(styled, st, {}).format).toBe(seen[0]);
  });

  it("directives carry the style's structure/hook/duration", () => {
    const d = resolveBibleDirectives(styled, normalizeRotationState(null), {});
    expect(d.format).toBe("interview");
    expect(d.durationSeconds).toBeGreaterThanOrEqual(20);
    expect(d.durationSeconds).toBeLessThanOrEqual(35);
    expect(d.brief.structureNotes).toContain("question-vox-punch");
    expect(d.brief.angle).toBe("question");
  });

  it("legacy bible directives are unchanged (starter styles mirror the old axes walk)", () => {
    const d = resolveBibleDirectives(bible, normalizeRotationState(null), {});
    expect(d.format).toBe("news-react");
    expect(d.brief.structureNotes).toContain("problem-twist-verdict");
  });
});

// ── Style targeting (copilot + ideation binding) ─────────────────────────────
import { matchVideoStyle } from "./showBible";

describe("matchVideoStyle", () => {
  const b = normalizeShowBible({ ...bible, videoStyles: [
    { id: "street-interview", name: "Street interview", format: "interview", weight: 1 },
    { id: "hot-take", name: "Hot take", format: "talking-head", weight: 1 },
  ] })!;
  it("matches by id, by name (case-insensitive), and inside a longer ask", () => {
    expect(matchVideoStyle(b, "street-interview")?.id).toBe("street-interview");
    expect(matchVideoStyle(b, "HOT TAKE")?.id).toBe("hot-take");
    expect(matchVideoStyle(b, "make a street interview video about rent prices")?.id).toBe("street-interview");
  });
  it("no match → undefined; never matches on generic words", () => {
    expect(matchVideoStyle(b, "a video about cats")).toBeUndefined();
    expect(matchVideoStyle(b, "")).toBeUndefined();
  });
});

describe("resolveBibleDirectives with explicit styleId", () => {
  const b = normalizeShowBible({ ...bible, videoStyles: [
    { id: "street", name: "Street interview", format: "interview", structure: "question-vox-punch", durationSec: { min: 20, max: 35 }, weight: 2 },
    { id: "hot-take", name: "Hot take", format: "talking-head", durationSec: { min: 10, max: 20 }, weight: 1 },
  ] })!;
  it("styleId pins the recipe regardless of rotation state", () => {
    const d = resolveBibleDirectives(b, { hookIdx: 0, structureIdx: 0, settingIdx: 0, formatIdx: 0, styleIdx: 2 }, { styleId: "street" });
    expect(d.format).toBe("interview");
    expect(d.brief.structureNotes).toContain("question-vox-punch");
    expect(d.durationSeconds).toBeGreaterThanOrEqual(20);
    expect(d.durationSeconds).toBeLessThanOrEqual(35);
  });
  it("unknown styleId falls back to rotation", () => {
    const d = resolveBibleDirectives(b, normalizeRotationState(null), { styleId: "nope" });
    expect(d.format).toBe("interview"); // rotation slot 0 = street (weight-2 first)
  });
});

// ── Visual Show Designer additions ───────────────────────────────────────────
import { getArchetype, identityRefKindsFor, ARCHETYPES } from "./showArchetypes";
import { resolveIdentityRefs } from "./showBible";

describe("showArchetypes", () => {
  it("registry has the core archetypes with policies", () => {
    expect(ARCHETYPES.length).toBeGreaterThanOrEqual(7);
    expect(getArchetype("cartoon-series")?.refPolicy).toBe("stylized");
    expect(getArchetype("talking-head")?.refPolicy).toBe("realistic");
    expect(getArchetype("nope")).toBeUndefined();
  });
  it("identityRefKindsFor maps policy to allowed kinds", () => {
    expect(identityRefKindsFor("cartoon-series")).toEqual(["ai-sheet", "style-frame"]);
    expect(identityRefKindsFor("talking-head")).toEqual(["real-photo", "video-frame"]);
    expect(identityRefKindsFor(undefined)).toContain("real-photo"); // custom/any = all
    expect(identityRefKindsFor(undefined)).toContain("ai-sheet");
  });
});

describe("visualRefs normalization", () => {
  it("keeps valid refs, drops gif/data/junk urls and blank roles default to style", () => {
    const n = normalizeShowBible({
      premise: "p", format: { kinds: ["skit"] },
      archetype: "skit",
      visualRefs: [
        { url: "https://x.com/a.png", kind: "real-photo", role: "cast:Lex", locked: true },
        { url: "https://x.com/b.gif", kind: "real-photo", role: "style" },
        { url: "data:image/png;base64,xx", kind: "ai-sheet", role: "style" },
        { url: "not-a-url", kind: "ai-sheet", role: "style" },
        { url: "https://x.com/c.png", kind: "weird-kind", role: "" },
      ],
    });
    expect(n?.archetype).toBe("skit");
    expect(n?.visualRefs).toHaveLength(1);
    expect(n?.visualRefs?.[0]).toEqual({ url: "https://x.com/a.png", kind: "real-photo", role: "cast:Lex", locked: true });
  });
  it("unknown archetype is dropped", () => {
    const n = normalizeShowBible({ premise: "p", format: { kinds: ["skit"] }, archetype: "hologram" });
    expect(n?.archetype).toBeUndefined();
  });
});

describe("resolveIdentityRefs", () => {
  const mk = (over: Partial<ShowBible>): ShowBible => ({
    version: 1, premise: "p", format: { kinds: ["skit"] },
    cast: [
      { name: "Lex", role: "host", visualIdentity: "x" },
      { name: "Rex", role: "co", visualIdentity: "y" },
    ],
    visualWorld: { style: "", settings: [], moods: [] }, voice: { tone: "" },
    contentEngine: { newsQueries: [], evergreenPools: [], seriesArcs: false },
    variationAxes: { hookStyles: [], structures: [] }, cadence: { perFormatDuration: {} },
    contentMix: { entertain: 50, value: 30, promo: 20 },
    ...over,
  });
  it("locked-only, policy-filtered, cast order first, cap 3", () => {
    const bible = mk({
      archetype: "cartoon-series",
      visualRefs: [
        { url: "https://x/style.png", kind: "style-frame", role: "style", locked: true },
        { url: "https://x/rex.png", kind: "ai-sheet", role: "cast:Rex", locked: true },
        { url: "https://x/lex.png", kind: "ai-sheet", role: "cast:Lex", locked: true },
        { url: "https://x/real.png", kind: "real-photo", role: "cast:Lex", locked: true },  // filtered: stylized policy
        { url: "https://x/unlocked.png", kind: "ai-sheet", role: "style" },                  // filtered: not locked
        { url: "https://x/extra.png", kind: "style-frame", role: "style", locked: true },
      ],
    });
    const r = resolveIdentityRefs(bible);
    expect(r.primary).toBe("https://x/lex.png");             // lead cast member first (bible.cast order)
    expect(r.extras).toEqual(["https://x/rex.png", "https://x/style.png"]); // cap 3 total
  });
  it("realistic policy excludes ai refs entirely", () => {
    const bible = mk({
      archetype: "talking-head",
      visualRefs: [
        { url: "https://x/sheet.png", kind: "ai-sheet", role: "cast:Lex", locked: true },
        { url: "https://x/photo.png", kind: "real-photo", role: "cast:Lex", locked: true },
      ],
    });
    const r = resolveIdentityRefs(bible);
    expect(r.primary).toBe("https://x/photo.png");
    expect(r.extras).toEqual([]);
  });
  it("empty when nothing usable", () => {
    expect(resolveIdentityRefs(mk({}))).toEqual({ primary: undefined, extras: [] });
  });
});

describe("contentMix", () => {
  it("defaults when absent and normalizes to 100", () => {
    const n = normalizeShowBible({ premise: "p", format: { kinds: ["skit"] } });
    expect(n?.contentMix).toEqual({ entertain: 60, value: 30, promo: 10 });
    const m = normalizeShowBible({ premise: "p", format: { kinds: ["skit"] }, contentMix: { entertain: 2, value: 1, promo: 1 } });
    expect(m?.contentMix).toEqual({ entertain: 50, value: 25, promo: 25 });
  });
  it("junk mix falls back to default", () => {
    const n = normalizeShowBible({ premise: "p", format: { kinds: ["skit"] }, contentMix: { entertain: 0, value: 0, promo: 0 } });
    expect(n?.contentMix).toEqual({ entertain: 60, value: 30, promo: 10 });
  });
});

describe("archetype pitch hints + episodic", () => {
  it("every archetype has a pitchHint; cartoon/anime are episodic", () => {
    for (const a of ARCHETYPES) expect(a.pitchHint.length).toBeGreaterThan(10);
    expect(getArchetype("cartoon-series")?.episodic).toBe(true);
    expect(getArchetype("anime-series")?.episodic).toBe(true);
    expect(getArchetype("talking-head")?.episodic).toBe(false);
  });
});
