/* ════════ Share on X — animated membership-card renderer ════════
   Renders the 1200×675 SOLCAMEO MEMBERSHIP card frame by frame and encodes the
   loop to an animated GIF with sharp. The static PNG (renderShareCard) is one
   settled frame of the same animation, so the in-app preview, the /dev/x-cards
   gallery and the posted media are all one design.

   Digital identity:
   - The REAL Solcameo logo (assets/lo.png) is pixelated at load time — its alpha
     and shading are sampled into a pixel grid — and used for the header lockup
     and the card emblem. Nothing hand-drawn stands in for the brand.
   - The agent's profile image is pixelated and "resolves" from coarse blocks
     to a crisp pixel portrait.
   - The card materializes from pixel blocks and disintegrates at loop end;
     the name enters with an RGB-split glitch; views count up on a 5×7 matrix.

   Each tier has its own card material AND its own signature element:
     MEMBER    graphite dot-matrix, scanline, faint pixel-logo watermark
     SILVER    brushed metal, engraved pinstripe band, strong light sweep
     GOLD      hatched gold, embossed pixel-logo watermark, pixel twinkles
     PLATINUM  iridescent + guilloche, animated holographic pixel foil
     BLACK     gold guilloche, pixel lattice border, gold pixel comet

   Pipeline: static layers (backdrop, card faces, logo grids, avatar mosaics)
   are baked once with sharp; each frame is laid out by satori and rasterized
   by sharp's native librsvg straight onto the baked backdrop. Stats come from
   Convex, never the client, so a card can't claim views an agent doesn't have. */

import { LOGO_FILE as BRAND_LOGO, LOGO_CUT } from "@/lib/server/brandLogo";
import type { ReactNode } from "react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import satori from "satori";
import sharp from "sharp";
import type { ShareAgentData } from "@/lib/server/xShareCardRender";
import {
  CARD_H, CARD_W, FACE_H, FACE_W, SHARE_FRAMES, SHARE_FRAME_MS, SHARE_TIERS, compactNumber, hashSeed, nextTierFor, pickVariant,
  type ShareLayout, type ShareMaterial, type ShareTier, type ShareVariant,
} from "@/lib/share/xShareCard";

/* Restored from bcc4ea5b ("the first card design"): the SOLCAMEO MEMBERSHIP
   physical card with its original animation. It now serves the PLATINUM tier
   of the share-card system (see ../xShareCardRender.tsx); stats loading and
   caching live in the main renderer. */

/* ── Pixel primitives ───────────────────────────────────────────────────────── */

/** One lit cell of a pixelated image; `shade` 0..1 is its sampled lightness. */
interface PxCell { x: number; y: number; shade: number }
interface PxGrid { cols: number; rows: number; cells: PxCell[] }

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

function glyphCells(rows: string[]): PxCell[] {
  const out: PxCell[] = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "X") out.push({ x, y, shade: 1 }); }));
  return out;
}

/** Draw pixel cells. `reveal` 0..1 prints them in reading order (a scan-in);
 *  shading modulates opacity so the pixelated 3D logo keeps its depth. */
function Pixels({ grid, px, gap, color, left, top, reveal = 1, shadeFloor = 1, key0 = "" }: {
  grid: { cells: PxCell[] }; px: number; gap: number; color: string; left: number; top: number; reveal?: number; shadeFloor?: number; key0?: string;
}) {
  const cell = px + gap;
  const shown = Math.round(grid.cells.length * Math.max(0, Math.min(1, reveal)));
  return (
    <>
      {grid.cells.slice(0, shown).map((c) => (
        <div
          key={`${key0}${c.x}-${c.y}`}
          style={{
            position: "absolute", left: left + c.x * cell, top: top + c.y * cell, width: px, height: px, display: "flex",
            backgroundColor: color, opacity: shadeFloor + (1 - shadeFloor) * c.shade,
          }}
        />
      ))}
    </>
  );
}

function pixelText(text: string) {
  let x = 0;
  const glyphs: { rows: string[]; cells: PxCell[]; x: number }[] = [];
  for (const ch of text) {
    const rows = PIXEL_GLYPHS[ch];
    if (!rows) continue;
    glyphs.push({ rows, cells: glyphCells(rows), x });
    x += rows[0].length + 1;
  }
  return { glyphs, cols: Math.max(0, x - 1) };
}

/** Static pixel art (logo lockups, emblem) baked to a PNG sprite once, so a
 *  frame draws ONE image instead of hundreds of cell nodes. Reveals are a
 *  growing clip over the sprite with a scan edge — still a pixel "print". */
interface Sprite { url: string; w: number; h: number }
const spriteCache = new Map<string, Promise<Sprite>>();

function sprite(grid: PxGrid, px: number, gap: number, color: string, shadeFloor: number): Promise<Sprite> {
  const cell = px + gap;
  const key = `${grid.cols}x${grid.rows}:${grid.cells.length}:${px}:${gap}:${color}:${shadeFloor}`;
  let p = spriteCache.get(key);
  if (!p) {
    const w = grid.cols * cell, h = grid.rows * cell;
    const rects = grid.cells.map((c) => `<rect x="${c.x * cell}" y="${c.y * cell}" width="${px}" height="${px}" fill="${color}" fill-opacity="${(shadeFloor + (1 - shadeFloor) * c.shade).toFixed(3)}"/>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
    p = sharp(Buffer.from(svg)).png().toBuffer().then((b) => ({ url: pngDataUrl(b), w, h }));
    p.catch(() => spriteCache.delete(key));
    spriteCache.set(key, p);
  }
  return p;
}

function SpriteImg({ s, left, top, reveal = 1, scan }: { s: Sprite; left: number; top: number; reveal?: number; scan?: string }) {
  const r = Math.max(0, Math.min(1, reveal));
  if (r <= 0) return null;
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={s.url} alt="" width={s.w} height={s.h} style={{ position: "absolute", left: 0, top: 0 }} />;
  const h = Math.max(1, Math.round(s.h * r));
  return (
    <div style={{ position: "absolute", left, top, width: s.w, height: s.h, display: "flex" }}>
      {r >= 1 ? img : <div style={{ position: "absolute", left: 0, top: 0, width: s.w, height: h, display: "flex", overflow: "hidden" }}>{img}</div>}
      {scan && r < 1 ? <div style={{ position: "absolute", left: -4, top: h - 1, width: s.w + 8, height: 2, display: "flex", backgroundColor: scan }} /> : null}
    </div>
  );
}

/* ── Static assets (read / baked once per process) ─────────────────────────── */

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
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
const LOGO_FILE = BRAND_LOGO;
/** Brand lime, sampled from the logo mark. */
const BRAND_LIME = "#C8F02A";

interface Logo {
  /** Mark (the 3D glyph) at card-emblem and header resolutions. */
  markLg: PxGrid;
  markSm: PxGrid;
  /** "vello" wordmark at header and card-print resolutions. */
  word: PxGrid;
  wordSm: PxGrid;
}

interface Assets {
  fonts: Font[];
  socialIcons: Record<string, string>;
  faces: Record<ShareMaterial, string>;
  logo: Logo;
}
let assetsPromise: Promise<Assets> | null = null;
type Backdrop = { url: string; buf: Buffer };
const backdropCache = new Map<string, Promise<Backdrop>>();

const pub = (...p: string[]) => join(process.cwd(), "public", ...p);
const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const pngDataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
const svgToPng = async (svg: string) => pngDataUrl(await sharp(Buffer.from(svg)).png().toBuffer());

/** Pixelate a region of the logo PNG into a grid of lit cells (alpha-thresholded,
 *  lightness kept as `shade` so the 3D bevel survives as pixel shading). */
async function pixelizeLogo(src: Buffer, region: { left: number; width: number }, cols: number): Promise<PxGrid> {
  const meta = await sharp(src).metadata();
  // Two passes: in one pipeline sharp trims BEFORE extracting, which breaks the region.
  const region1 = await sharp(src).extract({ left: region.left, top: 0, width: region.width, height: meta.height ?? 300 }).png().toBuffer();
  const cropped = await sharp(region1).trim().toBuffer();
  const m = await sharp(cropped).metadata();
  const rows = Math.max(1, Math.round((cols * (m.height ?? 1)) / (m.width ?? 1)));
  const { data } = await sharp(cropped).ensureAlpha().resize(cols, rows, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  const raw: { x: number; y: number; lum: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      if (data[i + 3] / 255 < 0.42) continue;
      raw.push({ x, y, lum: (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255 });
    }
  }
  const lo = Math.min(...raw.map((c) => c.lum)), hi = Math.max(...raw.map((c) => c.lum));
  const span = hi - lo || 1;
  return { cols, rows, cells: raw.map((c) => ({ x: c.x, y: c.y, shade: (c.lum - lo) / span })) };
}

async function loadLogo(): Promise<Logo> {
  const src = await readFile(LOGO_FILE);
  const w = (await sharp(src).metadata()).width ?? 1000;
  const mark = { left: 0, width: Math.round(w * LOGO_CUT) };
  const word = { left: Math.round(w * LOGO_CUT), width: w - Math.round(w * LOGO_CUT) };
  const [markLg, markSm, wordGrid, wordSm] = await Promise.all([
    pixelizeLogo(src, mark, 20),
    pixelizeLogo(src, mark, 9),
    pixelizeLogo(src, word, 46),
    pixelizeLogo(src, word, 34),
  ]);
  return { markLg, markSm, word: wordGrid, wordSm };
}

const FACE_R = 22;
const faceCenter = { x: FACE_W / 2 + 40, y: FACE_H / 2 - 4 };

function facePattern(t: ShareTier, logo: Logo): string {
  const c = t.card;
  const m = t.material;
  const parts: string[] = [];
  if (c.pattern === "dots") {
    parts.push(`<defs><pattern id="p" width="9" height="9" patternUnits="userSpaceOnUse"><rect x="4" y="4" width="1.4" height="1.4" fill="${c.patternColor}"/></pattern></defs><rect width="${FACE_W}" height="${FACE_H}" fill="url(#p)"/>`);
  }
  if (c.pattern === "lines") {
    parts.push(`<defs><pattern id="p" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><rect width="0.8" height="5" fill="${c.patternColor}"/></pattern></defs><rect width="${FACE_W}" height="${FACE_H}" fill="url(#p)"/>`);
  }
  if (c.pattern === "rosette") {
    const { x, y } = faceCenter;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      parts.push(`<circle cx="${(x + Math.cos(a) * 46).toFixed(2)}" cy="${(y + Math.sin(a) * 46).toFixed(2)}" r="78" fill="none" stroke="${c.patternColor}" stroke-width="0.45"/>`);
    }
    for (let i = 0; i < 10; i++) parts.push(`<circle cx="${x}" cy="${y}" r="${140 + i * 16}" fill="none" stroke="${c.patternColor}" stroke-width="0.4"/>`);
  }
  // Tier signatures, baked.
  if (m === "silver") {
    for (let i = 0; i < 7; i++) parts.push(`<rect x="0" y="${190 + i * 5}" width="${FACE_W}" height="1" fill="rgba(0,0,0,${i % 2 ? 0.05 : 0.09})"/>`);
    parts.push(`<rect x="0" y="189" width="${FACE_W}" height="1" fill="rgba(255,255,255,0.6)"/><rect x="0" y="225" width="${FACE_W}" height="1" fill="rgba(255,255,255,0.6)"/>`);
  }
  if (m === "black") {
    // Gold pixel lattice inset border.
    const inset = 10;
    for (let x = inset; x <= FACE_W - inset; x += 8) {
      parts.push(`<rect x="${x}" y="${inset}" width="2" height="2" fill="rgba(205,174,110,0.35)"/><rect x="${x}" y="${FACE_H - inset - 2}" width="2" height="2" fill="rgba(205,174,110,0.35)"/>`);
    }
    for (let y = inset + 8; y < FACE_H - inset; y += 8) {
      parts.push(`<rect x="${inset}" y="${y}" width="2" height="2" fill="rgba(205,174,110,0.35)"/><rect x="${FACE_W - inset - 2}" y="${y}" width="2" height="2" fill="rgba(205,174,110,0.35)"/>`);
    }
  }
  return parts.join("");
}

function faceSvg(t: ShareTier, logo: Logo): string {
  const c = t.card;
  const stops = c.stops.map((s, i, a) => `<stop offset="${(i / (a.length - 1)).toFixed(3)}" stop-color="${s}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}" height="${FACE_H}" viewBox="0 0 ${FACE_W} ${FACE_H}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${c.noise}" numOctaves="2" seed="11"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${c.noiseAlpha}"/></feComponentTransfer></filter>
<clipPath id="c"><rect width="${FACE_W}" height="${FACE_H}" rx="${FACE_R}"/></clipPath>
</defs>
<g clip-path="url(#c)">
<rect width="${FACE_W}" height="${FACE_H}" fill="url(#g)"/>
<rect width="${FACE_W}" height="${FACE_H}" filter="url(#n)"/>
${facePattern(t, logo)}
</g>
<rect x="0.5" y="0.5" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="${FACE_R - 0.5}" fill="none" stroke="${c.edge}" stroke-width="1"/>
</svg>`;
}

function cardBox(layout: ShareLayout): { x: number; y: number } {
  if (layout === "panelLeft") return { x: 72, y: 170 };
  if (layout === "centered") return { x: (CARD_W - FACE_W) / 2, y: 74 };
  return { x: CARD_W - FACE_W - 72, y: 170 };
}

/** A card from a lower tier fanned behind the agent's own card (GOLD's
 *  three-card hand): rotated about the front card's bottom corner, dimmed. */
interface BackCard { tier: ShareTier; face: string; fan: number }

function backCardsSvg(cards: BackCard[], layout: ShareLayout, angle: number): string {
  if (!cards.length) return "";
  const { x, y } = cardBox(layout);
  const px = layout === "panelLeft" ? x + FACE_W : x, py = y + FACE_H;
  const cx = x + FACE_W / 2, cy = y + FACE_H / 2;
  return `<defs><clipPath id="bc" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${FACE_W}" height="${FACE_H}" rx="${FACE_R}"/></clipPath></defs>` +
    cards.map(({ tier, face, fan }, i) => `<g transform="rotate(${fan} ${px} ${py}) rotate(${angle} ${cx} ${cy})">
<rect x="${x + 24}" y="${y + 40}" width="${FACE_W - 48}" height="${FACE_H - 24}" rx="30" fill="rgba(0,0,0,0.7)" filter="url(#s)"/>
<g clip-path="url(#bc)"><image href="${face}" x="${x}" y="${y}" width="${FACE_W}" height="${FACE_H}"/><rect x="${x}" y="${y}" width="${FACE_W}" height="${FACE_H}" fill="#000" opacity="${0.18 + i * 0.12}"/></g>
<rect x="${x + 0.5}" y="${y + 0.5}" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="${FACE_R}" fill="none" stroke="${tier.card.edge}"/>
<text x="${layout === "panelLeft" ? x + 26 : x + FACE_W - 26}" y="${y + 38}" text-anchor="${layout === "panelLeft" ? "start" : "end"}" font-family="Helvetica, Arial, sans-serif" font-size="13" letter-spacing="3" fill="${tier.card.inkMuted}">${tier.label}</text>
</g>`).join("");
}

/** Frame backdrop: flat bg, digital dot grid, light pool + baked card shadow, vignette. */
function backdropSvg(t: ShareTier, layout: ShareLayout, back: BackCard[] = [], angle = 0): string {
  const { x, y } = cardBox(layout);
  const cx = ((x + FACE_W / 2) / CARD_W * 100).toFixed(1);
  const cy = ((y + FACE_H / 2) / CARD_H * 100).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
<defs>
<pattern id="d" width="22" height="22" patternUnits="userSpaceOnUse"><rect x="10" y="10" width="1.5" height="1.5" fill="rgba(255,255,255,0.055)"/></pattern>
<radialGradient id="l" cx="${cx}%" cy="${cy}%" r="46%"><stop offset="0" stop-color="${t.glow}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
<radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="0.55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.75)"/></radialGradient>
<filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
</defs>
<rect width="100%" height="100%" fill="${t.bg}"/>
<rect width="100%" height="100%" fill="url(#d)"/>
<rect width="100%" height="100%" fill="url(#l)"/>
<rect width="100%" height="100%" fill="url(#v)"/>
${backCardsSvg(back, layout, angle)}
<rect x="${x + 28}" y="${y + 58}" width="${FACE_W - 56}" height="${FACE_H - 20}" rx="30" fill="rgba(0,0,0,0.85)" filter="url(#s)"/>
</svg>`;
}

function loadAssets(): Promise<Assets> {
  assetsPromise ??= (async () => {
    const [manrope, grotesk, fraunces, logo] = await Promise.all([
      readFile(pub("fonts", "captions", "Manrope-Medium.ttf")),
      readFile(pub("fonts", "captions", "SpaceGrotesk-Medium.ttf")),
      readFile(pub("fonts", "captions", "Fraunces-SemiBold.ttf")),
      loadLogo(),
    ]);
    const fonts: Font[] = [
      { name: "Manrope", data: toArrayBuffer(manrope), weight: 500, style: "normal" },
      { name: "Grotesk", data: toArrayBuffer(grotesk), weight: 500, style: "normal" },
      { name: "Fraunces", data: toArrayBuffer(fraunces), weight: 600, style: "normal" },
    ];
    const socialIcons = Object.fromEntries(await Promise.all(Object.entries(SOCIAL_PATHS).map(async ([id, path]) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="white">${path}</svg>`;
      return [id, await svgToPng(svg)];
    })));
    // JPEG, not PNG: the grain makes a PNG ~10× bigger, and this image is
    // embedded in every frame's SVG. Corners are clipped by the card container.
    const faces = Object.fromEntries(await Promise.all(SHARE_TIERS.map(async (t) => {
      const jpg = await sharp(Buffer.from(faceSvg(t, logo))).flatten({ background: t.bg }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
      return [t.material, `data:image/jpeg;base64,${jpg.toString("base64")}`];
    }))) as Record<ShareMaterial, string>;
    return { fonts, socialIcons, faces, logo };
  })().catch((e) => { assetsPromise = null; throw e; });
  return assetsPromise;
}

function backdropFor(t: ShareTier, layout: ShareLayout, back: BackCard[] = [], angle = 0): Promise<Backdrop> {
  const key = `${t.material}:${layout}:${back.length ? angle : "solo"}`;
  let p = backdropCache.get(key);
  if (!p) {
    p = sharp(Buffer.from(backdropSvg(t, layout, back, angle))).png().toBuffer().then((buf) => ({ buf, url: pngDataUrl(buf) }));
    p.catch(() => backdropCache.delete(key));
    backdropCache.set(key, p);
  }
  return p;
}

/* ── Agent avatar → pixel mosaics ──────────────────────────────────────────── */

const AVATAR_PX = 72;
/** Block counts per side, coarse → the final crisp pixel portrait. */
const AVATAR_LEVELS = [4, 6, 9, 13, 18, 24];

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

/** One nearest-neighbour mosaic per level — the reveal steps through them. */
async function avatarMosaics(url: string | null): Promise<string[] | null> {
  const src = await avatarSource(url);
  if (!src) return null;
  try {
    const base = await sharp(src).resize(240, 240, { fit: "cover", position: "attention" }).flatten({ background: "#111" }).png().toBuffer();
    return await Promise.all(AVATAR_LEVELS.map(async (n) => {
      const small = await sharp(base).resize(n, n, { kernel: "cubic" }).png().toBuffer();
      return pngDataUrl(await sharp(small).resize(AVATAR_PX, AVATAR_PX, { kernel: "nearest" }).png().toBuffer());
    }));
  } catch {
    return null;
  }
}

/* ── Timeline helpers ───────────────────────────────────────────────────────── */

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOut = (n: number) => 1 - Math.pow(1 - clamp01(n), 3);
const easeInOut = (n: number) => { const x = clamp01(n); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** The settled frame used for the static PNG. */
const STILL_T = 0.62;

/** A point on the card's edge, s ∈ [0,1) clockwise from top-left. */
function edgePoint(s: number): { x: number; y: number } {
  const per = 2 * (FACE_W + FACE_H);
  let d = ((s % 1) + 1) % 1 * per;
  if (d < FACE_W) return { x: d, y: 0 };
  d -= FACE_W;
  if (d < FACE_H) return { x: FACE_W, y: d };
  d -= FACE_H;
  if (d < FACE_W) return { x: FACE_W - d, y: FACE_H };
  d -= FACE_W;
  return { x: 0, y: FACE_H - d };
}

/** Pixel-block cover over the card: blocks drop out as `p` goes 0→1. */
const DISSOLVE_COLS = 16;
const DISSOLVE_ROWS = 10;
function Dissolve({ p, color, edgeColor, seed }: { p: number; color: string; edgeColor: string; seed: number }) {
  if (p >= 1) return null;
  const bw = FACE_W / DISSOLVE_COLS, bh = FACE_H / DISSOLVE_ROWS;
  const blocks: ReactNode[] = [];
  for (let y = 0; y < DISSOLVE_ROWS; y++) {
    for (let x = 0; x < DISSOLVE_COLS; x++) {
      // Bias toward a left→right sweep with pixel noise on top.
      const th = 0.55 * (x / DISSOLVE_COLS) + 0.45 * ((hashSeed(seed, x, y) % 1000) / 1000);
      if (p > th) continue;
      const edge = p > th - 0.08;
      blocks.push(
        <div key={`${x}-${y}`} style={{ position: "absolute", left: Math.floor(x * bw), top: Math.floor(y * bh), width: Math.ceil(bw) + 1, height: Math.ceil(bh) + 1, display: "flex", backgroundColor: edge ? edgeColor : color, opacity: edge ? 0.45 : 1 }} />,
      );
    }
  }
  return <>{blocks}</>;
}

/* ── Card face (dynamic layer over the baked face) ─────────────────────────── */

function CardFace({ v, t, face, name, sprites }: { v: ShareVariant; t: number; face: string; name: string; sprites: Sprites }) {
  const tier = v.tier;
  const c = tier.card;
  const m = tier.material;
  const sweep = span(t, 0.34, 0.8);
  const sheenX = -220 + easeInOut(sweep) * (FACE_W + 440);
  const eW = sprites.emblem.w, eH = sprites.emblem.h;
  const emblemReveal = easeOut(span(t, m === "black" ? 0.1 : 0.08, m === "black" ? 0.38 : 0.26));
  const year = String(new Date().getUTCFullYear()).slice(-2);
  const cardName = name.toUpperCase().slice(0, 24);

  // Only full-bleed layers that must be clipped to the rounded card live inside
  // the overflow:hidden box. Everything else (pixel emblem, wordmark, chip,
  // text, twinkles, foil) sits inside the card bounds anyway and is drawn as a
  // SIBLING — satori wraps every descendant of an overflow:hidden box in its own
  // <mask>, and hundreds of pixel cells in there made each frame ~5× slower.
  return (
    <>
    <div style={{ position: "absolute", left: 0, top: 0, width: FACE_W, height: FACE_H, display: "flex", borderRadius: FACE_R, overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={face} alt="" width={FACE_W} height={FACE_H} style={{ position: "absolute", left: 0, top: 0 }} />

      {m === "platinum" && (
        <div style={{
          position: "absolute", left: 0, top: 0, width: FACE_W, height: FACE_H, display: "flex", opacity: 0.5,
          backgroundImage: `linear-gradient(${Math.round(110 + 70 * Math.sin(t * Math.PI * 2))}deg, rgba(255,170,225,0) 0%, rgba(255,170,225,0.38) 22%, rgba(150,200,255,0.38) 44%, rgba(160,255,215,0.32) 66%, rgba(255,225,150,0.32) 84%, rgba(255,225,150,0) 100%)`,
        }} />
      )}

      {m === "graphite" && (
        <div style={{ position: "absolute", left: 0, top: Math.round(((t * 1.4) % 1) * FACE_H), width: FACE_W, height: 2, display: "flex", backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.3), rgba(255,255,255,0))" }} />
      )}

      {/* light sweep */}
      <div style={{
        position: "absolute", left: sheenX, top: -120, width: 150, height: FACE_H + 240, display: "flex", transform: "rotate(22deg)",
        backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${c.sheen}) 50%, rgba(255,255,255,0) 100%)`,
      }} />
    </div>
    <div style={{ position: "absolute", left: 0, top: 0, width: FACE_W, height: FACE_H, display: "flex" }}>

      {m === "gold" && v.sparkles.map((s, i) => {
        const o = Math.max(0, Math.sin((t * 2 + s.phase) * Math.PI * 2));
        const halo = s.size * 3;
        return (
          <div key={i} style={{ position: "absolute", left: s.x - s.size, top: s.y - s.size, width: halo, height: halo, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: `rgba(255,240,200,${(o * 0.18).toFixed(3)})` }}>
            <div style={{ display: "flex", width: s.size, height: s.size, backgroundColor: "#FFF6DC", opacity: o * 0.95 }} />
          </div>
        );
      })}

      {/* platinum: holographic pixel foil — a security hologram in pixels */}
      {m === "platinum" && Array.from({ length: 6 * 8 }, (_, i) => {
        const x = i % 8, y = Math.floor(i / 8);
        const h = Math.round((x * 22 + y * 30 + t * 360) % 360);
        return <div key={i} style={{ position: "absolute", left: 30 + 60 + x * 7, top: 118 + y * 7, width: 6, height: 6, display: "flex", backgroundColor: `hsl(${h}, 80%, 72%)`, opacity: 0.75 }} />;
      })}

      {/* pixelated wordmark (real logo) + tier */}
      <SpriteImg s={sprites.cardWord} left={26} top={24} />
      <div style={{ position: "absolute", right: 26, top: 27, display: "flex", fontFamily: "Grotesk", fontSize: 10.5, letterSpacing: 3, color: c.inkMuted }}>{tier.label}</div>

      {/* chip */}
      <div style={{ position: "absolute", left: 30, top: 116, width: 50, height: 38, display: "flex", borderRadius: 7, backgroundImage: `linear-gradient(135deg, ${c.chip[1]} 0%, ${c.chip[0]} 55%, ${c.chip[1]} 100%)`, border: "1px solid rgba(0,0,0,0.25)" }}>
        <div style={{ position: "absolute", left: 0, top: 12, width: 50, height: 1, display: "flex", backgroundColor: "rgba(0,0,0,0.28)" }} />
        <div style={{ position: "absolute", left: 0, top: 25, width: 50, height: 1, display: "flex", backgroundColor: "rgba(0,0,0,0.28)" }} />
        <div style={{ position: "absolute", left: 24, top: 0, width: 1, height: 38, display: "flex", backgroundColor: "rgba(0,0,0,0.28)" }} />
      </div>

      {/* pixelated real logo mark — prints in, pixel by pixel */}
      <SpriteImg s={sprites.emblem} left={Math.round(faceCenter.x - eW / 2)} top={Math.round(faceCenter.y - eH / 2)} reveal={emblemReveal} scan={tier.accent} />

      <div style={{ position: "absolute", left: 26, bottom: 44, display: "flex", fontFamily: "Grotesk", fontSize: 15, letterSpacing: 2.5, color: c.ink }}>{cardName}</div>
      <div style={{ position: "absolute", left: 26, bottom: 24, display: "flex", fontFamily: "Grotesk", fontSize: 10, letterSpacing: 2, color: c.inkMuted }}>{`MEMBER N° ${v.memberId}`}</div>
      <div style={{ position: "absolute", right: 26, bottom: 24, display: "flex", fontFamily: "Grotesk", fontSize: 10, letterSpacing: 2, color: c.inkMuted }}>{`SINCE ${year}`}</div>
    </div>
    </>
  );
}

/* ── Frame ──────────────────────────────────────────────────────────────────── */

function nameSize(name: string, centered: boolean) {
  const n = name.length;
  const s = n <= 10 ? 50 : n <= 16 ? 40 : 32;
  return centered ? Math.round(s * 0.8) : s;
}

/** Pixel avatar: steps coarse → crisp, a scanline wiping down while it resolves. */
function Avatar({ mosaics, t, accent, left, top, fallback }: { mosaics: string[] | null; t: number; accent: string; left: number; top: number; fallback: Sprite }) {
  const p = span(t, 0.08, 0.34);
  const level = mosaics ? mosaics[Math.min(mosaics.length - 1, Math.floor(easeOut(p) * mosaics.length))] : null;
  const scanY = Math.round(p * AVATAR_PX);
  const bracket = (x: number, y: number, rot: number) => (
    <div key={`${x}${y}`} style={{ position: "absolute", left: x, top: y, width: 10, height: 10, display: "flex", transform: `rotate(${rot}deg)` }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 10, height: 2, display: "flex", backgroundColor: accent }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: 2, height: 10, display: "flex", backgroundColor: accent }} />
    </div>
  );
  return (
    <div style={{ position: "absolute", left, top, width: AVATAR_PX, height: AVATAR_PX, display: "flex", opacity: span(t, 0.04, 0.1) }}>
      {level ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={level} alt="" width={AVATAR_PX} height={AVATAR_PX} style={{ position: "absolute", left: 0, top: 0 }} />
      ) : (
        <div style={{ position: "absolute", left: 0, top: 0, width: AVATAR_PX, height: AVATAR_PX, display: "flex", backgroundColor: "rgba(255,255,255,0.04)" }}>
          <SpriteImg s={fallback} left={Math.round((AVATAR_PX - fallback.w) / 2)} top={Math.round((AVATAR_PX - fallback.h) / 2)} reveal={easeOut(p)} scan={accent} />
        </div>
      )}
      {p > 0 && p < 1 ? <div style={{ position: "absolute", left: 0, top: scanY, width: AVATAR_PX, height: 3, display: "flex", backgroundColor: accent, opacity: 0.85 }} /> : null}
      {bracket(-5, -5, 0)}
      {bracket(AVATAR_PX - 5, -5, 90)}
      {bracket(AVATAR_PX - 5, AVATAR_PX - 5, 180)}
      {bracket(-5, AVATAR_PX - 5, 270)}
    </div>
  );
}

/** Glitch-in name: RGB-split ghosts with a frame-seeded jitter for the first beat. */
function GlitchName({ text, size, t, seed }: { text: string; size: number; t: number; seed: number }) {
  const g = t > 0.03 && t < 0.15 ? 1 - span(t, 0.03, 0.15) : 0;
  const jitter = g > 0 ? ((hashSeed(seed, Math.round(t * 100)) % 7) - 3) : 0;
  const base = { position: "absolute" as const, left: 0, top: 0, display: "flex", fontFamily: "Manrope", fontSize: size, letterSpacing: -1, lineHeight: 1.05, whiteSpace: "nowrap" as const };
  return (
    <div style={{ position: "relative", display: "flex", height: Math.round(size * 1.08) }}>
      {g > 0 ? <div style={{ ...base, left: jitter - 4 * g, color: "#FF2A6D", opacity: 0.65 * g }}>{text}</div> : null}
      {g > 0 ? <div style={{ ...base, left: -jitter + 4 * g, color: "#2AF6FF", opacity: 0.65 * g }}>{text}</div> : null}
      <div style={{ display: "flex", fontFamily: "Manrope", fontSize: size, letterSpacing: -1, lineHeight: 1.05, color: "#F4F4F1", whiteSpace: "nowrap", marginLeft: jitter }}>{text}</div>
    </div>
  );
}

/** FOMO, honestly: a pixel progress bar to the next tier using real views. */
const BAR_SEG = 28;
const BAR_W = BAR_SEG * 9 - 2;

function NextTierBar({ views, accent, t, left, top }: { views: number; accent: string; t: number; left: number; top: number }) {
  const next = nextTierFor(views);
  const SEG = BAR_SEG;
  const fill = next ? Math.round(SEG * next.progress * easeOut(span(t, 0.18, 0.46))) : Math.round(SEG * easeOut(span(t, 0.18, 0.46)));
  const shimmer = Math.floor(((t * 2) % 1) * SEG);
  const pct = next ? Math.floor(next.progress * 100) : 100;
  return (
    <div style={{ position: "absolute", left, top, display: "flex", flexDirection: "column", opacity: easeOut(span(t, 0.16, 0.3)) * (1 - span(t, 0.93, 1)) }}>
      <div style={{ display: "flex", position: "relative", width: SEG * 9, height: 7 }}>
        {Array.from({ length: SEG }, (_, i) => (
          <div key={i} style={{
            position: "absolute", left: i * 9, top: 0, width: 7, height: 7, display: "flex",
            backgroundColor: i < fill ? (i === shimmer ? "#FFFFFF" : accent) : "rgba(255,255,255,0.08)",
          }} />
        ))}
      </div>
      <div style={{ display: "flex", marginTop: 10, fontFamily: "Grotesk", fontSize: 10.5, letterSpacing: 3, color: "rgba(255,255,255,0.5)" }}>
        {next ? `${pct}% TO ${next.tier.label} · ${compactNumber(next.tier.min)} VIEWS` : "TOP TIER · INVITE ONLY"}
      </div>
    </div>
  );
}

function Frame({ data, v, t, face, backdrop, socialIcons, sprites, mosaics }: {
  data: ShareAgentData; v: ShareVariant; t: number; face: string; backdrop?: string; socialIcons: Record<string, string>; sprites: Sprites; mosaics: string[] | null;
}) {
  const { stats } = data;
  const tier = v.tier;
  const centered = v.layout === "centered";
  const box = cardBox(v.layout);
  const displayName = stats.name.length > 20 ? `${stats.name.slice(0, 18).trimEnd()}…` : stats.name;

  // Loop: materialize 0–0.24, count 0.08–0.4, ambient hold, disintegrate 0.9–1.
  const outro = 1 - span(t, 0.93, 1);
  const cardY = box.y + Math.round(Math.sin(t * Math.PI * 2) * 3);
  const dissolveP = t < 0.5 ? easeOut(span(t, 0.0, 0.24)) : 1 - span(t, 0.9, 0.99);
  const count = Math.round(stats.views * easeOut(span(t, 0.08, 0.4)));
  const counter = pixelText(compactNumber(count));
  const fadeIn = (a: number) => easeOut(span(t, a, a + 0.14)) * outro;

  const comet = tier.material === "black"
    ? Array.from({ length: 6 }, (_, i) => ({ ...edgePoint(t * 1.25 - i * 0.012), o: (1 - i / 6) * outro * span(t, 0.2, 0.3) }))
    : [];

  const px = centered ? 7 : 9;
  const gap = 2;
  const cell = px + gap;
  const counterW = counter.cols * cell - gap;
  const counterH = 7 * cell - gap;

  const textLeft = v.layout === "panelLeft" ? 650 : 72;
  const colTop = 138;
  const plats = [...new Set(stats.platforms.map((id) => (id === "twitter" ? "x" : id)))].filter((id) => socialIcons[id]).slice(0, 5);
  const counterLeft = centered ? CARD_W - 72 - BAR_W : textLeft;
  const counterTop = centered ? 452 : colTop + 128;
  const nameLeft = textLeft + AVATAR_PX + 22;
  const nameTop = centered ? 452 : colTop + 30;


  return (
    // No overflow:hidden on the root: satori turns it into a nested <mask> on
    // every descendant, which made librsvg ~30× slower per frame. The SVG
    // viewport already clips to 1200×675.
    <div style={{ width: CARD_W, height: CARD_H, display: "flex", position: "relative", ...(backdrop ? { backgroundColor: tier.bg } : {}), color: "#F2F2EF", fontFamily: "Manrope" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {backdrop ? <img src={backdrop} alt="" width={CARD_W} height={CARD_H} style={{ position: "absolute", left: 0, top: 0 }} /> : null}

      {/* header: the real logo, pixelated — mark in brand lime, wordmark in white */}
      <div style={{ position: "absolute", left: 40, top: 28, display: "flex", alignItems: "center", opacity: outro }}>
        <div style={{ position: "relative", width: sprites.headMark.w, height: sprites.headMark.h, display: "flex", marginRight: 10 }}>
          <SpriteImg s={sprites.headMark} left={0} top={0} reveal={easeOut(span(t, 0, 0.12))} scan={BRAND_LIME} />
        </div>
        <div style={{ position: "relative", width: sprites.headWord.w, height: sprites.headWord.h, display: "flex" }}>
          <SpriteImg s={sprites.headWord} left={0} top={0} reveal={easeOut(span(t, 0.03, 0.16))} scan="#F2F2EF" />
        </div>
        <div style={{ display: "flex", width: 1, height: 14, backgroundColor: "rgba(255,255,255,0.22)", marginLeft: 16, marginRight: 14 }} />
        <div style={{ display: "flex", fontFamily: "Grotesk", fontSize: 11, letterSpacing: 4, color: "rgba(255,255,255,0.42)" }}>MEMBERSHIP</div>
      </div>
      <div style={{ position: "absolute", right: 40, top: 34, display: "flex", fontFamily: "Grotesk", fontSize: 11, letterSpacing: 3, color: "rgba(255,255,255,0.38)", opacity: outro }}>{`N° ${v.memberId}`}</div>

      {/* card: materializes from pixel blocks, disintegrates at the loop end */}
      <div style={{ position: "absolute", left: box.x, top: cardY, width: FACE_W, height: FACE_H, display: "flex", transform: `rotate(${v.angle}deg)`, borderRadius: FACE_R }}>
        <CardFace v={v} t={t} face={face} name={stats.name} sprites={sprites} />
        {comet.length ? <div style={{ position: "absolute", left: comet[0].x - 8, top: comet[0].y - 8, width: 16, height: 16, display: "flex", backgroundColor: tier.accent, opacity: comet[0].o * 0.22 }} /> : null}
        {comet.map((p, i) => (
          <div key={i} style={{ position: "absolute", left: p.x - 3, top: p.y - 3, width: i > 2 ? 4 : 6, height: i > 2 ? 4 : 6, display: "flex", backgroundColor: tier.accent, opacity: p.o }} />
        ))}
        <Dissolve p={dissolveP} color={tier.bg} edgeColor={tier.accent} seed={v.seed} />
      </div>

      {/* tier line */}
      <div style={{ position: "absolute", left: textLeft, top: centered ? 418 : colTop, display: "flex", alignItems: "center", opacity: fadeIn(0.04) }}>
        <div style={{ display: "flex", width: 6, height: 6, backgroundColor: tier.accent, marginRight: 12 }} />
        <div style={{ display: "flex", fontFamily: "Grotesk", fontSize: 12, letterSpacing: 4, color: tier.accent }}>{`${tier.label}  ·  ${tier.zone.toUpperCase()}`}</div>
      </div>

      {/* pixel avatar + glitch-in name */}
      <Avatar mosaics={mosaics} t={t} accent={tier.accent} left={textLeft} top={nameTop} fallback={sprites.avatarFallback} />
      <div style={{ position: "absolute", left: nameLeft, top: nameTop + 4, display: "flex", flexDirection: "column", opacity: fadeIn(0.03) }}>
        <GlitchName text={displayName} size={nameSize(displayName, centered)} t={t} seed={v.seed} />
        {stats.handle ? <div style={{ display: "flex", fontFamily: "Grotesk", fontSize: 13, letterSpacing: 1, color: "rgba(255,255,255,0.42)", marginTop: 8 }}>{`@${stats.handle}`}</div> : null}
      </div>

      {/* pixel-matrix view counter */}
      <div style={{ position: "absolute", left: counterLeft, top: counterTop, width: Math.max(1, counterW), height: counterH, display: "flex", opacity: fadeIn(0.06) }}>
        {counter.glyphs.map((g, i) => (
          <div key={i} style={{ position: "absolute", left: g.x * cell, top: 0, width: g.rows[0].length * cell, height: counterH, display: "flex" }}>
            {g.rows[0].length > 1 ? (
              <Pixels grid={{ cells: g.rows.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === "X" ? [] : [{ x, y, shade: 1 }]))) }} px={px} gap={gap} color="rgba(255,255,255,0.045)" left={0} top={0} key0="d" />
            ) : null}
            <Pixels grid={g} px={px} gap={gap} color={tier.accent} left={0} top={0} key0="l" />
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: centered ? CARD_W - 72 - BAR_W : counterLeft, top: counterTop + counterH + 12, display: "flex", fontFamily: "Grotesk", fontSize: 11, letterSpacing: 5, color: "rgba(255,255,255,0.45)", opacity: fadeIn(0.1) }}>TRACKED VIEWS</div>
      <NextTierBar views={stats.views} accent={tier.accent} t={t} left={centered ? CARD_W - 72 - BAR_W : counterLeft} top={counterTop + counterH + 40} />

      {!centered && (
        <div style={{ position: "absolute", left: textLeft, top: colTop + 318, display: "flex", opacity: fadeIn(0.24) }}>
          {[
            ["VIDEOS", String(stats.videos)],
            ["POSTED", String(stats.posted)],
            ["BEST CLIP", compactNumber(stats.bestViews)],
          ].map(([label, value], i) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", paddingLeft: i ? 22 : 0, paddingRight: 22, borderLeft: i ? "1px solid rgba(255,255,255,0.14)" : "none" }}>
              <div style={{ display: "flex", fontFamily: "Manrope", fontSize: 22, color: "#F2F2EF" }}>{value}</div>
              <div style={{ display: "flex", fontFamily: "Grotesk", fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.42)", marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      )}
      {plats.length > 0 && (
        <div style={{ position: "absolute", left: centered ? nameLeft : textLeft, top: centered ? 540 : colTop + 390, display: "flex", alignItems: "center", opacity: fadeIn(0.3) }}>
          {plats.map((id) => (
            <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, marginRight: 8, border: "1px solid rgba(255,255,255,0.18)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={socialIcons[id]} alt={id} width={13} height={13} style={{ opacity: 0.85 }} />
            </div>
          ))}
        </div>
      )}

      <div style={{ position: "absolute", left: 40, bottom: 30, display: "flex", fontFamily: "Grotesk", fontSize: 11, letterSpacing: 3, color: "rgba(255,255,255,0.32)", opacity: outro }}>SOLCAMEO.COM</div>
      <div style={{ position: "absolute", right: 40, bottom: 28, display: "flex", fontFamily: "Fraunces", fontSize: 14, letterSpacing: 0.5, color: tier.accent, opacity: outro * 0.85 }}>{tier.tagline}</div>
    </div>
  );
}

/* ── Public render API ─────────────────────────────────────────────────────── */

interface Sprites { headMark: Sprite; headWord: Sprite; cardWord: Sprite; emblem: Sprite; avatarFallback: Sprite }

async function spritesFor(logo: Logo, tier: ShareTier): Promise<Sprites> {
  const [headMark, headWord, cardWord, emblem, avatarFallback] = await Promise.all([
    sprite(logo.markSm, 2, 1, BRAND_LIME, 0.55),
    sprite(logo.word, 2, 0, "#F2F2EF", 0.85),
    sprite(logo.wordSm, 2, 0, tier.card.ink, 0.85),
    sprite(logo.markLg, 4, 1, tier.card.emblem, 0.78),
    sprite(logo.markSm, 4, 1, BRAND_LIME, 0.5),
  ]);
  return { headMark, headWord, cardWord, emblem, avatarFallback };
}

async function prepare(data: ShareAgentData, nonce: string | number) {
  let v = pickVariant(data.mint, data.stats.views, nonce, `${data.stats.name}|${data.stats.platforms.slice().sort().join(",")}`);
  // GOLD holds its whole collection: MEMBER and SILVER fanned behind the
  // gold card. The fan needs a side layout (the centered one has no room).
  const trio = v.tier.material === "gold";
  if (trio && v.layout === "centered") v = { ...v, layout: "panelRight", angle: -4 };
  const [assets, mosaics] = await Promise.all([loadAssets(), avatarMosaics(data.avatarUrl)]);
  const dir = v.layout === "panelLeft" ? -1 : 1;
  const back: BackCard[] = trio
    ? [
        { tier: SHARE_TIERS[0], face: assets.faces.graphite, fan: dir * 17 },
        { tier: SHARE_TIERS[1], face: assets.faces.silver, fan: dir * 8.5 },
      ]
    : [];
  const backdrop = await backdropFor(v.tier, v.layout, back, v.angle);
  const sprites = await spritesFor(assets.logo, v.tier);
  return { v, assets, backdrop, mosaics, sprites, face: assets.faces[v.tier.material] };
}

type Prepared = Awaited<ReturnType<typeof prepare>>;

function frameEl(data: ShareAgentData, p: Prepared, t: number, withBackdrop: boolean) {
  return (
    <Frame data={data} v={p.v} t={t} face={p.face} backdrop={withBackdrop ? p.backdrop.url : undefined}
      socialIcons={p.assets.socialIcons} sprites={p.sprites} mosaics={p.mosaics} />
  );
}

/** Static PNG — the settled frame of the animation. */
export async function membershipPng(data: ShareAgentData, nonce: string | number): Promise<Buffer> {
  const p = await prepare(data, nonce);
  const svg = await satori(frameEl(data, p, STILL_T, false), { width: CARD_W, height: CARD_H, fonts: p.assets.fonts });
  return sharp(p.backdrop.buf).composite([{ input: Buffer.from(svg) }]).png({ compressionLevel: 6 }).toBuffer();
}

/** Animated GIF — SHARE_FRAMES frames at SHARE_FRAME_MS, looping forever.
 *  Laid out by satori, rasterized by sharp's native librsvg onto the baked
 *  backdrop, a few frames at a time so memory stays flat. */
export async function membershipGif(data: ShareAgentData, nonce: string | number): Promise<Buffer> {
  const p = await prepare(data, nonce);
  const frames: Buffer[] = [];
  for (let start = 0; start < SHARE_FRAMES; start += 6) {
    frames.push(...await Promise.all(Array.from({ length: Math.min(6, SHARE_FRAMES - start) }, async (_, k) => {
      const svg = await satori(frameEl(data, p, (start + k) / SHARE_FRAMES, false), { width: CARD_W, height: CARD_H, fonts: p.assets.fonts });
      return sharp(p.backdrop.buf).composite([{ input: Buffer.from(svg) }]).removeAlpha().raw().toBuffer();
    })));
  }
  return sharp(Buffer.concat(frames), { raw: { width: CARD_W, height: CARD_H * SHARE_FRAMES, channels: 3, pageHeight: CARD_H } })
    .gif({ delay: frames.map(() => SHARE_FRAME_MS), loop: 0, effort: 5, dither: 0.3, interFrameMaxError: 4 })
    .toBuffer();
}
