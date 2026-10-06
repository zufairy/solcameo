import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Same Made by + white brand lockup as captions-lab, scaled to the canvas.
 * A full-canvas transparent PNG preserves percentage positioning at any aspect.
 *
 * TOP placement, not bottom: TikTok's own UI (caption, username, sound ticker,
 * the right-hand like/comment/share rail) runs along the BOTTOM of the frame,
 * so a bottom-left mark sat right where the platform's chrome covers or the
 * frame gets cropped. 6.5% down from the top clears the status bar / feed tabs
 * instead of sitting flush on the edge; 8% in from the left (was 5%) keeps it
 * off that same top-left corner. Mirrors components/builder/video-editor/
 * VelloWatermark.tsx exactly — same design, same numbers, just burned instead
 * of previewed — so the export always matches what the editor showed. */
export async function writeVelloWatermark(path: string, width: number, height: number): Promise<string> {
  const logo = await readFile(join(process.cwd(), "public", "brand", "solcameo-dark.png"));
  const meta = await sharp(logo).metadata();
  const scale = Math.min(width, height) / 315;
  const logoH = 14 * scale;
  const logoW = logoH * (meta.width! / meta.height!);
  const x = width * 0.08;
  const textFontSize = 6 * scale;
  const textY = height * 0.065 + textFontSize; // SVG text y is the baseline
  const logoY = textY + 3 * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><filter id="shadow" x="-30%" y="-80%" width="160%" height="260%"><feDropShadow dx="0" dy="${scale}" stdDeviation="${2 * scale}" flood-opacity=".55"/></filter></defs>
    <g filter="url(#shadow)"><text x="${x}" y="${textY}" fill="white" fill-opacity=".65" font-family="sans-serif" font-weight="500" font-size="${textFontSize}" letter-spacing="${1.92 * scale}">MADE BY</text>
    <image x="${x}" y="${logoY}" width="${logoW}" height="${logoH}" href="data:image/png;base64,${logo.toString("base64")}"/></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path);
  return path;
}
