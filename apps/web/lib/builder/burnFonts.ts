/**
 * Single source of truth for every font the ffmpeg/libass burn can use — and,
 * because the browser preview loads the SAME .ttf files under the SAME family
 * names (burnFontFaceCss + app/api/fonts/burn/[file]), what the editor preview
 * shows is the exact glyph set the export burns.
 *
 * `family` MUST equal the file's name-table family (fontTools name id 1) —
 * libass matches the ASS `Fontname` against it, and anything else silently
 * falls back to a system font (Helvetica on macOS, DejaVu on the prod image).
 * (libass reads the WINDOWS name record, platform 3 — fontTools getDebugName can
 * show the Mac record instead, e.g. Barlow-SemiBold is "Barlow" on Mac but
 * "Barlow SemiBold" on Windows.) Verify a new file with:
 *   python3 -c "from fontTools.ttLib import TTFont; n=TTFont('X.ttf')['name']; print(n.getName(1,3,1,0x409))"
 *
 * Client-safe (no node imports) — lib/server/hookFonts re-exports the hook map.
 */
export const BURN_FONTS = [
  { family: "Anton", file: "Anton-Regular.ttf" },
  { family: "Archivo Black", file: "ArchivoBlack-Regular.ttf" },
  { family: "Barlow SemiBold", file: "Barlow-SemiBold.ttf" },
  { family: "Barlow Condensed", file: "BarlowCondensed-Bold.ttf" },
  { family: "Bebas Neue", file: "BebasNeue-Regular.ttf" },
  { family: "Fira Sans", file: "FiraSans-Bold.ttf" },
  { family: "Fraunces 144pt SemiBold", file: "Fraunces-SemiBold.ttf" },
  { family: "Gelasio", file: "Gelasio-Bold.ttf" },
  { family: "Inter ExtraBold", file: "Inter-ExtraBold.ttf" },
  { family: "Jost ExtraBold", file: "Jost-ExtraBold.ttf" },
  { family: "Manrope ExtraBold", file: "Manrope-ExtraBold.ttf" },
  { family: "Manrope Medium", file: "Manrope-Medium.ttf" },
  { family: "Montserrat ExtraBold", file: "Montserrat-ExtraBold.ttf" },
  { family: "Montserrat Black", file: "Montserrat-BlackItalic.ttf" },
  { family: "DM Serif Display", file: "DMSerifDisplay-Regular.ttf" },
  { family: "Montserrat SemiBold", file: "Montserrat-SemiBold.ttf" },
  { family: "Nunito Black", file: "Nunito-Black.ttf" },
  { family: "Plus Jakarta Sans ExtraBold", file: "PlusJakartaSans-ExtraBold.ttf" },
  { family: "Plus Jakarta Sans SemiBold", file: "PlusJakartaSans-SemiBold.ttf" },
  { family: "Poppins Black", file: "Poppins-Black.ttf" },
  { family: "Poppins SemiBold", file: "Poppins-SemiBold.ttf" },
  { family: "Quicksand", file: "Quicksand-Bold.ttf" },
  { family: "Satisfy", file: "Satisfy-Regular.ttf" },
  { family: "Space Grotesk Medium", file: "SpaceGrotesk-Medium.ttf" },
] as const;

export type BurnFontFamily = (typeof BURN_FONTS)[number]["family"];

export const BURN_FONT_FAMILIES: ReadonlySet<string> = new Set(BURN_FONTS.map((f) => f.family));
export const BURN_FONT_FILES: ReadonlySet<string> = new Set(BURN_FONTS.map((f) => f.file));

/** Hook-template font TOKEN → bundled family (what renderHookAss writes as Fontname). */
export const HOOK_FONT_FAMILY: Record<string, BurnFontFamily> = {
  // Modern readable set (drives the current themes).
  manrope: "Manrope Medium",
  montserrat: "Montserrat SemiBold",
  space: "Space Grotesk Medium",
  jakarta: "Plus Jakarta Sans SemiBold",
  fraunces: "Fraunces 144pt SemiBold",
  anton: "Anton",
  bebas: "Bebas Neue",
  barlowcondensed: "Barlow Condensed",
  // Poster / Cinematic: heavy italic keyword face + serif connector face.
  montserratblack: "Montserrat Black",
  dmserif: "DM Serif Display",
  // Legacy tokens — kept so older saved graphs / influencer configs still resolve.
  barlow: "Barlow SemiBold",
  archivo: "Archivo Black",
  poppins: "Poppins SemiBold",
};

/** libass sizes text by the font's Windows ascent+descent (OS/2 usWinAscent +
 *  usWinDescent), not by its em square like drawtext and CSS do. unitsPerEm ÷
 *  (winAscent + winDescent) per bundled family, measured with fontTools; divide
 *  a CSS/drawtext px size by it to get the ASS `\fs` that renders the same glyphs. */
export const LIBASS_EM_RATIO: Partial<Record<BurnFontFamily, number>> = {
  "Anton": 0.577, "Archivo Black": 0.742, "Barlow SemiBold": 0.735, "Barlow Condensed": 0.741,
  "Bebas Neue": 0.769, "DM Serif Display": 0.729, "Fira Sans": 0.833, "Fraunces 144pt SemiBold": 0.678,
  "Gelasio": 0.602, "Inter ExtraBold": 0.699, "Jost ExtraBold": 0.692, "Manrope ExtraBold": 0.732,
  "Manrope Medium": 0.732, "Montserrat Black": 0.64, "Montserrat ExtraBold": 0.64, "Montserrat SemiBold": 0.64,
  "Nunito Black": 0.726, "Plus Jakarta Sans ExtraBold": 0.605, "Plus Jakarta Sans SemiBold": 0.605,
  "Poppins Black": 0.568, "Poppins SemiBold": 0.568, "Quicksand": 0.673, "Satisfy": 0.702, "Space Grotesk Medium": 0.693,
};
/** ASS `\fs` for a family so libass draws the same em size as `px` in CSS/drawtext. */
export const libassFontSize = (family: string, px: number): number =>
  Math.round(px / (LIBASS_EM_RATIO[family as BurnFontFamily] ?? 0.7));

/** Public URL the browser loads a bundled font from. */
export const burnFontUrl = (file: string) => `/api/fonts/burn/${encodeURIComponent(file)}`;

/** @font-face rules registering every bundled file under its exact burn family
 *  name, weight-normal (the weight IS the file — same as libass with Bold=0). */
export function burnFontFaceCss(): string {
  return BURN_FONTS.map((f) =>
    `@font-face{font-family:"${f.family}";src:url("${burnFontUrl(f.file)}") format("truetype");font-weight:400;font-style:normal;font-display:swap;}`,
  ).join("\n");
}

/** CSS font-family stack for a burn family name — the bundled face first, a
 *  generic fallback only while it loads. */
export function burnFontStack(family: string | undefined): string {
  if (!family) return "system-ui, sans-serif";
  const generic = /Fraunces|Gelasio|DM Serif/.test(family) ? "serif" : family === "Satisfy" ? "cursive" : "sans-serif";
  return `"${family}", ${generic}`;
}
