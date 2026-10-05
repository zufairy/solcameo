/* Pixelated brand logo sprites — shared by the X share cards and the dev
   post-material renderer so both wear the exact same mark. */
import sharp from "sharp";

export interface PxCell { x: number; y: number; shade: number }
export interface PxGrid { cols: number; rows: number; cells: PxCell[] }
export interface Sprite { url: string; w: number; h: number }

const pngDataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

/** Pixelate a region of the logo PNG into lit cells (alpha-thresholded,
 *  lightness kept as `shade` so the 3D bevel survives as pixel shading). */
export async function pixelizeLogo(src: Buffer, region: { left: number; width: number }, cols: number): Promise<PxGrid> {
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
  const range = hi - lo || 1;
  return { cols, rows, cells: raw.map((c) => ({ x: c.x, y: c.y, shade: (c.lum - lo) / range })) };
}

export async function sprite(grid: PxGrid, px: number, gap: number, color: string, shadeFloor: number): Promise<Sprite> {
  const cell = px + gap;
  const w = grid.cols * cell, h = grid.rows * cell;
  const rects = grid.cells.map((c) => `<rect x="${c.x * cell}" y="${c.y * cell}" width="${px}" height="${px}" fill="${color}" fill-opacity="${(shadeFloor + (1 - shadeFloor) * c.shade).toFixed(3)}"/>`).join("");
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`)).png().toBuffer();
  return { url: pngDataUrl(png), w, h };
}
