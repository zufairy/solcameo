import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESETS } from "./presets";
import { POSES, buildPrompt, categoriesFor, sanitizeSelection } from "./spec";
import { ANIMAL_TIERS } from "./types";

describe("Higgsfield presets", () => {
  it("mirrors all 41 presets with their images on disk", () => {
    expect(PRESETS).toHaveLength(41);
    for (const p of PRESETS) {
      expect(existsSync(join(process.cwd(), "public", p.preview)), p.name).toBe(true);
      expect(existsSync(join(process.cwd(), "public", p.sheet)), p.name).toBe(true);
    }
  });
  it("keeps every trait of every preset (nothing is dropped by the catalog)", () => {
    for (const p of PRESETS) expect(sanitizeSelection(p.selection, p.tier), p.name).toEqual(p.selection);
  });
});

describe("animal tiers", () => {
  it("offer species plus only the groups Higgsfield shares with animals", () => {
    for (const tier of ANIMAL_TIERS) {
      const ids = categoriesFor(tier).map((c) => c.id);
      expect(ids[0]).toBe("species");
      expect(ids).toContain("hair");
      expect(ids).not.toContain("skin_tone");
      expect(ids).not.toContain("age");
    }
  });
  it("name the animal in the prompt", () => {
    const sel = sanitizeSelection({ species: ["owl"], gender: ["female"] }, "birds");
    expect(buildPrompt(sel, "birds")).toContain("anthropomorphic owl");
  });
});

describe("poses", () => {
  it("are all different and replace the default stance", () => {
    expect(new Set(POSES).size).toBe(POSES.length);
    const sel = { gender: ["female"] };
    expect(buildPrompt(sel, "normal", { pose: POSES[2] })).toContain(POSES[2]);
    expect(buildPrompt(sel, "normal", { pose: POSES[2] })).not.toContain("Front-facing, standing,");
  });
});
