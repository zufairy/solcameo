/**
 * theme.ts — single source of truth for the Vello promo's visual language.
 *
 * Quality bar: swapping these colors into a generic template should NOT produce
 * this film. The look is specifically Vello — one neon world, glowing, fast.
 */

/* ── Palette ──────────────────────────────────────────────────────────────
 * Near-black violet world. Violet is the hero, lime + emerald are energy. */
export const COLORS = {
  bg: "#0B0B12", // near-black background (brand)
  bg2: "#0E0E18", // raised surface
  bgGlow: "#14101F", // violet-tinted lift behind hero content
  card: "#16161F", // glass card fill
  cardHi: "#1C1B27", // lighter glass card
  border: "#2A2A3A", // hairline borders
  borderHi: "#3A3650", // emphasized borders

  white: "#F5F5FA",
  text: "#FFFFFF",
  sub: "#9A9AAE", // secondary text
  faint: "#62627A", // tertiary / labels

  violet: "#8B5CF6", // brand violet — the hero accent
  violetDeep: "#6D44E0",
  violetSoft: "#A78BFA",
  lime: "#A3E635", // energy / CTA
  emerald: "#10B981", // money / on-chain
  emeraldSoft: "#34D399",
  pink: "#EC4899", // 4th agent flavor
  cyan: "#22D3EE", // accent pops
  amber: "#F59E0B",
} as const;

/* Platform brand tints for the staggered logo row */
export const PLATFORMS = {
  tiktok: "#25F4EE",
  instagram: "#E1306C",
  x: "#FFFFFF",
  youtube: "#FF0000",
} as const;

/* ── Timing ──────────────────────────────────────────────────────────────
 * 60fps master for buttery motion. */
export const FPS = 60;

/** Spring config — confident, no bounce by default. */
export const SPRING = { damping: 200, mass: 1, stiffness: 120 } as const;
/** Snappier spring for entrances that should pop. */
export const SPRING_POP = { damping: 26, mass: 0.9, stiffness: 220 } as const;

/** Clamp helper for every interpolate() call. */
export const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/* ── Type scale ──────────────────────────────────────────────────────────
 * Heavy geometric display, mono for technical/label texture. Sizes are
 * authored for the 1080-min-dimension grid (see useUnit()). */
export const FONT_WEIGHTS = {
  black: 800,
  bold: 700,
  semibold: 600,
  medium: 500,
} as const;

/* Reusable glow recipes — keep glows consistent across scenes. */
export const glow = (color: string, blur = 60, alpha = "66") =>
  `0 0 ${blur}px ${color}${alpha}`;

export const textGlow = (color: string, blur = 50) =>
  `0 0 ${blur}px ${color}55, 0 2px 24px rgba(0,0,0,0.55)`;
