import type { CSSProperties } from "react";

/**
 * Video Filters (clip.filters) preset chips. The operator picks one in the node
 * inspector; the chosen preset is mapped server-side onto the FILTER_PRESETS
 * ffmpeg graph in lib/server/clipFilterGraph and burned into the clip.
 *
 * Each chip carries a CSS `filter` that APPROXIMATES the burned-in look (sepia /
 * saturate / hue-rotate / grayscale / contrast) so the inspector swatch matches
 * the render — the same idea as the Auto Hook design chips, where the chip
 * preview mirrors the drawtext params. The real burned-in look is a full graded
 * chain (curves/colorbalance + contrast + sharpen + vignette/grain where it
 * fits the look) — CSS can't replicate unsharp/vignette/grain exactly, so these
 * are a best-effort preview, not a pixel match.
 */
export interface FilterChip {
  id: "" | "vintage" | "warm" | "cool" | "bw" | "vivid" | "cinematic" | "hd" | "superhd" | "moody" | "filmic" | "matte";
  label: string;
  /** Inspector swatch CSS — approximates the burned-in look. */
  css: CSSProperties;
}

/** All real (non-"None") preset ids — mirrors the keys of FILTER_PRESETS server-side. */
export const FILTER_PRESET_IDS = ["vintage", "warm", "cool", "bw", "vivid", "cinematic", "hd", "superhd", "moody", "filmic", "matte"] as const;

export const FILTER_CHIPS: FilterChip[] = [
  { id: "", label: "None", css: { filter: "none" } },
  {
    id: "vintage",
    label: "Vintage",
    css: { filter: "sepia(0.45) contrast(1.05) saturate(0.85) brightness(1.02)" },
  },
  {
    id: "warm",
    label: "Warm",
    css: { filter: "sepia(0.30) saturate(1.25) hue-rotate(-12deg) brightness(1.03) contrast(1.08)" },
  },
  {
    id: "cool",
    label: "Cool",
    css: { filter: "saturate(1.15) hue-rotate(14deg) brightness(1.0) contrast(1.08)" },
  },
  { id: "bw", label: "B&W", css: { filter: "grayscale(1) contrast(1.2) brightness(1.02)" } },
  { id: "vivid", label: "Vivid", css: { filter: "saturate(1.6) contrast(1.12)" } },
  {
    id: "cinematic",
    label: "Cinematic",
    css: { filter: "saturate(1.08) contrast(1.14) sepia(0.12) hue-rotate(-6deg) brightness(0.98)" },
  },
  {
    id: "hd",
    label: "HD Clarity",
    css: { filter: "contrast(1.1) saturate(1.08) brightness(1.01)" },
  },
  {
    id: "superhd",
    label: "Super HD",
    css: { filter: "contrast(1.12) saturate(1.15) brightness(1.01)" },
  },
  {
    id: "moody",
    label: "Moody",
    css: { filter: "saturate(0.85) contrast(1.12) brightness(0.92) hue-rotate(6deg)" },
  },
  {
    id: "filmic",
    label: "Filmic",
    css: { filter: "saturate(0.95) contrast(1.05) brightness(1.0)" },
  },
  {
    id: "matte",
    label: "Matte",
    css: { filter: "saturate(0.88) contrast(0.94) brightness(1.04)" },
  },
];
