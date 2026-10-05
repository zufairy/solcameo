/* ════════ Share on X — animated clip-triptych card renderer ════════
   Renders the 1200×675 share card and encodes the loop to an animated GIF.
   The static PNG (renderShareCard) is one settled frame of the same loop, so
   the in-app preview, the /dev/x-cards lab and the posted media are one design.

   Five tiers, five compositions — each its own layout AND look. The data card
   (name, pixel-matrix view counter, next-tier bar, stats) always has the
   agent's best clip playing behind it as pixel video; the other recent clips
   are arranged around it:
     MEMBER    triptych  clip · data · clip          10px mono, dot grid
     SILVER    deck      3D stack · data · clip       8px cool duotone, double frame
     GOLD      the VELLO MEMBERSHIP physical card as a three-card hand — MEMBER
               and SILVER fanned behind the gold card — xShareDesigns/membershipCard
     PLATINUM  the first VELLO MEMBERSHIP physical card with its original
               animation — xShareDesigns/membershipCard
     BLACK     the premium VELLO BLACK card: black + gold foil, crest rings,
               sweeping foil sheen — xShareDesigns/blackCard

   Cost model (why this is cheap): satori lays out the text ONCE per card.
   Everything static is baked into a handful of raw base frames with sharp
   (one per middle-video frame, plus two coarse "resolve" levels). Each GIF
   frame is then a raw base + a tiny rect-only SVG (counter, bar, scanline),
   and the whole loop is encoded in one go from a raw strip. Stats come from
   Convex, never the client, so a card can't claim views an agent lacks. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import satori from "satori";
import sharp from "sharp";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getProfile, isConfigured, resolveUsername } from "@/lib/server/uploadPost";
import { pixelizeLogo, sprite, type Sprite } from "@/lib/server/pixelLogo";
import { solanaPixels, SOLANA_COLS } from "@/lib/server/solanaPixels";
import {
  CARD_H as H, CARD_W as W, SHARE_FRAMES, SHARE_FRAME_MS, compactNumber, nextTierFor, pickVariant, rng, tierFor,
  type ShareMaterial, type ShareStats, type ShareTier,
} from "@/lib/share/xShareCard";

/** One real recent clip: a few frames (the middle card plays them) + its views. */
export interface ShareClip { frames: Buffer[]; views: number | null; /** Source video URL, when known (lets callers drop a duplicate). */ url?: string }

export interface ShareAgentData {
  mint: string;
  stats: ShareStats;
  /** http(s) URL, or a /public path (dev previews only). */
  avatarUrl: string | null;
  /** Up to 5 of the agent's best recent clips, best first. Fewer (or none,
   *  for a brand-new agent) is fine — the empty slots get tier placeholders. */
  clips?: ShareClip[];
  /** Force the SILVER clip-deck look whatever the view count (the 10k video milestone card). */
  look?: "graphite" | "silver";
  /** Cinzel serif title across the top of the card (replaces any badge). */
  headline?: string;
  /** Replaces the "MEMBER · VELLO ACCESS" eyebrow above the counter. */
  eyebrow?: string;
}

/** Frames pulled from the top clip for the middle card's pixel video. */
export const MID_VIDEO_FRAMES = 5;

async function loadClips(items: { videoUrl: string; viewCount: number | null }[]): Promise<ShareClip[]> {
  // One spare candidate so a single dead URL doesn't cost a panel. All grabs
  // run in parallel, so the worst case is one clip's own timeout, not N×.
  const top = [...items].filter((v) => v.videoUrl).sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 6);
  if (top.length === 0) return [];
  const { videoFrames } = await import("@/lib/server/videoThumbnails");
  const grabbed = await Promise.all(top.map(async (v, i) => {
    const frames = await videoFrames(v.videoUrl, i === 0 ? MID_VIDEO_FRAMES : 1);
    return frames ? { frames, views: v.viewCount ?? null, url: v.videoUrl } : null;
  }));
  return grabbed.filter((c): c is ShareClip => !!c).slice(0, 5);
}

/** Agent + its video feed → honest card stats. Null when the agent doesn't exist.
 *  `media: false` skips the clip frame grabs (callers that only need stats). */
export async function loadShareAgent(mint: string, opts: { media?: boolean } = {}): Promise<ShareAgentData | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Convex not configured");
  const convex = new ConvexHttpClient(url);
  const [agent, feed] = await Promise.all([
    convex.query(api.influencers.getByMint, { mintAddress: mint }),
    convex.query(api.clipJobs.videoFeedByMints, { mintAddresses: [mint] }),
  ]);
  if (!agent) return null;
  const items = feed?.items ?? [];
  const a = agent as { name?: string; handle?: string; avatarUrl?: string; connectedPlatforms?: string[] };
  let platforms = a.connectedPlatforms ?? [];
  if (isConfigured()) {
    try {
      const profile = await getProfile(resolveUsername(mint));
      platforms = Object.entries(profile.connected).filter(([, account]) => account != null).map(([id]) => id);
    } catch { /* Use the last successfully synced connected-platform cache. */ }
  }
  const clips = opts.media === false ? [] : await loadClips(items).catch(() => []);
  return {
    mint,
    avatarUrl: a.avatarUrl ?? null,
    clips,
    stats: {
      name: (a.name ?? "My Agent").trim() || "My Agent",
      handle: a.handle?.replace(/^@/, "") || null,
      views: items.reduce((s, v) => s + (v.viewCount ?? 0), 0),
      videos: items.length,
      posted: items.filter((v) => v.state === "posted").length,
      bestViews: items.reduce((m, v) => Math.max(m, v.viewCount ?? 0), 0),
      platforms,
    },
  };
}

/* ── Geometry: one composition per tier ────────────────────────────────────── */

interface Box { x: number; y: number; w: number; h: number }

/** One recent-clip card in a composition. */
interface ClipSpec {
  /** Clip index (0 = best clip, which also plays inside the data card). */
  slot: number;
  /** Card size + position before any transform (transforms pivot on its centre). */
  box: Box;
  /** 2×2 affine [a, b, c, d] — squash + shear turns a card in 3D (the deck). */
  matrix?: [number, number, number, number];
  /** 0..1 darkening for cards deeper in a stack. */
  shade?: number;
  /** Flat cards only: index label ("02"), views and a play-head timeline. */
  label?: string;
  /** Drawn over the data card (the Black monolith's inset tiles). */
  above?: boolean;
  /** Pixel block size for this card — each card resolves at its own level. */
  block?: number;
  /** A dimmed clip card carrying an analytics panel instead of the clip labels. */
  analytic?: boolean;
}

interface Layout {
  /** The data card — the best clip plays behind it as pixel video. */
  mid: Box;
  /** Where the name / counter / bar / stats column sits inside it. */
  content: Box;
  /** Legibility scrim: under the bottom half, or behind a left column. */
  scrim: "bottom" | "left";
  /** Back to front. */
  clips: ClipSpec[];
}

const PAD = 24;
const inset = (b: Box, p = PAD): Box => ({ x: b.x + p, y: b.y + p, w: b.w - 2 * p, h: b.h - 2 * p });
/** A card turned away around its vertical axis: squash + vertical shear. */
const turn = (squash: number, shear: number): [number, number, number, number] => [squash, 0, shear, 1];

const TRIPTYCH_MID: Box = { x: 414, y: 68, w: 372, h: 550 };

/** Tiers drawn by this file; GOLD, PLATINUM and BLACK use the card designs. */
type ClipMaterial = Extract<ShareMaterial, "graphite" | "silver">;

/**
 *  MEMBER    triptych  — clip · data · clip, flat and even
 *  SILVER    deck      — a 3D-turned stack of clips · data · clip
 */
const LAYOUTS: Record<ClipMaterial, Layout> = {
  graphite: {
    mid: TRIPTYCH_MID, content: inset(TRIPTYCH_MID), scrim: "bottom",
    clips: [
      { slot: 1, box: { x: 96, y: 98, w: 282, h: 490 }, label: "02", block: 12 },
      { slot: 2, box: { x: 822, y: 98, w: 282, h: 490 }, label: "03", block: 8 },
    ],
  },
  silver: {
    mid: TRIPTYCH_MID, content: inset(TRIPTYCH_MID), scrim: "bottom",
    clips: [
      { slot: 4, box: { x: 160, y: 104, w: 228, h: 404 }, matrix: turn(0.84, -0.12), shade: 0.38, block: 12 },
      { slot: 3, box: { x: 128, y: 128, w: 228, h: 404 }, matrix: turn(0.88, -0.12), shade: 0.18, block: 12 },
      { slot: 1, box: { x: 96, y: 152, w: 228, h: 404 }, matrix: turn(0.92, -0.12), block: 11 },
      { slot: 2, box: { x: 822, y: 98, w: 282, h: 490 }, label: "03", block: 8, analytic: true, shade: 0.42 },
    ],
  },
};

/* ── Tier styles ───────────────────────────────────────────────────────────── */

type Tone = "mono" | "color" | "holo" | { duo: string; dark?: boolean };
interface TierStyle {
  /** Pixel block size — higher tiers resolve sharper. */
  block: number;
  /** Block size of the data card's playing video — finer than the side cards. */
  midBlock?: number;
  bg: string;
  bloom: string;
  line: string;
  side: Tone;
  mid: Tone;
  motif: "dots" | "brushed" | "glow" | "facets" | "void";
  extra: "none" | "twinkle" | "holo" | "comet";
}

const STYLES: Record<ClipMaterial, TierStyle> = {
  graphite: { block: 10, midBlock: 5, bg: "#08090a", bloom: "#3b4044", line: "#e9e9e6", side: "mono", mid: "mono", motif: "dots", extra: "none" },
  silver: { block: 8, midBlock: 5, bg: "#060a11", bloom: "#34506a", line: "#cddbe7", side: { duo: "#a9c8e8" }, mid: "color", motif: "brushed", extra: "none" },
};

/* ── Pixel primitives ──────────────────────────────────────────────────────── */


/** 5×7 dot-matrix glyphs for the view counter. */
const PIXEL_GLYPHS: Record<string, string[]> = {
  "0": [".XXX.", "X...X", "X..XX", "X.X.X", "XX..X", "X...X", ".XXX."],
  "1": ["..X..", ".XX..", "..X..", "..X..", "..X..", "..X..", ".XXX."],
  "2": [".XXX.", "X...X", "....X", "...X.", "..X..", ".X...", "XXXXX"],
  "3": ["XXXXX", "...X.", "..X..", "...X.", "....X", "X...X", ".XXX."],
  "4": ["...X.", "..XX.", ".X.X.", "X..X.", "XXXXX", "...X.", "...X."],
  "5": ["XXXXX", "X....", "XXXX.", "....X", "....X", "X...X", ".XXX."],
  "6": ["..XX.", ".X...", "X....", "XXXX.", "X...X", "X...X", ".XXX."],
  "7": ["XXXXX", "....X", "...X.", "..X..", ".X...", ".X...", ".X..."],
  "8": [".XXX.", "X...X", "X...X", ".XXX.", "X...X", "X...X", ".XXX."],
  "9": [".XXX.", "X...X", "X...X", ".XXXX", "....X", "...X.", ".XX.."],
  K: ["X...X", "X..X.", "X.X..", "XX...", "X.X..", "X..X.", "X...X"],
  M: ["X...X", "XX.XX", "X.X.X", "X.X.X", "X...X", "X...X", "X...X"],
  B: ["XXXX.", "X...X", "X...X", "XXXX.", "X...X", "X...X", "XXXX."],
  ".": [".", ".", ".", ".", ".", ".", "X"],
};

function pixelText(text: string) {
  let x = 0;
  const glyphs: { rows: string[]; x: number }[] = [];
  for (const ch of text) {
    const rows = PIXEL_GLYPHS[ch];
    if (!rows) continue;
    glyphs.push({ rows, x });
    x += rows[0].length + 1;
  }
  return { glyphs, cols: Math.max(0, x - 1) };
}

/** Rectangle with 2-step pixel-notched corners (step `s`), as an SVG path. */
function steppedPath(b: Box, s: number, grow = 0): string {
  const x = b.x - grow, y = b.y - grow, w = b.w + grow * 2, h = b.h + grow * 2, d = 2 * s;
  const pts = [
    [x + d, y], [x + w - d, y], [x + w - d, y + s], [x + w - s, y + s], [x + w - s, y + d], [x + w, y + d],
    [x + w, y + h - d], [x + w - s, y + h - d], [x + w - s, y + h - s], [x + w - d, y + h - s], [x + w - d, y + h],
    [x + d, y + h], [x + d, y + h - s], [x + s, y + h - s], [x + s, y + h - d], [x, y + h - d],
    [x, y + d], [x + s, y + d], [x + s, y + s], [x + d, y + s],
  ];
  return `M${pts.map(([px, py]) => `${px} ${py}`).join("L")}Z`;
}

const notchFor = (block: number) => Math.max(4, Math.min(8, block));

/* ── Static assets (read once per process) ─────────────────────────────────── */

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
const LADDER = [1e3, 5e3, 1e4, 25e3, 5e4, 1e5, 25e4, 5e5, 1e6];
const PLATFORM_NAMES: Record<string, string> = { x: "X", twitter: "X", youtube: "YOUTUBE", tiktok: "TIKTOK", instagram: "INSTAGRAM", facebook: "FACEBOOK", linkedin: "LINKEDIN", threads: "THREADS" };
const SOCIAL_PATHS: Record<string, string> = {
  x: '<path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.3-8.5L1.9 2h6.5l4.5 6.9L18.9 2Zm-1.1 18h1.7L7.4 3.9H5.6L17.8 20Z"/>',
  youtube: '<path d="M22.5 6.3a2.8 2.8 0 0 0-2-2C18.7 3.8 12 3.8 12 3.8s-6.7 0-8.5.5a2.8 2.8 0 0 0-2 2C1 8.1 1 12 1 12s0 3.9.5 5.7a2.8 2.8 0 0 0 2 2c1.8.5 8.5.5 8.5.5s6.7 0 8.5-.5a2.8 2.8 0 0 0 2-2c.5-1.8.5-5.7.5-5.7s0-3.9-.5-5.7ZM9.7 15.5v-7l6 3.5-6 3.5Z"/>',
  tiktok: '<path d="M12.5 1h4c.1 3.2 2 5.1 5.4 5.4v4c-2-.1-3.8-.7-5.4-1.8v7.1c0 4.3-2.8 7.2-6.8 7.2A6.8 6.8 0 0 1 3 16.1c0-4.2 3.3-7 7.3-6.8v4.2c-1.8-.4-3.3.7-3.3 2.6 0 1.6 1.3 2.8 2.9 2.8 1.8 0 2.6-1.4 2.6-3.1V1Z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke="white" stroke-width="2.2"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="white" stroke-width="2.2"/><circle cx="17.7" cy="6.4" r="1.25"/>',
  facebook: '<path d="M14.3 22v-9h3l.5-3.5h-3.5V7.3c0-1 .3-1.8 1.8-1.8H18V2.4c-.9-.1-1.9-.2-2.9-.2-3 0-5 1.8-5 5.1v2.2H7V13h3.1v9h4.2Z"/>',
  linkedin: '<path d="M4.4 8.5H.9V22h3.5V8.5ZM2.7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM22 14.1c0-3.6-1.9-5.3-4.5-5.3-2.1 0-3 1.1-3.5 1.9V8.5h-3.5V22H14v-7.5c0-1.9.9-2.8 2.4-2.8 1.4 0 2.1.9 2.1 2.8V22H22v-7.9Z"/>',
  threads: '<path d="M12 2c-5.5 0-9 3.7-9 10s3.5 10 9 10c4.6 0 7.9-2.6 7.9-6.5 0-2.7-1.6-4.5-4.6-5.3-.5-2.2-1.7-3.2-3.7-3.2-1.6 0-2.9.7-3.7 1.9l2.1 1.4c.4-.6.9-.9 1.6-.9.7 0 1.1.3 1.3 1-3.7-.3-5.9 1.2-5.9 3.8 0 2.2 1.7 3.6 4.2 3.6 2.4 0 4-1.6 4.2-4.2 1.3.5 1.8 1.5 1.8 2.4 0 2.3-1.8 3.8-4.9 3.8-4 0-6.4-2.8-6.4-7.5S8 4.6 12 4.6c2.8 0 4.5 1.2 5.2 3.5l2.6-.7C18.7 3.9 16 2 12 2Zm-.7 13.3c-.9 0-1.4-.4-1.4-1.1 0-.9 1.1-1.3 3.3-1.1-.1 1.4-.7 2.2-1.9 2.2Z"/>',
};

/** The live brand logo — the same file the app header renders. */
const LOGO_FILE = join(process.cwd(), "assets", "lo.png");
/** Brand lime, sampled from the logo mark. */
const BRAND_LIME = "#C8F02A";

interface Assets { fonts: Font[]; socialIcons: Record<string, string>; headMark: Sprite; headWord: Sprite; markBig: Sprite }
let assetsPromise: Promise<Assets> | null = null;

const pub = (...p: string[]) => join(process.cwd(), "public", ...p);
const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const pngDataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

function loadAssets(): Promise<Assets> {
  assetsPromise ??= (async () => {
    const [manrope, grotesk, cinzel, logoSrc] = await Promise.all([
      readFile(pub("fonts", "captions", "Manrope-Medium.ttf")),
      readFile(pub("fonts", "captions", "SpaceGrotesk-Medium.ttf")),
      readFile(pub("fonts", "captions", "Cinzel-SemiBold.ttf")),
      readFile(LOGO_FILE),
    ]);
    const lw = (await sharp(logoSrc).metadata()).width ?? 1000;
    const mark = { left: 0, width: Math.round(lw * 0.235) };
    const word = { left: Math.round(lw * 0.235), width: lw - Math.round(lw * 0.235) };
    const [markGrid, wordGrid] = await Promise.all([pixelizeLogo(logoSrc, mark, 9), pixelizeLogo(logoSrc, word, 46)]);
    const [headMark, headWord, markBig] = await Promise.all([
      sprite(markGrid, 2, 1, BRAND_LIME, 0.55),
      sprite(wordGrid, 2, 0, "#F2F2EF", 0.85),
      sprite(markGrid, 3, 1, BRAND_LIME, 0.5),
    ]);
    const socialIcons = Object.fromEntries(await Promise.all(Object.entries(SOCIAL_PATHS).map(async ([id, path]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="white">${path}</svg>`;
      return [id, pngDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())];
    })));
    const fonts: Font[] = [
      { name: "Manrope", data: toArrayBuffer(manrope), weight: 500, style: "normal" },
      { name: "Grotesk", data: toArrayBuffer(grotesk), weight: 500, style: "normal" },
      { name: "Cinzel", data: toArrayBuffer(cinzel), weight: 400, style: "normal" },
    ];
    return { fonts, socialIcons, headMark, headWord, markBig };
  })().catch((e) => { assetsPromise = null; throw e; });
  return assetsPromise;
}

async function avatarSource(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    if (url.startsWith("/")) {
      // Local /public asset (dev previews). Refuse anything that escapes public/.
      const root = pub();
      const file = join(root, url.replace(/^\/+/, ""));
      if (!file.startsWith(root + "/") || url.includes("..")) return null;
      return await readFile(file);
    }
    if (!/^https?:\/\//.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/* ── Card faces (pixelated, toned, framed, notched) ────────────────────────── */

function toned(img: sharp.Sharp, tone: Tone): sharp.Sharp {
  if (tone === "mono") return img.greyscale().linear(1.15, -10);
  // tint() keeps luminance and swaps chroma — a duotone on its own
  // (greyscale() first would cancel it).
  if (tone === "holo") return img.tint("#c8c0ff");
  if (typeof tone === "object") return tone.dark ? img.tint(tone.duo).modulate({ brightness: 0.5 }) : img.tint(tone.duo);
  return img.modulate({ saturation: 1.12 });
}

function holoSvg(w: number, h: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ef0ff"/><stop offset=".35" stop-color="#d7b8ff"/><stop offset=".65" stop-color="#ffd6b0"/><stop offset="1" stop-color="#a6ffcf"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#h)"/></svg>`);
}

/** Legibility scrim for the data card. */
function midScrimSvg(w: number, h: number, kind: Layout["scrim"]): Buffer {
  const body = kind === "left"
    ? `<linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".92"/><stop offset=".38" stop-color="#000" stop-opacity=".78"/><stop offset=".55" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>`
    : `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset=".26" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#000" stop-opacity=".66"/><stop offset=".7" stop-color="#000" stop-opacity=".86"/><stop offset="1" stop-color="#000" stop-opacity=".95"/></linearGradient>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset=".2" stop-color="#000" stop-opacity="0"/></linearGradient>${body}
</defs><rect width="100%" height="100%" fill="url(#t)"/><rect width="100%" height="100%" fill="url(#b)"/></svg>`);
}

function clipScrimSvg(w: number, h: number, shade: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".16" stop-color="#000" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#b)"/>${shade ? `<rect width="100%" height="100%" fill="#000" opacity="${shade}"/>` : ""}</svg>`);
}

/** Source → pixel card face: shrink to the tier's block grid (cheap: tone is
 *  applied at that tiny size), nearest-upscale, scrim, hairline frame, notch
 *  the corners. The frame is baked in so it follows the card through any
 *  3D/fan transform. */
async function cardFace(src: Buffer, w: number, h: number, block: number, tone: Tone, scrim: Buffer, notch: number, frame: string | null): Promise<Buffer> {
  const cols = Math.max(3, Math.round(w / block)), rows = Math.max(3, Math.round(h / block));
  const small = await toned(sharp(src).resize(cols, rows, { fit: "cover", position: "centre" }), tone).png().toBuffer();
  const shape = steppedPath({ x: 0, y: 0, w, h }, notch);
  const layers: sharp.OverlayOptions[] = [];
  if (tone === "holo") layers.push({ input: holoSvg(w, h), blend: "soft-light" });
  layers.push({ input: scrim });
  if (frame) layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges"><path d="${steppedPath({ x: 1, y: 1, w: w - 2, h: h - 2 }, notch)}" fill="none" stroke="${frame}" stroke-opacity=".32" stroke-width="2"/></svg>`) });
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges"><path d="${shape}" fill="#fff"/></svg>`), blend: "dest-in" });
  return sharp(small).resize(w, h, { kernel: "nearest", fit: "fill" }).ensureAlpha().composite(layers).png().toBuffer();
}

/** A clip card placed on the canvas: flat, or transformed about its centre
 *  (nearest-neighbour, so pixels stay crisp) with a soft drop shadow. */
async function placeClip(face: Buffer, spec: ClipSpec): Promise<sharp.OverlayOptions[]> {
  const { box } = spec;
  if (!spec.matrix) return [{ input: face, left: Math.round(box.x), top: Math.round(box.y) }];
  const [a, b, c, d] = spec.matrix;
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const { data, info } = await sharp(face).affine([[a, b], [c, d]], { background: clear, interpolator: sharp.interpolators.nearest }).png().toBuffer({ resolveWithObject: true });
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const left = Math.round(cx - info.width / 2), top = Math.round(cy - info.height / 2);
  const shadow = await sharp(data).modulate({ brightness: 0 }).extend({ top: 18, bottom: 18, left: 18, right: 18, background: clear }).blur(9).png().toBuffer();
  return [{ input: shadow, left: left - 18 + 6, top: top - 18 + 12 }, { input: data, left, top }];
}

/** Stand-in for a missing clip: a tier-lit glow that pixelates into clean
 *  retro banding. */
function placeholderSource(style: TierStyle, salt: number): Buffer {
  const cy = 30 + (salt % 40);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><defs><radialGradient id="p" cx="50%" cy="${cy}%" r="75%"><stop offset="0" stop-color="${style.bloom}"/><stop offset="1" stop-color="${style.bg}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`);
}

/* ── Backdrop + static decor ───────────────────────────────────────────────── */

function backgroundSvg(style: TierStyle, layout: Layout): string {
  const { mid } = layout;
  const cx = mid.x + mid.w / 2, cy = mid.y + mid.h / 2;
  const motif = (() => {
    switch (style.motif) {
      case "dots": return `<defs><pattern id="m" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${style.line}" opacity=".07"/></pattern></defs><rect width="100%" height="100%" fill="url(#m)"/>`;
      case "brushed": return Array.from({ length: W / 4 }, (_, i) => `<rect x="${i * 4}" y="0" width="1" height="${H}" fill="${style.line}" opacity="${i % 5 === 0 ? 0.05 : 0.018}"/>`).join("");
      case "glow": return Array.from({ length: 4 }, (_, i) => { const r = 330 + i * 70; return `<rect x="${cx - r}" y="${cy - r * 0.62}" width="${r * 2}" height="${r * 1.24}" fill="none" stroke="${style.line}" stroke-opacity="${(0.07 - i * 0.015).toFixed(3)}" stroke-dasharray="4 8"/>`; }).join("");
      case "facets": return Array.from({ length: 22 }, (_, i) => `<line x1="${-300 + i * 80}" y1="${H}" x2="${i * 80 + 100}" y2="0" stroke="${i % 3 ? "#9ef0ff" : "#ffd6b0"}" stroke-opacity=".035"/>`).join("");
      default: return "";
    }
  })();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" shape-rendering="crispEdges"><defs>
<radialGradient id="g" cx="${(cx / W * 100).toFixed(1)}%" cy="${(cy / H * 100).toFixed(1)}%" r="60%"><stop offset="0" stop-color="${style.bloom}" stop-opacity=".55"/><stop offset=".55" stop-color="${style.bloom}" stop-opacity=".1"/><stop offset="1" stop-color="${style.bg}" stop-opacity="0"/></radialGradient>
<radialGradient id="v" cx="50%" cy="45%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
</defs><rect width="100%" height="100%" fill="${style.bg}"/><rect width="100%" height="100%" fill="url(#g)"/>${motif}<rect width="100%" height="100%" fill="url(#v)"/></svg>`;
}

const flatClips = (layout: Layout) => layout.clips.filter((c) => c.label && !c.matrix);

/** Tier chrome drawn over everything static: the data card's frame and the
 *  tier's signature element. */
function decorSvg(style: TierStyle, layout: Layout, notch: number): string {
  const L = style.line, MID = layout.mid;
  const parts: string[] = [];
  const frame = (b: Box, opacity: number, width: number, stroke = L, grow = 0) =>
    `<path d="${steppedPath(b, notch, grow)}" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}"/>`;
  switch (style.motif) {
    case "brushed": // silver: engraved double frame
      parts.push(frame(MID, 0.6, 1.5), frame(MID, 0.22, 1, L, 6));
      break;
    case "glow": { // gold: pixel L-brackets at every flat card's corners
      parts.push(frame(MID, 0.55, 1.5));
      for (const b of [MID, ...flatClips(layout).map((c) => c.box)]) {
        const o = 10, a = b === MID ? 22 : 16, t = 3;
        for (const [x, y, sx, sy] of [[b.x - o, b.y - o, 1, 1], [b.x + b.w + o, b.y - o, -1, 1], [b.x + b.w + o, b.y + b.h + o, -1, -1], [b.x - o, b.y + b.h + o, 1, -1]]) {
          parts.push(`<rect x="${sx > 0 ? x : x - a}" y="${sy > 0 ? y : y - t}" width="${a}" height="${t}" fill="${L}"/>`);
          parts.push(`<rect x="${sx > 0 ? x : x - t}" y="${sy > 0 ? y : y - a}" width="${t}" height="${a}" fill="${L}"/>`);
        }
      }
      break;
    }
    case "facets": // platinum: iridescent frame
      parts.push(`<defs><linearGradient id="ir" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ef0ff"/><stop offset=".4" stop-color="#d7b8ff"/><stop offset=".7" stop-color="#ffd6b0"/><stop offset="1" stop-color="#a6ffcf"/></linearGradient></defs>`);
      parts.push(frame(MID, 0.9, 2, "url(#ir)"));
      break;
    case "void": { // black: gold pixel lattice around the monolith, CRT lines on its tiles
      parts.push(frame(MID, 0.7, 1));
      const g = 9, o = 9, x0 = MID.x - o, y0 = MID.y - o, x1 = MID.x + MID.w + o, y1 = MID.y + MID.h + o;
      for (let x = x0; x <= x1; x += g) parts.push(`<rect x="${x - 1}" y="${y0 - 1}" width="3" height="3" fill="${L}" opacity=".45"/><rect x="${x - 1}" y="${y1 - 1}" width="3" height="3" fill="${L}" opacity=".45"/>`);
      for (let y = y0 + g; y < y1; y += g) parts.push(`<rect x="${x0 - 1}" y="${y - 1}" width="3" height="3" fill="${L}" opacity=".45"/><rect x="${x1 - 1}" y="${y - 1}" width="3" height="3" fill="${L}" opacity=".45"/>`);
      for (const { box: b } of flatClips(layout)) for (let y = b.y + 2; y < b.y + b.h; y += 4) parts.push(`<rect x="${b.x}" y="${y}" width="${b.w}" height="1" fill="#000" opacity=".3"/>`);
      break;
    }
    default:
      parts.push(frame(MID, 0.5, 1));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" shape-rendering="crispEdges">${parts.join("")}</svg>`;
}

/* ── Text layer (satori, once per card) ────────────────────────────────────── */

interface Geo {
  cell: number; px: number; top: number; h: number;
  content: Box; statsTop: number; dividerY: number; barTop: number;
}

const BAR_SEGS = 36;

/** Data column, laid out from its bottom edge up: stats, divider, bar, label,
 *  counter, tier eyebrow. The name row pins to its top. */
function geoFor(layout: Layout, views: number): Geo {
  const c = layout.content;
  const statsTop = c.y + c.h - 36, dividerY = statsTop - 16, barTop = dividerY - 39;
  const cols = pixelText(compactNumber(views)).cols || 1;
  const cell = Math.max(8, Math.min(16, Math.floor((c.w + 2) / cols)));
  const h = 7 * cell - 2;
  return { cell, px: cell - 2, h, top: barTop - 38 - h, content: c, statsTop, dividerY, barTop };
}

function nameSize(name: string) {
  return name.length <= 12 ? 25 : name.length <= 17 ? 21 : 18;
}

const mono = (size: number, color: string, spacing = 3) => ({ display: "flex", fontFamily: "Grotesk", fontSize: size, letterSpacing: spacing, color, whiteSpace: "nowrap" as const });

interface ClipLabel { box: Box; index: string; text: string }

/** Static labels + values for the right-hand analytics card (the bars and ladder are drawn per frame). */
function AnalyticsText({ box, data, accent, next }: { box: Box; data: ShareAgentData; accent: string; next: ReturnType<typeof nextTierFor> }) {
  const { stats } = data, views = stats.views, lit = LADDER.filter((m) => views >= m).length;
  const plat = stats.platforms[0] ? (PLATFORM_NAMES[stats.platforms[0]] ?? stats.platforms[0].toUpperCase()) : "ALL";
  const rows: [string, string][] = [
    ["VIEWS", compactNumber(views)],
    ["TO NEXT TIER", next ? `${compactNumber(Math.max(0, next.tier.min - views))} TO ${next.tier.label}` : "TOP TIER"],
    ["PLATFORM", stats.platforms.length > 1 ? `${stats.platforms.length} LINKED` : plat],
    ["BEST CLIP", compactNumber(stats.bestViews)],
  ];
  const bw = box.w - 36, seg = (bw - 8 * 3) / 9;
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex" }}>
      <div style={{ ...mono(10, "rgba(255,255,255,0.78)", 2.5), position: "absolute", left: 18, top: 14 }}>03 · ANALYTICS</div>
      <div style={{ ...mono(9, "rgba(255,255,255,0.5)", 2.4), position: "absolute", left: 18, top: 48 }}>CLIP VIEWS</div>
      <div style={{ ...mono(8.5, accent, 2), position: "absolute", right: 18, top: 49 }}>THIS VIDEO</div>
      <div style={{ ...mono(9, "rgba(255,255,255,0.5)", 2.4), position: "absolute", left: 18, top: 212 }}>VIEW LADDER</div>
      <div style={{ ...mono(9, accent, 2), position: "absolute", right: 18, top: 212 }}>{`${lit}/${LADDER.length}`}</div>
      {[[0, "1K"], [2, "10K"], [5, "100K"], [8, "1M"]].map(([i, label]) => (
        <div key={label} style={{ ...mono(8, "rgba(255,255,255,0.4)", 1), position: "absolute", left: 18 + (i as number) * (seg + 3), top: 250 }}>{label}</div>
      ))}
      {rows.map(([label, value], i) => (
        <div key={label} style={{ position: "absolute", left: 18 + (i % 2) * (bw / 2 + 4), top: 288 + Math.floor(i / 2) * 70, width: bw / 2 - 6, display: "flex", flexDirection: "column" }}>
          <div style={{ ...mono(8.5, "rgba(255,255,255,0.45)", 2.2) }}>{label}</div>
          <div style={{ display: "flex", fontSize: value.length > 9 ? 14 : 22, color: "#F2F2EF", marginTop: 8, whiteSpace: "nowrap" }}>{value}</div>
        </div>
      ))}
      <div style={{ ...mono(8.5, "rgba(255,255,255,0.42)", 2), position: "absolute", left: 34, top: box.h - 30 }}>LIVE · TRACKED BY VELLO</div>
    </div>
  );
}

function TextLayer({ data, tier, assets, avatar, memberId, labels, geo, layout, analytic }: {
  data: ShareAgentData; tier: ShareTier; assets: Assets; avatar: string | null; memberId: string;
  labels: ClipLabel[]; geo: Geo; layout: Layout; analytic: Box | null;
}) {
  const { stats } = data;
  const name = stats.name.length > 22 ? `${stats.name.slice(0, 20).trimEnd()}…` : stats.name;
  const next = nextTierFor(stats.views);
  const plats = [...new Set(stats.platforms.map((id) => (id === "twitter" ? "x" : id)))].filter((id) => assets.socialIcons[id]).slice(0, 5);
  const accent = tier.accent;
  const markW = Math.min(34, assets.markBig.w);
  const c = geo.content, MID = layout.mid;
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", color: "#F2F2EF", fontFamily: "Manrope" }}>
      {/* header: the real logo, pixelated */}
      <div style={{ position: "absolute", left: 48, top: 26, display: "flex", alignItems: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.headMark.url} alt="" width={assets.headMark.w} height={assets.headMark.h} style={{ marginRight: 10 }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.headWord.url} alt="" width={assets.headWord.w} height={assets.headWord.h} />
      </div>
      <div style={{ ...mono(11, "rgba(255,255,255,0.4)"), position: "absolute", right: 48 + SOLANA_COLS * 2.6 + 16, top: 32 }}>{`N° ${memberId}`}</div>
      {data.headline ? <div style={{ position: "absolute", left: 0, top: 18, width: W, display: "flex", justifyContent: "center", fontFamily: "Cinzel", fontSize: 31, letterSpacing: 3, color: "#FFFFFF", textTransform: "uppercase", whiteSpace: "nowrap" }}>{data.headline}</div> : null}

      {labels.map((l) => (
        <div key={l.index} style={{ position: "absolute", left: l.box.x, top: l.box.y, width: l.box.w, height: l.box.h, display: "flex" }}>
          <div style={{ ...mono(10, "rgba(255,255,255,0.72)"), position: "absolute", left: 14, top: 13 }}>{l.index}</div>
          <div style={{ ...mono(l.box.w < 200 ? 9.5 : 11, "rgba(255,255,255,0.9)", 2), position: "absolute", left: 14, top: l.box.h - 44 }}>{l.text}</div>
        </div>
      ))}

      {analytic ? <AnalyticsText box={analytic} data={data} accent={accent} next={next} /> : null}

      {/* data column */}
      <div style={{ position: "absolute", left: c.x, top: c.y, width: c.w, display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", width: 44, height: 44, border: `1px solid ${accent}`, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" }}>
          {avatar
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={avatar} alt="" width={42} height={42} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={assets.markBig.url} alt="" width={markW} height={Math.round(markW * assets.markBig.h / assets.markBig.w)} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 12 }}>
          <div style={{ display: "flex", fontSize: nameSize(name), letterSpacing: -0.6, lineHeight: 1.05, whiteSpace: "nowrap" }}>{name}</div>
          {stats.handle ? <div style={{ ...mono(11, "rgba(255,255,255,0.55)", 1), marginTop: 5 }}>{`@${stats.handle}`}</div> : null}
        </div>
      </div>

      <div style={{ ...mono(10.5, accent), position: "absolute", left: c.x, top: geo.top - 24 }}>{data.eyebrow ?? `${tier.label} · ${tier.zone.toUpperCase()}`}</div>
      <div style={{ ...mono(10, "rgba(255,255,255,0.5)", 4), position: "absolute", left: c.x, top: geo.top + geo.h + 12 }}>TRACKED VIEWS</div>
      <div style={{ ...mono(9.5, "rgba(255,255,255,0.5)", 2.5), position: "absolute", left: c.x, top: geo.barTop + 15 }}>
        {next ? `${Math.floor(next.progress * 100)}% TO ${next.tier.label}` : "TOP TIER · INVITE ONLY"}
      </div>
      {next ? <div style={{ ...mono(9.5, "rgba(255,255,255,0.35)", 2.5), position: "absolute", right: W - (c.x + c.w), top: geo.barTop + 15 }}>{compactNumber(next.tier.min)}</div> : null}
      <div style={{ position: "absolute", left: c.x, top: geo.dividerY, width: c.w, height: 1, display: "flex", backgroundColor: "rgba(255,255,255,0.14)" }} />
      <div style={{ position: "absolute", left: c.x, top: geo.statsTop, width: c.w, display: "flex" }}>
        {[["VIDEOS", String(stats.videos)], ["POSTED", String(stats.posted)], ["BEST CLIP", compactNumber(stats.bestViews)]].map(([label, value]) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", width: c.w / 3 }}>
            <div style={{ display: "flex", fontSize: 20, color: "#F2F2EF" }}>{value}</div>
            <div style={{ ...mono(9, "rgba(255,255,255,0.45)", 2.5), marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* footer */}
      <div style={{ ...mono(10.5, "rgba(255,255,255,0.34)"), position: "absolute", left: 48, top: 636 }}>VELLOAGENTS.COM</div>
      <div style={{ position: "absolute", left: MID.x, top: 633, width: MID.w, display: "flex", justifyContent: "center", fontFamily: "Manrope", fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{tier.tagline}</div>
      {plats.length > 0 ? (
        <div style={{ position: "absolute", right: 48, top: 632, display: "flex", alignItems: "center" }}>
          {plats.map((id) => (
            <div key={id} style={{ display: "flex", alignItems: "center", marginLeft: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assets.socialIcons[id]} alt={id} width={14} height={14} style={{ opacity: 0.8 }} />
              <div style={{ ...mono(9.5, "rgba(255,255,255,0.62)", 1.6), marginLeft: 6 }}>{PLATFORM_NAMES[id] ?? id.toUpperCase()}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── Per-frame dynamic layer (rects only — fast to rasterize) ──────────────── */

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOut = (n: number) => 1 - Math.pow(1 - clamp01(n), 3);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** The settled frame used for the static PNG. */
const STILL_T = 0.6;

interface Twinkle { x: number; y: number; phase: number }

function dynamicSvg(t: number, b: Built, still = false): string {
  const { views, tier, style, geo, twinkles, notch, layout } = b;
  const a = tier.accent, MID = layout.mid, c = geo.content;
  const out: string[] = [];
  out.push(solanaPixels(t, W - 48 - SOLANA_COLS * 2.6, 22, 2.6, { entrance: false }));

  // pixel-matrix counter: lit cells in accent, unlit cells as a faint LED grid
  const counter = pixelText(compactNumber(Math.round(views * easeOut(span(t, 0.1, 0.42)))));
  for (const g of counter.glyphs) {
    g.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const px = c.x + (g.x + x) * geo.cell, py = geo.top + y * geo.cell;
      out.push(ch === "X"
        ? `<rect x="${px}" y="${py}" width="${geo.px}" height="${geo.px}" fill="${a}"/>`
        : `<rect x="${px}" y="${py}" width="${geo.px}" height="${geo.px}" fill="#fff" fill-opacity=".06"/>`);
    }));
  }

  // next-tier bar (honest progress, real views)
  const next = nextTierFor(views);
  const fill = Math.round(BAR_SEGS * (next ? next.progress : 1) * easeOut(span(t, 0.18, 0.5)));
  const shimmer = Math.floor(((t * 2) % 1) * BAR_SEGS);
  const step = (c.w + 2) / BAR_SEGS;
  for (let i = 0; i < BAR_SEGS; i++) {
    const on = i < fill;
    out.push(`<rect x="${Math.round(c.x + i * step)}" y="${geo.barTop}" width="${Math.round(step) - 2}" height="7" fill="${on && i !== shimmer ? a : "#fff"}" fill-opacity="${on ? 1 : 0.1}"/>`);
  }

  // scanline sweeping the data card (motion only — it reads as a stray rule on the still)
  const sy = MID.y + Math.round(((t * 1.5) % 1) * (MID.h - 4));
  if (!still) out.push(`<rect x="${MID.x}" y="${sy}" width="${MID.w}" height="2" fill="${a}" fill-opacity=".28"/><rect x="${MID.x}" y="${sy - 10}" width="${MID.w}" height="10" fill="${a}" fill-opacity=".05"/>`);

  // flat clip cards get a play-head timeline
  flatClips(layout).filter((c) => !c.analytic).forEach(({ box }, i) => {
    const tw = box.w - 28, p = ((t + i * 0.37) % 1) * tw;
    out.push(`<rect x="${box.x + 14}" y="${box.y + box.h - 18}" width="${tw}" height="3" fill="#fff" fill-opacity=".2"/><rect x="${box.x + 14}" y="${box.y + box.h - 18}" width="${Math.round(p)}" height="3" fill="${a}"/>`);
  });

  if (b.analytic) {
    const { box, bars, lit } = b.analytic, bx = box.x + 18, bw = box.w - 36;
    const grow = easeOut(span(t, 0.12, 0.5)), blink = Math.floor(t * 8) % 2 === 0;
    const baseY = box.y + 70 + 12 * 9, n = Math.max(1, bars.length), max = Math.max(1, ...bars.map((x) => x.views)), barW = Math.floor((bw - (n - 1) * 6) / n);
    bars.forEach((bar, i) => {
      const blocks = Math.max(1, Math.round((bar.views / max) * 12)), shown = Math.ceil(blocks * grow);
      for (let k = 0; k < shown; k++) {
        const flash = bar.hot && k === shown - 1 && grow >= 1 && blink;
        out.push(`<rect x="${bx + i * (barW + 6)}" y="${baseY - (k + 1) * 9 + 2}" width="${barW}" height="7" fill="${bar.hot ? (flash ? "#fff" : a) : "#fff"}" fill-opacity="${bar.hot ? 1 : 0.34}"/>`);
      }
    });
    const segW = (bw - 8 * 3) / 9, reached = lit * grow;
    for (let i = 0; i < 9; i++) {
      const on = i < Math.floor(reached), next = i === Math.floor(reached) && i < 9 && lit < 9 && reached >= lit - 0.001;
      out.push(`<rect x="${Math.round(bx + i * (segW + 3))}" y="${box.y + 230}" width="${Math.round(segW)}" height="8" fill="${on ? a : "#fff"}" fill-opacity="${on ? 1 : next && blink ? 0.5 : 0.1}"/>`);
    }
    out.push(`<rect x="${box.x + 18}" y="${box.y + box.h - 27}" width="8" height="8" fill="${a}" fill-opacity="${blink ? 1 : 0.3}"/>`);
  }

  if (style.extra === "twinkle") {
    for (const tw of twinkles) {
      const o = Math.pow(Math.max(0, Math.sin((t + tw.phase) * Math.PI * 2)), 3);
      if (o < 0.05) continue;
      out.push(`<g fill="${style.line}" fill-opacity="${o.toFixed(2)}"><rect x="${tw.x}" y="${tw.y - 4}" width="3" height="11"/><rect x="${tw.x - 4}" y="${tw.y}" width="11" height="3"/></g>`);
    }
  } else if (style.extra === "holo") {
    const x = MID.x - 220 + t * (MID.w + 440);
    out.push(`<defs><clipPath id="mc"><path d="${steppedPath(MID, notch)}"/></clipPath><linearGradient id="hs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9ef0ff" stop-opacity="0"/><stop offset=".5" stop-color="#e2ccff" stop-opacity=".22"/><stop offset="1" stop-color="#ffd6b0" stop-opacity="0"/></linearGradient></defs>`);
    out.push(`<polygon clip-path="url(#mc)" points="${x},${MID.y} ${x + 140},${MID.y} ${x + 40},${MID.y + MID.h} ${x - 100},${MID.y + MID.h}" fill="url(#hs)"/>`);
  } else if (style.extra === "comet") {
    const o = 9, x0 = MID.x - o, y0 = MID.y - o, w = MID.w + 2 * o, h = MID.h + 2 * o, P = 2 * (w + h);
    for (let k = 0; k < 10; k++) {
      let d = ((t * P - k * 9) % P + P) % P;
      let x: number, y: number;
      if (d < w) { x = x0 + d; y = y0; } else if ((d -= w) < h) { x = x0 + w; y = y0 + d; } else if ((d -= h) < w) { x = x0 + w - d; y = y0 + h; } else { d -= w; x = x0; y = y0 + h - d; }
      out.push(`<rect x="${Math.round(x) - 2}" y="${Math.round(y) - 2}" width="5" height="5" fill="${style.line}" fill-opacity="${(1 - k / 10).toFixed(2)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" shape-rendering="crispEdges">${out.join("")}</svg>`;
}

/* ── Build: bake every static layer once ───────────────────────────────────── */

interface Built {
  /** Final raw RGB bases, one per data-card video frame. */
  bases: Buffer[];
  /** Coarse "resolve" levels (no text), coarsest first. */
  intro: Buffer[];
  views: number;
  tier: ShareTier;
  style: TierStyle;
  layout: Layout;
  geo: Geo;
  twinkles: Twinkle[];
  notch: number;
  /** The right-hand analytics card (silver look): its box, the bar data and how many ladder rungs are reached. */
  analytic: { box: Box; bars: { views: number; hot: boolean }[]; lit: number } | null;
}

async function build(data: ShareAgentData, nonce: string | number): Promise<Built> {
  const v = pickVariant(data.mint, data.stats.views, nonce, `${data.stats.name}|${data.stats.platforms.slice().sort().join(",")}`);
  const tier = v.tier;
  const material = (data.look ?? tier.material) as ClipMaterial;
  const style = STYLES[material];
  const layout = LAYOUTS[material];
  const notch = notchFor(style.block);
  const [assets, avatarSrc] = await Promise.all([loadAssets(), avatarSource(data.avatarUrl)]);

  // Clips cycle when an agent has fewer than a layout wants; a new design
  // (nonce) rotates which clip lands on which card. Slot 0 always plays in
  // the data card.
  const clips = data.clips ?? [];
  const shift = v.seed % 4;
  const clipFor = (slot: number): ShareClip | null => {
    if (!clips.length) return null;
    if (slot === 0) return clips[0];
    const others = clips.length > 1 ? clips.slice(1) : clips;
    return others[(slot - 1 + shift) % others.length];
  };
  const midSources = clips[0]?.frames.length ? clips[0].frames.slice(0, MID_VIDEO_FRAMES) : [avatarSrc ?? placeholderSource(style, v.seed)];
  const srcFor = (spec: ClipSpec) => clipFor(spec.slot)?.frames[0] ?? placeholderSource(style, v.seed + spec.slot);

  const avatar = avatarSrc
    ? await sharp(avatarSrc).resize(11, 11, { fit: "cover", position: "attention" }).png().toBuffer()
        .then((b) => sharp(b).resize(42, 42, { kernel: "nearest" }).png().toBuffer()).then(pngDataUrl).catch(() => null)
    : null;

  const geo = geoFor(layout, data.stats.views);
  const MID = layout.mid;
  const midScrim = midScrimSvg(MID.w, MID.h, layout.scrim);
  // Clip frames are 240px wide: a very wide data card (the Black monolith)
  // needs coarser blocks or the upscale reads as blur instead of pixels.
  const midBlock = Math.max(style.midBlock ?? style.block, Math.round(MID.w / 110));
  const midFace = (src: Buffer, block: number) => cardFace(src, MID.w, MID.h, Math.max(block, midBlock), style.mid, midScrim, notch, null);
  const levels = [style.block, style.block * 6, style.block * 3];
  // Each card resolves at its own pixel level (finest in the centre), so the three never match.
  const clipLayers = (level: number) => Promise.all(layout.clips.map(async (spec) => {
    const face = await cardFace(srcFor(spec), spec.box.w, spec.box.h, level === 0 ? spec.block ?? style.block : levels[level], style.side, clipScrimSvg(spec.box.w, spec.box.h, spec.shade ?? 0), notch, style.line);
    return { above: !!spec.above, layers: await placeClip(face, spec) };
  }));
  const labels: ClipLabel[] = flatClips(layout).filter((spec) => !spec.analytic).map((spec) => {
    const clip = clipFor(spec.slot);
    return { box: spec.box, index: spec.label!, text: !clip ? "NEXT CLIP" : clip.views != null ? `${compactNumber(clip.views)} VIEWS` : "RECENT CLIP" };
  });

  const analyticSpec = layout.clips.find((c) => c.analytic);
  const [bg, textSvg, clipsByLevel, midFaces, midCoarse] = await Promise.all([
    sharp(Buffer.from(backgroundSvg(style, layout))).png().toBuffer(),
    satori(
      <TextLayer data={data} tier={tier} assets={assets} avatar={avatar} memberId={v.memberId} labels={labels} geo={geo} layout={layout} analytic={analyticSpec?.box ?? null} />,
      { width: W, height: H, fonts: assets.fonts },
    ),
    Promise.all(levels.map((_, i) => clipLayers(i))),
    Promise.all(midSources.map((src) => midFace(src, style.midBlock ?? style.block))),
    Promise.all(levels.slice(1).map((blk) => midFace(midSources[0], blk))),
  ]);
  const decor = Buffer.from(decorSvg(style, layout, notch));
  const text = await sharp(Buffer.from(textSvg)).png().toBuffer();

  const scene = (level: number, mid: Buffer, withText: boolean) => {
    const parts = clipsByLevel[level];
    const below = parts.filter((p) => !p.above).flatMap((p) => p.layers);
    const above = parts.filter((p) => p.above).flatMap((p) => p.layers);
    return sharp(bg).composite([
      ...below, { input: mid, left: MID.x, top: MID.y }, ...above, { input: decor }, ...(withText ? [{ input: text }] : []),
    ]).removeAlpha().raw().toBuffer();
  };
  const [bases, intro] = await Promise.all([
    Promise.all(midFaces.map((mid) => scene(0, mid, true))),
    Promise.all(midCoarse.map((mid, i) => scene(i + 1, mid, false))),
  ]);

  const tr = rng(v.seed ^ 0x5bd1);
  const sparkleBoxes = [MID, ...flatClips(layout).map((c) => c.box)];
  const twinkles = Array.from({ length: 9 }, () => {
    const b = sparkleBoxes[Math.floor(tr() * sparkleBoxes.length)];
    return { x: Math.round(b.x - 14 + tr() * (b.w + 28)), y: Math.round(tr() < 0.5 ? b.y - 22 + tr() * 8 : b.y + b.h + 14 + tr() * 8), phase: tr() };
  });

  const analytic = analyticSpec ? {
    box: analyticSpec.box,
    bars: clips.filter((c) => (c.views ?? 0) > 0).slice(0, 8).map((c, i) => ({ views: c.views ?? 0, hot: i === 0 })),
    lit: LADDER.filter((m) => data.stats.views >= m).length,
  } : null;
  return { bases, intro, views: data.stats.views, tier, style, layout, geo, twinkles, notch, analytic };
}

const builtCache = new Map<string, Promise<Built>>();
const BUILT_CACHE_MAX = 6;

function cacheKey(data: ShareAgentData, nonce: string | number) {
  const clips = (data.clips ?? []).map((c) => `${c.frames.length}:${c.frames[0]?.length ?? 0}:${c.views ?? ""}`).join(",");
  return JSON.stringify([data.mint, data.stats, data.avatarUrl, String(nonce), clips]);
}

function built(data: ShareAgentData, nonce: string | number): Promise<Built> {
  const key = cacheKey(data, nonce);
  let p = builtCache.get(key);
  if (!p) {
    p = build(data, nonce);
    p.catch(() => builtCache.delete(key));
    builtCache.set(key, p);
    if (builtCache.size > BUILT_CACHE_MAX) builtCache.delete(builtCache.keys().next().value as string);
  }
  return p;
}

/** GIF frame i → which baked base it sits on. Frames 0–3 resolve from coarse
 *  pixels, the last two dissolve back, the rest play the data-card video at ~3 fps. */
function baseFor(b: Built, i: number): { base: Buffer; settled: boolean } {
  if (i < 2) return { base: b.intro[0], settled: false };
  if (i < 4 || i >= SHARE_FRAMES - 2) return { base: b.intro[1], settled: false };
  return { base: b.bases[Math.floor((i - 4) / 3) % b.bases.length], settled: true };
}

async function frameRaw(b: Built, i: number): Promise<Buffer> {
  const { base, settled } = baseFor(b, i);
  if (!settled) return base;
  return sharp(base, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(dynamicSvg(i / SHARE_FRAMES, b)) }]).removeAlpha().raw().toBuffer();
}

/* ── Public render API ─────────────────────────────────────────────────────── */

const pngCache = new Map<string, Promise<Buffer>>();
const gifCache = new Map<string, Promise<Buffer>>();
const OUT_CACHE_MAX = 12;
let gifQueue: Promise<unknown> = Promise.resolve();

function remember(cache: Map<string, Promise<Buffer>>, key: string, job: Promise<Buffer>) {
  job.catch(() => cache.delete(key));
  cache.set(key, job);
  if (cache.size > OUT_CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return job;
}

/** Which renderer draws this agent's tier. */
function designFor(views: number): "membership" | "black" | "clips" {
  const m = tierFor(views).material;
  return m === "gold" || m === "platinum" ? "membership" : m === "black" ? "black" : "clips";
}

/** Static PNG — the settled loop frame. */
export async function renderShareCard(data: ShareAgentData, nonce: string | number): Promise<Response> {
  const key = cacheKey(data, nonce);
  const png = await (pngCache.get(key) ?? remember(pngCache, key, (async () => {
    const design = designFor(data.stats.views);
    if (design === "black") return (await import("@/lib/server/xShareDesigns/blackCard")).blackPng(data, nonce);
    if (design === "membership") return (await import("@/lib/server/xShareDesigns/membershipCard")).membershipPng(data, nonce);
    const b = await built(data, nonce);
    return sharp(b.bases[0], { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(dynamicSvg(STILL_T, b, true)) }]).png({ compressionLevel: 6 }).toBuffer();
  })()));
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}

/** Animated GIF — SHARE_FRAMES frames at SHARE_FRAME_MS, looping forever.
 *  Renders are queued one at a time so a burst can't stack CPU/memory. */
export function renderShareGif(data: ShareAgentData, nonce: string | number): Promise<Buffer> {
  const key = cacheKey(data, nonce);
  const hit = gifCache.get(key);
  if (hit) return hit;
  const job = gifQueue.then(async () => {
    const design = designFor(data.stats.views);
    if (design === "black") return (await import("@/lib/server/xShareDesigns/blackCard")).blackGif(data, nonce);
    if (design === "membership") return (await import("@/lib/server/xShareDesigns/membershipCard")).membershipGif(data, nonce);
    const b = await built(data, nonce);
    const frames: Buffer[] = [];
    for (let i = 0; i < SHARE_FRAMES; i += 6) {
      frames.push(...await Promise.all(Array.from({ length: Math.min(6, SHARE_FRAMES - i) }, (_, k) => frameRaw(b, i + k))));
    }
    return sharp(Buffer.concat(frames), { raw: { width: W, height: H * SHARE_FRAMES, channels: 3, pageHeight: H } })
      .gif({ delay: frames.map(() => SHARE_FRAME_MS), loop: 0, effort: 4, dither: 0, interFrameMaxError: 6, reuse: false })
      .toBuffer();
  });
  gifQueue = job.catch(() => undefined);
  return remember(gifCache, key, job);
}
