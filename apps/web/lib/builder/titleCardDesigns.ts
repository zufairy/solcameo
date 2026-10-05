import type { CSSProperties } from "react";

/**
 * Hook Title Card (clip.title) = NEWS-BROADCAST title slates. Distinct from Auto
 * Hook (clip.hook), which overlays a styled text line ON the playing video with a
 * prompt. A title card is a full-frame news-graphic slate concatenated in FRONT of
 * the clip: a coloured card with a "kicker" badge (BREAKING NEWS / LIVE / FLASH)
 * over a bold headline — the flash-news look. The operator picks a template; the
 * catalog floor + clipEditPlanner.applyTitleStyle burn the chosen look onto the
 * opening slate.
 *
 * `render` maps onto the title_card op: bgColor + fontColor + fontSize ride the
 * TextStyle; kicker/kickerColor/kickerTextColor + anim ride the op. `preview` is a
 * CSS approximation (erased at runtime) for the inspector chip — one source of
 * truth, no drift. Pure data so the catalog floor imports it with no server runtime.
 */
export type TitleAnimation = "none" | "fade" | "rise" | "typebar";

export interface TitleCardRender {
  /** Slate background colour (the card, ffmpeg color source). */
  bgColor: string;
  /** Headline text colour (drawtext fontcolor). */
  fontColor: string;
  /** Headline font size at 1080x1920. */
  fontSize: number;
  /** Render the headline in ALL CAPS. */
  allCaps: boolean;
  /** Entrance animation for the slate. */
  anim: TitleAnimation;
  /** How long the slate holds before the clip body plays (seconds). */
  durationSec: number;
  /** News "kicker" badge text (e.g. "BREAKING NEWS"). Empty = no badge. */
  kicker: string;
  /** Kicker badge box colour. */
  kickerColor: string;
  /** Kicker badge text colour. */
  kickerTextColor: string;
}

export interface TitleCardDesign {
  id: string;
  name: string;
  blurb: string;
  /** Best-fit headline vibe (default steer when the operator leaves the box empty). */
  vibe: string;
  render: TitleCardRender;
  /** Inspector chip CSS — approximates the burned-in headline look. */
  preview: CSSProperties;
}

export const TITLE_CARD_DESIGNS: TitleCardDesign[] = [
  {
    id: "breaking_news",
    name: "Breaking News",
    blurb: "Red BREAKING NEWS badge over a bold white headline on black — classic flash news.",
    vibe: "A shocking breaking-news headline.",
    render: { bgColor: "#0A0A0A", fontColor: "#FFFFFF", fontSize: 66, allCaps: true, anim: "rise", durationSec: 1.8, kicker: "BREAKING NEWS", kickerColor: "#C81E1E", kickerTextColor: "#FFFFFF" },
    preview: { color: "#fff", fontWeight: 900, textTransform: "uppercase", background: "#0a0a0a" },
  },
  {
    id: "flash_news",
    name: "Flash News",
    blurb: "Gold FLASH kicker on deep navy — urgent bulletin energy.",
    vibe: "An urgent one-line news flash.",
    render: { bgColor: "#0B1B3A", fontColor: "#FFFFFF", fontSize: 64, allCaps: true, anim: "rise", durationSec: 1.6, kicker: "⚡ FLASH", kickerColor: "#F5A300", kickerTextColor: "#0B1B3A" },
    preview: { color: "#fff", fontWeight: 800, textTransform: "uppercase", background: "#0b1b3a" },
  },
  {
    id: "live_update",
    name: "Live Update",
    blurb: "A pulsing ● LIVE badge over a clean headline — happening now.",
    vibe: "A live, happening-now update.",
    render: { bgColor: "#111318", fontColor: "#FFFFFF", fontSize: 62, allCaps: false, anim: "fade", durationSec: 1.6, kicker: "● LIVE", kickerColor: "#E11D48", kickerTextColor: "#FFFFFF" },
    preview: { color: "#fff", fontWeight: 800, background: "#111318" },
  },
  {
    id: "news_alert",
    name: "News Alert",
    blurb: "Amber ALERT kicker on near-black — a warning-style opener.",
    vibe: "A mistake-warning style alert (\"stop doing X\").",
    render: { bgColor: "#0A0A0A", fontColor: "#FFE600", fontSize: 66, allCaps: true, anim: "rise", durationSec: 1.7, kicker: "⚠ NEWS ALERT", kickerColor: "#F59E0B", kickerTextColor: "#0A0A0A" },
    preview: { color: "#FFE600", fontWeight: 900, textTransform: "uppercase", background: "#0a0a0a" },
  },
  {
    id: "world_report",
    name: "World Report",
    blurb: "A calm blue REPORT kicker on navy — premium, credible broadcast look.",
    vibe: "An authoritative report-style headline.",
    render: { bgColor: "#0E1A2B", fontColor: "#F5F5F5", fontSize: 58, allCaps: false, anim: "fade", durationSec: 2, kicker: "WORLD REPORT", kickerColor: "#2563EB", kickerTextColor: "#FFFFFF" },
    preview: { color: "#f5f5f5", fontWeight: 700, background: "#0e1a2b", letterSpacing: "0.01em" },
  },
  {
    id: "sports_center",
    name: "Sports Center",
    blurb: "Lime SPORTS kicker on charcoal — hype highlight-reel intro.",
    vibe: "A hype sports-highlight headline.",
    render: { bgColor: "#0B0B0B", fontColor: "#A3E635", fontSize: 68, allCaps: true, anim: "rise", durationSec: 1.5, kicker: "SPORTS", kickerColor: "#65A30D", kickerTextColor: "#0B0B0B" },
    preview: { color: "#A3E635", fontWeight: 900, textTransform: "uppercase", background: "#0b0b0b" },
  },
  {
    id: "tabloid",
    name: "Tabloid",
    blurb: "Magenta EXCLUSIVE kicker on white — loud front-page shout.",
    vibe: "A loud tabloid front-page headline.",
    render: { bgColor: "#FFFFFF", fontColor: "#111111", fontSize: 72, allCaps: true, anim: "fade", durationSec: 1.8, kicker: "EXCLUSIVE", kickerColor: "#DB2777", kickerTextColor: "#FFFFFF" },
    preview: { color: "#111", fontWeight: 900, textTransform: "uppercase", background: "#fff" },
  },
  {
    id: "newspaper",
    name: "Newspaper",
    blurb: "A TODAY masthead over a black headline on newsprint cream — old-print feel.",
    vibe: "A dramatic newspaper headline.",
    render: { bgColor: "#F4ECD8", fontColor: "#141414", fontSize: 60, allCaps: false, anim: "typebar", durationSec: 2, kicker: "TODAY", kickerColor: "#141414", kickerTextColor: "#F4ECD8" },
    preview: { color: "#141414", fontWeight: 800, background: "#f4ecd8", letterSpacing: "0.01em" },
  },
];

export const TITLE_CARD_BY_ID: Record<string, TitleCardDesign> = Object.fromEntries(
  TITLE_CARD_DESIGNS.map((d) => [d.id, d]),
);

export const DEFAULT_TITLE_CARD_ID = "breaking_news";
export const DEFAULT_TITLE_DURATION_SEC = 1.8;
// The title slate can hold 1–5s (the renderer clamps to this too). Wider than the
// hook window because a slate is a hard cut, not an overlay riding the footage.
export const TITLE_DURATION_MIN = 1;
export const TITLE_DURATION_MAX = 5;

export const titleCardById = (id?: string): TitleCardDesign | undefined =>
  id ? TITLE_CARD_BY_ID[id] : undefined;

export const isTitleCardId = (id: unknown): id is string =>
  typeof id === "string" && id in TITLE_CARD_BY_ID;

/** Old (pre-news-redesign) template ids → the nearest news template, so saved
 *  graphs and stored configs keep rendering after the redesign. */
const LEGACY_TITLE_ID: Record<string, string> = {
  bold_white: "breaking_news",
  impact_caps: "breaking_news",
  yellow_pop: "news_alert",
  lime_brand: "sports_center",
  spotlight: "world_report",
  clean_hold: "world_report",
};

/** Resolve any stored templateId (current, legacy, or missing) to a valid id. */
export function migrateTitleTemplateId(id?: string): string {
  if (id && TITLE_CARD_BY_ID[id]) return id;
  if (id && LEGACY_TITLE_ID[id]) return LEGACY_TITLE_ID[id];
  return DEFAULT_TITLE_CARD_ID;
}

/** Clamp + default a possibly-undefined inspector duration to the 1–5s window. */
export const clampTitleDuration = (v: unknown): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_TITLE_DURATION_SEC;
  return Math.min(TITLE_DURATION_MAX, Math.max(TITLE_DURATION_MIN, n));
};

/** Resolve a template id to its concrete render params (falls back to default). */
export function resolveTitleRender(designId?: string): TitleCardRender {
  return (titleCardById(designId) ?? TITLE_CARD_BY_ID[DEFAULT_TITLE_CARD_ID]).render;
}
