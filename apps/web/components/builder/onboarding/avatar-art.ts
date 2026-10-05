import { mulberry32 } from "./setup-data";

/**
 * Procedural avatars: deterministic SVG art drawn from (name, style, palette, seed).
 * No image model and no network, so creating an agent costs zero credits.
 * Uploaded photos bypass this entirely.
 */

export type AvatarStyleId = "critter" | "blob" | "emblem";

export const AVATAR_STYLES: { id: AvatarStyleId; title: string; blurb: string }[] = [
  { id: "critter", title: "Pixel critter", blurb: "A tiny pixel-art creature" },
  { id: "blob", title: "Friendly face", blurb: "A soft, expressive blob" },
  { id: "emblem", title: "Brand mark", blurb: "Bold shapes and your initial" },
];

export interface Palette { id: string; label: string; bg: [string, string]; body: string; shade: string; accent: string; ink: string }

export const PALETTES: Palette[] = [
  { id: "lime", label: "Lime", bg: ["#1c2410", "#0b0d0a"], body: "#A3E635", shade: "#7fb81f", accent: "#F4F6F0", ink: "#0b0d0a" },
  { id: "sunset", label: "Sunset", bg: ["#ff9a5a", "#ff4f6d"], body: "#fff1de", shade: "#ffd2b0", accent: "#7a1f3d", ink: "#2a0f1c" },
  { id: "ocean", label: "Ocean", bg: ["#0f3a5f", "#06182b"], body: "#5ad1ff", shade: "#2fa6d6", accent: "#d8f4ff", ink: "#04121f" },
  { id: "grape", label: "Grape", bg: ["#3b1e6e", "#150a2e"], body: "#c4a1ff", shade: "#9b72e6", accent: "#fff0fb", ink: "#150a2e" },
  { id: "coral", label: "Coral", bg: ["#ffe3da", "#ffc2b0"], body: "#ff6b4a", shade: "#d9482b", accent: "#fff8f4", ink: "#2b0f08" },
  { id: "mint", label: "Mint", bg: ["#d9fbe9", "#a8efcb"], body: "#1fb57f", shade: "#12875e", accent: "#ffffff", ink: "#062a1d" },
  { id: "gold", label: "Gold", bg: ["#2a2108", "#0f0b02"], body: "#ffcf40", shade: "#d9a418", accent: "#fff6d6", ink: "#1a1303" },
  { id: "mono", label: "Mono", bg: ["#f1efe9", "#d9d6cd"], body: "#141413", shade: "#3a3a37", accent: "#ffffff", ink: "#141413" },
];

export function paletteFor(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** Stable starting palette per niche so the first preview already feels on-topic. */
export function defaultPaletteId(niche: string): string {
  let h = 0;
  for (const ch of niche) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length].id;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const f = (n: number) => Math.round(n * 100) / 100;

function background(p: Palette, rnd: () => number): string {
  const blobs = Array.from({ length: 3 }, () => {
    const cx = 80 + rnd() * 352, cy = 80 + rnd() * 352, r = 90 + rnd() * 120;
    return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${p.accent}" opacity="0.07"/>`;
  }).join("");
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient></defs><rect width="512" height="512" fill="url(#bg)"/>${blobs}`;
}

function critter(p: Palette, rnd: () => number): string {
  // 7 columns mirrored from 4 → symmetric sprite, 9 rows. Rows 3-4 stay solid for the face.
  const COLS = 7, ROWS = 9, CELL = 44;
  const ox = (512 - COLS * CELL) / 2, oy = (512 - ROWS * CELL) / 2 + 6;
  const grid: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 0; x < 4; x++) {
      const edge = x === 0 ? 0.55 : 0.8;
      const on = y >= 2 && y <= 6 ? (x === 3 || rnd() < edge + 0.12) : rnd() < edge - 0.25;
      grid[y][x] = on; grid[y][COLS - 1 - x] = on;
    }
  }
  for (let y = 3; y <= 5; y++) for (let x = 1; x <= 5; x++) grid[y][x] = true; // keep the face readable
  grid[1][3] = true; grid[2][3] = true;
  const cells: string[] = [];
  const shadeRows = new Set([6, 7]);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!grid[y][x]) continue;
    cells.push(`<rect x="${f(ox + x * CELL)}" y="${f(oy + y * CELL)}" width="${CELL - 2}" height="${CELL - 2}" rx="5" fill="${shadeRows.has(y) ? p.shade : p.body}"/>`);
  }
  const ey = oy + 3 * CELL, eyeCells = [1, 4];
  const eyes = eyeCells.map((x) => `<rect x="${f(ox + (x + 0.5) * CELL - 4)}" y="${f(ey)}" width="${CELL + 8}" height="${CELL + 8}" rx="9" fill="${p.accent}"/><rect x="${f(ox + (x + 0.5) * CELL + 14)}" y="${f(ey + 14)}" width="${CELL - 24}" height="${CELL - 18}" rx="4" fill="${p.ink}"/>`).join("");
  const mouthY = oy + 5.05 * CELL;
  const mouth = rnd() < 0.5
    ? `<rect x="${f(ox + 2.6 * CELL)}" y="${f(mouthY)}" width="${f(CELL * 1.8)}" height="10" rx="4" fill="${p.ink}"/>`
    : `<rect x="${f(ox + 2.6 * CELL)}" y="${f(mouthY)}" width="${f(CELL * 1.8)}" height="10" rx="4" fill="${p.ink}"/><rect x="${f(ox + 2.6 * CELL)}" y="${f(mouthY - 10)}" width="10" height="10" rx="3" fill="${p.ink}"/><rect x="${f(ox + 2.6 * CELL + CELL * 1.8 - 10)}" y="${f(mouthY - 10)}" width="10" height="10" rx="3" fill="${p.ink}"/>`;
  return cells.join("") + eyes + mouth;
}

function blobPath(rnd: () => number): string {
  const N = 8, cx = 256, cy = 270, pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, r = 138 + rnd() * 48;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.94]);
  }
  // Closed Catmull-Rom → cubic Bézier
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + " Z";
}

function blob(p: Palette, rnd: () => number): string {
  const eyeGap = 52 + rnd() * 14, eyeY = 245 + rnd() * 16, eyeR = 25 + rnd() * 8;
  const look = (rnd() - 0.5) * 9;
  const eyes = [-1, 1].map((s) => `<circle cx="${f(256 + s * eyeGap)}" cy="${f(eyeY)}" r="${f(eyeR)}" fill="${p.accent}"/><circle cx="${f(256 + s * eyeGap + look)}" cy="${f(eyeY + 3)}" r="${f(eyeR * 0.5)}" fill="${p.ink}"/><circle cx="${f(256 + s * eyeGap + look - 4)}" cy="${f(eyeY - 2)}" r="${f(eyeR * 0.16)}" fill="#fff"/>`).join("");
  const my = eyeY + 62 + rnd() * 10;
  const kind = Math.floor(rnd() * 3);
  const mouth = kind === 0
    ? `<path d="M ${f(256 - 34)} ${f(my)} Q 256 ${f(my + 42)} ${f(256 + 34)} ${f(my)}" fill="none" stroke="${p.ink}" stroke-width="10" stroke-linecap="round"/>`
    : kind === 1
    ? `<ellipse cx="256" cy="${f(my + 8)}" rx="17" ry="20" fill="${p.ink}"/>`
    : `<path d="M ${f(256 - 40)} ${f(my)} Q 256 ${f(my + 54)} ${f(256 + 40)} ${f(my)} Z" fill="${p.ink}"/><path d="M ${f(256 - 22)} ${f(my + 24)} Q 256 ${f(my + 38)} ${f(256 + 22)} ${f(my + 24)} Q 256 ${f(my + 12)} ${f(256 - 22)} ${f(my + 24)}" fill="#ff7a8a"/>`;
  const cheeks = [-1, 1].map((s) => `<ellipse cx="${f(256 + s * (eyeGap + 30))}" cy="${f(eyeY + 44)}" rx="20" ry="12" fill="${p.accent}" opacity="0.28"/>`).join("");
  const shine = `<ellipse cx="190" cy="170" rx="46" ry="22" transform="rotate(-28 190 170)" fill="#fff" opacity="0.22"/>`;
  const tuft = rnd() < 0.6 ? `<path d="M 256 118 Q ${f(236 + rnd() * 40)} 70 ${f(270 + rnd() * 20)} 74" fill="none" stroke="${p.body}" stroke-width="14" stroke-linecap="round"/><circle cx="${f(270 + rnd() * 20)}" cy="74" r="13" fill="${p.shade}"/>` : "";
  return `${tuft}<path d="${blobPath(rnd)}" fill="${p.body}"/>${shine}${cheeks}${eyes}${mouth}`;
}

function emblem(p: Palette, rnd: () => number, name: string): string {
  const letter = esc((name.trim().match(/[A-Za-z0-9]/)?.[0] ?? "V").toUpperCase());
  const shapes: string[] = [];
  const n = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const s = 320 - i * 64, rot = Math.floor(rnd() * 8) * 11.25, kind = Math.floor(rnd() * 3);
    const fill = i % 2 === 0 ? p.body : p.shade;
    const x = 256 - s / 2, y = 256 - s / 2;
    const el = kind === 0 ? `<rect x="${f(x)}" y="${f(y)}" width="${s}" height="${s}" rx="${f(s * 0.22)}" fill="${fill}"/>`
      : kind === 1 ? `<circle cx="256" cy="256" r="${s / 2}" fill="${fill}"/>`
      : `<polygon points="256,${f(y - 6)} ${f(x + s + 8)},${f(y + s)} ${f(x - 8)},${f(y + s)}" fill="${fill}"/>`;
    shapes.push(`<g transform="rotate(${rot} 256 256)" opacity="${i === 0 ? 1 : 0.94}">${el}</g>`);
  }
  const ring = `<circle cx="256" cy="256" r="${f(236 + rnd() * 6)}" fill="none" stroke="${p.accent}" stroke-width="4" stroke-dasharray="3 14" stroke-linecap="round" opacity="0.7"/>`;
  const text = `<text x="256" y="318" text-anchor="middle" font-family="'Space Grotesk','Geist',system-ui,sans-serif" font-weight="800" font-size="190" letter-spacing="-4" fill="${p.ink}">${letter}</text>`;
  return ring + shapes.join("") + text;
}

export interface AvatarSpec { style: AvatarStyleId; palette: string; seed: number; name: string }

export function avatarSvg(spec: AvatarSpec): string {
  const p = paletteFor(spec.palette);
  const rnd = mulberry32(hashStr(`${spec.name}|${spec.style}`) ^ (spec.seed * 2654435761));
  const bg = background(p, rnd);
  const art = spec.style === "critter" ? critter(p, rnd) : spec.style === "blob" ? blob(p, rnd) : emblem(p, rnd, spec.name);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${bg}${art}</svg>`;
}

export function avatarDataUri(spec: AvatarSpec): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(spec))}`;
}

/** Rasterise the SVG to a PNG data URL (the mint API wants a hosted raster). */
export async function avatarPng(spec: AvatarSpec, size = 640): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Couldn't draw the avatar."));
    el.src = avatarDataUri(spec);
  });
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the avatar.");
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}
