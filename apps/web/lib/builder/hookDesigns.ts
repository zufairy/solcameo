import type { CSSProperties } from "react";

/**
 * Auto Hook (clip.hook) design templates. The operator picks one in the node
 * inspector; the deterministic floor + the applyHookStyle pass burn the chosen
 * design onto the clip's opening hook overlay. Like caption presets, each
 * template co-locates the SERVER render params (`render`, mapped onto the
 * drawtext filter in lib/server/clipFilterGraph) with a CSS `preview` so the
 * inspector chip matches the burned-in look — one source of truth, no drift.
 *
 * Pure data + a CSS type (erased at runtime) so the floor in clipSkillsCatalog
 * can import it without pulling in any server runtime.
 */
/** Entrance/exit animation for the hook, rendered as ASS override tags by
 *  lib/server/hookRenderer. Each template picks a distinct one. */
export type HookAnimation = "pop" | "pop-overshoot" | "slide-down" | "fade" | "word-reveal";

/**
 * Motion for the editorial (boxed) hook layouts, burned by
 * lib/server/clipFilterGraph editorialHookFilters and mirrored in the CSS
 * previews. The LOOK (colours, fonts, layout) stays the template's own; this
 * only adds how it arrives and a light "shine" sweep that glides across the
 * box every `periodSec` for as long as the hook is on screen.
 *   wipe    — boxes grow in left→right, text fades up behind them
 *   stagger — line by line, alternating wipe direction
 *   drop    — text drops in from above
 *   rise    — text rises in from below
 */
export type HookEntrance = "wipe" | "stagger" | "drop" | "rise";
export interface HookMotion {
  entrance: HookEntrance;
  shine: { color: string; alpha: number; periodSec: number };
}

/** Every editorial hook treatment. The first five are drawn with boxes + text
 *  (clipFilterGraph drawbox/drawtext); the "fx" ones are drawn entirely by libass
 *  (lib/server/hookFxAss) because they need vector shapes, gradients, per-word
 *  fonts/colours and eased motion that drawbox can't do. */
export const HOOK_LAYOUTS = ["stacked", "news-card", "pov", "ticker", "plain", "banner-left", "banner-right", "cinematic", "poster", "modern-gradient"] as const;
export type HookLayout = (typeof HOOK_LAYOUTS)[number];
export type HookFxKind = "banner-left" | "banner-right" | "cinematic" | "poster" | "modern-gradient";
export const isHookLayout = (v: unknown): v is HookLayout => typeof v === "string" && (HOOK_LAYOUTS as readonly string[]).includes(v);
export const isHookFxLayout = (v: unknown): v is HookFxKind =>
  v === "banner-left" || v === "banner-right" || v === "cinematic" || v === "poster" || v === "modern-gradient";

export interface HookDesignRender {
  /** Bundled industry font token (see lib/server/hookFonts HOOK_FONT_FAMILY). */
  font: string;
  /** Entrance/exit animation. */
  animation: HookAnimation;
  /** Text colour (ASS PrimaryColour). */
  fontColor: string;
  /** Font size at 1080x1920. */
  fontSize: number;
  /** Vertical anchor of the hook line. */
  position: "top" | "center" | "bottom";
  /** Outline colour (ASS OutlineColour). */
  outlineColor: string;
  /** Outline width px (0 = no outline). */
  outlineWidth: number;
  /** Solid text box behind the line (ASS BorderStyle 3). Omit = no box. */
  boxColor?: string;
  /** Render the hook text in ALL CAPS. */
  allCaps?: boolean;
  /** Editorial block treatment, rendered as a separate background layer. */
  layout?: HookLayout;
  accentColor?: string;
  /** Entrance + shine for the boxed layouts (see HookMotion). */
  motion?: HookMotion;
}

export interface HookDesign {
  id: string;
  name: string;
  /** Short aesthetic-theme label shown as a chip in the picker (e.g. "Punchy"). */
  theme: string;
  blurb: string;
  render: HookDesignRender;
  /** Inspector chip CSS — approximates the burned-in look. */
  preview: CSSProperties;
}

/**
 * The hook-design library. Each entry is one aesthetic THEME the operator can pick.
 * Sizes are authored at the 1080×1920 reference (renderers scale down for shorter
 * canvases), and every template uses a DISTINCT bundled font so no two themes read
 * the same. The palette leans premium and quiet: readable sizes, slim outlines, a
 * couple of understated boxed styles — the loud stuff comes from the template's
 * accent colour, not from oversized type. `render` drives the burned overlay;
 * `preview` mirrors it for the chip — one source of truth, so what you pick is
 * what burns in.
 */
export const HOOK_DESIGNS: HookDesign[] = [
  {
    id: "bold_impact",
    name: "POV Headline", theme: "Perspective",
    blurb: "A direct point of view in bold white type on a dark editorial block.",
    render: { font: "barlowcondensed", animation: "fade", fontColor: "#FFFFFF", fontSize: 100, position: "top", outlineColor: "#000000", outlineWidth: 0, layout: "pov", boxColor: "#191919", allCaps: true, motion: { entrance: "wipe", shine: { color: "#FFFFFF", alpha: 0.22, periodSec: 3.2 } } },
    preview: { color: "#fff", background: "#191919", padding: "4px 9px" },
  },
  {
    id: "yellow_pop",
    name: "Quote Stack", theme: "Interview",
    blurb: "Condensed quotation text on alternating editorial color strips.",
    render: { font: "barlowcondensed", animation: "fade", fontColor: "#FFFFFF", fontSize: 104, position: "center", outlineColor: "#000000", outlineWidth: 0, layout: "stacked", boxColor: "#8B2521", accentColor: "#816847", allCaps: true, motion: { entrance: "stagger", shine: { color: "#FFE9C7", alpha: 0.2, periodSec: 3.6 } } },
    preview: { color: "#fff", background: "#8B2521", padding: "4px 9px" },
  },
  {
    id: "coral_punch",
    name: "Breaking News", theme: "Newsroom",
    blurb: "A strong white news panel with the final line in signal red.",
    render: { font: "montserrat", animation: "fade", fontColor: "#101010", fontSize: 78, position: "top", outlineColor: "#000000", outlineWidth: 0, layout: "news-card", boxColor: "#FFFFFF", accentColor: "#F11620", allCaps: true, motion: { entrance: "drop", shine: { color: "#C9D2E0", alpha: 0.55, periodSec: 3 } } },
    preview: { color: "#101010", background: "#fff", padding: "4px 9px", borderRadius: 12 },
  },
  {
    id: "mint_fresh",
    name: "Field Note", theme: "Documentary",
    blurb: "Quiet cream type inside a charcoal field note.",
    render: { font: "jakarta", animation: "fade", fontColor: "#F8F4E9", fontSize: 76, position: "bottom", outlineColor: "#000000", outlineWidth: 0, layout: "pov", boxColor: "#202923", motion: { entrance: "rise", shine: { color: "#F8F4E9", alpha: 0.14, periodSec: 4.5 } } },
    preview: { color: "#F8F4E9", background: "#202923", padding: "4px 9px" },
  },
  {
    id: "gold_luxe",
    name: "The Brief", theme: "Editorial",
    blurb: "A compact serif headline with a deep green information panel.",
    render: { font: "fraunces", animation: "fade", fontColor: "#FDFCF7", fontSize: 72, position: "center", outlineColor: "#000000", outlineWidth: 0, layout: "news-card", boxColor: "#173B35", accentColor: "#D5E969", motion: { entrance: "rise", shine: { color: "#D5E969", alpha: 0.2, periodSec: 3.4 } } },
    preview: { color: "#FDFCF7", background: "#173B35", padding: "4px 9px", borderRadius: 12 },
  },
  {
    id: "violet_card",
    name: "Local Report", theme: "Explainer",
    blurb: "Black headline in a rounded white card, with a red final line.",
    render: { font: "jakarta", animation: "fade", fontColor: "#111111", fontSize: 74, position: "top", outlineColor: "#000000", outlineWidth: 0, layout: "news-card", boxColor: "#FFFFFF", accentColor: "#E32127", allCaps: true, motion: { entrance: "drop", shine: { color: "#C9D2E0", alpha: 0.55, periodSec: 3.6 } } },
    preview: { color: "#111", background: "#fff", padding: "4px 9px", borderRadius: 12 },
  },
  {
    id: "clean_slide",
    name: "Front Page", theme: "Headline",
    blurb: "A clear white headline over a solid navy editorial bar.",
    render: { font: "barlowcondensed", animation: "fade", fontColor: "#FFFFFF", fontSize: 96, position: "top", outlineColor: "#000000", outlineWidth: 0, layout: "ticker", boxColor: "#163C58", allCaps: true, motion: { entrance: "wipe", shine: { color: "#FFFFFF", alpha: 0.25, periodSec: 2.6 } } },
    preview: { color: "#fff", background: "#163C58", padding: "4px 9px" },
  },
  {
    id: "black_box",
    name: "The Question", theme: "POV",
    blurb: "A focused question on an ink-black card.",
    render: { font: "manrope", animation: "fade", fontColor: "#FFFFFF", fontSize: 70, position: "center", outlineColor: "#000000", outlineWidth: 0, layout: "news-card", boxColor: "#101010", accentColor: "#F3D058", motion: { entrance: "stagger", shine: { color: "#F3D058", alpha: 0.18, periodSec: 3.8 } } },
    preview: { color: "#fff", background: "#101010", padding: "4px 9px", borderRadius: 12 },
  },
  // ── Animated entrance templates (drawn by libass, lib/server/hookFxAss) ──
  {
    id: "side_banner",
    name: "Side Banner", theme: "Broadcast",
    blurb: "A bold banner sweeps in from the left edge, then the headline slides onto it.",
    render: { font: "barlowcondensed", animation: "fade", fontColor: "#FFFFFF", fontSize: 96, position: "top", outlineColor: "#000000", outlineWidth: 0, layout: "banner-left", boxColor: "#E0262B", accentColor: "#FFD23F", allCaps: true, motion: { entrance: "wipe", shine: { color: "#FFFFFF", alpha: 0.32, periodSec: 3.2 } } },
    preview: { color: "#fff", background: "#E0262B", padding: "4px 9px" },
  },
  {
    id: "flash_banner",
    name: "Flash Banner", theme: "Hype",
    blurb: "A yellow flash banner cuts in from the right with ink-black type.",
    render: { font: "anton", animation: "fade", fontColor: "#0B0B0B", fontSize: 92, position: "center", outlineColor: "#000000", outlineWidth: 0, layout: "banner-right", boxColor: "#FFD60A", accentColor: "#0B0B0B", allCaps: true, motion: { entrance: "wipe", shine: { color: "#FFFFFF", alpha: 0.5, periodSec: 2.8 } } },
    preview: { color: "#0B0B0B", background: "#FFD60A", padding: "4px 9px" },
  },
  {
    id: "cinematic_rise",
    name: "Cinematic Rise", theme: "Film",
    blurb: "A dark gradient rises from the bottom and the headline focuses in over it.",
    render: { font: "montserratblack", animation: "fade", fontColor: "#FFFFFF", fontSize: 84, position: "bottom", outlineColor: "#000000", outlineWidth: 0, layout: "cinematic", boxColor: "#000000", accentColor: "#F5C451", motion: { entrance: "rise", shine: { color: "#FFF4D6", alpha: 0.4, periodSec: 3.6 } } },
    preview: { color: "#fff", background: "linear-gradient(0deg,#000 0%,rgba(0,0,0,0) 100%)", padding: "4px 9px" },
  },
  {
    id: "poster_type",
    name: "Poster Type", theme: "Typographic",
    blurb: "A poster of mixed fonts and colour layers: heavy italic keywords, serif connectors.",
    render: { font: "montserratblack", animation: "fade", fontColor: "#FFFFFF", fontSize: 230, position: "center", outlineColor: "#000000", outlineWidth: 0, layout: "poster", boxColor: "#F2C94C", accentColor: "#E0409B", motion: { entrance: "stagger", shine: { color: "#FFFFFF", alpha: 0.55, periodSec: 3.4 } } },
    preview: { color: "#fff", padding: "4px 9px" },
  },
  {
    id: "modern_gradient",
    name: "Modern Gradient", theme: "Cinematic",
    blurb: "A black scrim rises from the bottom to mid-screen with clean modern type resting in it — no box, just the video showing through.",
    render: { font: "space", animation: "fade", fontColor: "#FFFFFF", fontSize: 88, position: "bottom", outlineColor: "#000000", outlineWidth: 0, layout: "modern-gradient", boxColor: "#000000" },
    preview: { color: "#fff", background: "linear-gradient(0deg,#000 0%,rgba(0,0,0,0) 100%)", padding: "4px 9px" },
  },
];

export const HOOK_DESIGN_BY_ID: Record<string, HookDesign> = Object.fromEntries(
  HOOK_DESIGNS.map((d) => [d.id, d]),
);

/** Stable headline lines shared by the editor preview and ffmpeg renderer. */
export function hookHeadlineLines(text: string, fontSize: number, frameWidth: number, maxLines: number): string[] {
  const maxChars = Math.max(4, Math.floor(frameWidth / (fontSize * 0.58)));
  const lines: string[] = [];
  for (const paragraph of text.trim().split(/\r?\n/)) {
    let line = "";
    for (const originalWord of paragraph.split(/\s+/).filter(Boolean)) {
      let word = originalWord;
      while (word.length > maxChars) {
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (!word) continue;
      if (`${line} ${word}`.trim().length > maxChars && line) {
        lines.push(line);
        line = word;
      } else line = `${line} ${word}`.trim();
    }
    if (line) lines.push(line);
  }
  if (!lines.length) return [];
  if (lines.length <= maxLines) return lines;
  const result = lines.slice(0, maxLines);
  result[maxLines - 1] = `${result[maxLines - 1].slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  return result;
}

/** One rectangle of an editorial hook, in burn-canvas pixels. */
export interface HookRect { x: number; y: number; w: number; h: number; color: string }

/** Exact layout of an editorial hook block on a W×H canvas — the SINGLE source
 *  of truth for where the hook sits. lib/server/clipFilterGraph burns these
 *  rects/lines with drawbox/drawtext, and the Editor preview draws the very same
 *  rects scaled to its box, so a dragged hook burns exactly where it was dropped.
 *
 *  `fontSize` is the design size at the 1080×1920 reference (user size slider
 *  already applied); it's scaled to the canvas like every overlay font.
 *  `yPct` (0–100) is the block's vertical CENTRE; without it the position band
 *  decides. The block is clamped fully on-frame. */
export interface HookBlockLayout {
  size: number;
  lineHeight: number;
  padY: number;
  top: number;
  totalH: number;
  /** news-card background (rounded, radius px) — null for per-line layouts. */
  card: (HookRect & { radius: number }) | null;
  lines: { text: string; y: number; color: string; box: HookRect | null }[];
}

export function hookOverlayFontPx(fontSize: number, canvasH: number): number {
  const h = canvasH > 0 ? canvasH : 1920;
  return Math.round(fontSize * Math.max(0.5, Math.min(1.2, h / 1920)));
}

export function hookBlockLayout(args: {
  text: string;
  fontSize: number;
  layout: NonNullable<HookDesignRender["layout"]>;
  font?: string;
  fontColor: string;
  boxColor?: string;
  accentColor?: string;
  position: "top" | "center" | "bottom";
  yPct?: number;
  width: number;
  height: number;
}): HookBlockLayout | null {
  const { width, height, layout } = args;
  const size = hookOverlayFontPx(args.fontSize, height);
  const lines = hookHeadlineLines(args.text, size, width * 0.76, layout === "news-card" ? 3 : 4);
  if (!lines.length) return null;
  const lineHeight = Math.round(size * 1.16);
  const padX = Math.round(size * 0.32);
  const padY = Math.round(size * 0.22);
  const totalH = lines.length * lineHeight + 2 * padY;
  const centerY = typeof args.yPct === "number" && Number.isFinite(args.yPct)
    ? height * Math.min(100, Math.max(0, args.yPct)) / 100
    : args.position === "bottom" ? height * 0.86 : args.position === "center" ? height * 0.5 : height * 0.12;
  const top = Math.round(Math.min(Math.max(0, height - totalH), Math.max(0, centerY - totalH / 2)));
  const bg = args.boxColor ?? "#171717";
  const accent = args.accentColor ?? "#D42A2A";
  let card: HookBlockLayout["card"] = null;
  if (layout === "news-card") {
    const x = Math.round(width * 0.08);
    card = { x, y: top, w: width - 2 * x, h: totalH, color: bg, radius: Math.min(Math.round(size * 0.5), Math.round(totalH * 0.18)) };
  }
  const charW = args.font === "barlowcondensed" ? 0.47 : 0.58;
  return {
    size, lineHeight, padY, top, totalH, card,
    lines: lines.map((text, i) => {
      const y = top + padY + i * lineHeight;
      let box: HookRect | null = null;
      if (layout !== "news-card") {
        const w = Math.round(Math.min(width * 0.84, text.length * size * charW + 2 * padX));
        box = {
          x: Math.round((width - w) / 2), y: y - Math.round(padY * 0.45), w, h: lineHeight + Math.round(padY * 0.9),
          color: layout === "stacked" && i % 2 ? accent : bg,
        };
      }
      const color = layout === "news-card" && i === lines.length - 1 ? (args.accentColor ?? args.fontColor) : args.fontColor;
      return { text, y, color, box };
    }),
  };
}

/* ── Animated "fx" templates: shared geometry ───────────────────────────────
   One layout for the burn (lib/server/hookFxAss → libass) AND the editor/picker
   preview (components/builder/hook-fx-preview), like hookBlockLayout for the
   boxed designs. Horizontal text placement is left to the renderer (libass /
   the browser measure real glyphs and centre or edge-align the line); this pins
   every vertical position, the shapes and the per-word styling. */

/** Poster small-word font (the serif connectors in "Do what you LOVE"). */
export const POSTER_SMALL_FONT = "dmserif";
/** Connector words set small in serif on the Poster layout. */
const POSTER_SMALL_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "from", "by", "as",
  "is", "are", "was", "were", "be", "been", "am", "it", "its", "it's", "this", "that", "these", "those",
  "what", "you", "your", "you're", "we", "our", "i", "i'm", "my", "me", "he", "she", "they", "them", "his", "her",
  "will", "can", "just", "so", "if", "when", "how", "why", "who", "then", "than", "into", "about", "up", "out", "all", "do", "not",
]);

export interface HookFxToken { text: string; size: number; font: string; color: string; small: boolean }
export interface HookFxLine { y: number; h: number; tokens: HookFxToken[] }
export interface HookFxLayout {
  kind: HookFxKind;
  size: number;
  top: number;
  totalH: number;
  /** Horizontal extent of the block (for drag handles / clips). */
  x: number;
  w: number;
  /** Banner bar (flush with its screen edge) + its accent stripe on the leading edge. */
  bar: (HookRect & { stripe: HookRect }) | null;
  /** Text inset from the banner's screen edge. */
  textInset: number;
  /** Cinematic backdrop: a vertical gradient band, darkest at `dark` edge. */
  gradient: { y: number; h: number; dark: "top" | "bottom"; color: string; maxAlpha: number } | null;
  /** Cinematic accent underline, centred. */
  underline: HookRect | null;
  lines: HookFxLine[];
}

const FX_CHAR_W: Record<string, number> = { barlowcondensed: 0.5, anton: 0.5, bebas: 0.46, montserratblack: 0.68, dmserif: 0.5 };
const fxCharW = (font: string) => FX_CHAR_W[font] ?? 0.62;
const estW = (text: string, size: number, font: string) => text.length * size * fxCharW(font);

/** hookHeadlineLines, then narrowed as far as it can go without adding a line,
 *  so the rows come out even ("THIS CHANGED / EVERYTHING FOR ME", never a lone
 *  "ME" on the last row). */
function balancedLines(text: string, size: number, maxW: number, maxLines: number): string[] {
  const base = hookHeadlineLines(text, size, maxW, maxLines);
  if (base.length < 2) return base;
  let best = base;
  for (let w = maxW * 0.95; w >= maxW * 0.45; w -= maxW * 0.05) {
    const l = hookHeadlineLines(text, size, w, maxLines);
    if (l.length !== base.length || l.some((x) => x.endsWith("…"))) break;
    best = l;
  }
  return best;
}

export function hookFxLayout(args: {
  text: string;
  kind: HookFxKind;
  fontSize: number;
  font: string;
  fontColor: string;
  boxColor?: string;
  accentColor?: string;
  position: "top" | "center" | "bottom";
  yPct?: number;
  width: number;
  height: number;
}): HookFxLayout | null {
  const { width, height, kind, font } = args;
  const size = hookOverlayFontPx(args.fontSize, height);
  const centreFor = (totalH: number) => {
    const centerY = typeof args.yPct === "number" && Number.isFinite(args.yPct)
      ? height * Math.min(100, Math.max(0, args.yPct)) / 100
      : args.position === "bottom" ? height * 0.8 : args.position === "center" ? height * 0.5 : height * 0.14;
    return Math.round(Math.min(Math.max(0, height - totalH), Math.max(0, centerY - totalH / 2)));
  };
  const accent = args.accentColor ?? "#FFD23F";

  if (kind === "banner-left" || kind === "banner-right") {
    const inset = Math.round(width * 0.06);
    const lines = balancedLines(args.text, size, width * 0.8, 3);
    if (!lines.length) return null;
    const lineH = Math.round(size * 1.08);
    const padY = Math.round(size * 0.26);
    const totalH = lines.length * lineH + 2 * padY;
    const top = centreFor(totalH);
    const stripeW = Math.max(6, Math.round(size * 0.16));
    const textW = Math.max(...lines.map((l) => estW(l, size, font)));
    const barW = Math.round(Math.min(width * 0.96, inset + textW + size * 0.7 + stripeW));
    const left = kind === "banner-left";
    const barX = left ? 0 : width - barW;
    const stripe = { x: left ? barX + barW - stripeW : barX, y: top, w: stripeW, h: totalH, color: accent };
    return {
      kind, size, top, totalH, x: barX, w: barW, textInset: inset,
      bar: { x: barX, y: top, w: barW, h: totalH, color: args.boxColor ?? "#E0262B", stripe },
      gradient: null, underline: null,
      lines: lines.map((t, i) => ({ y: top + padY + i * lineH, h: lineH, tokens: [{ text: t, size, font, color: args.fontColor, small: false }] })),
    };
  }

  if (kind === "cinematic") {
    const lines = balancedLines(args.text, size, width * 0.8, 3);
    if (!lines.length) return null;
    const lineH = Math.round(size * 1.12);
    const ulGap = Math.round(size * 0.3);
    const ulH = Math.max(4, Math.round(size * 0.08));
    const totalH = lines.length * lineH + ulGap + ulH;
    const top = centreFor(totalH);
    const blockMid = top + totalH / 2;
    const dark: "top" | "bottom" = blockMid >= height * 0.45 ? "bottom" : "top";
    const reach = Math.round(size * 2.2);
    const gy = dark === "bottom" ? Math.max(0, top - reach) : 0;
    const gh = dark === "bottom" ? height - gy : Math.min(height, top + totalH + reach);
    const ulW = Math.round(size * 1.7);
    return {
      kind, size, top, totalH, x: Math.round(width * 0.08), w: Math.round(width * 0.84), textInset: 0,
      bar: null,
      gradient: { y: gy, h: gh, dark, color: args.boxColor ?? "#000000", maxAlpha: 0.86 },
      underline: { x: Math.round((width - ulW) / 2), y: top + lines.length * lineH + ulGap, w: ulW, h: ulH, color: accent },
      lines: lines.map((t, i) => ({ y: top + i * lineH, h: lineH, tokens: [{ text: t, size, font, color: args.fontColor, small: false }] })),
    };
  }

  if (kind === "modern-gradient") {
    // Fixed bottom-half darken — mid-screen (0%) to the bottom edge (100% black),
    // independent of the text block (unlike "cinematic", whose gradient reach
    // tracks the text). Reads as a permanent letterbox scrim the text sits inside,
    // so it blends with whatever's playing above it instead of fighting it.
    const lines = balancedLines(args.text, size, width * 0.82, 3);
    if (!lines.length) return null;
    const lineH = Math.round(size * 1.16);
    const totalH = lines.length * lineH;
    const top = centreFor(totalH);
    const bandH = Math.round(height * 0.5);
    const bandY = height - bandH;
    return {
      kind, size, top, totalH, x: Math.round(width * 0.08), w: Math.round(width * 0.84), textInset: 0,
      bar: null,
      gradient: { y: bandY, h: bandH, dark: "bottom", color: args.boxColor ?? "#000000", maxAlpha: 1 },
      underline: null,
      lines: lines.map((t, i) => ({ y: top + i * lineH, h: lineH, tokens: [{ text: t, size, font, color: args.fontColor, small: false }] })),
    };
  }

  // Poster: heavy italic keywords cycling through the palette, small serif
  // connectors. Grouping (as in a hand-set type poster, e.g. "Do / what you /
  // LOVE / and the REST will / COME"):
  //   - the first word is always a keyword; every keyword gets its own row;
  //   - a single connector trails the keyword before it;
  //   - a connector run of 2+ alternates: its own row, then leading the next keyword.
  const words = args.text.trim().split(/\s+/).filter(Boolean).slice(0, 14);
  if (!words.length) return null;
  const palette = [args.fontColor, args.accentColor ?? "#E0409B", args.boxColor ?? "#F2C94C"];
  const isSmallWord = (w: string, i: number) => i > 0 && POSTER_SMALL_WORDS.has(w.toLowerCase().replace(/[^a-z']/g, ""));
  let smallFlags = words.map((w, i) => isSmallWord(w, i));
  // All-connector text ("what you do") still needs keywords to anchor it.
  if (smallFlags.every((f, i) => f || i === 0) && words.length > 2) smallFlags = words.map((_, i) => i % 2 === 1);
  const maxW = width * 0.86;
  for (let scale = 1; scale >= 0.4; scale -= 0.08) {
    const big = Math.round(size * scale);
    const small = Math.round(big * 0.4);
    let colorIdx = 0;
    const toks: HookFxToken[] = words.map((w, i) => smallFlags[i]
      ? { text: w.toLowerCase(), size: small, font: POSTER_SMALL_FONT, color: args.fontColor, small: true }
      : { text: w.toLowerCase(), size: big, font, color: palette[colorIdx++ % palette.length], small: false });
    const rows: HookFxToken[][] = [];
    let runIdx = 0;
    for (let i = 0; i < toks.length;) {
      const t = toks[i];
      if (!t.small) { rows.push([t]); i++; continue; }
      const run: HookFxToken[] = [];
      while (i < toks.length && toks[i].small) run.push(toks[i++]);
      const prev = rows[rows.length - 1];
      const next = toks[i];
      if (run.length === 1 && prev) prev.push(...run);
      else if (runIdx++ % 2 === 1 && next) { rows.push([...run, next]); i++; }
      else rows.push(run);
    }
    const rowW = (r: HookFxToken[]) => r.reduce((n, t, j) => n + estW(t.text, t.size, t.font) + (j ? Math.max(t.size, r[j - 1].size) * 0.2 : 0), 0);
    if (rows.some((r) => rowW(r) > maxW) && scale > 0.45) continue;
    // Keywords stack tight like set type; connector-only rows get a little air.
    const heights = rows.map((r) => Math.round(r.some((t) => !t.small) ? big * 0.96 : small * 1.3));
    const totalH = heights.reduce((a, b) => a + b, 0);
    const top = centreFor(totalH);
    let y = top;
    const lines = rows.map((tokens, i) => { const l = { y, h: heights[i], tokens }; y += heights[i]; return l; });
    return { kind, size: big, top, totalH, x: Math.round(width * 0.07), w: Math.round(width * 0.86), textInset: 0, bar: null, gradient: null, underline: null, lines };
  }
  return null;
}

export const DEFAULT_HOOK_DESIGN_ID = "bold_impact";
export const DEFAULT_HOOK_DURATION_SEC = 5;
// The hook now shows for a tight 3–6s window (dropdown). Clamp defensively — a
// legacy/influencer value outside the range is pulled in, never rejected.
export const HOOK_DURATION_MIN = 3;
export const HOOK_DURATION_MAX = 6;
/** "Always on": the hook stays up for the whole clip. Encoded as an end time
 *  past any clip length, so every renderer's between(t,start,end) window simply
 *  never closes (and the exit fade never starts). */
export const HOOK_ALWAYS_ON_END_SEC = 3600;
/** The duration choices offered in the inspector dropdown. */
export const HOOK_DURATION_CHOICES = [3, 4, 5, 6] as const;

export const hookDesignById = (id?: string): HookDesign | undefined =>
  id ? HOOK_DESIGN_BY_ID[id] : undefined;

export const isHookDesignId = (id: unknown): id is string =>
  typeof id === "string" && id in HOOK_DESIGN_BY_ID;

/** Old (pre-redesign) template ids → the nearest new template, so saved graphs
 *  and stored influencer configs keep rendering after the redesign. */
const LEGACY_HOOK_ID: Record<string, string> = {
  bold_white: "bold_impact",
  clean: "clean_slide",
  minimal: "clean_slide",
  yellow_pop: "yellow_pop",
  black_box: "black_box",
  red_alert: "coral_punch",
  // "word_reveal" was renamed to "gold_luxe" (same tall word-by-word reveal, now gold).
  word_reveal: "gold_luxe",
  mint: "mint_fresh",
};

/** Resolve any stored templateId (current, legacy, or missing) to a valid current id. */
export function migrateHookTemplateId(id?: string): string {
  if (id && HOOK_DESIGN_BY_ID[id]) return id;
  if (id && LEGACY_HOOK_ID[id]) return LEGACY_HOOK_ID[id];
  return DEFAULT_HOOK_DESIGN_ID;
}

/** Clamp + default a possibly-undefined inspector duration to the 3–6s window. */
export const clampHookDuration = (v: unknown): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : DEFAULT_HOOK_DURATION_SEC;
  return Math.max(HOOK_DURATION_MIN, Math.min(HOOK_DURATION_MAX, n));
};

/** Operator-built hook look (clip.hook "Custom" form). A partial override the
 *  inspector edits; merged over a base design server-side so unset fields keep
 *  sane defaults. */
export interface CustomHookDesign {
  font?: string;
  animation?: HookAnimation;
  fontColor?: string;
  fontSize?: number;
  position?: "top" | "center" | "bottom";
  /** Exact vertical position, 0–100 = % of canvas height from the top. When set
   *  it overrides the `position` band at burn time (text_overlay.yPct); the band
   *  is still stored as the fallback anchor. Set by the inspector's Position
   *  slider / the editor's drag-to-position. */
  yPct?: number;
  /** "" / null = no box; a hex = solid box behind the text. */
  boxColor?: string | null;
  allCaps?: boolean;
}

/** Clamp a raw yPct into [0,100]; non-finite → undefined (band anchor only). */
export function clampHookYPct(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : undefined;
}

/** Concrete payload the overlay-burn route needs to draw the hook: resolved
 *  design render params + the final (caps-applied) text + on-screen seconds. */
export interface HookBurnPayload {
  text: string;
  font: string;
  animation: HookAnimation;
  position: "top" | "center" | "bottom";
  fontColor: string;
  fontSize: number;
  outlineColor: string;
  outlineWidth: number;
  boxColor?: string;
  hookLayout?: HookDesignRender["layout"];
  hookAccentColor?: string;
  hookMotion?: HookMotion;
  durationSeconds: number;
  /** Hold the hook for the whole video instead of `durationSeconds`. */
  alwaysOn?: boolean;
  /** Exact vertical position (0–100 % from the top) from the saved style —
   *  overlay-burn prefers it over the `position` band when set. */
  yPct?: number;
}

/** Saved videoConfig.hookText shape (loose — the caller passes the persisted
 *  object, which may predate the templateId/duration fields). */
export interface SavedHookText {
  source?: string;
  text?: string;
  templateId?: string;
  durationSeconds?: number;
  /** Operator ticked "Always on" — hook stays until the end of the video. */
  alwaysOn?: boolean;
  style?: { fontColor?: string; fontSize?: number; position?: string; yPct?: number } | null;
}

/**
 * Resolve a saved `videoConfig.hookText` + the per-video fallback hook (the
 * script's generated hook line) into the exact overlay-burn payload — the chosen
 * hook DESIGN's colors/outline/box/caps/position plus the clamped on-screen
 * duration. `source:"custom"` uses the operator's stored `text` (usually
 * Kie-generated from their prompt); anything else uses the per-video script hook.
 * Returns null when there is no non-empty hook to burn. Shared by both render
 * paths (render-step route + videoJobs action) so the burn is identical.
 */
export function resolveHookBurnPayload(
  hook: SavedHookText | undefined,
  fallbackHook: string | undefined,
): HookBurnPayload | null {
  const raw = (hook?.source === "custom" ? (hook?.text ?? fallbackHook) : fallbackHook) ?? "";
  const text = raw.trim();
  if (!text) return null;
  const design = HOOK_DESIGN_BY_ID[migrateHookTemplateId(hook?.templateId)];
  const r = design.render;
  // The saved style's explicit size / exact position (the operator's slider +
  // drag choices, persisted as their hook template) win over the design defaults.
  const styleSize = typeof hook?.style?.fontSize === "number" && Number.isFinite(hook.style.fontSize)
    ? hook.style.fontSize : undefined;
  const yPct = clampHookYPct(hook?.style?.yPct);
  return {
    text: r.allCaps ? text.toUpperCase() : text,
    font: r.font,
    animation: r.animation,
    position: r.position,
    fontColor: r.fontColor,
    fontSize: styleSize ?? r.fontSize,
    outlineColor: r.outlineColor,
    outlineWidth: r.outlineWidth,
    boxColor: r.boxColor,
    hookLayout: r.layout,
    hookAccentColor: r.accentColor,
    ...(r.motion ? { hookMotion: r.motion } : {}),
    durationSeconds: hook?.alwaysOn ? HOOK_ALWAYS_ON_END_SEC : clampHookDuration(hook?.durationSeconds),
    ...(hook?.alwaysOn ? { alwaysOn: true } : {}),
    ...(yPct !== undefined ? { yPct } : {}),
  };
}

/** Final render params for the hook: a named design, optionally overridden by the
 *  operator's custom fields (only the fields they set win; the rest keep the base). */
export function resolveHookRender(designId?: string, custom?: CustomHookDesign | null): HookDesignRender {
  // Migrate legacy / renamed ids (e.g. "word_reveal" → "gold_luxe") so stored graphs
  // and influencer configs keep resolving to the right design after a redesign.
  const base = HOOK_DESIGN_BY_ID[migrateHookTemplateId(designId)] ?? HOOK_DESIGNS[0];
  if (!custom) return base.render;
  return {
    ...base.render,
    ...(custom.font ? { font: custom.font } : {}),
    ...(custom.animation ? { animation: custom.animation } : {}),
    ...(custom.fontColor ? { fontColor: custom.fontColor } : {}),
    ...(typeof custom.fontSize === "number" ? { fontSize: custom.fontSize } : {}),
    ...(custom.position ? { position: custom.position } : {}),
    ...(custom.boxColor !== undefined ? { boxColor: custom.boxColor || undefined } : {}),
    ...(typeof custom.allCaps === "boolean" ? { allCaps: custom.allCaps } : {}),
  };
}
