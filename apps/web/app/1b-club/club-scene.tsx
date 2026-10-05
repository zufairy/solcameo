"use client";

import { useEffect, useRef } from "react";
import type * as Three from "three";
import velloLogo from "@/assets/lo.png";
import styles from "./club.module.css";

type ThreeModule = typeof import("three");
type Mode = "card" | "globe" | "stack" | "mark" | "syndicate";
type Topology = { transform: { scale: number[]; translate: number[] }; arcs: number[][][] };

function roundedShape(T: ThreeModule, width: number, height: number, radius: number) {
  const s = new T.Shape();
  const x = -width / 2, y = -height / 2;
  s.moveTo(x + radius, y);
  s.lineTo(x + width - radius, y);
  s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius);
  s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  return s;
}

function createCard(T: ThreeModule) {
  const group = new T.Group();
  const shape = roundedShape(T, 3.95, 2.5, 0.15);
  const body = new T.Mesh(
    new T.ExtrudeGeometry(shape, { depth: 0.055, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: 0.026, bevelThickness: 0.022, curveSegments: 20 }),
    new T.MeshPhysicalMaterial({ color: 0x29292b, metalness: 1, roughness: 0.26, clearcoat: 0.65, clearcoatRoughness: 0.32 }),
  );
  group.add(body);

  const surface = document.createElement("canvas");
  surface.width = 1580; surface.height = 1000;
  const c = surface.getContext("2d")!;
  const base = c.createLinearGradient(0, 0, 1580, 1000);
  base.addColorStop(0, "#202023"); base.addColorStop(0.45, "#09090b"); base.addColorStop(1, "#151517");
  c.fillStyle = base; c.fillRect(0, 0, 1580, 1000);
  for (let y = 0; y < 1000; y += 2) {
    c.strokeStyle = `rgba(210,210,220,${0.015 + (Math.sin(y * 2.13) + 1) * 0.012})`;
    c.beginPath(); c.moveTo(0, y); c.lineTo(1580, y); c.stroke();
  }
  c.strokeStyle = "#77777d"; c.lineWidth = 1.3;
  c.strokeRect(40, 40, 1500, 920);
  c.fillStyle = "#d4d2cf"; c.font = "500 32px Arial";
  c.fillText("V E L L O", 110, 140);
  c.font = "400 24px Arial"; c.fillStyle = "#8d8d95";
  c.textAlign = "right"; c.fillText("B L A C K", 1465, 140);
  // Guilloché engraving: fine metallic waves, not a glow or particle effect.
  c.save(); c.translate(1150, 510);
  for (let i = 0; i < 48; i++) {
    c.beginPath();
    for (let j = 0; j <= 220; j++) {
      const a = (j / 220) * Math.PI * 2;
      const r = 138 + i * 5 + Math.sin(a * 5 + i * 0.05) * 22;
      const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.91;
      if (j === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = `rgba(170,170,181,${0.09 + i * 0.002})`; c.lineWidth = 1; c.stroke();
  }
  c.restore();
  c.textAlign = "left";
  const silver = c.createLinearGradient(100, 300, 700, 650);
  silver.addColorStop(0, "#f0eeea"); silver.addColorStop(0.48, "#b8b7b9"); silver.addColorStop(1, "#727278");
  c.fillStyle = silver; c.font = "400 310px Georgia"; c.fillText("1B", 100, 640);
  c.font = "400 20px Arial"; c.fillStyle = "#a3a3a9";
  c.fillText("O N E   B I L L I O N   V I E W S", 115, 730);
  c.fillStyle = "#d0cfcf"; c.font = "400 21px Arial"; c.fillText("BY INVITATION. BY ACHIEVEMENT.", 115, 885);
  c.textAlign = "right"; c.fillStyle = "#929298"; c.fillText("VB / 001", 1465, 885);
  const texture = new T.CanvasTexture(surface); texture.colorSpace = T.SRGBColorSpace;
  const face = new T.Mesh(new T.ShapeGeometry(shape, 20), new T.MeshStandardMaterial({ map: texture, metalness: 0.2, roughness: 0.58 }));
  // ShapeGeometry uses local coordinates as UVs; map the engraving to the full face.
  const positions = face.geometry.attributes.position;
  const uv = face.geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) uv.setXY(i, (positions.getX(i) + 1.975) / 3.95, (positions.getY(i) + 1.25) / 2.5);
  face.position.z = 0.08; group.add(face);
  const edge = new T.LineSegments(new T.EdgesGeometry(body.geometry, 30), new T.LineBasicMaterial({ color: 0xa6a6ac, transparent: true, opacity: 0.22 }));
  group.add(edge);
  group.rotation.set(-0.16, -0.32, -0.1);
  return group;
}

/* ── Tier stack: every membership tier as a pixel-digital card ─────────────── */

const TIERS = [
  { label: "MEMBER", need: "0+", note: "THE COUNT HAS STARTED", accent: "#6BFFB8", base: 0x1d2a24, face: ["#11211a", "#050d09"] },
  { label: "SILVER", need: "100K", note: "VERIFIED REACH", accent: "#8FE3FF", base: 0x8f99a4, face: ["#152231", "#070d15"] },
  { label: "GOLD", need: "1M", note: "CERTIFIED CREATOR", accent: "#FFC94A", base: 0xc49434, face: ["#2a1c05", "#0f0a02"] },
  { label: "PLATINUM", need: "10M", note: "ELITE CIRCLE", accent: "#D6A6FF", base: 0xbcb4cf, face: ["#20173a", "#0a0716"] },
  { label: "VELLO BLACK", need: "1B", note: "INVITE ONLY", accent: "#E8C77A", base: 0x19191b, face: ["#18181b", "#030304"] },
] as const;

/** 5×7 matrix glyphs for the big threshold numerals. */
const GLYPH: Record<string, string[]> = {
  "0": [".XXX.", "X...X", "X..XX", "X.X.X", "XX..X", "X...X", ".XXX."],
  "1": ["..X..", ".XX..", "..X..", "..X..", "..X..", "..X..", ".XXX."],
  K: ["X...X", "X..X.", "X.X..", "XX...", "X.X..", "X..X.", "X...X"],
  M: ["X...X", "XX.XX", "X.X.X", "X.X.X", "X...X", "X...X", "X...X"],
  B: ["XXXX.", "X...X", "X...X", "XXXX.", "X...X", "X...X", "XXXX."],
  "+": [".....", "..X..", "..X..", "XXXXX", "..X..", "..X..", "....."],
};

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = velloLogo.src;
  });
}

/** The Vello mark, downsampled to a hard-edged pixel sprite in `color`. */
function pixelMark(logo: HTMLImageElement, color: string, pixelsTall: number) {
  const sw = Math.round(logo.naturalWidth * 0.235), sh = logo.naturalHeight;
  const h = pixelsTall, w = Math.max(1, Math.round((sw / sh) * h));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  x.drawImage(logo, 0, 0, sw, sh, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 100 ? 255 : 0;
  x.putImageData(d, 0, 0);
  x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, w, h);
  return c;
}

/* ── Pixelated 3D Vello mark: a voxel sculpture built from the real logo's own
   silhouette, one cube per "on" pixel — reused wherever the club wants a
   memorable, unmistakably-Vello stamp (footer, the milestone plaque, the
   hardware engraving) instead of just the flat wordmark. ── */

/** Boolean on/off grid of the Vello mark's silhouette (same 23.5%-of-lockup
 *  crop `pixelMark` uses), downsampled to `pixelsTall` rows. */
function logoGrid(logo: HTMLImageElement, pixelsTall: number): { w: number; h: number; on: boolean[] } {
  const sw = Math.round(logo.naturalWidth * 0.235), sh = logo.naturalHeight;
  const h = pixelsTall, w = Math.max(1, Math.round((sw / sh) * h));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  x.drawImage(logo, 0, 0, sw, sh, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const on = new Array<boolean>(w * h);
  for (let i = 0; i < w * h; i++) on[i] = d[i * 4 + 3] > 100;
  return { w, h, on };
}

type MarkVoxel = { group: Three.Group; mesh: Three.InstancedMesh; count: number; positions: Three.Vector3[]; starts: Three.Vector3[]; delays: number[]; dummy: Three.Object3D; assembled: boolean };

/** One voxel cube per lit pixel of the Vello mark, an InstancedMesh so a
 *  ~250-cube sculpture is one draw call. `assemble()` (called each frame
 *  while mid-intro) flies every cube in from a scattered start position —
 *  once every cube reaches `t>=1` the caller can stop calling it and just
 *  rotate `group` as a whole, since the instances are already in place. */
function createMarkVoxel(T: ThreeModule, logo: HTMLImageElement | null, accent: number, pixelsTall = 22): MarkVoxel {
  const group = new T.Group();
  const grid = logo ? logoGrid(logo, pixelsTall) : { w: 1, h: 1, on: [true] };
  const cube = 0.15, gap = 0.02, cell = cube + gap;
  const originX = -(grid.w * cell) / 2, originY = (grid.h * cell) / 2;
  const positions: Three.Vector3[] = [];
  for (let gy = 0; gy < grid.h; gy++) for (let gx = 0; gx < grid.w; gx++) {
    if (!grid.on[gy * grid.w + gx]) continue;
    positions.push(new T.Vector3(originX + gx * cell, originY - gy * cell, (Math.random() - 0.5) * 0.24));
  }
  const count = Math.max(1, positions.length);
  const geo = new T.BoxGeometry(cube, cube, cube);
  const material = new T.MeshPhysicalMaterial({ color: accent, metalness: 1, roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.3, emissive: accent, emissiveIntensity: 0.1 });
  const mesh = new T.InstancedMesh(geo, material, count);
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  const starts = positions.map(() => new T.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8 - 3));
  const delays = positions.map((_, i) => (i / count) * 0.55 + Math.random() * 0.2);
  group.add(mesh);
  return { group, mesh, count: positions.length, positions, starts, delays, dummy: new T.Object3D(), assembled: false };
}

/** Advances a mark's "materializing from scattered cubes" intro. Returns
 *  true once every cube has reached its final position (caller can then
 *  stop calling this and just transform `mark.group` for cheap animation). */
function assembleMark(mark: MarkVoxel, elapsed: number, duration = 0.9): boolean {
  if (mark.assembled) return true;
  let done = true;
  for (let i = 0; i < mark.count; i++) {
    const t = Math.min(1, Math.max(0, (elapsed - mark.delays[i]) / duration));
    if (t < 1) done = false;
    const eased = 1 - Math.pow(1 - t, 3);
    mark.dummy.position.lerpVectors(mark.starts[i], mark.positions[i], eased);
    mark.dummy.scale.setScalar(0.35 + eased * 0.65);
    mark.dummy.rotation.set(0, (1 - eased) * Math.PI, 0);
    mark.dummy.updateMatrix();
    mark.mesh.setMatrixAt(i, mark.dummy.matrix);
  }
  mark.mesh.instanceMatrix.needsUpdate = true;
  if (done) mark.assembled = true;
  return done;
}

function drawPixelText(c: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string) {
  let cx = x;
  for (const ch of text) {
    const g = GLYPH[ch];
    if (!g) { cx += px * 3; continue; }
    g.forEach((row, gy) => [...row].forEach((cell, gx) => {
      c.fillStyle = cell === "X" ? color : "rgba(255,255,255,0.045)";
      c.fillRect(cx + gx * px, y + gy * px, px - 2, px - 2);
    }));
    cx += (g[0].length + 1) * px;
  }
}

function tierFace(tier: (typeof TIERS)[number], logo: HTMLImageElement | null, index: number) {
  const W = 1024, H = 648;
  const face = document.createElement("canvas"); face.width = W; face.height = H;
  const c = face.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, tier.face[0]); g.addColorStop(1, tier.face[1]);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // LED dot matrix.
  c.fillStyle = tier.accent; c.globalAlpha = 0.07;
  for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) c.fillRect(x, y, 2, 2);
  c.globalAlpha = 1;
  // Inset hairline frame.
  c.strokeStyle = tier.accent; c.globalAlpha = 0.35; c.lineWidth = 2; c.strokeRect(22, 22, W - 44, H - 44); c.globalAlpha = 1;
  // Top band — the part still visible when the cards are stacked.
  c.imageSmoothingEnabled = false;
  if (logo) { const m = pixelMark(logo, tier.accent, 14); const mh = 56, mw = mh * (m.width / m.height); c.drawImage(m, 52, 34, mw, mh); }
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  c.fillStyle = tier.accent; c.font = `700 40px ${mono}`; c.textBaseline = "middle";
  (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "8px";
  c.fillText(tier.label, 130, 64);
  c.textAlign = "right"; c.font = `500 20px ${mono}`; c.fillStyle = "rgba(255,255,255,0.55)";
  c.fillText(`TIER 0${index + 1} / 05`, W - 52, 64);
  // Big pixel-matrix threshold.
  c.textAlign = "left";
  drawPixelText(c, tier.need === "0+" ? "0+" : `${tier.need}+`, 56, 190, 30, tier.accent);
  c.font = `500 22px ${mono}`; c.fillStyle = "rgba(255,255,255,0.6)";
  c.fillText("VERIFIED VIEWS", 58, 438);
  // Pixel chip.
  for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) { c.fillStyle = (x + y) % 3 === 0 ? "#f3dfa4" : "#c9a24a"; c.fillRect(W - 250 + x * 16, 190 + y * 16, 14, 14); }
  // Equaliser bars — "views increasing".
  for (let i = 0; i < 12; i++) {
    const hgt = 3 + Math.round(Math.abs(Math.sin(i * 1.3 + index)) * 7);
    for (let b = 0; b < hgt; b++) { c.fillStyle = tier.accent; c.globalAlpha = 0.35 + b / hgt * 0.65; c.fillRect(W - 330 + i * 22, 560 - b * 14, 18, 11); }
  }
  c.globalAlpha = 1;
  c.font = `500 20px ${mono}`; c.fillStyle = "rgba(255,255,255,0.7)"; c.fillText(tier.note, 58, 560);
  c.fillStyle = "rgba(255,255,255,0.4)"; c.fillText(`N° VB/${String(index + 1).padStart(3, "0")}`, 58, 596);
  return face;
}

function createTierStack(T: ThreeModule, logo: HTMLImageElement | null) {
  const stack = new T.Group();
  const shape = roundedShape(T, 3.95, 2.5, 0.15);
  const bodyGeo = new T.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.022, bevelThickness: 0.02, curveSegments: 16 });
  const cards: Three.Group[] = [];
  TIERS.forEach((tier, i) => {
    const card = new T.Group();
    card.add(new T.Mesh(bodyGeo, new T.MeshPhysicalMaterial({ color: tier.base, metalness: 1, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.3 })));
    const texture = new T.CanvasTexture(tierFace(tier, logo, i)); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4;
    const face = new T.Mesh(new T.ShapeGeometry(shape, 16), new T.MeshStandardMaterial({ map: texture, metalness: 0.25, roughness: 0.55, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.18 }));
    const pos = face.geometry.attributes.position, uv = face.geometry.attributes.uv;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) + 1.975) / 3.95, (pos.getY(k) + 1.25) / 2.5);
    face.position.z = 0.075; card.add(face);
    stack.add(card); cards.push(card);
  });
  // A gold scanline sweeping the front (Vello Black) card.
  const scan = new T.Mesh(new T.PlaneGeometry(3.85, 0.045), new T.MeshBasicMaterial({ color: 0xe8c77a, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
  scan.position.z = 0.09; cards[cards.length - 1].add(scan);
  // Square "pixel dust" rising around the stack.
  const COUNT = 260;
  const positions = new Float32Array(COUNT * 3), colors = new Float32Array(COUNT * 3), speeds = new Float32Array(COUNT);
  const tint = new T.Color();
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 7; positions[i * 3 + 1] = -2 + Math.random() * 5; positions[i * 3 + 2] = -1.8 + Math.random() * 2.6;
    tint.set(TIERS[i % TIERS.length].accent); colors.set([tint.r, tint.g, tint.b], i * 3); speeds[i] = 0.12 + Math.random() * 0.35;
  }
  const dustGeo = new T.BufferGeometry();
  dustGeo.setAttribute("position", new T.BufferAttribute(positions, 3)); dustGeo.setAttribute("color", new T.BufferAttribute(colors, 3));
  const dust = new T.Points(dustGeo, new T.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
  stack.add(dust);
  stack.rotation.set(-0.12, -0.35, -0.04);
  return { stack, cards, scan, dust, speeds };
}

function geographic(T: ThreeModule, lat: number, lon: number, r = 1.75) {
  const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
  return new T.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

async function createGlobe(T: ThreeModule, signal: AbortSignal) {
  const group = new T.Group();
  group.add(new T.Mesh(new T.SphereGeometry(1.745, 64, 48), new T.MeshStandardMaterial({ color: 0x101012, roughness: 0.93, metalness: 0.05 })));
  const response = await fetch("/1b-club/world-110m.json", { signal });
  if (!response.ok) throw new Error("World geometry unavailable");
  const topology = await response.json() as Topology;
  const vertices: number[] = [];
  for (const arc of topology.arcs) {
    let x = 0, y = 0, previous: Three.Vector3 | null = null;
    for (const point of arc) {
      x += point[0]; y += point[1];
      const lon = x * topology.transform.scale[0] + topology.transform.translate[0];
      const lat = y * topology.transform.scale[1] + topology.transform.translate[1];
      const v = geographic(T, lat, lon, 1.755);
      if (previous) vertices.push(...previous.toArray(), ...v.toArray());
      previous = v;
    }
  }
  const lines = new T.BufferGeometry(); lines.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  group.add(new T.LineSegments(lines, new T.LineBasicMaterial({ color: 0x99999e, transparent: true, opacity: 0.57 })));
  const grid: number[] = [];
  for (let lat = -80; lat <= 80; lat += 5) for (let lon = -180; lon < 180; lon += 5) grid.push(...geographic(T, lat, lon, 1.756).toArray());
  const dots = new T.BufferGeometry(); dots.setAttribute("position", new T.Float32BufferAttribute(grid, 3));
  group.add(new T.Points(dots, new T.PointsMaterial({ color: 0xa0a0a5, size: 0.012, transparent: true, opacity: 0.34 })));
  const cities = [[51.51, -0.13], [40.71, -74.01], [25.2, 55.27], [1.35, 103.82], [35.68, 139.65]];
  const routes: { points: Three.Vector3[]; traveler: Three.Mesh }[] = [];
  const nodeGeometry = new T.SphereGeometry(0.025, 10, 10);
  const nodeMaterial = new T.MeshBasicMaterial({ color: 0xefefed });
  cities.forEach(([lat, lon]) => { const n = new T.Mesh(nodeGeometry, nodeMaterial); n.position.copy(geographic(T, lat, lon, 1.79)); group.add(n); });
  for (let i = 1; i < cities.length; i++) {
    const start = geographic(T, ...cities[0] as [number, number]).normalize();
    const end = geographic(T, ...cities[i] as [number, number]).normalize();
    const points = Array.from({ length: 100 }, (_, j) => {
      const t = j / 99;
      return start.clone().lerp(end, t).normalize().multiplyScalar(1.79 + Math.sin(t * Math.PI) * 0.38);
    });
    group.add(new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: 0xc3c0b9, transparent: true, opacity: 0.38 })));
    const traveler = new T.Mesh(nodeGeometry, nodeMaterial); group.add(traveler); routes.push({ points, traveler });
  }
  group.rotation.set(0.08, -1.12, -0.12);
  return { group, routes };
}

/* ── "The Vello Syndicate" ambient backdrop ──
   A premium, elegant field behind the section's copy and deal card: a few
   pixelated Vello marks drifting at different depths (each materializing the
   same voxel-assemble way as the standalone mark), connected by faint gold
   threads, with slow-rising particle dust for scale — deliberately calm and
   autonomous (no pointer-follow) so it reads as ambience, not a toy. */
const SYNDICATE_ACCENTS = [0xe8c77a, 0x8fe3ff, 0xd6a6ff];

function createSyndicateField(T: ThreeModule, logo: HTMLImageElement | null) {
  const group = new T.Group();
  const marks = SYNDICATE_ACCENTS.map((accent, i) => {
    const mark = createMarkVoxel(T, logo, accent, 16);
    mark.group.scale.setScalar(0.55 - i * 0.08);
    mark.group.position.set(-3.4 + i * 3.6, i === 1 ? 0.9 : -0.6, -1.4 - i * 1.3);
    group.add(mark.group);
    return mark;
  });
  // Faint threads linking the three marks — "a network", not a grid.
  const threadPts: number[] = [];
  for (let i = 0; i < marks.length - 1; i++) threadPts.push(...marks[i].group.position.toArray(), ...marks[i + 1].group.position.toArray());
  const threads = new T.LineSegments(
    new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(threadPts, 3)),
    new T.LineBasicMaterial({ color: 0xd8c99a, transparent: true, opacity: 0.22 }),
  );
  group.add(threads);
  const COUNT = 180;
  const positions = new Float32Array(COUNT * 3), speeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 11; positions[i * 3 + 1] = -3 + Math.random() * 6; positions[i * 3 + 2] = -4 + Math.random() * 3.5;
    speeds[i] = 0.05 + Math.random() * 0.16;
  }
  const dustGeo = new T.BufferGeometry();
  dustGeo.setAttribute("position", new T.BufferAttribute(positions, 3));
  const dust = new T.Points(dustGeo, new T.PointsMaterial({ color: 0xe8c77a, size: 0.028, transparent: true, opacity: 0.45, depthWrite: false }));
  group.add(dust);
  return { group, marks, dust, speeds };
}

export default function ClubScene({ mode, paused }: { mode: Mode; paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const pauseRef = useRef(paused);
  const synchronize = useRef<(() => void) | null>(null);
  useEffect(() => { pauseRef.current = paused; synchronize.current?.(); }, [paused]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false, booted = false, visible = false;
    let renderer: Three.WebGLRenderer | undefined;
    let scene: Three.Scene | undefined;
    let environment: Three.WebGLRenderTarget | undefined;
    let resize: ResizeObserver | undefined;
    let removeEvents: (() => void) | undefined;
    const abort = new AbortController();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0, y: 0 };
    let hovering = false;

    const boot = async () => {
      if (booted) return; booted = true;
      try {
        const T = await import("three");
        // Skip the (fairly expensive) PMREM/RoomEnvironment reflection setup
        // for the small repeated "mark" stamp — footer, plaque, and hardware
        // engraving each boot their own WebGL context, and three near-identical
        // env-map builds running at once is exactly what stalled a couple of
        // them under fast scrolling. A tiny icon reads fine lit by the plain
        // directional lights below; it doesn't need studio reflections.
        const needsEnvironment = mode !== "mark";
        const { RoomEnvironment } = needsEnvironment ? await import("three/addons/environments/RoomEnvironment.js") : { RoomEnvironment: null };
        if (disposed) return;
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setClearColor(0x09090b, 0);
        renderer.outputColorSpace = T.SRGBColorSpace;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = mode === "globe" ? 1.1 : 1.3;
        element.appendChild(renderer.domElement);
        scene = new T.Scene();
        const camera = new T.PerspectiveCamera(35, 1, 0.1, 100);
        camera.position.set(0, 0, mode === "stack" ? 8.6 : mode === "card" ? 7.4 : mode === "mark" ? 5 : mode === "syndicate" ? 8.5 : 6.8);
        if (needsEnvironment && RoomEnvironment) {
          const room = new RoomEnvironment();
          const pmrem = new T.PMREMGenerator(renderer);
          environment = pmrem.fromScene(room, 0.04);
          scene.environment = environment.texture; room.dispose(); pmrem.dispose();
        }
        scene.add(new T.AmbientLight(0xffffff, mode === "mark" ? 0.9 : 0.5));
        const key = new T.DirectionalLight(0xffffff, 4); key.position.set(-3, 5, 6); scene.add(key);
        const rim = new T.DirectionalLight(0xbfc4d0, 3); rim.position.set(4, -2, 2); scene.add(rim);
        let object: Three.Group;
        let routes: { points: Three.Vector3[]; traveler: Three.Mesh }[] = [];
        let tierStack: ReturnType<typeof createTierStack> | null = null;
        let mark: MarkVoxel | null = null;
        let syndicate: ReturnType<typeof createSyndicateField> | null = null;
        if (mode === "card") object = createCard(T);
        else if (mode === "stack") { tierStack = createTierStack(T, await loadLogo()); object = tierStack.stack; }
        else if (mode === "mark") { mark = createMarkVoxel(T, await loadLogo(), 0xe8c77a); object = mark.group; }
        else if (mode === "syndicate") { syndicate = createSyndicateField(T, await loadLogo()); object = syndicate.group; }
        else { const world = await createGlobe(T, abort.signal); object = world.group; routes = world.routes; }
        if (disposed) { object.traverse(disposeObject); return; }
        scene.add(object);
        let elapsed = 0, lastTime = 0, spread = 0;
        const render = (time: number) => {
          const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.04) : 0;
          lastTime = time;
          if (!reduce.matches && !pauseRef.current) {
            elapsed += delta;
            if (tierStack) {
              spread += ((hovering ? 1 : 0) - spread) * 0.06;
              tierStack.cards.forEach((card, i) => {
                const k = tierStack!.cards.length - 1 - i; // 0 = front (Vello Black)
                card.position.set(-0.14 * k * (1 + spread * 0.9), 0.34 * k * (1 + spread * 1.25) + Math.sin(elapsed * 0.9 + i * 1.3) * 0.025, -0.28 * k);
                card.rotation.z = 0.03 * k * (1 + spread);
              });
              object.position.y = -0.55;
              object.rotation.y += (-0.35 + pointer.x * 0.3 + Math.sin(elapsed * 0.25) * 0.07 - object.rotation.y) * 0.05;
              object.rotation.x += (-0.12 + pointer.y * 0.16 - object.rotation.x) * 0.05;
              const sweep = (elapsed * 0.4) % 1;
              tierStack.scan.position.y = -1.2 + sweep * 2.4;
              (tierStack.scan.material as Three.MeshBasicMaterial).opacity = 0.6 * Math.sin(sweep * Math.PI);
              const pos = tierStack.dust.geometry.attributes.position as Three.BufferAttribute;
              for (let i = 0; i < pos.count; i++) {
                let y = pos.getY(i) + tierStack.speeds[i] * delta;
                if (y > 3) y = -2;
                pos.setY(i, y);
              }
              pos.needsUpdate = true;
            } else if (mode === "card") {
              object.rotation.y += (-0.32 + pointer.x * 0.24 + Math.sin(elapsed * 0.28) * 0.09 - object.rotation.y) * 0.05;
              object.rotation.x += (-0.16 + pointer.y * 0.13 - object.rotation.x) * 0.05;
              object.position.y = Math.sin(elapsed * 0.7) * 0.055;
            } else if (mark) {
              if (!assembleMark(mark, elapsed)) {
                // Mid-assembly: the group itself stays put, only the
                // per-instance cube positions are animating in.
              } else {
                object.rotation.y += (-0.3 + pointer.x * 0.4 + Math.sin(elapsed * 0.3) * 0.1 - object.rotation.y) * 0.05;
                object.rotation.x += (pointer.y * 0.25 - object.rotation.x) * 0.05;
                object.position.y = Math.sin(elapsed * 0.6) * 0.05;
              }
            } else if (syndicate) {
              syndicate.marks.forEach((m, i) => {
                assembleMark(m, elapsed - i * 0.35);
                if (m.assembled) {
                  m.group.rotation.y += (0.12 + (i % 2 ? -0.06 : 0.05)) * delta;
                  m.group.position.y += Math.sin(elapsed * (0.3 + i * 0.08) + i) * 0.0015;
                }
              });
              object.rotation.y = Math.sin(elapsed * 0.05) * 0.08;
              const pos = syndicate.dust.geometry.attributes.position as Three.BufferAttribute;
              for (let i = 0; i < pos.count; i++) {
                let y = pos.getY(i) + syndicate.speeds[i] * delta;
                if (y > 3) y = -3;
                pos.setY(i, y);
              }
              pos.needsUpdate = true;
            } else {
              object.rotation.y = -1.12 + elapsed * 0.055 + pointer.x * 0.05;
              routes.forEach(({ points, traveler }, i) => traveler.position.copy(points[Math.floor(((elapsed * 0.13 + i * 0.24) % 1) * 99)]));
            }
          }
          renderer?.render(scene!, camera);
        };
        const sync = () => {
          lastTime = 0;
          if (!renderer || disposed) return;
          renderer.setAnimationLoop(visible && !document.hidden && !pauseRef.current && !reduce.matches ? render : null);
          render(performance.now());
        };
        synchronize.current = sync;
        resize = new ResizeObserver(() => {
          if (!renderer || disposed) return;
          const width = element.clientWidth, height = element.clientHeight;
          renderer.setSize(width, height); camera.aspect = width / height;
          camera.position.z = mode === "stack" ? (camera.aspect < 1 ? 11 : 8.6) : mode === "card" && camera.aspect < 1 ? 8.5 : mode === "card" ? 7.4 : mode === "mark" ? 5 : mode === "syndicate" ? 8.5 : 6.8;
          camera.updateProjectionMatrix(); render(performance.now());
        });
        resize.observe(element);
        const move = (e: PointerEvent) => { const r = element.getBoundingClientRect(); hovering = true; pointer.x = (e.clientX - r.left) / r.width - 0.5; pointer.y = (e.clientY - r.top) / r.height - 0.5; };
        const leave = () => { hovering = false; pointer.x = 0; pointer.y = 0; };
        element.addEventListener("pointermove", move); element.addEventListener("pointerleave", leave);
        document.addEventListener("visibilitychange", sync); reduce.addEventListener("change", sync);
        removeEvents = () => { element.removeEventListener("pointermove", move); element.removeEventListener("pointerleave", leave); document.removeEventListener("visibilitychange", sync); reduce.removeEventListener("change", sync); };
        element.dataset.ready = "true"; sync();
      } catch (error) {
        if (!disposed) { element.dataset.ready = "false"; console.warn("Club visual fallback active", error); }
      }
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) void boot(); synchronize.current?.(); }, { rootMargin: "150px" });
    observer.observe(element);
    function disposeObject(object: Three.Object3D) {
      const mesh = object as Three.Mesh;
      mesh.geometry?.dispose();
      const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const material of materials) { (material as Three.MeshStandardMaterial).map?.dispose(); material.dispose(); }
    }
    return () => {
      disposed = true; abort.abort(); observer.disconnect(); resize?.disconnect(); removeEvents?.();
      synchronize.current = null;
      renderer?.setAnimationLoop(null); scene?.traverse(disposeObject); environment?.dispose(); renderer?.dispose(); renderer?.domElement.remove();
    };
  }, [mode]);

  const label = mode === "stack" ? "Stack of the five Vello membership tier cards, from Member to Vello Black"
    : mode === "card" ? "Interactive engraved titanium Vello Black membership card"
    : mode === "mark" ? "Pixelated 3D Vello mark"
    : mode === "syndicate" ? undefined // decorative backdrop, not content
    : "Animated globe connecting the world's creative capitals";
  return <div ref={host} className={`${styles.scene} ${mode === "globe" ? styles.globeScene : mode === "mark" ? styles.markScene : mode === "syndicate" ? styles.syndicateScene : styles.cardScene}`} role={mode === "syndicate" ? undefined : "img"} aria-hidden={mode === "syndicate" || undefined} aria-label={label}>
    <div className={styles.sceneFallback} aria-hidden="true">
      {mode === "globe" ? <div className={styles.fallbackGlobe}>WORLDWIDE<br /><span>ONE CIRCLE</span></div>
        : mode === "mark"
        // eslint-disable-next-line @next/next/no-img-element
        ? <span className={styles.fallbackMarkCrop}><img src={velloLogo.src} alt="" className={styles.fallbackMark} /></span>
        : mode === "syndicate" ? null
        : <div className={styles.fallbackCard}><span>VELLO <b>BLACK</b></span><strong>1B</strong><small>BY INVITATION. BY ACHIEVEMENT.</small></div>}
    </div>
  </div>;
}
