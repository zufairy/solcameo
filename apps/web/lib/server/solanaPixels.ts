/* Pixel/voxel Solana mark, shared by the post-material cards and the X share cards.
   `t` is the loop position (0..1): pixels pop in, then the mark tilts like a lit 3D
   sprite, a light sweeps across it and the pixels twinkle. All motion is periodic in t. */

const TAU = Math.PI * 2;
const seg = (t: number, start: number, dur: number) => Math.min(1, Math.max(0, (t - start) / dur));
const outBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

const BARS: [number, number][][] = [
  [[74, 0], [397.7, 0], [323.7, 77.6], [0, 77.6]],
  [[0, 116.3], [323.7, 116.3], [397.7, 193.9], [74, 193.9]],
  [[74, 234.1], [397.7, 234.1], [323.7, 311.7], [0, 311.7]],
];
const inPoly = (x: number, y: number, p: [number, number][]) => { let o = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) o = !o; return o; };
export const SOLANA_COLS = 26;
const U = 397.7 / SOLANA_COLS, ROWS = Math.ceil(311.7 / U);
const CELLS = (() => {
  const out: { c: number; r: number; u: number; h: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < SOLANA_COLS; c++) {
    const x = (c + 0.5) * U, y = (r + 0.5) * U;
    if (BARS.some((b) => inPoly(x, y, b))) out.push({ c, r, u: (x / 397.7) * 0.5 + (1 - y / 311.7) * 0.5, h: ((((c * 73856093) ^ (r * 19349663)) >>> 0) % 1000) / 1000 });
  }
  return out;
})();

/** SVG rects for the mark with its top-left at (x0, y0); `cell` is the pixel size (width = 26 cells). */
export function solanaPixels(t: number, x0: number, y0: number, cell: number, opts: { entrance?: boolean } = {}): string {
  const entrance = opts.entrance ?? true, wd = SOLANA_COLS * cell;
  const th = 0.6 * Math.sin(TAU * t), cs = Math.cos(th), sn = Math.sin(th);
  return CELLS.map(({ c, r, u, h }) => {
    const e = entrance ? outBack(seg(t, 0.02 + h * 0.2, 0.12)) : 1;
    if (e < 0.02) return "";
    const lx = (c + 0.5 - SOLANA_COLS / 2) * cell, x = x0 + wd / 2 + lx * cs, y = y0 + r * cell;
    const lit = Math.min(1, (0.8 + 0.2 * Math.sin(TAU * (u * 1.2 - 2 * t))) * (1 + 0.25 * sn * lx / (wd / 2)));
    const col = `rgb(${Math.round(153 + (20 - 153) * u)},${Math.round(69 + (241 - 69) * u)},${Math.round(255 + (149 - 255) * u)})`;
    const a = Math.min(1, e) * lit * (0.9 + 0.1 * Math.sin(TAU * (2 * t + h))), sz = (cell - 0.4) * Math.min(1.15, e);
    return `<rect x="${(x - sn * 2.5 - sz / 2).toFixed(2)}" y="${(y + 1.8).toFixed(2)}" width="${(sz * Math.max(0.6, cs)).toFixed(2)}" height="${sz.toFixed(2)}" fill="${col}" fill-opacity="${(a * 0.3).toFixed(2)}"/><rect x="${(x - sz / 2).toFixed(2)}" y="${y.toFixed(2)}" width="${(sz * Math.max(0.6, cs)).toFixed(2)}" height="${sz.toFixed(2)}" fill="${col}" fill-opacity="${a.toFixed(2)}"/>`;
  }).join("");
}
