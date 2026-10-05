import type { CSSProperties } from "react";

/**
 * Viral Sticker (clip.sticker) box styles — the IG/TikTok story-style text
 * sticker (a short line in a solid colored box). Like hookDesigns, each style
 * co-locates the SERVER render params (mapped onto the drawtext box in
 * lib/server/clipFilterGraph) with a CSS `preview` for the inspector chip.
 */
export interface StickerStyleRender {
  fontColor: string;
  fontSize: number;
  /** Solid box behind the text (drawtext box=1:boxcolor). */
  boxColor: string;
  /** Optional thin outline. 0 = none (boxed stickers usually need none). */
  outlineColor?: string;
  outlineWidth?: number;
  allCaps?: boolean;
}

export interface StickerStyle {
  id: string;
  name: string;
  blurb: string;
  render: StickerStyleRender;
  preview: CSSProperties;
}

export const STICKER_STYLES: StickerStyle[] = [
  {
    id: "classic",
    name: "Classic",
    blurb: "White text on a solid black box — the IG/TikTok story look.",
    render: { fontColor: "#FFFFFF", fontSize: 46, boxColor: "#000000", outlineWidth: 0 },
    preview: { color: "#fff", fontWeight: 700, background: "#000", padding: "2px 7px", borderRadius: 4 },
  },
  {
    id: "spotlight",
    name: "Spotlight",
    blurb: "Black text on a bright white box — clean and bold.",
    render: { fontColor: "#101010", fontSize: 46, boxColor: "#FFFFFF", outlineWidth: 0 },
    preview: { color: "#101010", fontWeight: 800, background: "#fff", padding: "2px 7px", borderRadius: 4 },
  },
  {
    id: "hype",
    name: "Hype",
    blurb: "White CAPS on a hot-pink box — loud and trendy.",
    render: { fontColor: "#FFFFFF", fontSize: 46, boxColor: "#FF2D78", outlineWidth: 0, allCaps: true },
    preview: { color: "#fff", fontWeight: 800, textTransform: "uppercase", background: "#FF2D78", padding: "2px 7px", borderRadius: 4 },
  },
  {
    id: "money",
    name: "Money",
    blurb: "Dark CAPS on a mint-green box — $$$ / finance vibe.",
    render: { fontColor: "#06281f", fontSize: 46, boxColor: "#00E5A0", outlineWidth: 0, allCaps: true },
    preview: { color: "#06281f", fontWeight: 800, textTransform: "uppercase", background: "#00E5A0", padding: "2px 7px", borderRadius: 4 },
  },
];

export const STICKER_STYLE_BY_ID: Record<string, StickerStyle> = Object.fromEntries(
  STICKER_STYLES.map((s) => [s.id, s]),
);

export const DEFAULT_STICKER_STYLE_ID = "classic";
export const STICKER_POSITIONS = ["top", "center", "bottom"] as const;
export const DEFAULT_STICKER_POSITION = "top";

export const stickerStyleById = (id?: string): StickerStyle | undefined =>
  id ? STICKER_STYLE_BY_ID[id] : undefined;
export const isStickerStyleId = (id: unknown): id is string =>
  typeof id === "string" && id in STICKER_STYLE_BY_ID;
export const isStickerPosition = (p: unknown): p is "top" | "center" | "bottom" =>
  typeof p === "string" && (STICKER_POSITIONS as readonly string[]).includes(p);
