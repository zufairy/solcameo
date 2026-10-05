import { existsSync } from "node:fs";

// Shared font resolver for every ffmpeg drawtext / ASS-subtitle burn (clip render
// AND influencer-video overlay burn). drawtext with NO explicit fontfile relies on
// fontconfig's default, which does NOT exist on a font-less / fontconfig-less host
// (many minimal Linux containers, ffmpeg-static) — there the burn HARD-FAILS, and a
// fail-safe caller then silently drops the caption/hook. Pinning an explicit font
// makes the burn work on any host. Set CLIP_FONT_PATH to override on prod.
let cachedFont: string | null | undefined;

export function resolveFontFile(): string | undefined {
  if (cachedFont !== undefined) return cachedFont ?? undefined;
  const candidates = [
    process.env.CLIP_FONT_PATH,
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  ].filter(Boolean) as string[];
  cachedFont = candidates.find((p) => existsSync(p)) ?? null;
  if (!cachedFont) console.warn("[videoFont] no font file found — drawtext relies on fontconfig default (may fail on a font-less host); set CLIP_FONT_PATH");
  return cachedFont ?? undefined;
}
