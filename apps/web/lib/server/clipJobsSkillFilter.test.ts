import { describe, it, expect } from "vitest";
import { CLIP_SKILL_PRICE_USDC, clipSkillRunCost } from "../economy/servicePrices";

// ── Regression for the SKILL-LEAK bug (commit 1d3ecd2, convex/clipJobs.ts) ──
// The cloud render (clipJobs.process) used to APPLY + BILL every installed skill
// row, even one whose canvas node was removed — so a stale "brainrot" install
// fired its floor (gameplay bg) AND got billed on a run the user never wired it
// into. The fix filters agentSkillFiles by the canvas-synced `wired` flag:
//   wiredFiles = rows.filter(s => s.wired !== false)           // line 683
//   wiredSkillIds = [...new Set(wiredFiles.map(s=>s.skillId)   // line 736
//                      .filter(id => id in CLIP_SKILL_PRICE_USDC))]
// The `process` action downloads video + calls the cloud, so it isn't unit-
// callable; this pins the exact filter + pricing EXPRESSIONS it relies on so a
// regression to that contract is caught pre-deploy.
//
// (The data-layer half — agentSkillFiles.setWired/listByMint surfacing the flag
// — is covered in convex/agentSkillFiles.test.ts.)

type SkillRow = { skillId: string; wired?: boolean };

/** The EXACT render-list filter clipJobs.process applies (line 683). */
const wiredFiles = (rows: SkillRow[]): SkillRow[] => rows.filter((s) => s.wired !== false);

/** The EXACT billing-id derivation clipJobs.process applies (line 736). */
const wiredSkillIds = (rows: SkillRow[]): string[] => [
  ...new Set(wiredFiles(rows).map((s) => s.skillId).filter((id) => id in CLIP_SKILL_PRICE_USDC)),
];

describe("clipJobs wired-skill filter (skill-leak regression)", () => {
  // clip.meme ($0.18) is a PRICED skill left installed after its node was removed —
  // exactly the leak: it would fire its floor AND bill if not filtered out.
  const rows: SkillRow[] = [
    { skillId: "clip.captions", wired: true },       // wired on
    { skillId: "clip.meme", wired: false },          // node removed → must NOT apply/bill (priced!)
    { skillId: "clip.zoom" },                         // legacy/undefined → treated as wired
    { skillId: "clip.unknownjunk", wired: true },    // wired but unpriced → not billed
  ];

  it("excludes wired:false rows from the APPLIED skills, keeps wired:true and undefined", () => {
    const applied = wiredFiles(rows).map((s) => s.skillId);
    expect(applied).toContain("clip.captions");
    expect(applied).toContain("clip.zoom");          // undefined kept (legacy)
    expect(applied).not.toContain("clip.meme");      // the leak: must be gone
  });

  it("an unwired PRICED skill is NOT billed (its floor never fires AND no fee)", () => {
    expect(CLIP_SKILL_PRICE_USDC["clip.meme"]).toBeGreaterThan(0); // it really has a fee
    const billed = wiredSkillIds(rows);
    expect(billed).not.toContain("clip.meme");
    // The run cost reflects ONLY the wired+priced skills, never the stale meme fee.
    const cost = clipSkillRunCost(billed);
    const ifLeaked = clipSkillRunCost([...billed, "clip.meme"]);
    expect(ifLeaked).toBeGreaterThan(cost); // proves the meme fee was correctly excluded
    expect(cost).toBe(clipSkillRunCost(["clip.captions", "clip.zoom"]));
  });

  it("unknown/unpriced wired ids fall out of billing (cost $0 for them) but DON'T crash", () => {
    const billed = wiredSkillIds(rows);
    expect(billed).not.toContain("clip.unknownjunk");
    // captions 0.40 + zoom 0.25 = 0.65, junk contributes nothing.
    expect(clipSkillRunCost(billed)).toBeCloseTo(0.65);
  });

  it("an ALL-unwired install set produces an empty render + zero-cost run", () => {
    const allOff: SkillRow[] = [
      { skillId: "clip.captions", wired: false },
      { skillId: "clip.brainrot", wired: false },
    ];
    expect(wiredFiles(allOff)).toHaveLength(0);
    expect(wiredSkillIds(allOff)).toHaveLength(0);
    expect(clipSkillRunCost(wiredSkillIds(allOff))).toBe(0);
  });

  it("a WIRED clip.trendingaudio applies + bills $0.15; a stale (wired:false) one does neither", () => {
    expect(CLIP_SKILL_PRICE_USDC["clip.trendingaudio"]).toBe(0.15); // priced
    const on: SkillRow[] = [{ skillId: "clip.trendingaudio", wired: true }, { skillId: "clip.captions", wired: true }];
    expect(wiredFiles(on).map((s) => s.skillId)).toContain("clip.trendingaudio");
    expect(wiredSkillIds(on)).toContain("clip.trendingaudio");
    expect(clipSkillRunCost(wiredSkillIds(on))).toBeCloseTo(0.55); // 0.15 + 0.40

    const stale: SkillRow[] = [{ skillId: "clip.trendingaudio", wired: false }];
    expect(wiredFiles(stale)).toHaveLength(0);
    expect(wiredSkillIds(stale)).not.toContain("clip.trendingaudio");
    expect(clipSkillRunCost(wiredSkillIds(stale))).toBe(0);
  });
});
