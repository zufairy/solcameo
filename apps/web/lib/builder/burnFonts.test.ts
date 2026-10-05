import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BURN_FONTS, BURN_FONT_FAMILIES, HOOK_FONT_FAMILY } from "./burnFonts";
import { CAPTION_PRESETS } from "./captionPresets";

const FONTS_DIR = join(__dirname, "..", "..", "assets", "fonts");

describe("burn fonts", () => {
  it("every registered font file is bundled", () => {
    for (const f of BURN_FONTS) expect(existsSync(join(FONTS_DIR, f.file)), f.file).toBe(true);
  });

  it("every caption preset font is a bundled burn family (preview == burn)", () => {
    for (const p of CAPTION_PRESETS) {
      const r = p.render;
      const fonts = [r.font, r.keywordFont, ...(r.wordFonts ?? []), ...(r.lineFonts ?? [])].filter(Boolean) as string[];
      for (const f of fonts) expect(BURN_FONT_FAMILIES.has(f), `${p.id}: ${f}`).toBe(true);
    }
  });

  it("every hook font token maps to a bundled family", () => {
    for (const fam of Object.values(HOOK_FONT_FAMILY)) expect(BURN_FONT_FAMILIES.has(fam)).toBe(true);
  });

  it("preset picker chips use the burn family at native weight", () => {
    for (const p of CAPTION_PRESETS) {
      expect(String(p.preview.base.fontFamily)).toContain(`"${p.render.font}"`);
      expect(p.preview.base.fontWeight).toBe(400);
    }
  });
});
