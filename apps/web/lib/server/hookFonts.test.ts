import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_FONT_FAMILY, hookFontsDir, hasHookFonts } from "./hookFonts";

describe("hookFonts", () => {
  it("resolves a real bundled directory with the 5 ttf files", () => {
    expect(hasHookFonts()).toBe(true);
    expect(existsSync(hookFontsDir())).toBe(true);
    const ttf = readdirSync(hookFontsDir()).filter((f) => f.endsWith(".ttf"));
    expect(ttf.length).toBeGreaterThanOrEqual(5);
  });

  it("maps every template font token to a non-empty family name", () => {
    for (const token of ["anton", "barlow", "archivo", "poppins", "bebas"]) {
      expect(typeof HOOK_FONT_FAMILY[token]).toBe("string");
      expect(HOOK_FONT_FAMILY[token].length).toBeGreaterThan(0);
    }
  });

  it("bundles a LICENSE for the fonts", () => {
    expect(existsSync(join(hookFontsDir(), "OFL.txt"))).toBe(true);
  });
});

describe("hookFontsDir resolution", () => {
  afterEach(() => { delete process.env.HOOK_FONTS_DIR; vi.resetModules(); });

  it("honors the HOOK_FONTS_DIR override when that dir exists", async () => {
    process.env.HOOK_FONTS_DIR = tmpdir(); // an existing dir, distinct from assets/fonts
    vi.resetModules();
    const fresh = await import("./hookFonts");
    expect(fresh.hookFontsDir()).toBe(tmpdir());
  });

  it("ignores a non-existent override and falls back to the cwd assets dir", async () => {
    process.env.HOOK_FONTS_DIR = join(tmpdir(), "definitely-not-here-xyz");
    vi.resetModules();
    const fresh = await import("./hookFonts");
    expect(fresh.hookFontsDir()).not.toContain("definitely-not-here-xyz");
    expect(fresh.hasHookFonts()).toBe(true); // real bundled dir still resolves
  });
});
