/** Prebuild the Three-projected pixel art used by X share cards.
 * Run: npx tsx scripts/generate-x-card-art.ts */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { Euler } from "three/src/math/Euler.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { SHARE_TIERS, type ShareMaterial, type ShareTier } from "../lib/share/xShareCard";
const ART_W = 500;
const ART_H = 440;
const ART_FRAMES = 8;
const output = join(process.cwd(), "public", "x-card-art");
function artCell(material: ShareMaterial, x: number, y: number, t: number): boolean {
  const ax = Math.abs(x), ay = Math.abs(y);
  switch (material) {
    case "graphite": {
      const r = Math.hypot(x, y);
      const wave = (t * 3.5) % 1;
      return r < 1.6 || [3.5, 6.4, 9.2].some((ring) => Math.abs(r - ring - wave) < 0.62) || (ax < 0.7 && ay < 9);
    }
    case "silver": {
      const bar = Math.floor((x + 11) / 2);
      const heights = [2, 5, 8, 4, 11, 6, 10, 4, 8, 5, 2];
      return bar >= 0 && bar < heights.length && Math.abs(x - (-10 + bar * 2)) < 0.65 && ay <= heights[bar] * (0.8 + 0.2 * Math.sin(t * Math.PI * 2 + bar));
    }
    case "gold":
      return (y < -3 && y > -9 && ax < 7) || (y >= -3 && y < 5 && ax < 7 - (y + 3) * 0.66) ||
        (y > -7 && y < 1 && ax >= 7 && ax < 10 - (y + 7) * 0.22) ||
        (y >= 5 && y < 9 && ax < 1.5) || (y >= 9 && y <= 10 && ax < 7);
    case "platinum": {
      const d = ax / 11 + ay / 10;
      return d < 1 || Math.abs(d - 1) < 0.11;
    }
    case "black":
      return (y >= 0 && y < 7 && ax < 9) || (y >= 7 && y <= 9 && ax < 10) ||
        (y < 0 && y >= -9 && ((ax < 1.2) || (ax > 6.8 && ax < 8.5) || y >= -3 + ax * 0.35));
  }
}

function artSvg(tier: ShareTier, frame: number): string {
  const t = frame / ART_FRAMES;
  const material = tier.material;
  const ink = ({ graphite: "#b8d2c7", silver: "#afcde2", gold: "#e4ba76", platinum: "#c9bfe8", black: "#d9b777" } as Record<ShareMaterial, string>)[material];
  const highlight = material === "black" ? "#f3dca6" : material === "gold" ? "#fff0bd" : material === "platinum" ? "#f3edff" : material === "silver" ? "#effaff" : "#ffffff";
  const rotation = new Euler(-0.09 + Math.sin(t * Math.PI * 2) * 0.06, Math.sin(t * Math.PI * 2) * 0.22, 0);
  const voxels: { z: number; svg: string }[] = [];
  for (let y = -18; y <= 18; y++) for (let x = -20; x <= 20; x++) {
    if (!artCell(material, Math.round(x * 0.55), Math.round(y * 0.55), t)) continue;
    for (const depth of [-2, -1, 0, 1, 2]) {
      const p = new Vector3(x * 10.2, y * 10, depth * 5.5).applyEuler(rotation);
      const perspective = 600 / (600 - p.z);
      const px = 250 + p.x * perspective;
      const py = 220 + p.y * perspective;
      const size = depth === 2 ? 8.4 : 8.1;
      const shine = (x - y + frame * 2) % 11 === 0;
      const color = depth === 2 && shine ? highlight : ink;
      const opacity = depth <= -1 ? 0.25 : depth === 0 ? 0.5 : depth === 1 ? 0.72 : 0.95;
      voxels.push({ z: p.z, svg: `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${size}" height="${size}" fill="${color}" opacity="${opacity}"/>` });
    }
  }
  voxels.sort((a, b) => a.z - b.z);
  const orbits = Array.from({ length: 5 }, (_, i) => `<ellipse cx="250" cy="220" rx="${150 + i * 17}" ry="${125 + i * 16}" fill="none" stroke="${ink}" stroke-opacity="${i === frame % 5 ? .2 : .07}" stroke-width="1" ${i % 2 ? 'stroke-dasharray="2 12"' : ''}/>`).join("");
  const particles = Array.from({ length: 70 }, (_, i) => { const a = i * 2.39996 + t * (i % 3 ? -.4 : 3); const r = 152 + i * 47 % 67; const x = 250 + Math.cos(a) * r, y = 220 + Math.sin(a) * r * .8; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${i % 9 ? 2 : 4}" height="${i % 9 ? 2 : 4}" fill="${i % 9 ? ink : highlight}" opacity="${i % 9 ? .35 : .8}"/>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 ${ART_W} ${ART_H}" shape-rendering="crispEdges">${orbits}${particles}${voxels.map((v) => v.svg).join("")}</svg>`;
}


async function main() {
  await mkdir(output, { recursive: true });
  for (const tier of SHARE_TIERS) {
    for (let frame = 0; frame < ART_FRAMES; frame++) {
      const png = await sharp(Buffer.from(artSvg(tier, frame))).png({ compressionLevel: 7 }).toBuffer();
      await writeFile(join(output, `${tier.material}-${frame}.png`), png);
    }
    console.log(`Generated ${tier.label} artwork`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
