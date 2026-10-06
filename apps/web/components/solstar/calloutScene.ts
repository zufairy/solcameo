import * as THREE from "three";
import { compact, type CalloutCardData } from "@/lib/client/calloutCard";

/**
 * Callout visual: the admin "Views generated" network card, rebuilt in three.js and applied to one agent.
 *   - the agent's total views as a glowing 3D pixel-matrix counter that counts up and shimmers
 *   - its own videos (poster frames) and avatar floating around it as the "network", sending lime
 *     packets into the counter
 *   - glass stat panels (videos, market cap, move since call), the call as a quote, Solana mark
 * One scene builder serves the live feed card, the popup preview and the 1600×900 PNG posted to X.
 */
const W = 16, H = 9; // scene units; 1 unit = 100px of the 1600×900 card
const LIME = 0xc8f02a, LIME_CSS = "#C8F02A", INK = "#F2F2EF", MUTE = "rgba(242,242,239,0.56)", FAINT = "rgba(242,242,239,0.34)";
const SANS = `Manrope, Inter, -apple-system, "SF Pro Display", system-ui, sans-serif`;
const SERIF = `Fraunces, Georgia, "Times New Roman", serif`;
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const seg = (t: number, a: number, d: number) => Math.max(0, Math.min(1, (t - a) / d));

/* 5×7 pixel glyphs for the counter */
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
  ".": [".....", ".....", ".....", ".....", ".....", ".XX..", ".XX.."],
  K: ["X...X", "X..X.", "X.X..", "XX...", "X.X..", "X..X.", "X...X"],
  M: ["X...X", "XX.XX", "X.X.X", "X.X.X", "X...X", "X...X", "X...X"],
  B: ["XXXX.", "X...X", "X...X", "XXXX.", "X...X", "X...X", "XXXX."],
  "—": [".....", ".....", ".....", "XXXXX", ".....", ".....", "....."],
};
const MAX_CELLS = 9 * 35;

/* ── static HUD: type, glass panels, quote, brand. Redrawn while the intro plays. ── */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
const spacing = (ctx: CanvasRenderingContext2D, px: number) => { (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`; };
function letters(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, track: number, align: CanvasTextAlign = "left") {
  spacing(ctx, track); ctx.textAlign = align; ctx.fillText(s, x, y); spacing(ctx, 0);
}
function fitText(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  let v = s; while (v.length > 2 && ctx.measureText(`${v}…`).width > max) v = v.slice(0, -1);
  return `${v}…`;
}
function drawSolana(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const h = w * 0.12, sk = h * 0.7, g = ctx.createLinearGradient(x, y, x + w, y + h * 3);
  g.addColorStop(0, "#9945FF"); g.addColorStop(1, "#14F195");
  ctx.fillStyle = g;
  [0, 1, 2].forEach((i) => {
    const yy = y + i * h * 1.45;
    ctx.beginPath();
    if (i === 1) { ctx.moveTo(x, yy); ctx.lineTo(x + w - sk, yy); ctx.lineTo(x + w, yy + h); ctx.lineTo(x + sk, yy + h); }
    else { ctx.moveTo(x + sk, yy); ctx.lineTo(x + w, yy); ctx.lineTo(x + w - sk, yy + h); ctx.lineTo(x, yy + h); }
    ctx.closePath(); ctx.fill();
  });
}
export function drawHud(ctx: CanvasRenderingContext2D, d: CalloutCardData, p: number, logo: HTMLImageElement | null) {
  ctx.clearRect(0, 0, 1600, 900);
  ctx.textBaseline = "alphabetic";
  const f = ease(p * 1.4);
  ctx.globalAlpha = f;
  // top bar: logo + brand, ticker chip
  if (logo) ctx.drawImage(logo, 64, 52, 44, 44);
  ctx.fillStyle = INK; ctx.font = `700 26px ${SANS}`; letters(ctx, "solcameo", 122, 84, -0.5);
  const tick = `$${d.ticker.toUpperCase()}`;
  ctx.font = `800 22px ${SANS}`; const tw = ctx.measureText(tick).width + 36;
  ctx.fillStyle = "rgba(255,255,255,0.06)"; roundRect(ctx, 1536 - tw, 52, tw, 44, 22); ctx.fill();
  ctx.strokeStyle = "rgba(200,240,42,0.5)"; ctx.lineWidth = 1.5; roundRect(ctx, 1536 - tw, 52, tw, 44, 22); ctx.stroke();
  ctx.fillStyle = LIME_CSS; letters(ctx, tick, 1536 - tw / 2, 82, 0.5, "center");

  // kicker + headline
  ctx.fillStyle = LIME_CSS; ctx.font = `700 18px ${SANS}`; letters(ctx, "SOLCAMEO AGENT NETWORK", 800, 150, 6, "center");
  const a = "Views generated", b = ` by ${d.name.slice(0, 14)}`;
  ctx.font = `500 84px ${SANS}`; spacing(ctx, -3); const wA = ctx.measureText(a).width; spacing(ctx, 0);
  ctx.font = `italic 600 84px ${SERIF}`; const wB = ctx.measureText(b).width;
  const x0 = 800 - (wA + wB) / 2;
  ctx.textAlign = "left";
  ctx.font = `500 84px ${SANS}`; ctx.fillStyle = "#fff"; spacing(ctx, -3); ctx.fillText(a, x0, 250); spacing(ctx, 0);
  ctx.font = `italic 600 84px ${SERIF}`; ctx.fillStyle = LIME_CSS; ctx.fillText(b, x0 + wA, 250);

  // caption under the counter
  ctx.fillStyle = FAINT; ctx.font = `500 17px ${SANS}`;
  letters(ctx, `${(d.videos ?? 0).toLocaleString("en-US")} ${d.videos === 1 ? "video" : "videos"}  /  live tracked views`, 800, 590, 1.2, "center");

  // stat panels
  const has = typeof d.changePct === "number" && Number.isFinite(d.changePct);
  const ch = has ? (d.changePct as number) : 0;
  const panels: Array<[string, string, string]> = [
    ["VIDEOS CREATED", Math.round((d.videos ?? 0) * p).toLocaleString("en-US"), LIME_CSS],
    ["MARKET CAP", d.cap, INK],
    [has ? (d.label === "SINCE CALL" ? "SINCE CALL" : "SINCE LAUNCH") : "VIEWS PER VIDEO", has ? `${ch >= 0 ? "+" : "−"}${Math.abs(ch * p).toFixed(1)}%` : compact(Math.round((d.views ?? 0) / Math.max(1, d.videos ?? 1))), has ? (ch >= 0 ? LIME_CSS : "#ff8a9b") : INK],
  ];
  const PW = 340, PG = 28, PX = (1600 - (PW * 3 + PG * 2)) / 2, PY = 640, PH = 118;
  panels.forEach(([label, value, color], i) => {
    const px = PX + i * (PW + PG), pf = ease(seg(p, 0.25 + i * 0.1, 0.4));
    ctx.save(); ctx.globalAlpha = f * pf; ctx.translate(0, (1 - pf) * 22);
    const g = ctx.createLinearGradient(px, PY, px + PW, PY + PH);
    g.addColorStop(0, i === 0 ? "rgba(200,240,42,0.12)" : "rgba(255,255,255,0.075)"); g.addColorStop(1, "rgba(255,255,255,0.02)");
    ctx.fillStyle = g; roundRect(ctx, px, PY, PW, PH, 20); ctx.fill();
    ctx.strokeStyle = i === 0 ? "rgba(200,240,42,0.4)" : "rgba(255,255,255,0.14)"; ctx.lineWidth = 1.5; roundRect(ctx, px + 0.75, PY + 0.75, PW - 1.5, PH - 1.5, 20); ctx.stroke();
    const sh = ctx.createLinearGradient(0, PY, 0, PY + PH * 0.5); sh.addColorStop(0, "rgba(255,255,255,0.1)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save(); roundRect(ctx, px, PY, PW, PH, 20); ctx.clip(); ctx.fillStyle = sh; ctx.fillRect(px, PY, PW, PH * 0.5); ctx.restore();
    ctx.fillStyle = MUTE; ctx.font = `600 13px ${SANS}`; letters(ctx, label, px + PW / 2, PY + 34, 3, "center");
    ctx.fillStyle = color; ctx.font = `700 52px ${SANS}`; ctx.textAlign = "center";
    spacing(ctx, -1.5); ctx.fillText(value, px + PW / 2, PY + 92, PW - 40); spacing(ctx, 0);
    ctx.restore();
  });

  // the call + footer
  ctx.globalAlpha = f * ease(seg(p, 0.55, 0.4));
  ctx.fillStyle = "rgba(242,242,239,0.8)"; ctx.font = `italic 500 25px ${SERIF}`; ctx.textAlign = "center";
  ctx.fillText(`“${fitText(ctx, (d.body || "What's your call?").replace(/\s+/g, " "), 1100)}”`, 800, 826);
  ctx.globalAlpha = f;
  ctx.fillStyle = FAINT; ctx.font = `600 13px ${SANS}`; letters(ctx, "SOLCAMEO.COM", 64, 868, 3.5);
  drawSolana(ctx, 1486, 846, 50);
  ctx.globalAlpha = 1;
}

/* ── textures ── */
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function loadTexture(url?: string): Promise<THREE.Texture | null> {
  if (!url || !/^https:\/\//.test(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
    const timer = setTimeout(() => resolve(null), 6000);
    loader.load(url, (t) => { clearTimeout(timer); t.colorSpace = THREE.SRGBColorSpace; resolve(t); }, undefined, () => { clearTimeout(timer); resolve(null); });
  });
}
/** Crop the texture to a centred square so a portrait poster fills a round bubble. */
function coverFit(tex: THREE.Texture) {
  const img = tex.image as { width?: number; height?: number } | undefined;
  const a = (img?.width ?? 1) / (img?.height ?? 1);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(a > 1 ? 1 / a : 1, a > 1 ? 1 : a);
  tex.offset.set(a > 1 ? (1 - 1 / a) / 2 : 0, a > 1 ? 0 : (1 - a) / 2);
}

type Bubble = { x: number; y: number; r: number; z: number; delay: number; amp: number; k: number; ph: number; slot: number | "lead" | null };
const BUBBLES: Bubble[] = [
  { x: -5.9, y: 0.35, r: 0.95, z: 0.6, delay: 0.05, amp: 0.14, k: 0.9, ph: 0.1, slot: "lead" },
  { x: -7.2, y: 3.0, r: 0.52, z: -0.2, delay: 0.18, amp: 0.2, k: 1.1, ph: 0.4, slot: 0 },
  { x: -7.3, y: -2.0, r: 0.62, z: 0.1, delay: 0.26, amp: 0.18, k: 0.8, ph: 0.7, slot: 1 },
  { x: -4.7, y: 3.35, r: 0.34, z: -0.6, delay: 0.34, amp: 0.16, k: 1.3, ph: 0.2, slot: 2 },
  { x: 7.1, y: 3.05, r: 0.56, z: -0.1, delay: 0.14, amp: 0.2, k: 1.0, ph: 0.6, slot: 3 },
  { x: 6.2, y: 0.4, r: 0.78, z: 0.5, delay: 0.22, amp: 0.15, k: 0.85, ph: 0.9, slot: 4 },
  { x: 7.4, y: -2.2, r: 0.5, z: 0.0, delay: 0.3, amp: 0.2, k: 1.15, ph: 0.3, slot: 5 },
  { x: 4.8, y: 3.4, r: 0.3, z: -0.7, delay: 0.4, amp: 0.14, k: 1.25, ph: 0.8, slot: null },
  { x: -3.3, y: -3.7, r: 0.28, z: -0.6, delay: 0.44, amp: 0.14, k: 1.0, ph: 0.5, slot: null },
  { x: 3.6, y: -3.75, r: 0.32, z: -0.5, delay: 0.48, amp: 0.14, k: 1.2, ph: 0.15, slot: null },
];

export type CalloutScene = {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  update: (t: number, p: number, pointer: { x: number; y: number }) => void;
  setData: (d: CalloutCardData) => void;
  dispose: () => void;
};

/** Builds the scene. Thumbnails and the avatar stream in after creation and appear on their bubbles. */
export function buildCalloutScene(initial: CalloutCardData, opts: { hudScale?: number } = {}): CalloutScene {
  let data = initial;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x070a07);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  camera.position.z = H / 2 / Math.tan((30 * Math.PI) / 360);
  const rig = new THREE.Group(); scene.add(rig);
  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);

  // atmosphere
  const glowTex = keep(glowTexture());
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(13, 7), keep(new THREE.MeshBasicMaterial({ map: glowTex, color: LIME, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending })));
  haze.position.z = -2.5; scene.add(haze);
  const vignette = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.3, H * 1.3), keep(new THREE.MeshBasicMaterial({ map: glowTex, color: 0x1a2a10, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })));
  vignette.position.z = -3; scene.add(vignette);

  // dust
  const DUST = 150, dBase = new Float32Array(DUST * 3), dPos = new Float32Array(DUST * 3), dVel = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) { dBase[i * 3] = (Math.random() - 0.5) * 17; dBase[i * 3 + 1] = (Math.random() - 0.5) * 9.6; dBase[i * 3 + 2] = -2 + Math.random() * 3.4; dVel[i] = 0.05 + Math.random() * 0.2; }
  dPos.set(dBase);
  const dGeo = keep(new THREE.BufferGeometry()); dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  const dMat = keep(new THREE.PointsMaterial({ color: 0xd9f27a, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false }));
  rig.add(new THREE.Points(dGeo, dMat));

  // counter: instanced glowing cubes
  const cubeGeo = keep(new THREE.BoxGeometry(1, 1, 0.7));
  const cubeMat = keep(new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.75, roughness: 0.35, metalness: 0.2 }));
  const cubes = new THREE.InstancedMesh(cubeGeo, cubeMat, MAX_CELLS); cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); cubes.count = 0; rig.add(cubes);
  const glowMat = keep(new THREE.MeshBasicMaterial({ map: glowTex, color: LIME, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  const cubeGlow = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(1, 1)), glowMat, MAX_CELLS); cubeGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); cubeGlow.count = 0; rig.add(cubeGlow);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.PointLight(0xf0ffb0, 14, 30); key.position.set(-3, 3, 7); scene.add(key);
  const rim = new THREE.PointLight(0x9945ff, 6, 30); rim.position.set(5, -3, 5); scene.add(rim);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const counterCenterY = 0.15;
  let counterHalfW = 3;

  // bubbles
  const bubbles = BUBBLES.map((b) => {
    const g = new THREE.Group();
    const mat = keep(new THREE.MeshBasicMaterial({ color: b.slot === null ? 0xffffff : 0x151a16, transparent: true, opacity: b.slot === null ? 0.08 : 1 }));
    const face = new THREE.Mesh(keep(new THREE.CircleGeometry(b.r, 48)), mat);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(b.r, b.r + (b.slot === "lead" ? 0.05 : 0.03), 64)), keep(new THREE.MeshBasicMaterial({ color: b.slot === "lead" ? LIME : 0xffffff, transparent: true, opacity: b.slot === "lead" ? 0.95 : b.slot === null ? 0.14 : 0.28 })));
    const halo = new THREE.Mesh(keep(new THREE.CircleGeometry(b.r + 0.26, 48)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.035, depthWrite: false })));
    halo.position.z = -0.01; ring.position.z = 0.01;
    g.add(halo, face, ring);
    let pulse: THREE.Mesh | null = null;
    if (b.slot === "lead") { pulse = new THREE.Mesh(keep(new THREE.RingGeometry(b.r + 0.14, b.r + 0.17, 64)), keep(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.35 }))); g.add(pulse); }
    g.position.set(b.x, b.y, b.z); rig.add(g);
    return { b, g, mat, pulse };
  });
  // packets flowing from the lead + first thumbs into the counter
  const packetSrc = BUBBLES.map((b, i) => ({ b, i })).filter(({ b }) => b.slot === "lead" || (typeof b.slot === "number" && b.slot <= 4)).slice(0, 4);
  const packetGeo = keep(new THREE.SphereGeometry(0.06, 10, 10));
  const packets = packetSrc.flatMap(({ i }) => [0, 1, 2, 3].map((k) => ({ i, k, mesh: new THREE.Mesh(packetGeo, keep(new THREE.MeshBasicMaterial({ color: k ? 0xffffff : LIME, transparent: true, opacity: 0 }))) })));
  packets.forEach((pk) => rig.add(pk.mesh));

  // HUD plane: type and glass panels drawn in 2D, mapped 1:1 onto the frame
  const logoImg = new Image(); logoImg.src = "/brand/solcameo-mark.png";
  const hudScale = opts.hudScale ?? 1;
  const hudCanvas = document.createElement("canvas"); hudCanvas.width = Math.round(1600 * hudScale); hudCanvas.height = Math.round(900 * hudScale);
  const hctx = hudCanvas.getContext("2d")!;
  const hudTex = keep(new THREE.CanvasTexture(hudCanvas)); hudTex.colorSpace = THREE.SRGBColorSpace; hudTex.anisotropy = 4;
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(W, H), keep(new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthWrite: false })));
  hud.position.z = 2.2; scene.add(hud);
  hud.scale.setScalar((camera.position.z - 2.2) / camera.position.z);
  let lastHudP = -1, lastHudKey = "";
  const redrawHud = (p: number) => {
    const k = `${data.name}|${data.ticker}|${data.cap}|${data.videos}|${data.changePct}|${data.label}|${data.views}|${data.body}`;
    if (Math.abs(p - lastHudP) < 0.004 && k === lastHudKey) return;
    lastHudP = p; lastHudKey = k;
    hctx.setTransform(hudScale, 0, 0, hudScale, 0, 0);
    drawHud(hctx, data, p, logoImg.complete && logoImg.naturalWidth ? logoImg : null);
    hudTex.needsUpdate = true;
  };

  // image streaming
  const live = { disposed: false };
  let loadedFor = "";
  const loadImages = () => {
    const urls = [data.imageUrl ?? "", ...(data.thumbs ?? []).slice(0, 6)];
    const sig = urls.join("|"); if (sig === loadedFor) return; loadedFor = sig;
    urls.forEach((u, idx) => void loadTexture(u).then((tex) => {
      if (live.disposed || !tex || loadedFor !== sig) { tex?.dispose(); return; }
      const slot = idx === 0 ? "lead" : idx - 1;
      const target = bubbles.find((x) => x.b.slot === slot); if (!target) { tex.dispose(); return; }
      coverFit(tex); keep(tex);
      target.mat.map = tex; target.mat.color.set(0xffffff); target.mat.needsUpdate = true;
    }));
  };
  loadImages();

  const setCounter = (t: number, p: number) => {
    const shown = data.views && data.views > 0 ? compact(Math.round(data.views * ease(p / 0.6))) : "—";
    const chars = [...shown].filter((c) => GLYPHS[c]);
    const cols = Math.max(1, chars.length * 6 - 1), cell = Math.min(0.27, 6.4 / cols);
    counterHalfW = (cols * cell) / 2;
    const top = counterCenterY + (7 * cell) / 2;
    let n = 0;
    chars.forEach((c, ci) => GLYPHS[c].forEach((row, ry) => [...row].forEach((v, rx) => {
      if (v !== "X" || n >= MAX_CELLS) return;
      const gx = ci * 6 + rx, x = (gx - (cols - 1) / 2) * cell, y = top - (ry + 0.5) * cell;
      const shimmer = 0.9 + 0.1 * Math.sin(t * 3.2 - gx * 0.35), grow = ease(seg(p, 0.05 + gx * 0.004, 0.3));
      const s = cell * 0.82 * shimmer * grow;
      ps.set(x, y, 0.2); sc.set(s, s, s * 1.1); m4.compose(ps, q, sc); cubes.setMatrixAt(n, m4);
      const gs = cell * 2.4 * grow; sc.set(gs, gs, 1); ps.set(x, y, 0.45); m4.compose(ps, q, sc); cubeGlow.setMatrixAt(n, m4);
      n++;
    })));
    cubes.count = n; cubeGlow.count = n; cubes.instanceMatrix.needsUpdate = true; cubeGlow.instanceMatrix.needsUpdate = true;
  };

  const update: CalloutScene["update"] = (t, p, pointer) => {
    redrawHud(p);
    rig.rotation.y += (pointer.x * 0.06 - rig.rotation.y) * 0.06; rig.rotation.x += (-pointer.y * 0.04 - rig.rotation.x) * 0.06;
    haze.position.x = Math.cos(t * 0.5) * 2.2; haze.position.y = Math.sin(t * 1.0) * 0.4;
    setCounter(t, p);
    bubbles.forEach(({ b, g, pulse }) => {
      const e = ease(seg(p, b.delay, 0.3)), ph = Math.PI * 2 * (b.k * t * 0.12 + b.ph);
      g.position.set(b.x + b.amp * 0.55 * Math.cos(ph), b.y + b.amp * Math.sin(ph) - (1 - e) * 0.45, b.z);
      g.scale.setScalar(0.5 + 0.5 * e); g.visible = e > 0.01;
      if (pulse) { pulse.scale.setScalar(1 + 0.06 * Math.sin(t * 4)); (pulse.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.12 * Math.sin(t * 4); }
    });
    packets.forEach((pk, n) => {
      const src = bubbles[pk.i].g.position, side = src.x < 0 ? -1 : 1;
      const tx = side * (counterHalfW + 0.5), ty = counterCenterY, cx = (src.x + tx) / 2, cy = Math.max(src.y, ty) + 1.2;
      const u = (0.34 * t + (n % 4) * 0.19 + pk.i * 0.07) % 1, v = Math.max(0, u - pk.k * 0.035), m = 1 - v;
      pk.mesh.position.set(m * m * src.x + 2 * m * v * cx + v * v * tx, m * m * src.y + 2 * m * v * cy + v * v * ty, 0.8);
      (pk.mesh.material as THREE.MeshBasicMaterial).opacity = seg(p, 0.35, 0.15) * Math.sin(Math.PI * v) * (0.9 - pk.k * 0.2);
    });
    for (let i = 0; i < DUST; i++) { const k = i * 3; let y = dPos[k + 1] + dVel[i] * 0.016; if (y > 4.9) y = -4.9; dPos[k + 1] = y; dPos[k] = dBase[k] + Math.sin(t * 0.4 + i) * 0.06; }
    dGeo.attributes.position.needsUpdate = true;
    key.intensity = 12 + 3 * Math.sin(t * 1.4);
  };

  return {
    scene, camera, update,
    setData: (d) => { data = d; loadImages(); lastHudKey = ""; },
    dispose: () => { live.disposed = true; disposables.forEach((d) => d.dispose()); cubes.dispose(); cubeGlow.dispose(); },
  };
}

/** Renders the callout to a 1600×900 PNG: the same scene, frozen at its settled frame. */
export async function renderCalloutPng(d: CalloutCardData): Promise<Blob | null> {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch { return null; }
  renderer.setPixelRatio(1); renderer.setSize(1600, 900, false);
  const s = buildCalloutScene(d);
  // images stream in; give them a moment, then draw the settled frame
  await new Promise((r) => setTimeout(r, 1800));
  s.update(2.4, 1, { x: 0, y: 0 });
  renderer.render(s.scene, s.camera);
  const blob = await new Promise<Blob | null>((res) => renderer.domElement.toBlob(res, "image/png"));
  s.dispose(); renderer.dispose();
  return blob;
}
