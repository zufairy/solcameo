/* eslint-disable @next/next/no-img-element -- Satori renders these embedded assets into PNG/GIF, not browser HTML. */
/* ════════ Dev post material — premium 1200×675 X cards ════════
   Same design language as the X share cards (/dev/x-cards): near-black glass,
   the pixelated VELLO logo, the 5×7 pixel-matrix counter and brand lime.

   Two cheap layers per card:
     text layer  satori lays out every label / name ONCE → transparent PNG
     gfx layer   a plain SVG (glow, rings, bars, pixel counters) redrawn per
                 frame, so the GIF counts up and sweeps without re-laying out text.
   Numbers that animate are drawn as pixel-matrix counters in the gfx layer;
   the text layer only holds copy that never changes between frames. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import satori from "satori";
import sharp from "sharp";
import { safeFetchToBuffer } from "@/lib/server/downloader";
import { pixelizeLogo, sprite, type PxGrid, type Sprite } from "@/lib/server/pixelLogo";
import { solanaPixels } from "@/lib/server/solanaPixels";

export type MaterialKind = "network" | "minted" | "leaderboard" | "engine" | "pulse" | "social" | "launch";
export interface MaterialAgent { avatarUrl?: string; name: string; handle: string; views: number; posted: number; generated: number }
export interface MaterialMint { avatarUrl?: string; name: string; handle: string; ago: string; /** The agent's niche, shown as a tag on the launch card. */ niche?: string; /** ISO country code for the pixel flag on the launch card. */ country?: string }
export interface MaterialData {
  kind: MaterialKind; period: string; date: string; agents: MaterialAgent[];
  /** Selected-window totals. */
  totalViews: number; totalPosts: number; totalGenerated: number; active: number;
  /** Always the trailing 7 days — drives the hero "views this week" card. */
  weekViews: number; weekPosts: number; weekActive: number;
  /** Roster size, agents minted in the last 24h and the newest few. */
  totalAgents: number; mintedToday: number; minted: MaterialMint[];
  /** Trailing 30 days: all views, plus the per-platform split behind the "Views by platform" card. */
  monthViews: number; platforms: { id: string; views: number }[];
  /** Agent number shown on the launch card (defaults to the roster size). */
  launchNo?: number;
}

const W = 1200, H = 675, M = 56;
const LIME = "#C8F02A";
const INK = "#F2F2EF";
const MUTE = "rgba(242,242,239,0.56)";
const FAINT = "rgba(242,242,239,0.34)";
const LOGO_FILE = join(process.cwd(), "assets", "lo.png");

/* ── helpers ──────────────────────────────────────────────────────────────── */

const num = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n));
const full = (n: number) => Math.round(n).toLocaleString("en-US");
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, t * 1.7 + 0.04), 3);
const clean = (s: string, max = 22) => s.replace(/[^A-Za-z0-9À-ÿ .,_'&+!-]/g, "").trim().slice(0, max);
const nameOf = (a: { name: string }) => clean(a.name) || "Agent";
const handleOf = (a: { handle: string }) => clean(a.handle, 28).replace(/\s+/g, "");
const initials = (name: string) => (clean(name).split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "V").toUpperCase();

const GLYPHS: Record<string, string[]> = {
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
  "%": ["XX..X", "XX..X", "...X.", "..X..", ".X...", "X..XX", "X..XX"],
  ".": [".", ".", ".", ".", ".", ".", "X"],
  ",": ["..", "..", "..", "..", ".X", ".X", "X."],
  ":": [".", ".", "X", ".", "X", ".", "."],
  A: [".XXX.", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  R: ["XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"],
  E: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
  N: ["X...X", "XX..X", "X.X.X", "X..XX", "X...X", "X...X", "X...X"],
  W: ["X...X", "X...X", "X...X", "X.X.X", "X.X.X", "XX.XX", "X...X"],
  T: ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
  O: [".XXX.", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  P: ["XXXX.", "X...X", "X...X", "XXXX.", "X....", "X....", "X...."],
  C: [".XXX.", "X...X", "X....", "X....", "X....", "X...X", ".XXX."],
  G: [".XXX.", "X...X", "X....", "X.XXX", "X...X", "X...X", ".XXX."],
  S: [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
  V: ["X...X", "X...X", "X...X", "X...X", "X...X", ".X.X.", "..X.."],
  I: [".XXX.", "..X..", "..X..", "..X..", "..X..", "..X..", ".XXX."],
  B: ["XXXX.", "X...X", "X...X", "XXXX.", "X...X", "X...X", "XXXX."],
  Y: ["X...X", "X...X", ".X.X.", "..X..", "..X..", "..X..", "..X.."],
  L: ["X....", "X....", "X....", "X....", "X....", "X....", "XXXXX"],
  F: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "X...."],
  " ": ["..", "..", "..", "..", "..", "..", ".."],
  "#": [".X.X.", "XXXXX", ".X.X.", ".X.X.", "XXXXX", ".X.X.", ".X.X."],
};
const pxCols = (s: string) => Math.max(0, [...s].reduce((c, ch) => GLYPHS[ch] ? c + GLYPHS[ch][0].length + 1 : c, 0) - 1);
/** Largest cell (≤ max) that keeps `s` inside `width` px. */
const fitCell = (s: string, width: number, max: number) => Math.max(3, Math.min(max, Math.floor(width / Math.max(1, pxCols(s)))));

/** Pixel-matrix counter. `cur` is drawn right-aligned inside the box `final` would fill. */
function px(final: string, cur: string, x: number, y: number, cell: number, color = LIME, anchor: "start" | "middle" | "end" = "start", glow = true, gop = 0.7, fade?: (x: number, y: number) => number) {
  const fw = pxCols(final) * cell;
  const x0 = anchor === "start" ? x : anchor === "middle" ? x - fw / 2 : x - fw;
  let cx = anchor === "middle" ? x - (pxCols(cur) * cell) / 2 : x0 + fw - pxCols(cur) * cell;
  const size = cell - Math.max(1, Math.round(cell * 0.16));
  let r = "";
  for (const ch of cur) {
    const g = GLYPHS[ch];
    if (!g) continue;
    g.forEach((row, ry) => [...row].forEach((c, rx) => { if (c === "X") { const X = cx + rx * cell, Y = y + ry * cell; r += `<rect x="${X}" y="${Y}" width="${size}" height="${size}" fill="${color}"${fade ? ` fill-opacity="${fade(X, Y).toFixed(2)}"` : ""}/>`; } }));
    cx += (g[0].length + 1) * cell;
  }
  return `${glow ? `<g filter="url(#glow)" opacity="${gop}">${r}</g>` : ""}<g>${r}</g>`;
}
const round = (x: number, y: number, w: number, h: number, r: number, fill: string, stroke = "none", sw = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const glass = (x: number, y: number, w: number, h: number, hot = false) =>
  round(x + .5, y + .5, w - 1, h - 1, 18, hot ? "url(#hot)" : "url(#glass)", hot ? "rgba(200,240,42,.55)" : "rgba(255,255,255,.10)");

/* ── assets ───────────────────────────────────────────────────────────────── */

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
interface Assets { fonts: Font[]; mark: Sprite; word: Sprite; markGrid: PxGrid; wordGrid: PxGrid }
let assetsPromise: Promise<Assets> | null = null;
const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function loadAssets(): Promise<Assets> {
  assetsPromise ??= (async () => {
    const f = (n: string) => readFile(join(process.cwd(), "public", "fonts", "captions", n));
    const [anton, jakarta, grotesk, manrope, fraunces, logo] = await Promise.all([f("Anton-Regular.ttf"), f("PlusJakartaSans-SemiBold.ttf"), f("SpaceGrotesk-Medium.ttf"), f("Manrope-Medium.ttf"), f("Fraunces-SemiBold.ttf"), readFile(LOGO_FILE)]);
    const lw = (await sharp(logo).metadata()).width ?? 1000;
    const cut = Math.round(lw * 0.235);
    const [markGrid, wordGrid] = await Promise.all([pixelizeLogo(logo, { left: 0, width: cut }, 9), pixelizeLogo(logo, { left: cut, width: lw - cut }, 46)]);
    const fonts: Font[] = [
      { name: "Manrope", data: toAB(manrope), weight: 500, style: "normal" },
      { name: "Fraunces", data: toAB(fraunces), weight: 600, style: "normal" },
      { name: "Anton", data: toAB(anton), weight: 400, style: "normal" },
      { name: "Jakarta", data: toAB(jakarta), weight: 600, style: "normal" },
      { name: "Grotesk", data: toAB(grotesk), weight: 500, style: "normal" },
    ];
    return {
      fonts,
      mark: await sprite(markGrid, 3, 1, LIME, 0.5),
      word: await sprite(wordGrid, 3, 0, INK, 0.85),
      markGrid, wordGrid,
    };
  })().catch((e) => { assetsPromise = null; throw e; });
  return assetsPromise;
}

/* ── text-layer primitives ────────────────────────────────────────────────── */

type Align = "start" | "center" | "end";
interface TProps { x: number; y: number; w?: number; align?: Align; size: number; font?: "Anton" | "Jakarta" | "Grotesk" | "Manrope" | "Fraunces"; color?: string; ls?: number; upper?: boolean; children: ReactNode }
/** Absolutely placed single-line text. `x` is the left edge, centre (align=center) or right edge (align=end). */
function T({ x, y, w = 640, align = "start", size, font = "Manrope", color = INK, ls = 0, upper, children }: TProps) {
  const left = align === "start" ? x : align === "center" ? x - w / 2 : x - w;
  return <div style={{ position: "absolute", left, top: y, width: w, display: "flex", justifyContent: align === "start" ? "flex-start" : align === "center" ? "center" : "flex-end", fontFamily: font, fontSize: size, color, letterSpacing: ls, ...(upper ? { textTransform: "uppercase" as const } : {}), lineHeight: 1, whiteSpace: "nowrap" }}>{children}</div>;
}
const Label = (p: Omit<TProps, "size" | "font" | "ls" | "upper"> & { size?: number }) => <T {...p} size={p.size ?? 13} font="Grotesk" ls={4} upper color={p.color ?? MUTE} />;
/** Profile image, resolved once per render; initials are the unavailable-image fallback. */
const Badge = ({ cx, cy, r, name, avatarUrl, hot = false }: { cx: number; cy: number; r: number; name: string; avatarUrl?: string; hot?: boolean }) => (
  <div style={{ position: "absolute", left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: r, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Manrope", fontSize: r * 0.72, color: hot ? "#0b1005" : INK }}>
    {avatarUrl ? <img src={avatarUrl} alt={name} width={r * 2} height={r * 2} style={{ objectFit: "cover" }} /> : initials(name)}
  </div>
);
function Headline({ x, y, size, lead, accent, w = 1088, center = false }: { x: number; y: number; size: number; lead: string; accent: string; w?: number; center?: boolean }) {
  return <div style={{ position: "absolute", left: center ? x - w / 2 : x, top: y, width: w, display: "flex", alignItems: "baseline", justifyContent: center ? "center" : "flex-start", fontSize: size, lineHeight: 1.08, letterSpacing: -size * 0.035, whiteSpace: "nowrap" }}>
    <span style={{ fontFamily: "Manrope", fontWeight: 500 }}>{lead}</span>
    <span style={{ fontFamily: "Fraunces", fontWeight: 600, color: LIME, marginLeft: size * 0.22 }}>{accent}</span>
  </div>;
}
const AvatarRow = ({ agents, x, y }: { agents: MaterialAgent[]; x: number; y: number }) => <div style={{ display: "flex" }}>
  {agents.slice(0, 4).map((agent, i) => <Badge key={i} cx={x + i * 46} cy={y} r={18} name={agent.name} avatarUrl={agent.avatarUrl} />)}
</div>;
const badgeGfx = (cx: number, cy: number, r: number, hot: boolean, t: number) =>
  `${hot ? `<circle cx="${cx}" cy="${cy}" r="${r + 7 + 5 * Math.sin(t * Math.PI * 2)}" fill="none" stroke="${LIME}" stroke-opacity=".3"/>` : ""}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hot ? LIME : "#151a16"}" stroke="${hot ? LIME : "rgba(255,255,255,.22)"}" stroke-width="1.5"/>`;

function Shell({ a, logo = true, children }: { a: Assets; logo?: boolean; children: ReactNode }) {
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Jakarta", color: INK }}>
      {logo && <div style={{ position: "absolute", left: M, top: 38, display: "flex", alignItems: "center" }}>
        <img src={a.mark.url} alt="Vello mark" width={a.mark.w} height={a.mark.h} style={{ marginRight: 14 }} />
        <img src={a.word.url} alt="Vello" width={a.word.w} height={a.word.h} />
      </div>}
      <T x={M} y={H - 40} size={12} font="Grotesk" ls={4} color={FAINT} upper>velloagents.com</T>
      {children}
    </div>
  );
}

/* ── gfx base ─────────────────────────────────────────────────────────────── */

function base(inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
<radialGradient id="vig" cx="600" cy="320" r="780" gradientUnits="userSpaceOnUse"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
<radialGradient id="haze"><stop stop-color="#fff" stop-opacity=".045"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".075"/><stop offset="1" stop-color="#fff" stop-opacity=".015"/></linearGradient>
<linearGradient id="hot" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${LIME}" stop-opacity=".09"/><stop offset="1" stop-color="${LIME}" stop-opacity=".015"/></linearGradient>
<linearGradient id="lime" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${LIME}" stop-opacity=".55"/><stop offset="1" stop-color="${LIME}"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter></defs>
<rect width="${W}" height="${H}" fill="#07080a"/>
${inner}
<rect width="${W}" height="${H}" fill="url(#vig)"/></svg>`;
}

/* ── designs ──────────────────────────────────────────────────────────────── */

/** `layers` are text snippets rasterised once and placed (and animated) by `gfx`; `frames` makes the GIF a seamless loop with no end hold. */
interface Layer { id: string; w: number; h: number; node: ReactNode }
interface Design { label: string; gfx: (t: number, img: Record<string, string>, meta: Record<string, { x0: number; x1: number }>) => string; animLogo?: boolean; text: (a: Assets) => ReactNode; layers?: Layer[]; frames?: number; delay?: number; still?: number }

const TAU = Math.PI * 2;
const seg = (t: number, start: number, dur: number) => Math.min(1, Math.max(0, (t - start) / dur));
const outCubic = (x: number) => 1 - (1 - x) ** 3;
const outBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

/** Floating "agent" bubbles: random sizes, blur and opacity fake depth of field. `agent` indexes the ranked agents; others are out-of-focus ghosts. */
interface Bubble { x: number; y: number; r: number; blur: number; op: number; amp: number; k: 1 | 2; ph: number; delay: number; agent?: number; ghost?: "glass" | "lime" }
const BUBBLES: Bubble[] = [
  { x: 200, y: 404, r: 34, blur: 10, op: 0.34, amp: 5, k: 1, ph: 0.35, delay: 0.1, ghost: "glass" },
  { x: 1138, y: 392, r: 30, blur: 9, op: 0.4, amp: 5, k: 1, ph: 0.8, delay: 0.14, ghost: "glass" },
  { x: 906, y: 178, r: 20, blur: 6, op: 0.45, amp: 5, k: 2, ph: 0.2, delay: 0.16, ghost: "glass" },
  { x: 300, y: 192, r: 15, blur: 4.5, op: 0.5, amp: 4, k: 2, ph: 0.6, delay: 0.18, ghost: "glass" },
  { x: 1112, y: 150, r: 13, blur: 3.5, op: 0.55, amp: 4, k: 1, ph: 0.1, delay: 0.2, ghost: "lime" },
  { x: 96, y: 170, r: 20, blur: 3.6, op: 0.62, amp: 5, k: 2, ph: 0.45, delay: 0.17, agent: 4 },
  { x: 262, y: 366, r: 27, blur: 1.8, op: 0.85, amp: 6, k: 2, ph: 0.55, delay: 0.14, agent: 2 },
  { x: 1040, y: 374, r: 42, blur: 0.9, op: 0.94, amp: 8, k: 1, ph: 0.7, delay: 0.1, agent: 3 },
  { x: 1050, y: 228, r: 38, blur: 0, op: 1, amp: 9, k: 1, ph: 0.3, delay: 0.08, agent: 1 },
  { x: 150, y: 264, r: 52, blur: 0, op: 1, amp: 10, k: 1, ph: 0, delay: 0.05, agent: 0 },
];

/** Animated pixel Vello logo: pixels pop in at random, the wordmark wipes in left to right, then a lime scan sweeps it and the mark glows. */
function logoGfx(a: Assets, t: number) {
  const H0 = Math.max(a.mark.h, a.word.h), my = 38 + (H0 - a.mark.h) / 2, wy = 38 + (H0 - a.word.h) / 2, wx = M + a.mark.w + 14;
  const mark = a.markGrid.cells.map((c) => {
    const e = outBack(seg(t, rnd(c.x * 31 + c.y, 11) * 0.16, 0.12));
    if (e < 0.02) return "";
    const sz = 3 * Math.min(1.15, e), op = (0.5 + 0.5 * c.shade) * Math.min(1, e) * (0.82 + 0.18 * Math.sin(TAU * (2 * t + (c.x + c.y) * 0.12)));
    return `<rect x="${(M + c.x * 4 + 1.5 - sz / 2).toFixed(2)}" y="${(my + c.y * 4 + 1.5 - sz / 2).toFixed(2)}" width="${sz.toFixed(2)}" height="${sz.toFixed(2)}" fill="${LIME}" fill-opacity="${op.toFixed(2)}"/>`;
  }).join("");
  const sweep = ((t - 0.34) / 0.5) * (a.wordGrid.cols + 14) - 7, sweeping = t > 0.34 && t < 0.84;
  const word = a.wordGrid.cells.map((c) => {
    const e = outBack(seg(t, 0.04 + (c.x / a.wordGrid.cols) * 0.2 + rnd(c.x * 17 + c.y, 13) * 0.04, 0.1));
    if (e < 0.02) return "";
    const sz = 3 * Math.min(1.15, e), hit = sweeping && Math.abs(c.x - sweep) < 3.2;
    return `<rect x="${(wx + c.x * 3 + 1.5 - sz / 2).toFixed(2)}" y="${(wy + c.y * 3 + 1.5 - sz / 2).toFixed(2)}" width="${sz.toFixed(2)}" height="${sz.toFixed(2)}" fill="${hit ? LIME : INK}" fill-opacity="${(hit ? 1 : (0.85 + 0.15 * c.shade) * Math.min(1, e)).toFixed(2)}"/>`;
  }).join("");
  const bob = 1.5 * Math.sin(TAU * t);
  return `<g transform="translate(0 ${bob.toFixed(2)})"><g filter="url(#glow)" opacity="${(0.25 + 0.15 * Math.sin(TAU * 2 * t)).toFixed(2)}">${mark}</g>${mark}</g>${word}`;
}

/** 8-bit block lettering with a chunky extrusion: pixels drop in, the word tilts like a 3D sign and a white highlight scans across it. */
function pix3d(text: string, x0: number, y0: number, cell: number, t: number) {
  const cols = pxCols(text), wd = cols * cell, th = 0.22 * Math.sin(TAU * t), cs = Math.cos(th), sn = Math.sin(th);
  const sweep = ((2 * t) % 1) * (cols + 12) - 6;
  let col = 0, li = 0, ext = "", front = "";
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) continue;
    g.forEach((row, ry) => [...row].forEach((c, rx) => {
      if (c !== "X") return;
      const gx = col + rx, e = outBack(seg(t, 0.02 + (gx / cols) * 0.16 + rnd(gx * 7 + ry, 3) * 0.06, 0.12));
      if (e < 0.02) return;
      const lx = (gx + 0.5 - cols / 2) * cell, X = x0 + wd / 2 + lx * cs - cell / 2, Y = y0 + ry * cell + 3 * Math.sin(TAU * (t + li * 0.14)) - (1 - Math.min(1, e)) * 70;
      const sz = (cell - 0.8) * Math.min(1.15, e), w = sz * Math.max(0.6, cs), al = Math.min(1, e * 1.5), hi = Math.abs(gx - sweep) < 1.6;
      for (let k = 4; k >= 1; k--) ext += `<rect x="${(X - k * (1 + sn)).toFixed(1)}" y="${(Y + k * 1.1).toFixed(1)}" width="${w.toFixed(1)}" height="${sz.toFixed(1)}" fill="#55690b" fill-opacity="${(al * 0.95).toFixed(2)}"/>`;
      front += `<rect x="${X.toFixed(1)}" y="${Y.toFixed(1)}" width="${w.toFixed(1)}" height="${sz.toFixed(1)}" fill="${hi ? "#fff" : LIME}" fill-opacity="${Math.min(1, al * (1 + 0.2 * sn * lx / (wd / 2))).toFixed(2)}"/>`;
    }));
    col += g[0].length + 1; li++;
  }
  return `${ext}<g filter="url(#glow)" opacity=".4">${front}</g>${front}`;
}

/** Solana mark as a pixel/voxel grid: pops in pixel by pixel, then tilts, shimmers and twinkles like a lit 3D sprite. */
const solanaMark = (t: number) => solanaPixels(t, W - M - 26 * 3.1, 34, 3.1);

function network(d: MaterialData, a: Assets): Design {
  const nodes = d.agents.slice(0, 5);
  const fin = full(d.weekViews);
  const cell = fitCell(fin, 640, 16), cw = pxCols(fin) * cell;
  const top = 252, capY = top + 7 * cell + 30;
  const stats: [string, string][] = [["Agents minted today", full(d.mintedToday)], ["Clips posted this week", full(d.weekPosts)], ["Active agents this week", full(d.weekActive)]];
  const PW = 264, PG = 28, PX = (W - (PW * 3 + PG * 2)) / 2, PY = 452, PH = 112;
  const named = BUBBLES.map((b, i) => ({ b, i })).filter(({ b }) => b.agent !== undefined && b.blur < 1 && nodes[b.agent!]);
  const layers: Layer[] = [
    { id: "kick", w: 600, h: 20, node: <Label x={300} y={0} w={600} align="center" color={LIME} size={14}>Vello Global Network</Label> },
    { id: "head", w: 1000, h: 84, node: <div style={{ position: "absolute", left: 0, top: 0, width: 1000, display: "flex", alignItems: "baseline", justifyContent: "center", whiteSpace: "nowrap" }}>
      <span style={{ fontFamily: "Manrope", fontWeight: 500, fontSize: 66, lineHeight: 1.1, letterSpacing: -2.4, color: "#FFFFFF" }}>Views generated</span>
      <span style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: 66, lineHeight: 1.1, letterSpacing: -2.4, color: LIME, marginLeft: 16 }}>this week</span>
    </div> },
    { id: "cap", w: 700, h: 16, node: <Label x={350} y={0} w={700} align="center" size={12} color={FAINT}>{full(d.weekActive)} agents creating  /  live tracked views</Label> },
    ...stats.map(([l], i) => ({ id: `s${i}`, w: PW, h: 14, node: <T x={PW / 2} y={0} w={PW} align="center" size={11} font="Grotesk" ls={2.6} upper color={MUTE}>{l}</T> })),
    ...named.map(({ b }) => ({ id: `n${b.agent}`, w: 160, h: 18, node: <T x={80} y={0} w={160} align="center" size={13} color={MUTE}>{nameOf(nodes[b.agent!]).slice(0, 14)}</T> })),
  ];
  return {
    label: "Network report", animLogo: true, layers, frames: 64, delay: 70, still: 0.86,
    text: () => null,
    gfx: (t, img) => {
      const out = 1 - seg(t, 0.93, 0.07);
      const rise = (id: string, x: number, y: number, w: number, h: number, start: number, dur: number, lift: number) => {
        const f = outCubic(seg(t, start, dur));
        return f < 0.004 || !img[id] ? "" : `<image xlink:href="${img[id]}" x="${x}" y="${y + (1 - f) * lift}" width="${w}" height="${h}" opacity="${f}"/>`;
      };
      const pos = (b: Bubble) => {
        const e = seg(t, b.delay, 0.2), ph = TAU * (b.k * t + b.ph);
        return { x: b.x + b.amp * 0.55 * Math.cos(ph), y: b.y + b.amp * Math.sin(ph) + (1 - outCubic(e)) * 34, s: 0.5 + 0.5 * outBack(e), a: Math.min(1, seg(t, b.delay, 0.1) * 1.5) * b.op };
      };
      const haze = `<ellipse cx="${600 + 330 * Math.cos(TAU * t)}" cy="${300 + 40 * Math.sin(TAU * 2 * t)}" rx="560" ry="300" fill="url(#haze)"/>`;

      const bubbles = BUBBLES.map((b, i) => {
        const p = pos(b);
        if (p.a < 0.004) return "";
        const n = b.agent !== undefined ? nodes[b.agent] : undefined;
        const r = b.r, lead = b.agent === 0 && n;
        let body: string;
        if (!n) {
          const lime = b.ghost === "lime";
          body = `<circle r="${r}" fill="${lime ? LIME : "#fff"}" fill-opacity="${lime ? 0.16 : 0.08}" stroke="${lime ? LIME : "#fff"}" stroke-opacity="${lime ? 0.4 : 0.14}"/>`;
        } else {
          const face = n.avatarUrl
            ? `<image xlink:href="${n.avatarUrl}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}"/>`
            : `<circle cy="${-r * 0.2}" r="${r * 0.28}" fill="#fff" fill-opacity=".3"/><path d="M${-r * 0.55} ${r * 0.62}Q0 ${-r * 0.1} ${r * 0.55} ${r * 0.62}Z" fill="#fff" fill-opacity=".22"/>`;
          const halo = b.blur < 1 ? `<circle r="${r + 14}" fill="#fff" fill-opacity=".035"/>` : "";
          const ring = lead ? `<circle r="${r + 10 + 4 * Math.sin(TAU * 2 * t)}" fill="none" stroke="${LIME}" stroke-opacity=".32"/>` : "";
          body = `${halo}${ring}<circle r="${r}" fill="#151a16"/>${face}<circle r="${r}" fill="none" stroke="${lead ? LIME : "#fff"}" stroke-opacity="${lead ? 0.9 : 0.22}" stroke-width="${lead ? 2 : 1.5}"/>`;
        }
        const blur = b.blur ? `<filter id="bb${i}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${b.blur}"/></filter>` : "";
        return `${blur}<g transform="translate(${p.x} ${p.y}) scale(${p.s})" opacity="${p.a}"${b.blur ? ` filter="url(#bb${i})"` : ""}>${body}</g>`;
      }).join("");

      const names = named.map(({ b }) => { const p = pos(b); return rise(`n${b.agent}`, p.x - 80, p.y + b.r + 14, 160, 18, b.delay + 0.1, 0.16, 0); }).join("");

      const packets = BUBBLES.map((b) => {
        if (b.agent === undefined || b.agent > 3 || !nodes[b.agent]) return "";
        const p = pos(b), vis = seg(t, 0.3, 0.1);
        if (vis <= 0) return "";
        const tx = p.x < 600 ? 600 - cw / 2 - 22 : 600 + cw / 2 + 22, ty = top + 3.5 * cell, cx = (p.x + tx) / 2, cy = Math.min(p.y, ty) - 60;
        const u = (2 * t + b.agent * 0.23) % 1;
        return [0, 1, 2, 3].map((k) => { const v = Math.max(0, u - k * 0.035), m = 1 - v; return `<circle cx="${m * m * p.x + 2 * m * v * cx + v * v * tx}" cy="${m * m * p.y + 2 * m * v * cy + v * v * ty}" r="${3 - k * 0.6}" fill="${k ? "#fff" : LIME}" opacity="${vis * Math.sin(Math.PI * v) * (0.85 - k * 0.2)}"/>`; }).join("");
      }).join("");

      const cf = outCubic(seg(t, 0.08, 0.12)), cp = outCubic(seg(t, 0.08, 0.34));
      const counter = `<g opacity="${cf}">${px(fin, full(d.weekViews * cp), 600, top, cell, LIME, "middle", true, 0.45 + 0.2 * Math.sin(TAU * 2 * t), (x) => 0.72 + 0.28 * Math.sin(TAU * (x / 240 - 2 * t)))}</g>`;

      const panels = stats.map(([, v], i) => {
        const x = PX + i * (PW + PG), f = outCubic(seg(t, 0.34 + i * 0.06, 0.18)), vp = outCubic(seg(t, 0.4 + i * 0.06, 0.3));
        if (f < 0.004) return "";
        const sx = x - 90 + (PW + 150) * outCubic(seg(t, 0.62 + i * 0.1, 0.26));
        const sheen = `<clipPath id="pc${i}"><rect x="${x}" y="${PY}" width="${PW}" height="${PH}" rx="18"/></clipPath><g clip-path="url(#pc${i})"><polygon points="${sx + 26},${PY} ${sx + 76},${PY} ${sx + 50},${PY + PH} ${sx},${PY + PH}" fill="url(#sheen)"/></g>`;
        return `<g transform="translate(0 ${(1 - f) * 26})" opacity="${f}">${glass(x, PY, PW, PH, i === 0)}${sheen}${px(v, full(Number(v.replace(/,/g, "")) * vp), x + PW / 2, PY + 50, 6, i === 0 ? LIME : INK, "middle", i === 0, 0.7, (x) => 0.75 + 0.25 * Math.sin(TAU * (x / 90 - 2 * t + i * 0.3)))}${img[`s${i}`] ? `<image xlink:href="${img[`s${i}`]}" x="${x}" y="${PY + 20}" width="${PW}" height="14"/>` : ""}</g>`;
      }).join("");

      return base(`<g opacity="${out}">${haze}${logoGfx(a, t)}${solanaMark(t)}${bubbles}${packets}${rise("kick", 300, 124, 600, 20, 0, 0.14, 12)}${rise("head", 100, 144, 1000, 84, 0.04, 0.2, 18)}${counter}${rise("cap", 250, capY, 700, 16, 0.3, 0.16, 8)}${panels}${names}</g>`);
    },
  };
}

/** Podium stage: three 3D blocks rise, the agents drop onto them, then a spotlight, pixel dust and shimmering digital counters keep the loop alive. */
const CROWN = ["X...X...X", "XX.XXX.XX", "XXXXXXXXX", "XXXXXXXXX"];
const rnd = (i: number, s: number) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const DUST = Array.from({ length: 34 }, (_, i) => ({ x: 20 + rnd(i, 1) * 1160, ph: rnd(i, 2), k: rnd(i, 3) > 0.5 ? 2 : 1, size: 2 + rnd(i, 4) * 5, lime: rnd(i, 5) > 0.72, dir: i % 2 ? 1 : -1 }));

function leaderboard(d: MaterialData, a: Assets): Design {
  const rows = d.agents.slice(0, 3);
  const BASE = 596, PW = 260, GAP = 30, DEP = 22, SK = 0.55;
  const SLOTS = [
    { i: 1, x: 600 - PW / 2 - GAP - PW, h: 150, r: 44, cell: 6, delay: 0.12 },
    { i: 0, x: 600 - PW / 2, h: 190, r: 58, cell: 8, delay: 0.2 },
    { i: 2, x: 600 + PW / 2 + GAP, h: 124, r: 40, cell: 5, delay: 0.05 },
  ];
  const BLOCK = 50 + 12;
  const layers: Layer[] = [
    ...SLOTS.filter((s) => rows[s.i]).map((s) => ({ id: `n${s.i}`, w: PW, h: 50, node: <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: PW }}>
      <span style={{ fontFamily: "Manrope", fontWeight: 500, fontSize: 24, lineHeight: 1.1, letterSpacing: -0.4, color: "#FFFFFF", whiteSpace: "nowrap" }}>{nameOf(rows[s.i]).slice(0, 16)}</span>
      <span style={{ fontFamily: "Grotesk", fontSize: 13, letterSpacing: 2, marginTop: 8, color: MUTE, whiteSpace: "nowrap" }}>{handleOf(rows[s.i]) ? `@${handleOf(rows[s.i])}` : " "}</span>
    </div> })),
  ];
  return {
    label: "Leaderboard", animLogo: true, layers, frames: 64, delay: 70, still: 0.86,
    text: () => null,
    gfx: (t, img) => {
      const out = 1 - seg(t, 0.93, 0.07);
      const place = (id: string, x: number, y: number, w: number, h: number, start: number, dur: number, lift: number) => {
        const f = outCubic(seg(t, start, dur));
        return f < 0.004 || !img[id] ? "" : `<image xlink:href="${img[id]}" x="${x}" y="${y + (1 - f) * lift}" width="${w}" height="${h}" opacity="${f}"/>`;
      };
      const sway = 22 * Math.sin(TAU * t);
      const stage = `<defs><linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".09"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="fl" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="14"/></filter></defs>
<polygon points="${566 + sway},0 ${634 + sway},0 ${800 - sway},${BASE} ${400 + sway},${BASE}" fill="url(#beam)" opacity="${outCubic(seg(t, 0.16, 0.2))}"/>
<ellipse cx="${600 + DEP / 2}" cy="${BASE + 8}" rx="500" ry="20" fill="#fff" fill-opacity="${0.07 * outCubic(seg(t, 0.02, 0.15))}" filter="url(#fl)"/>`;

      const dust = dustGfx(t);

      const pods = SLOTS.map((s, n) => {
        const e = outBack(seg(t, s.delay, 0.22)), hh = Math.max(0, s.h * Math.min(1.05, e));
        if (hh < 2) return "";
        const al = Math.min(1, seg(t, s.delay, 0.08) * 2), top = BASE - hh, x = s.x, hot = s.i === 0, ftop = BASE - s.h, dz = DEP * SK;
        const front = `<rect x="${x}" y="${top}" width="${PW}" height="${hh}" fill="#0b0e0f"/><rect x="${x + 0.5}" y="${top + 0.5}" width="${PW - 1}" height="${hh - 1}" fill="url(#${hot ? "hot" : "glass"})" stroke="${hot ? "rgba(200,240,42,.5)" : "rgba(255,255,255,.12)"}"/>`;
        const topFace = `<polygon points="${x},${top} ${x + DEP},${top - dz} ${x + PW + DEP},${top - dz} ${x + PW},${top}" fill="${hot ? LIME : "#fff"}" fill-opacity="${(hot ? 0.24 : 0.14) + 0.05 * Math.sin(TAU * (t + n / 3))}"/>`;
        const side = `<polygon points="${x + PW},${top} ${x + PW + DEP},${top - dz} ${x + PW + DEP},${BASE - dz} ${x + PW},${BASE}" fill="#000" fill-opacity=".38"/>`;
        const sx = x - 90 + (PW + 150) * outCubic(seg(t, 0.6 + n * 0.08, 0.24));
        const sheen = `<clipPath id="pf${n}"><rect x="${x}" y="${top}" width="${PW}" height="${hh}"/></clipPath><g clip-path="url(#pf${n})"><polygon points="${sx + 26},${top} ${sx + 76},${top} ${sx + 50},${BASE} ${sx},${BASE}" fill="url(#sheen)"/></g>`;
        const r = rows[s.i];
        let body = "";
        if (r) {
          const cs = outCubic(seg(t, s.delay + 0.14, 0.12)), vp = outCubic(seg(t, s.delay + 0.18, 0.3));
          const cy0 = ftop + (s.h - BLOCK - 7 * s.cell + 12) / 2;
          const fin = num(r.views), cell = Math.min(s.cell, fitCell(fin, PW - 50, s.cell));
          body = `${place(`n${s.i}`, x, cy0, PW, 50, s.delay + 0.14, 0.12, 8)}<g opacity="${cs}">${px(fin, num(r.views * vp), x + PW / 2, cy0 + 62, cell, hot ? LIME : INK, "middle", hot, 0.7, (X) => 0.86 + 0.14 * Math.sin(TAU * (X / 120 - 2 * t + n * 0.3)))}</g>`;
        }
        return `<g opacity="${al}">${front}${topFace}${side}${sheen}${body}</g>`;
      }).join("");

      const agents = SLOTS.map((s, n) => {
        const r = rows[s.i];
        if (!r) return "";
        const a = seg(t, s.delay + 0.14, 0.26), p = outBack(a), hot = s.i === 0;
        if (a <= 0) return "";
        const ph = TAU * (t + n * 0.33), cx = s.x + PW / 2 + DEP / 2 - 4 + 3 * Math.cos(ph), ftop = BASE - s.h;
        const base0 = ftop - DEP * 0.3 - s.r - 22, cy = base0 + 7 * Math.sin(ph) - (1 - outCubic(a)) * 110, rr = s.r;
        const face = r.avatarUrl
          ? `<image xlink:href="${r.avatarUrl}" x="${-rr}" y="${-rr}" width="${rr * 2}" height="${rr * 2}"/>`
          : `<circle cy="${-rr * 0.2}" r="${rr * 0.28}" fill="#fff" fill-opacity=".3"/><path d="M${-rr * 0.55} ${rr * 0.62}Q0 ${-rr * 0.1} ${rr * 0.55} ${rr * 0.62}Z" fill="#fff" fill-opacity=".22"/>`;
        const lift = Math.min(1, Math.max(0, (base0 - cy) / 22 + 0.4));
        const shadow = `<ellipse cx="${cx}" cy="${ftop - DEP * 0.28}" rx="${rr * 0.85 * (1 - 0.3 * lift)}" ry="${5 * (1 - 0.3 * lift)}" fill="#000" fill-opacity="${0.5 * Math.min(1, a * 2)}"/>`;
        let ring = "";
        if (hot) {
          /* 8-bit power-up ring: stepped marching pixels + blinking pixel sparkles, snapped to a 4px grid */
          const step = Math.floor(t * 16), N = 28, R = rr + 15, snap = (v: number) => Math.round(v / 4) * 4;
          for (let q = 0; q < N; q++) { const an = (TAU * q) / N, on = (q + step) % 4 < 2; ring += `<rect x="${snap(Math.cos(an) * R) - 2.5}" y="${snap(Math.sin(an) * R) - 2.5}" width="5" height="5" fill="${(q + step) % 8 < 4 ? LIME : "#fff"}" fill-opacity="${on ? 1 : 0.22}"/>`; }
          for (let q = 0; q < 4; q++) {
            const ph = (Math.floor(t * 8) + q * 3) % 6, an = Math.PI / 4 + (q * Math.PI) / 2, sx = snap(Math.cos(an) * (rr + 34)), sy = snap(Math.sin(an) * (rr + 34));
            if (ph >= 4) continue;
            const arms = ph < 2 ? [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4]] : [[0, 0]];
            ring += arms.map(([ox, oy]) => `<rect x="${sx + ox - 2}" y="${sy + oy - 2}" width="4" height="4" fill="${q % 2 ? LIME : "#fff"}"/>`).join("");
          }
        }
        const badgeR = 14, bx = rr * 0.74, by = rr * 0.74;
        const badge = `<circle cx="${bx}" cy="${by}" r="${badgeR}" fill="${hot ? LIME : "#1b2022"}" stroke="${hot ? LIME : "rgba(255,255,255,.3)"}"/>${px(String(s.i + 1), String(s.i + 1), bx - 5.5 * 2.4 / 2 + 0.6, by - 8.4, 2.4, hot ? "#0b1005" : INK, "start", false)}`;
        let crown = "";
        if (hot) {
          const cu = outBack(seg(t, s.delay + 0.3, 0.16)), cc = 6, cxl = -CROWN[0].length * cc / 2, cyl = -CROWN.length * cc / 2;
          crown = `<g opacity="${Math.min(1, cu * 2)}" transform="translate(${(rr * 0.66).toFixed(1)} ${(-rr * 0.8 + 3 * Math.sin(TAU * (t + 0.2)) - (1 - Math.min(1, cu)) * 26).toFixed(1)}) rotate(${(24 + 4 * Math.sin(TAU * t)).toFixed(1)})"><g filter="url(#glow)" opacity=".5">${CROWN.map((row, ry) => [...row].map((c, rx) => c === "X" ? `<rect x="${cxl + rx * cc}" y="${cyl + ry * cc}" width="${cc}" height="${cc}" fill="${LIME}"/>` : "").join("")).join("")}</g>${CROWN.map((row, ry) => [...row].map((c, rx) => c === "X" ? `<rect x="${cxl + rx * cc}" y="${cyl + ry * cc}" width="${cc - 0.7}" height="${cc - 0.7}" fill="${ry === 0 ? "#fff" : LIME}" fill-opacity="${(0.78 + 0.22 * Math.sin(TAU * (rx / 9 - 2 * t))).toFixed(2)}"/>` : "").join("")).join("")}</g>`;
        }
        return `${shadow}<g transform="translate(${cx} ${cy}) scale(${0.55 + 0.45 * p})" opacity="${Math.min(1, a * 3)}">${ring}<circle r="${rr + 14}" fill="#fff" fill-opacity=".035"/><circle r="${rr}" fill="#151a16"/>${face}<circle r="${rr}" fill="none" stroke="${hot ? LIME : "#fff"}" stroke-opacity="${hot ? 0.9 : 0.25}" stroke-width="${hot ? 2 : 1.5}"/>${badge}${crown}</g>`;
      }).join("");

      let burst = "";
      const lead = SLOTS[1], u = seg(t, 0.46, 0.3);
      if (rows[0] && u > 0 && u < 1) {
        const bx = lead.x + PW / 2 + DEP / 2 - 4, by = BASE - lead.h - DEP * 0.3 - lead.r - 22, k = outCubic(u);
        const bs = Math.floor(k * 6) / 6, br = lead.r + 24 + 160 * bs;
        burst = Array.from({ length: 24 }, (_, j) => { const an = (TAU * j) / 24; return `<rect x="${Math.round((bx + Math.cos(an) * br) / 4) * 4 - 3}" y="${Math.round((by + Math.sin(an) * br) / 4) * 4 - 3}" width="6" height="6" fill="${j % 2 ? LIME : "#fff"}" fill-opacity="${(1 - bs).toFixed(2)}"/>`; }).join("") + Array.from({ length: 18 }, (_, j) => { const an = (TAU * j) / 18 + 0.2, dist = lead.r + 20 + (60 + 90 * rnd(j, 7)) * k, sz = 3 + 3 * rnd(j, 8); return `<rect x="${(bx + Math.cos(an) * dist - sz / 2).toFixed(1)}" y="${(by + Math.sin(an) * dist - sz / 2).toFixed(1)}" width="${sz.toFixed(1)}" height="${sz.toFixed(1)}" fill="${j % 3 ? LIME : "#fff"}" fill-opacity="${(1 - u).toFixed(2)}"/>`; }).join("");
      }
      const L1 = "ARENA:", L2 = "TOP 3 CONTENT AGENTS", c1 = 8, c2 = 5;
      const headline = `${pix3d(L1, 600 - (pxCols(L1) * c1) / 2, 82, c1, t)}${pix3d(L2, 600 - (pxCols(L2) * c2) / 2, 152, c2, t - 0.05)}`;
      return base(`<g opacity="${out}">${stage}${dust}${pods}${agents}${burst}${headline}${logoGfx(a, t)}${solanaMark(t)}</g>`);
    },
  };
}

function engine(d: MaterialData): Design {
  const made = Math.max(0, d.totalGenerated), sent = Math.min(d.totalPosts, Math.max(made, d.totalPosts));
  const rate = made ? Math.min(100, Math.round((sent / made) * 100)) : 0;
  const RX = 650, RW = W - M - RX, C = [300, 392] as const, R = 152;
  const rows: [string, number, string][] = [["Clips created", made, num(made)], ["Clips published", d.totalPosts, num(d.totalPosts)], ["Publish rate", rate, `${rate}%`]];
  return {
    label: "Clip engine",
    gfx: (t) => {
      const p = ease(t), circ = 2 * Math.PI * R, arc = circ * (rate / 100) * p;
      const ring = `<circle cx="${C[0]}" cy="${C[1]}" r="${R}" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="22"/><circle cx="${C[0]}" cy="${C[1]}" r="${R}" fill="none" stroke="${LIME}" stroke-width="22" stroke-linecap="round" stroke-dasharray="${arc} ${circ}" transform="rotate(-90 ${C[0]} ${C[1]})" filter="url(#glow)" opacity=".55"/><circle cx="${C[0]}" cy="${C[1]}" r="${R}" fill="none" stroke="${LIME}" stroke-width="22" stroke-linecap="round" stroke-dasharray="${arc} ${circ}" transform="rotate(-90 ${C[0]} ${C[1]})"/><circle cx="${C[0]}" cy="${C[1]}" r="${R - 38}" fill="none" stroke="${LIME}" stroke-opacity=".12" stroke-dasharray="2 7"/>`;
      const list = rows.map(([, v, s], i) => { const y = 262 + i * 112; return `${glass(RX, y, RW, 96, i === 2)}${px(s, s.endsWith("%") ? `${Math.round(v * p)}%` : num(v * p), RX + 28, y + 27, 6, i === 2 ? LIME : INK, "start", i === 2)}`; }).join("");
      return base(`${ring}${px(num(made), num(made * p), C[0], C[1] - 34, fitCell(num(made), 190, 9), INK, "middle", false)}${list}`);
    },
    text: () => (<>
      <Label x={RX} y={142} color={LIME} size={14}>Production  /  {d.period}</Label>
      <Headline x={RX} y={170} w={RW} size={46} lead="The clip" accent="engine" />
      <AvatarRow agents={d.agents} x={C[0] - 69} y={202} />
      <Label x={C[0]} y={C[1] - 62} w={260} align="center" size={11}>Clips created</Label>
      <Label x={C[0]} y={C[1] + 46} w={260} align="center" size={11} color={LIME}>{rate}% published</Label>
      {rows.map(([l], i) => <Label key={l} x={RX + RW - 28} y={262 + 34 + i * 112 - 6} w={200} align="end" size={11}>{l}</Label>)}
    </>),
  };
}

function pulse(d: MaterialData): Design {
  const cols: [string, number, string][] = [["Total views", d.totalViews, "Tracked across every agent"], ["Clips posted", d.totalPosts, "Published to connected socials"], ["Active agents", d.active, "Creating in this window"]];
  const CW = 336, CG = 40, Y = 346, CH = 244;
  const max = Math.max(1, ...cols.map((c) => c[1]));
  return {
    label: "Daily pulse",
    gfx: (t) => {
      const p = ease(t);
      return base(cols.map(([, v], i) => {
        const x = M + i * (CW + CG), s = num(v), cell = fitCell(s, CW - 60, 11);
        return `${glass(x, Y, CW, CH, i === 0)}${px(s, num(v * p), x + 30, Y + 78, cell, i === 0 ? LIME : INK, "start", i === 0)}<rect x="${x + 30}" y="${Y + CH - 56}" width="${CW - 60}" height="6" rx="3" fill="#fff" fill-opacity=".09"/><rect x="${x + 30}" y="${Y + CH - 56}" width="${Math.max(6, (CW - 60) * (i === 0 ? 1 : Math.min(1, v / max + .08)) * p)}" height="6" rx="3" fill="${i === 0 ? "url(#lime)" : "#8fa35a"}"/>`;
      }).join(""));
    },
    text: () => (<>
      <Label x={M} y={142} color={LIME} size={14}>The daily pulse  /  {d.period}</Label>
      <T x={M} y={176} size={66} font="Manrope" ls={-2}>The feed is</T>
      <T x={M} y={242} size={76} font="Fraunces" ls={-2} color={LIME}>moving.</T>
      <AvatarRow agents={d.agents} x={830} y={266} />
      {cols.map(([l, , cap], i) => { const x = M + i * (CW + CG); return <div key={l} style={{ display: "flex" }}>
        <Label x={x + 30} y={Y + 28} size={12}>{l}</Label><T x={x + 30} y={Y + CH - 34} w={CW - 60} size={14} font="Grotesk" color={MUTE}>{cap}</T></div>; })}
    </>),
  };
}

/* ── shared gfx helpers for the 8-bit cards ───────────────────────────────── */

/** Rising pixel dust at three depths (sharp / soft / bokeh). */
function dustGfx(t: number) {
  const dustIn = outCubic(seg(t, 0, 0.12));
  return `<defs><filter id="pb1" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6"/></filter><filter id="pb2" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3.4"/></filter></defs>` + [0, 1, 2].map((depth) => `<g${depth ? ` filter="url(#pb${depth})"` : ""}>${DUST.filter((p) => (p.size < 3.6 ? 0 : p.size < 5 ? 1 : 2) === depth).map((p) => {
    const u = (p.k * t + p.ph) % 1, y = 650 - u * 620, al = 0.7 * (1 - depth * 0.18) * Math.sin(Math.PI * u) * dustIn;
    return `<rect x="${-p.size / 2}" y="${-p.size / 2}" width="${p.size}" height="${p.size}" fill="${p.lime ? LIME : "#fff"}" fill-opacity="${al.toFixed(3)}" transform="translate(${(p.x + 14 * Math.sin(TAU * (t + p.ph))).toFixed(1)} ${y.toFixed(1)}) rotate(${(p.dir * 360 * p.k * t + p.ph * 90).toFixed(1)})"/>`;
  }).join("")}</g>`).join("");
}

/** A pre-rasterised text layer, faded and lifted in. */
const layerAt = (img: Record<string, string>, t: number, id: string, x: number, y: number, w: number, h: number, start: number, dur: number, lift = 0) => {
  const f = outCubic(seg(t, start, dur));
  return f < 0.004 || !img[id] ? "" : `<image xlink:href="${img[id]}" x="${x}" y="${(y + (1 - f) * lift).toFixed(1)}" width="${w}" height="${h}" opacity="${f.toFixed(3)}"/>`;
};

/** Chunky 3D slab: dark body, glass front, lit top and shaded side. */
function slab(x: number, y: number, w: number, h: number, dep: number, hot: boolean, t = 0, ph = 0) {
  const dz = dep * 0.55;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#0b0e0f"/><rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="url(#${hot ? "hot" : "glass"})" stroke="${hot ? "rgba(200,240,42,.5)" : "rgba(255,255,255,.12)"}"/>`
    + `<polygon points="${x},${y} ${x + dep},${y - dz} ${x + w + dep},${y - dz} ${x + w},${y}" fill="${hot ? LIME : "#fff"}" fill-opacity="${((hot ? 0.24 : 0.13) + 0.04 * Math.sin(TAU * (t + ph))).toFixed(3)}"/>`
    + `<polygon points="${x + w},${y} ${x + w + dep},${y - dz} ${x + w + dep},${y + h - dz} ${x + w},${y + h}" fill="#000" fill-opacity=".38"/>`;
}

const STAR = ["...X...", "...X...", "XXXXXXX", ".XXXXX.", "..XXX..", ".XX.XX.", ".X...X."];
const pixSprite = (rows: string[], x: number, y: number, cell: number, color: string, op = 1) =>
  rows.map((row, ry) => [...row].map((c, rx) => c === "X" ? `<rect x="${(x + rx * cell).toFixed(1)}" y="${(y + ry * cell).toFixed(1)}" width="${(cell - 0.5).toFixed(1)}" height="${(cell - 0.5).toFixed(1)}" fill="${color}" fill-opacity="${op}"/>` : "").join("")).join("");

/** 8-bit segmented bar ("health bar"): `n` blocks, the first `lit` filled, the next one blinking. */
function segBar(x: number, y: number, w: number, n: number, lit: number, color: string, t: number) {
  const bw = (w - (n - 1) * 2) / n;
  return Array.from({ length: n }, (_, i) => {
    const on = i < Math.floor(lit), part = i === Math.floor(lit) && lit % 1 > 0.05, blink = part && Math.floor(t * 8) % 2 === 0;
    return `<rect x="${(x + i * (bw + 2)).toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="10" fill="${on || blink ? color : "#fff"}" fill-opacity="${on ? 0.95 - 0.1 * Math.sin(TAU * (2 * t - i * 0.15)) : blink ? 0.6 : 0.09}"/>`;
  }).join("");
}

/* ── platform icons: 12×12 pixel sprites ──────────────────────────────────── */

const PLAT: Record<string, { name: string; color: string; icon: string[] }> = {
  youtube: { name: "YouTube", color: "#FF2D46", icon: ["............", ".XXXXXXXXXX.", "XXXXXXXXXXXX", "XXXXWXXXXXXX", "XXXXWWXXXXXX", "XXXXWWWXXXXX", "XXXXWWXXXXXX", "XXXXWXXXXXXX", "XXXXXXXXXXXX", ".XXXXXXXXXX.", "............", "............"] },
  instagram: { name: "Instagram", color: "#FF4F9A", icon: ["............", ".XXXXXXXXXX.", "XX........XX", "X..XXXXXX.WX", "X.XX....XX.X", "X.X......X.X", "X.X......X.X", "X.XX....XX.X", "X..XXXXXX..X", "XX........XX", ".XXXXXXXXXX.", "............"] },
  tiktok: { name: "TikTok", color: "#25F4EE", icon: ["......XXX...", "......XXXX..", "......XX.XX.", "......XX..XX", "......XX....", "......XX....", "..XX..XX....", ".XXXX.XX....", ".XXXXXXX....", ".XXXXXX.....", "..XXXX......", "............"] },
  facebook: { name: "Facebook", color: "#2F8BFF", icon: [".XXXXXXXXXX.", "XXXXXXXXXXXX", "XXXXXWWWXXXX", "XXXXWWXXXXXX", "XXXXWWXXXXXX", "XXWWWWWWXXXX", "XXXXWWXXXXXX", "XXXXWWXXXXXX", "XXXXWWXXXXXX", "XXXXWWXXXXXX", "XXXXXXXXXXXX", ".XXXXXXXXXX."] },
  x: { name: "X", color: "#EDEDED", icon: ["XX........XX", "XXX......XXX", ".XXX....XXX.", "..XXX..XXX..", "...XXXXXX...", "....XXXX....", "....XXXX....", "...XXXXXX...", "..XXX..XXX..", ".XXX....XXX.", "XXX......XXX", "XX........XX"] },
  other: { name: "Other", color: "#8F9A8C", icon: ["....XXXX....", "..XX.XX.XX..", ".X..X..X..X.", ".X..X..X..X.", "XXXXXXXXXXXX", "X...X..X...X", "XXXXXXXXXXXX", ".X..X..X..X.", ".X..X..X..X.", "..XX.XX.XX..", "....XXXX....", "............"] },
};
function iconGfx(id: string, x: number, y: number, cell: number, op: number) {
  const p = PLAT[id];
  if (!p) return "";
  const draw = (dx: number, dy: number, main: string, accent: string) => p.icon.map((row, ry) => [...row].map((c, rx) => c === "." ? "" : `<rect x="${(x + dx + rx * cell).toFixed(1)}" y="${(y + dy + ry * cell).toFixed(1)}" width="${(cell - 0.4).toFixed(1)}" height="${(cell - 0.4).toFixed(1)}" fill="${c === "W" ? accent : main}" fill-opacity="${op}"/>`).join("")).join("");
  return `${id === "tiktok" ? draw(cell * 0.7, cell * 0.5, "#FE2C55", "#FE2C55") : ""}${draw(0, 0, p.color, "#fff")}`;
}

/* ── Views by platform: 8-bit stacked-block bar chart ─────────────────────── */

function social(d: MaterialData, a: Assets): Design {
  const known = d.platforms.filter((p) => PLAT[p.id] && p.id !== "other").sort((x, y) => y.views - x.views);
  const other = Math.max(0, d.monthViews - known.reduce((s, p) => s + p.views, 0));
  const bars = [...known, ...(other > 0 ? [{ id: "other", views: other }] : [])];
  const total = Math.max(d.monthViews, known.reduce((s, p) => s + p.views, 0)), maxV = Math.max(1, ...bars.map((b) => b.views));
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const BASE = 540, BX0 = 500, SPAN = 628, GAP = 26, DEP = 10, PITCH = 18, MAXB = 16;
  const n = Math.max(1, bars.length), bw = Math.floor((SPAN - (n - 1) * GAP) / n);
  const nb = bars.map((b) => (b.views <= 0 ? 1 : Math.max(1, Math.round((b.views / maxV) * MAXB))));
  const leader = bars[0];
  const fin = full(total), tcell = fitCell(fin, 332, 9);
  const layers: Layer[] = [
    { id: "kick", w: 400, h: 20, node: <Label x={0} y={0} w={400} size={14} color={LIME}>Last 30 days</Label> },
    { id: "tot", w: 392, h: 14, node: <T x={196} y={0} w={392} align="center" size={11} font="Grotesk" ls={2.6} upper color={MUTE}>Total views this month</T> },
    { id: "lead", w: 300, h: 44, node: <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
      <span style={{ fontFamily: "Grotesk", fontSize: 11, letterSpacing: 2.6, textTransform: "uppercase", color: MUTE }}>Top platform</span>
      <span style={{ fontFamily: "Manrope", fontWeight: 500, fontSize: 24, lineHeight: 1.1, marginTop: 8, letterSpacing: -0.4, color: "#FFFFFF", whiteSpace: "nowrap" }}>{leader && leader.views > 0 ? `${PLAT[leader.id].name}  ${pct(leader.views)}%` : "Waiting for views"}</span>
    </div> },
    ...bars.map((b, i) => ({ id: `pl${i}`, w: bw + GAP, h: 14, node: <T x={(bw + GAP) / 2} y={0} w={bw + GAP} align="center" size={11} font="Grotesk" ls={2} upper color={MUTE}>{`${PLAT[b.id].name}  ${pct(b.views)}%`}</T> })),
  ];
  return {
    label: "Views by platform", layers, frames: 64, delay: 70, still: 0.86, animLogo: true,
    text: () => null,
    gfx: (t, img) => {
      const out = 1 - seg(t, 0.93, 0.07), step = Math.floor(t * 8);
      const f0 = outCubic(seg(t, 0.06, 0.16)), cp = outCubic(seg(t, 0.12, 0.34));
      const haze = `<ellipse cx="${700 + 260 * Math.cos(TAU * t)}" cy="${330 + 30 * Math.sin(TAU * 2 * t)}" rx="560" ry="300" fill="url(#haze)"/>`;
      const floor = `<ellipse cx="${BX0 + SPAN / 2}" cy="${BASE + 6}" rx="${SPAN / 2 + 60}" ry="16" fill="#fff" fill-opacity="${(0.07 * f0).toFixed(3)}" filter="url(#glow)"/>`;

      const left = `<g opacity="${f0}" transform="translate(0 ${(1 - f0) * 24})">${slab(56, 322, 392, 140, 10, true, t)}${img.tot ? `<image xlink:href="${img.tot}" x="56" y="344" width="392" height="14"/>` : ""}${px(fin, full(total * cp), 252, 322 + 33 + (140 - 33 - 7 * tcell) / 2, tcell, LIME, "middle", true, 0.45 + 0.2 * Math.sin(TAU * 2 * t), (x) => 0.78 + 0.22 * Math.sin(TAU * (x / 240 - 2 * t)))}</g>`;
      const chipF = outCubic(seg(t, 0.28, 0.16));
      const chip = `<g opacity="${chipF}" transform="translate(0 ${(1 - chipF) * 22})">${slab(56, 484, 392, 74, 8, false, t, 0.3)}${leader ? iconGfx(leader.id, 76, 498 + (step % 4 < 2 ? 0 : -2), 3.8, 1) : ""}${img.lead ? `<image xlink:href="${img.lead}" x="142" y="500" width="300" height="44"/>` : ""}</g>`;

      const chart = bars.map((b, i) => {
        const x = BX0 + i * (bw + GAP), delay = 0.08 + i * 0.07, col = PLAT[b.id].color, cx = x + bw / 2, topY = BASE - nb[i] * PITCH;
        let blocks = "", flash = "";
        for (let j = 0; j < nb[i]; j++) {
          const e = seg(t, delay + j * 0.014, 0.07);
          if (e <= 0) continue;
          const f = outCubic(e), y = BASE - (j + 1) * PITCH + 3 - (1 - f) * 46, lit = 0.8 + 0.2 * Math.sin(TAU * (j * 0.4 - 2 * t + i * 0.2)), al = Math.min(1, e * 3) * (b.views <= 0 ? 0.25 : 1) * lit;
          blocks += `<polygon points="${x},${y} ${x + DEP},${y - DEP * 0.55} ${x + bw + DEP},${y - DEP * 0.55} ${x + bw},${y}" fill="#fff" fill-opacity="${(0.2 * al).toFixed(2)}"/><polygon points="${x + bw},${y} ${x + bw + DEP},${y - DEP * 0.55} ${x + bw + DEP},${y + 15 - DEP * 0.55} ${x + bw},${y + 15}" fill="#000" fill-opacity="${(0.4 * al).toFixed(2)}"/><rect x="${x}" y="${y}" width="${bw}" height="15" fill="${col}" fill-opacity="${al.toFixed(2)}"/><rect x="${x}" y="${y}" width="${bw}" height="3" fill="#fff" fill-opacity="${(0.28 * al).toFixed(2)}"/>`;
          if (j === nb[i] - 1 && e >= 1 && (step + i) % 4 === 0) flash = `<rect x="${x}" y="${y}" width="${bw}" height="15" fill="#fff" fill-opacity=".38"/>`;
        }
        const done = delay + nb[i] * 0.014 + 0.04, lf = outCubic(seg(t, done, 0.1)), bob = (step + i) % 4 < 2 ? 0 : -3;
        const vp = outCubic(seg(t, delay + 0.05, nb[i] * 0.014 + 0.2)), vcell = 4, vy = topY - 26 - 7 * vcell + bob;
        const label = lf > 0 ? `<g opacity="${lf}">${px(num(b.views), num(b.views * vp), cx, vy, vcell, col, "middle", true, 0.55, (X) => 0.9 + 0.1 * Math.sin(TAU * (X / 70 - 2 * t + i * 0.4)))}${i === 0 && b.views > 0 ? pixSprite(["XXXXX", ".XXX.", "..X.."], cx - 10, vy - 18 + (step % 2 ? 2 : -2), 4, LIME) : ""}</g>` : "";
        const su = (2 * t + i * 0.31) % 1, spark = lf > 0.5 ? pixSprite([".X.", "XXX", ".X."], Math.round((cx + (i % 2 ? 1 : -1) * (bw / 2 + 16)) / 4) * 4, Math.round((topY - 6 - su * 56) / 4) * 4, 4, "#fff", (Math.sin(Math.PI * su) * 0.85).toFixed(2) as unknown as number) : "";
        const tf = outCubic(seg(t, delay + 0.02, 0.14)), hop = (step + i) % 4 < 2 ? 0 : -3, ty = 556 + hop;
        const tile = `<g opacity="${tf}"><rect x="${cx - 31}" y="${ty}" width="62" height="62" rx="12" fill="#0b0e0f" stroke="${col}" stroke-opacity=".65" stroke-width="1.5"/><rect x="${cx - 30}" y="${ty + 1}" width="60" height="60" rx="11" fill="${col}" fill-opacity=".09"/>${iconGfx(b.id, cx - 22.8, ty + 8.2, 3.8, 1)}</g>`;
        return `<g>${blocks}${flash}${label}${spark}${tile}${layerAt(img, t, `pl${i}`, cx - (bw + GAP) / 2, 626, bw + GAP, 14, delay + 0.1, 0.14)}</g>`;
      }).join("");

      const head = `${layerAt(img, t, "kick", 56, 104, 400, 20, 0, 0.14, 12)}${pix3d("VIEWS BY", 56, 134, 7, t)}${pix3d("PLATFORM", 56, 196, 7, t - 0.06)}`;
      return base(`<g opacity="${out}">${haze}${dustGfx(t)}${floor}${logoGfx(a, t)}${solanaMark(t)}${head}${left}${chip}${chart}</g>`);
    },
  };
}

/* ── Agents minted today: 8-bit scoreboard ────────────────────────────────── */

function minted(d: MaterialData, a: Assets): Design {
  const rows = d.minted.slice(0, 4);
  const fin = full(d.mintedToday), cell = Math.min(15, fitCell(fin, 470, 15)), NY = 218;
  const total = d.totalAgents, step0 = total < 100 ? 25 : total < 500 ? 100 : total < 2000 ? 250 : 1000;
  const prev = Math.floor(total / step0) * step0, next = prev + step0, prog = (total - prev) / step0;
  const rate = total > 0 ? Math.min(1, d.weekActive / total) : 0;
  const TILES = [
    { x: 56, y: 394, w: 262, h: 116, label: "Total agents on Vello", value: total, bar: prog, cap: `Next milestone ${next.toLocaleString("en-US")}`, color: INK },
    { x: 340, y: 436, w: 262, h: 116, label: "Active this week", value: d.weekActive, bar: rate, cap: `${Math.round(rate * 100)}% of the roster`, color: LIME },
  ];
  const RX = 660, RW = 460, RH = 84, RG = 14, RY0 = 150;
  const layers: Layer[] = [
    { id: "head", w: 600, h: 70, node: <div style={{ position: "absolute", left: 0, top: 0, width: 600, display: "flex", alignItems: "baseline", whiteSpace: "nowrap" }}>
      <span style={{ fontFamily: "Manrope", fontWeight: 500, fontSize: 54, lineHeight: 1.1, letterSpacing: -1.8, color: "#FFFFFF" }}>Agents minted</span>
      <span style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: 54, lineHeight: 1.1, letterSpacing: -1.8, color: LIME, marginLeft: 14 }}>today</span>
    </div> },
    { id: "cap", w: 560, h: 16, node: <Label x={0} y={0} w={560} size={12} color={MUTE}>New agents in the last 24 hours</Label> },
    { id: "mk", w: 300, h: 16, node: <Label x={0} y={0} w={300} size={12} color={MUTE}>Latest mints</Label> },
    ...TILES.flatMap((tl, i) => [
      { id: `tl${i}`, w: tl.w, h: 14, node: <T x={tl.w / 2} y={0} w={tl.w} align="center" size={11} font="Grotesk" ls={2.4} upper color={MUTE}>{tl.label}</T> },
      { id: `tc${i}`, w: tl.w, h: 14, node: <T x={tl.w / 2} y={0} w={tl.w} align="center" size={11} font="Grotesk" ls={2.2} upper color={FAINT}>{tl.cap}</T> },
    ]),
    ...rows.flatMap((r, i) => [
      { id: `n${i}`, w: 280, h: 50, node: <div style={{ display: "flex", flexDirection: "column", width: 280 }}>
        <span style={{ fontFamily: "Manrope", fontWeight: 500, fontSize: 24, lineHeight: 1.1, letterSpacing: -0.4, color: "#FFFFFF", whiteSpace: "nowrap" }}>{nameOf(r).slice(0, 18)}</span>
        <span style={{ fontFamily: "Grotesk", fontSize: 13, letterSpacing: 2, marginTop: 8, color: MUTE, whiteSpace: "nowrap" }}>{handleOf(r) ? `@${handleOf(r)}` : "new agent"}</span>
      </div> },
      { id: `g${i}`, w: 96, h: 26, node: <div style={{ display: "flex", width: 96, justifyContent: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", height: 26, padding: "0 12px", borderRadius: 13, border: `1px solid ${i === 0 ? "rgba(200,240,42,.6)" : "rgba(255,255,255,.18)"}`, backgroundColor: i === 0 ? "rgba(200,240,42,.12)" : "rgba(255,255,255,.04)", fontFamily: "Grotesk", fontSize: 12, letterSpacing: 3, color: i === 0 ? LIME : MUTE, textTransform: "uppercase" }}>{r.ago}</div>
      </div> },
    ]),
    ...(rows.length ? [] : [{ id: "empty", w: RW, h: 60, node: <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: RW }}>
      <span style={{ fontFamily: "Manrope", fontWeight: 500, fontSize: 30, letterSpacing: -0.5, color: "#FFFFFF" }}>Next mint starts the day</span>
      <span style={{ fontFamily: "Grotesk", fontSize: 14, marginTop: 10, color: MUTE }}>mint an agent at velloagents.com</span>
    </div> }]),
  ];
  return {
    label: "Mint report", layers, frames: 64, delay: 70, still: 0.86, animLogo: true,
    text: () => null,
    gfx: (t, img) => {
      const out = 1 - seg(t, 0.93, 0.07), st = Math.floor(t * 8);
      const haze = `<ellipse cx="${360 + 280 * Math.cos(TAU * t)}" cy="${340 + 30 * Math.sin(TAU * 2 * t)}" rx="560" ry="300" fill="url(#haze)"/>`;
      const big = `<g filter="url(#glow)" opacity="0"></g>${pix3d(fin, 56, NY, cell, t)}`;
      const capY = NY + 7 * cell + 30;
      const tiles = TILES.map((tl, i) => {
        const f = outBack(seg(t, 0.3 + i * 0.1, 0.22)), al = Math.min(1, seg(t, 0.3 + i * 0.1, 0.1) * 2), vp = outCubic(seg(t, 0.4 + i * 0.1, 0.3)), lit = tl.bar * 16 * outCubic(seg(t, 0.55 + i * 0.1, 0.3));
        if (al <= 0) return "";
        const dy = (1 - Math.min(1, f)) * 40 - 0;
        return `<g opacity="${al}" transform="translate(0 ${dy.toFixed(1)})">${slab(tl.x, tl.y, tl.w, tl.h, 10, i === 1, t, i * 0.4)}${img[`tl${i}`] ? `<image xlink:href="${img[`tl${i}`]}" x="${tl.x}" y="${tl.y + 14}" width="${tl.w}" height="14"/>` : ""}${px(full(tl.value), full(tl.value * vp), tl.x + tl.w / 2, tl.y + 34, 5, tl.color, "middle", i === 1, 0.7, (X) => 0.9 + 0.1 * Math.sin(TAU * (X / 80 - 2 * t + i * 0.3)))}${segBar(tl.x + 24, tl.y + 80, tl.w - 48, 16, lit, tl.color === LIME ? LIME : "#fff", t)}${img[`tc${i}`] ? `<image xlink:href="${img[`tc${i}`]}" x="${tl.x}" y="${tl.y + 98}" width="${tl.w}" height="14"/>` : ""}</g>`;
      }).join("");

      const list = rows.length ? rows.map((r, i) => {
        const dx = i % 2 ? 0 : 28, x = RX + dx, w = RW - 28, y = RY0 + i * (RH + RG), hot = i === 0, d0 = 0.16 + i * 0.09;
        const e = seg(t, d0, 0.2), slide = Math.round(((1 - outCubic(e)) * 220) / 8) * 8;
        if (e <= 0) return "";
        const cx = x + 46, cy = y + RH / 2, rr = 26, bob = 2 * Math.sin(TAU * (t + i * 0.25));
        const face = r.avatarUrl ? `<image xlink:href="${r.avatarUrl}" x="${-rr}" y="${-rr}" width="${rr * 2}" height="${rr * 2}"/>` : `<circle cy="${-rr * 0.2}" r="${rr * 0.28}" fill="#fff" fill-opacity=".3"/><path d="M${-rr * 0.55} ${rr * 0.62}Q0 ${-rr * 0.1} ${rr * 0.55} ${rr * 0.62}Z" fill="#fff" fill-opacity=".22"/>`;
        const star = hot && e >= 1 ? pixSprite(STAR, x + w - 150, y + 6, 3, LIME, st % 2 ? 1 : 0.35) : "";
        return `<g opacity="${Math.min(1, e * 3)}" transform="translate(${slide} 0)">${slab(x, y, w, RH, 8, hot, t, i * 0.3)}<g transform="translate(${cx} ${(cy + bob).toFixed(1)})"><circle r="${rr}" fill="#151a16"/>${face}<circle r="${rr}" fill="none" stroke="${hot ? LIME : "#fff"}" stroke-opacity="${hot ? 0.9 : 0.25}" stroke-width="${hot ? 2 : 1.5}"/></g>${img[`n${i}`] ? `<image xlink:href="${img[`n${i}`]}" x="${x + 90}" y="${y + 17}" width="280" height="50"/>` : ""}${img[`g${i}`] ? `<image xlink:href="${img[`g${i}`]}" x="${x + w - 22 - 96}" y="${y + RH / 2 - 13}" width="96" height="26"/>` : ""}${star}</g>`;
      }).join("") : `<g opacity="${outCubic(seg(t, 0.2, 0.2))}">${slab(RX, RY0, RW, 4 * RH + 3 * RG, 8, false, t)}${layerAt(img, t, "empty", RX, RY0 + 140, RW, 60, 0.3, 0.2)}</g>`;

      return base(`<g opacity="${out}">${haze}${dustGfx(t)}${logoGfx(a, t)}${solanaMark(t)}${layerAt(img, t, "head", 56, 112, 600, 70, 0.02, 0.2, 16)}${big}${layerAt(img, t, "cap", 56, capY, 560, 16, 0.3, 0.16, 8)}${layerAt(img, t, "mk", RX, 120, 300, 16, 0.1, 0.16, 10)}${tiles}${list}</g>`);
    },
  };
}

/** Centred pixel counter with the shared shimmer — `cur` is what to draw now, `final` fixes the width. */
const pxText = (cur: string, final: string, x: number, y: number, cell: number, color: string, glow: boolean, t: number, i: number) =>
  px(final, cur, x, y, cell, color, "middle", glow, 0.7, (X) => 0.9 + 0.1 * Math.sin(TAU * (X / 80 - 2 * t + i * 0.3)));

/* ── Agent launch: close-up pixel avatar + FOMO ───────────────────────────── */

interface DesignExtra { grid: { n: number; px: Uint8Array } | null }
const AV_N = 32;

/** 32×32 colour grid of an agent's profile image (square crop, slightly boosted) — the "pixel scan". */
async function loadSquareGrid(url?: string): Promise<DesignExtra["grid"]> {
  if (!url) return null;
  try {
    let buffer: Buffer;
    if (url.startsWith("data:")) buffer = Buffer.from(url.split(",")[1] ?? "", "base64");
    else buffer = (await safeFetchToBuffer(new URL(url, process.env.NEXT_PUBLIC_APP_URL || "https://velloagents.com").href, { maxBytes: 5 * 1024 * 1024, timeoutMs: 6000 })).buffer;
    const { data } = await sharp(buffer, { limitInputPixels: 16_000_000 }).rotate().flatten({ background: "#151a16" })
      .resize(AV_N, AV_N, { fit: "cover", position: "attention" }).modulate({ saturation: 1.2 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { n: AV_N, px: new Uint8Array(data) };
  } catch { return null; }
}
/** Head-and-shoulders silhouette for agents without a usable image. */
function silhouetteGrid(): NonNullable<DesignExtra["grid"]> {
  const px = new Uint8Array(AV_N * AV_N * 3);
  for (let y = 0; y < AV_N; y++) for (let x = 0; x < AV_N; x++) {
    const head = (x - 16) ** 2 + (y - 12) ** 2 < 49, body = (x - 16) ** 2 / 150 + (y - 31) ** 2 / 110 < 1;
    const c = head || body ? [88, 98, 70] : [21 + (x + y) % 3 * 3, 26, 22];
    px.set(c, (y * AV_N + x) * 3);
  }
  return { n: AV_N, px };
}
/* ── 8-bit country flags (16×11 pixel grids) ──────────────────────────────── */

const FW = 16, FH = 11;
type FlagFn = (x: number, y: number) => string | null;
const hs = (...c: string[]): FlagFn => (_x, y) => c[Math.floor((y * c.length) / FH)];
const vs = (...c: string[]): FlagFn => (x) => c[Math.floor((x * c.length) / FW)];
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const over = (base: FlagFn, ...layers: [(x: number, y: number) => boolean, string][]): FlagFn => (x, y) => { for (const [hit, col] of layers) if (hit(x, y)) return col; return base(x, y); };
const star = (cx: number, cy: number) => (x: number, y: number) => (x === cx && Math.abs(y - cy) <= 1) || (y === cy && Math.abs(x - cx) <= 1);
const WHITE = "#F5F5F2", RED = "#E03A3E", BLUE = "#2447B8", NAVY = "#14246B", GREEN = "#1F9D55", YELLOW = "#F6C945", BLACK = "#16181A", ORANGE = "#F28A2E", SKY = "#6CB4EE";
const union: FlagFn = (x, y) => {
  if (Math.abs(x - 7.5) <= 0.6 || Math.abs(y - 5) <= 0.6) return RED;
  if (Math.abs(x - 7.5) <= 1.6 || Math.abs(y - 5) <= 1.6) return WHITE;
  if (Math.abs((x * FH) / FW - y) < 1.1 || Math.abs(((FW - 1 - x) * FH) / FW - y) < 1.1) return WHITE;
  return BLUE;
};
const FLAGS: Record<string, FlagFn> = {
  US: (x, y) => (x < 7 && y < 6 ? ((x + y) % 2 === 0 && x % 2 === 1 ? WHITE : NAVY) : y % 2 === 0 ? RED : WHITE),
  GB: union,
  MY: (x, y) => (x < 8 && y < 6 ? (disc(3, 3, 2)(x, y) && !disc(4, 3, 1.5)(x, y) ? YELLOW : NAVY) : y % 2 === 0 ? RED : WHITE),
  SG: over(hs(RED, WHITE), [(x, y) => disc(3, 2, 2)(x, y) && !disc(4, 2, 1.6)(x, y), WHITE], [star(6, 2), WHITE]),
  ID: hs(RED, WHITE), PL: hs(WHITE, RED), UA: hs(BLUE, YELLOW), NL: hs(RED, WHITE, BLUE), RU: hs(WHITE, BLUE, RED), DE: hs(BLACK, RED, YELLOW),
  FR: vs(BLUE, WHITE, RED), IT: vs(GREEN, WHITE, RED), IE: vs(GREEN, WHITE, ORANGE), NG: vs(GREEN, WHITE, GREEN),
  IN: over(hs(ORANGE, WHITE, GREEN), [disc(7.5, 5, 1.4), NAVY]),
  PH: over(hs(BLUE, RED), [(x, y) => x < 7 && Math.abs(y - 5) < 6 - x * 0.9, WHITE], [disc(2, 5, 1.2), YELLOW]),
  TH: (x, y) => { const u = (y * 6) / FH; return u < 1 || u >= 5 ? RED : u < 2 || u >= 4 ? WHITE : NAVY; },
  VN: over(() => RED, [star(7, 5), YELLOW], [(x, y) => Math.abs(x - 7) === 1 && Math.abs(y - 5) === 1, YELLOW]),
  JP: over(() => WHITE, [disc(7.5, 5, 3), RED]),
  KR: over(() => WHITE, [(x, y) => disc(7.5, 5, 2.6)(x, y) && y < 5, RED], [disc(7.5, 5, 2.6), BLUE], [(x, y) => (x === 2 || x === 13) && (y === 2 || y === 8), BLACK]),
  CN: over(() => RED, [star(3, 3), YELLOW], [(x, y) => (x === 6 && y === 1) || (x === 7 && y === 2) || (x === 7 && y === 4) || (x === 6 && y === 5), YELLOW]),
  HK: over(() => RED, [disc(7.5, 5, 2.2), WHITE]),
  TW: (x, y) => (x < 8 && y < 6 ? (disc(3.5, 2.5, 1.6)(x, y) ? WHITE : BLUE) : RED),
  AU: (x, y) => (x < 8 && y < 6 ? (Math.abs(x - 3.5) <= 0.6 || Math.abs(y - 2.5) <= 0.6 ? RED : WHITE) : (x === 4 && y === 8) || (x === 11 && y === 3) || (x === 12 && y === 7) || (x === 10 && y === 6) ? WHITE : NAVY),
  NZ: (x, y) => (x < 8 && y < 6 ? (Math.abs(x - 3.5) <= 0.6 || Math.abs(y - 2.5) <= 0.6 ? RED : WHITE) : (x === 11 && y === 3) || (x === 13 && y === 6) || (x === 10 && y === 8) ? RED : NAVY),
  CA: (x, y) => (x < 4 || x >= 12 ? RED : (Math.abs(x - 7.5) <= 1 && y >= 3 && y <= 6) || (x >= 6 && x <= 9 && y === 5) || (Math.abs(x - 7.5) <= 2 && y === 4) ? RED : WHITE),
  ES: (x, y) => { const u = (y * 4) / FH; return u < 1 || u >= 3 ? RED : YELLOW; },
  PT: over(vs(GREEN, GREEN, RED, RED, RED), [disc(5.5, 5, 1.8), YELLOW]),
  BR: over(() => GREEN, [disc(7.5, 5, 2.4), BLUE], [(x, y) => Math.abs(x - 7.5) / 7 + Math.abs(y - 5) / 4.4 <= 1 && !disc(7.5, 5, 2.4)(x, y), YELLOW]),
  MX: over(vs(GREEN, WHITE, RED), [disc(7.5, 5, 1.2), "#8A5A2B"]),
  AR: over(hs(SKY, WHITE, SKY), [disc(7.5, 5, 1.1), YELLOW]),
  CO: (x, y) => { const u = (y * 4) / FH; return u < 2 ? YELLOW : u < 3 ? BLUE : RED; },
  AE: (x, y) => (x < 4 ? RED : y < 4 ? GREEN : y < 7 ? WHITE : BLACK),
  SA: over(() => GREEN, [(x, y) => y === 7 && x >= 3 && x <= 12, WHITE], [(x, y) => y === 4 && x >= 4 && x <= 11 && x % 2 === 0, WHITE]),
  EG: over(hs(RED, WHITE, BLACK), [disc(7.5, 5, 1), YELLOW]),
  TR: over(() => RED, [disc(5.5, 5, 3), WHITE], [disc(6.6, 5, 2.4), RED], [star(10, 5), WHITE]),
  SE: (x, y) => (x >= 4 && x <= 6) || y === 5 ? YELLOW : BLUE,
  ZA: (x, y) => (y >= 4 && y <= 6 && x >= 4 ? GREEN : x < 4 && Math.abs(y - 5) <= 4 - x ? BLACK : y < 5 ? RED : BLUE),
  PK: over(() => GREEN, [(x) => x < 4, WHITE], [(x, y) => disc(9, 5, 2.4)(x, y) && !disc(10, 4.6, 2)(x, y), WHITE]),
  BD: over(() => GREEN, [disc(6.8, 5, 3), RED]),
};

/** The 8-bit flag as animated pixels: they pop in, then the whole flag waves and shimmers. Unknown countries get a pixel globe. */
function flagGfx(code: string, x: number, y: number, cell: number, t: number, start: number) {
  const fn = FLAGS[code.toUpperCase()];
  const globe = PLAT.other.icon;
  let out = "";
  for (let r = 0; r < FH; r++) for (let c = 0; c < FW; c++) {
    let col: string | null;
    if (fn) col = fn(c, r);
    else col = globe[r]?.[c - 2] === "X" ? "#8F9A8C" : null;
    if (!col) continue;
    const e = outBack(seg(t, start + ((c + r * 1.3) / (FW + FH)) * 0.14, 0.1));
    if (e < 0.02) continue;
    const wave = Math.sin(TAU * (t + c / FW * 0.9)), dy = 1.6 * wave * (c / FW), lit = 0.9 + 0.12 * Math.cos(TAU * (t + c / FW * 0.9)), sz = cell * Math.min(1.1, e);
    out += `<rect x="${(x + c * cell + (cell - sz) / 2).toFixed(1)}" y="${(y + r * cell + dy + (cell - sz) / 2).toFixed(1)}" width="${(sz - 0.3).toFixed(1)}" height="${(sz - 0.3).toFixed(1)}" fill="${col}" fill-opacity="${Math.min(1, e * 2 * lit).toFixed(2)}"/>`;
  }
  return out;
}

const ARROW = ["...X....", "...XX...", "XXXXXX..", "XXXXXXX.", "XXXXXX..", "...XX...", "...X...."];

function launch(d: MaterialData, a: Assets, x: DesignExtra): Design {
  const m = d.minted[0] ?? { name: "New Agent", handle: "", ago: "just now" };
  const nm = nameOf(m), nsize = Math.min(78, Math.max(40, Math.floor(600 / Math.max(1, nm.length * 0.56))));
  const no = Math.max(1, d.launchNo ?? d.totalAgents), grid = x.grid ?? silhouetteGrid();
  const C = 13, AW = AV_N * C, AX = 64, AY = 124, DEP = 26;
  const cells = Array.from({ length: AV_N * AV_N }, (_, i) => ({ cx: i % AV_N, cy: Math.floor(i / AV_N), r: grid.px[i * 3], g: grid.px[i * 3 + 1], b: grid.px[i * 3 + 2], h: rnd(i, 31) }));
  const TILE = [
    { x: 540, y: 332, w: 300, h: 128, prefix: "#", value: String(no), cell: 8, hot: true, color: LIME },
    { x: 866, y: 368, w: 278, h: 112, prefix: "", value: String(d.mintedToday), cell: 6, hot: false, color: INK },
  ];
  const layers: Layer[] = [
    { id: "kick", w: 400, h: 20, node: <Label x={0} y={0} w={400} size={14} color={LIME}>New operator</Label> },
    { id: "name", w: 604, h: 92, node: <div style={{ display: "flex", width: 604, whiteSpace: "nowrap", fontFamily: "Manrope", fontWeight: 500, fontSize: nsize, lineHeight: 1.1, letterSpacing: -nsize * 0.035, color: "#FFFFFF" }}>{nm}</div> },
    { id: "handle", w: 604, h: 52, node: <div style={{ display: "flex", width: 604, whiteSpace: "nowrap", fontFamily: "Fraunces", fontWeight: 600, fontSize: 40, lineHeight: 1.1, letterSpacing: -1, color: LIME }}>{handleOf(m) ? `@${handleOf(m)}` : "Vello agent"}</div> },
    ...(m.niche ? [{ id: "niche", w: 480, h: 30, node: <div style={{ display: "flex", width: 480 }}>
      <div style={{ display: "flex", alignItems: "center", height: 28, padding: "0 14px", borderRadius: 14, border: "1px solid rgba(200,240,42,.5)", backgroundColor: "rgba(200,240,42,.1)", fontFamily: "Grotesk", fontSize: 12, letterSpacing: 3, color: LIME, textTransform: "uppercase", whiteSpace: "nowrap" }}>{clean(m.niche, 28)}</div>
    </div> }] : []),
    { id: "l0", w: 300, h: 14, node: <T x={150} y={0} w={300} align="center" size={11} font="Grotesk" ls={2.6} upper color={MUTE}>Agent number</T> },
    { id: "c0", w: 300, h: 14, node: <T x={150} y={0} w={300} align="center" size={11} font="Grotesk" ls={2.2} upper color={FAINT}>{`of ${full(d.totalAgents)} on the network`}</T> },
    { id: "l1", w: 278, h: 14, node: <T x={139} y={0} w={278} align="center" size={11} font="Grotesk" ls={2.6} upper color={MUTE}>Minted in 24h</T> },
    { id: "c1", w: 278, h: 14, node: <T x={139} y={0} w={278} align="center" size={11} font="Grotesk" ls={2.2} upper color={FAINT}>{`Joined ${m.ago}`}</T> },
    { id: "cta", w: 480, h: 40, node: <div style={{ display: "flex", alignItems: "baseline", whiteSpace: "nowrap" }}>
      <span style={{ fontFamily: "Manrope", fontWeight: 500, fontSize: 30, letterSpacing: -0.8, color: "#FFFFFF" }}>Don&apos;t get left behind.</span>
      <span style={{ fontFamily: "Fraunces", fontWeight: 600, fontSize: 34, letterSpacing: -0.8, color: LIME, marginLeft: 12 }}>Mint yours.</span>
    </div> },
  ];
  return {
    label: "Agent launch", layers, frames: 64, delay: 70, still: 0.86, animLogo: true,
    text: () => null,
    gfx: (t, img, meta) => {
      const out = 1 - seg(t, 0.93, 0.07), gs = Math.floor(t * 16), step = Math.floor(t * 8);
      const haze = `<ellipse cx="${300 + 260 * Math.cos(TAU * t)}" cy="${340 + 30 * Math.sin(TAU * 2 * t)}" rx="560" ry="320" fill="url(#haze)"/>`;
      const ax = AX + AW / 2, ay = AY + AW / 2, sq = 0.2 * Math.sin(TAU * t), cs = Math.cos(sq), dep = DEP * (0.75 + 0.25 * Math.sin(TAU * t)), dz = dep * 0.55;
      const scan = ((2 * t) % 1) * (AV_N + 12) - 6;
      const px = cells.map((c) => {
        const e = outBack(seg(t, 0.02 + c.h * 0.22, 0.1));
        if (e < 0.02) return "";
        const live = e >= 1, shift = live && gs % 3 === 0 && rnd(c.cy * 13 + gs, 21) > 0.93 ? (rnd(c.cy + gs, 22) > 0.5 ? 1 : -1) * C : 0;
        const boost = Math.max(0, 1 - Math.abs(c.cy - scan) / 2.2) * 70, tw = 0.95 + 0.05 * Math.sin(TAU * (2 * t + c.h)), sz = C * Math.min(1.1, e);
        const col = `rgb(${Math.min(255, Math.round(c.r * tw + boost))},${Math.min(255, Math.round(c.g * tw + boost))},${Math.min(255, Math.round(c.b * tw + boost))})`;
        return `<rect x="${(AX + c.cx * C + shift + (C - sz) / 2).toFixed(1)}" y="${(AY + c.cy * C + (C - sz) / 2).toFixed(1)}" width="${(sz - 0.6).toFixed(1)}" height="${(sz - 0.6).toFixed(1)}" fill="${col}" fill-opacity="${Math.min(1, e * 2).toFixed(2)}"/>`;
      }).join("");
      const fe = outCubic(seg(t, 0, 0.12));
      const body = `<g opacity="${fe}" transform="translate(${ax} ${ay}) scale(${cs.toFixed(3)} 1) translate(${-ax} ${-ay})"><polygon points="${AX},${AY} ${AX + dep},${AY - dz} ${AX + AW + dep},${AY - dz} ${AX + AW},${AY}" fill="#fff" fill-opacity=".16"/><polygon points="${AX + AW},${AY} ${AX + AW + dep},${AY - dz} ${AX + AW + dep},${AY + AW - dz} ${AX + AW},${AY + AW}" fill="#000" fill-opacity=".5"/><rect x="${AX}" y="${AY}" width="${AW}" height="${AW}" fill="#0b0e0f"/>${px}</g>`;
      const shadow = `<ellipse cx="${ax + dep / 2}" cy="${AY + AW + 26}" rx="${AW / 2}" ry="12" fill="#000" fill-opacity="${(0.5 * fe).toFixed(2)}" filter="url(#glow)"/>`;
      const bd = outBack(seg(t, 0.34, 0.14));
      const badge = bd > 0.02 ? `<g transform="translate(${AX + AW - 96} ${AY - 8 + 3 * Math.sin(TAU * 2 * t)}) rotate(-9)">${pix3d("NEW", 0, 0, 6, t - 0.3)}</g>` : "";

      const lf = outCubic(seg(t, 0.06, 0.14)), dot = step % 2 === 0 ? 1 : 0.35;
      const kick = `<g opacity="${lf}"><rect x="540" y="${123 + (1 - lf) * 12}" width="8" height="8" fill="${LIME}" fill-opacity="${dot}"/></g>${layerAt(img, t, "kick", 558, 116, 400, 20, 0.06, 0.14, 12)}`;
      const tiles = TILE.map((tl, i) => {
        const f = outBack(seg(t, 0.3 + i * 0.1, 0.22)), al = Math.min(1, seg(t, 0.3 + i * 0.1, 0.1) * 2), vp = outCubic(seg(t, 0.4 + i * 0.1, 0.3));
        if (al <= 0) return "";
        return `<g opacity="${al}" transform="translate(0 ${((1 - Math.min(1, f)) * 40).toFixed(1)})">${slab(tl.x, tl.y, tl.w, tl.h, 10, tl.hot, t, i * 0.4)}${img[`l${i}`] ? `<image xlink:href="${img[`l${i}`]}" x="${tl.x}" y="${tl.y + 16}" width="${tl.w}" height="14"/>` : ""}${pxText(tl.prefix + String(Math.round(Number(tl.value) * vp)), tl.prefix + tl.value, tl.x + tl.w / 2, tl.y + 40, tl.cell, tl.color, tl.hot, t, i)}${img[`c${i}`] ? `<image xlink:href="${img[`c${i}`]}" x="${tl.x}" y="${tl.y + tl.h - 24}" width="${tl.w}" height="14"/>` : ""}</g>`;
      }).join("");
      const cf = seg(t, 0.5, 0.22), slide = Math.round(((1 - outCubic(cf)) * 240) / 8) * 8;
      const cta = cf > 0 ? `<g opacity="${Math.min(1, cf * 3)}" transform="translate(${slide} 0)">${slab(540, 508, 604, 72, 10, true, t, 0.6)}${img.cta ? `<image xlink:href="${img.cta}" x="568" y="${508 + 16}" width="480" height="40"/>` : ""}${pixSprite(ARROW, 1096 + (step % 4) * 3, 508 + 22, 4.4, LIME)}</g>` : "";
      return base(`<g opacity="${out}">${haze}${dustGfx(t)}${logoGfx(a, t)}${solanaMark(t)}${shadow}${body}${badge}${kick}${layerAt(img, t, "name", 540, 146, 604, 92, 0.12, 0.2, 18)}${layerAt(img, t, "handle", 540, 242, 604, 52, 0.2, 0.2, 14)}${m.country ? `<g opacity="${outCubic(seg(t, 0.24, 0.1))}">${flagGfx(m.country, 540 + (meta.handle?.x1 ?? 200) + 20, 250 + 2 * Math.sin(TAU * 2 * t), 3.4, t, 0.26)}</g>` : ""}${layerAt(img, t, "niche", 540, 298, 480, 30, 0.3, 0.16, 10)}${tiles}${cta}</g>`);
    },
  };
}

const DESIGNS: Record<MaterialKind, (d: MaterialData, a: Assets, x: DesignExtra) => Design> = { network, minted, leaderboard, engine, pulse, social, launch };

/* ── render ───────────────────────────────────────────────────────────────── */

async function textLayer(design: Design, a: Assets) {
  const svg = await satori(<Shell a={a} logo={!design.animLogo}>{design.text(a)}</Shell>, { width: W, height: H, fonts: a.fonts });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const avatarCache = new Map<string, { expires: number; image: Promise<string | undefined> }>();
async function loadAvatar(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  const cached = avatarCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.image;
  const image = (async () => {
    try {
      const absolute = new URL(url, process.env.NEXT_PUBLIC_APP_URL || "https://velloagents.com").href;
      const { buffer } = await safeFetchToBuffer(absolute, { maxBytes: 5 * 1024 * 1024, timeoutMs: 4000 });
      const mask = Buffer.from('<svg width="256" height="256"><circle cx="128" cy="128" r="128" fill="white"/></svg>');
      const png = await sharp(buffer, { limitInputPixels: 16_000_000 }).rotate().resize(256, 256, { fit: "cover" })
        .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    } catch { return undefined; }
  })();
  if (avatarCache.size >= 64) avatarCache.delete(avatarCache.keys().next().value!);
  avatarCache.set(url, { expires: Date.now() + 60_000, image });
  return image;
}
async function withAvatars(d: MaterialData): Promise<MaterialData> {
  const [agents, minted] = await Promise.all([
    Promise.all(d.agents.map(async (agent) => ({ ...agent, avatarUrl: await loadAvatar(agent.avatarUrl) }))),
    Promise.all(d.minted.map(async (agent) => ({ ...agent, avatarUrl: await loadAvatar(agent.avatarUrl) }))),
  ]);
  return { ...d, agents, minted };
}

async function layerImages(design: Design, a: Assets) {
  const img: Record<string, string> = {}, meta: Record<string, { x0: number; x1: number }> = {};
  await Promise.all((design.layers ?? []).map(async (l) => {
    const svg = await satori(<div style={{ display: "flex", position: "relative", width: l.w, height: l.h, color: INK }}>{l.node}</div>, { width: l.w, height: l.h, fonts: a.fonts });
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    img[l.id] = `data:image/png;base64,${png.toString("base64")}`;
    /* horizontal ink bounds, so a gfx can centre text it cannot measure itself */
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width, x1 = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    meta[l.id] = { x0: x1 >= x0 ? x0 : 0, x1: x1 >= x0 ? x1 + 1 : l.w };
  }));
  return { img, meta };
}

async function prepareMaterial(d: MaterialData) {
  const [assets, data] = await Promise.all([loadAssets(), withAvatars(d)]);
  const design = DESIGNS[data.kind](data, assets, { grid: data.kind === "launch" ? await loadSquareGrid(d.minted[0]?.avatarUrl) : null });
  const [text, { img, meta }] = await Promise.all([textLayer(design, assets), layerImages(design, assets)]);
  const frame = (t: number) => sharp(Buffer.from(design.gfx(t, img, meta))).composite([{ input: text }]);
  return { design, frame };
}

/** Raw RGB frames one at a time (low memory), for piping straight into a video encoder. */
export async function materialFrames(d: MaterialData) {
  const { design, frame } = await prepareMaterial(d);
  const count = design.frames ?? 20, loop = design.frames !== undefined;
  return { width: W, height: H, count, delayMs: design.delay ?? 70, rgb: (i: number) => frame(i / (loop ? count : count - 1)).removeAlpha().raw().toBuffer() };
}

export async function renderMaterial(d: MaterialData, format: "png" | "gif") {
  const { design, frame } = await prepareMaterial(d);
  if (format === "png") return frame(design.still ?? 1).png().toBuffer();
  const loop = design.frames !== undefined, N = design.frames ?? 20, frames: Buffer[] = [];
  for (let i = 0; i < N; i += 8) {
    const batch = Array.from({ length: Math.min(8, N - i) }, (_, k) => frame((i + k) / (loop ? N : N - 1)).removeAlpha().raw().toBuffer());
    frames.push(...await Promise.all(batch));
  }
  return sharp(Buffer.concat(frames), { raw: { width: W, height: H * N, channels: 3, pageHeight: H } })
    .gif({ delay: frames.map((_, i) => loop ? design.delay ?? 70 : i === N - 1 ? 2400 : 70), loop: 0, effort: loop ? 3 : 4, dither: 0.6 }).toBuffer();
}
