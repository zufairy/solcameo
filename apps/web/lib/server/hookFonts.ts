import { join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Bundled OFL industry fonts for the hook burn. A hook template carries a short
 * `font` TOKEN; this maps it to the font's INTERNAL family name (verified with
 * fontTools name id 1) that libass matches on via the ASS `Fontname` field, and
 * (via HOOK_FONT_FILE below) to the actual .ttf so the clip drawtext path can point
 * `fontfile=` straight at it. The family strings MUST match the bundled .ttf name
 * tables exactly or libass silently falls back to a default font.
 *
 * Weights are deliberately READABLE, not heavy: Medium (500) / SemiBold (600) reads
 * as clean and professional on video, where a Black/ExtraBold face looks clumsy. The
 * templates that need punch get it from a thick OUTLINE, not a heavier font. Legacy
 * tokens (barlow/archivo/poppins) stay mapped so older saved/custom configs render.
 *
 * Verified family names (fontTools name id 1):
 *   Manrope-Medium.ttf            → "Manrope Medium"
 *   Montserrat-SemiBold.ttf       → "Montserrat SemiBold"
 *   SpaceGrotesk-Medium.ttf       → "Space Grotesk Medium"
 *   PlusJakartaSans-SemiBold.ttf  → "Plus Jakarta Sans SemiBold"
 *   Fraunces-SemiBold.ttf         → "Fraunces 144pt SemiBold"
 *   Anton-Regular.ttf             → "Anton"
 *   BebasNeue-Regular.ttf         → "Bebas Neue"
 *   Barlow-SemiBold.ttf           → "Barlow SemiBold"   (legacy; Windows name record)
 *   ArchivoBlack-Regular.ttf      → "Archivo Black"      (legacy)
 *   Poppins-SemiBold.ttf          → "Poppins SemiBold"   (legacy)
 */
export { HOOK_FONT_FAMILY } from "../builder/burnFonts";

/** token → bundled .ttf filename. Lets the clip DRAWTEXT path (lib/server/
 *  clipFilterGraph) point `fontfile=` directly at the template's font — the ASS
 *  path resolves by family name instead, but drawtext needs the file. */
export const HOOK_FONT_FILE: Record<string, string> = {
  manrope: "Manrope-Medium.ttf",
  montserrat: "Montserrat-SemiBold.ttf",
  space: "SpaceGrotesk-Medium.ttf",
  jakarta: "PlusJakartaSans-SemiBold.ttf",
  fraunces: "Fraunces-SemiBold.ttf",
  anton: "Anton-Regular.ttf",
  bebas: "BebasNeue-Regular.ttf",
  barlowcondensed: "BarlowCondensed-Bold.ttf",
  montserratblack: "Montserrat-BlackItalic.ttf",
  dmserif: "DMSerifDisplay-Regular.ttf",
  barlow: "Barlow-SemiBold.ttf",
  archivo: "ArchivoBlack-Regular.ttf",
  poppins: "Poppins-SemiBold.ttf",
};

// The fonts live under apps/web/assets/fonts. libass resolves them via
// `subtitles=...:fontsdir=<this>`. We can't rely on process.cwd() alone — under a
// Next standalone/serverless build the cwd is the bundle root, not apps/web — so
// resolve the FIRST candidate directory that actually exists: an explicit env
// override (set HOOK_FONTS_DIR in prod if the assets land elsewhere), then the
// common cwd layouts. If none exist, `hasHookFonts()` returns false and the burn
// falls back to libass's default font instead of pointing at a dead path.
let cached: string | undefined;
export function hookFontsDir(): string {
  if (cached !== undefined) return cached;
  const candidates = [
    process.env.HOOK_FONTS_DIR,                          // explicit prod override
    join(process.cwd(), "assets", "fonts"),             // cwd = apps/web (Railway)
    join(process.cwd(), "apps", "web", "assets", "fonts"), // cwd = monorepo root
  ].filter((d): d is string => typeof d === "string" && d.length > 0);
  // First existing dir wins; fall back to the primary cwd path so the value is
  // stable (hasHookFonts still reports false when it doesn't exist).
  cached = candidates.find((d) => existsSync(d)) ?? candidates[1] ?? join(process.cwd(), "assets", "fonts");
  return cached;
}

export function hasHookFonts(): boolean {
  return existsSync(hookFontsDir());
}

/** Absolute path to a template token's bundled .ttf, or undefined if the token is
 *  unknown or the file isn't present (caller falls back to the global clip font). */
export function hookFontFilePath(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const file = HOOK_FONT_FILE[token];
  if (!file) return undefined;
  const path = join(hookFontsDir(), file);
  return existsSync(path) ? path : undefined;
}
