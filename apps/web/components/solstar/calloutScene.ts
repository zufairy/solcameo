import { GLYPHS, MAX_CELLS } from "./calloutPixels";
import { buildCompactCalloutScene } from "./compactCalloutScene";
import { formatTradeSol } from "@/lib/solstar/calloutTrade";
import { createCalloutMotif } from "./calloutThemeScene";
import { calloutStyle } from "@/lib/solstar/calloutStyle";
import { calloutArtwork } from "@/lib/solstar/calloutArtwork";
import * as THREE from "three";
import { calloutTheme, formatCalloutMoney } from "@/lib/solstar/callout";
import { compact, type CalloutCardData } from "@/lib/client/calloutCard";

/**
 * Callout visual: the admin "Views generated" network card, rebuilt in three.js and applied to one agent.
 *   - the agent's total views as a glowing 3D pixel-matrix counter that counts up and shimmers
 *   - its own videos (poster frames) and avatar floating around it as the "network", sending lime
 *     packets into the counter
 *   - glass stat panels (videos, market cap, move since call), the call as a quote, Solana mark
 * One scene builder serves the live feed card, the popup preview and the 1600×900 PNG posted to X.
 */
const INK = "#F2F2EF", MUTE = "rgba(242,242,239,0.56)", FAINT = "rgba(242,242,239,0.34)";
const SANS = `Manrope, Inter, -apple-system, "SF Pro Display", system-ui, sans-serif`;
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
const seg = (t: number, a: number, d: number) => Math.max(0, Math.min(1, (t - a) / d));




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
export function drawHud(ctx: CanvasRenderingContext2D, d: CalloutCardData, p: number, logo: HTMLImageElement | null, solanaLogo: HTMLImageElement | null = null) {
  const style = calloutStyle(d.theme);
  const LIME_CSS = calloutTheme(d.theme).accent;
  const metric = d.metric ?? "earnings";
  ctx.clearRect(0, 0, 1600, 900);
  ctx.textBaseline = "alphabetic";
  const f = ease(p * 1.4);
  ctx.globalAlpha = f;
  // top bar: logo + brand, ticker chip
  if (logo) ctx.drawImage(logo, 64, 52, 44, 44);
  ctx.fillStyle = INK; ctx.font = `700 26px ${SANS}`; letters(ctx, "solcameo", 122, 84, -0.5);
  const tick = d.trader && !d.ticker ? "TRADER" : `$${d.ticker.toUpperCase()}`;
  ctx.font = `800 22px ${SANS}`; const tw = ctx.measureText(tick).width + 36;
  ctx.fillStyle = "rgba(255,255,255,0.06)"; roundRect(ctx, 1536 - tw, 52, tw, 44, 22); ctx.fill();
  ctx.strokeStyle = `${LIME_CSS}80`; ctx.lineWidth = 1.5; roundRect(ctx, 1536 - tw, 52, tw, 44, 22); ctx.stroke();
  ctx.fillStyle = LIME_CSS; letters(ctx, tick, 1536 - tw / 2, 82, 0.5, "center");

  // Only the agent identity remains; the metric is explained beside the data.
  ctx.fillStyle = INK; ctx.font = `${style.italic ? "italic " : ""}${style.weight} 54px ${style.family}`;
  letters(ctx, fitText(ctx, d.name, 950), 800, 204, style.tracking, "center");

  // caption under the counter
  ctx.fillStyle = FAINT; ctx.font = `500 17px ${SANS}`;
  letters(ctx, metric === "views" ? `${(d.videos ?? 0).toLocaleString("en-US")} ${d.videos === 1 ? "video" : "videos"}  /  live tracked views` : metric === "trade" ? d.trader && d.unselectedPreview ? "SELECT A COIN · CONFIRMED TRADES" : d.onchainTrade ? `POSITION P&L · ${d.tradePnlUsd == null ? "SOL" : "USD"} · ON-CHAIN · ${d.onchainTrade.network.toUpperCase()}` : "NET TRADE PROFIT / LOSS · USD · USER REPORTED" : "LIFETIME AGENT EARNINGS · USD", 800, 590, 1.2, "center");

  // stat panels
  const has = typeof d.changePct === "number" && Number.isFinite(d.changePct);
  const ch = has ? (d.changePct as number) : 0;
  const panels: Array<[string, string, string]> = [
    metric === "views" ? ["VIDEOS CREATED", Math.round((d.videos ?? 0) * p).toLocaleString("en-US"), LIME_CSS] : metric === "trade" ? [(d.onchainTrade || (d.trader && d.unselectedPreview)) && d.tradePnlUsd == null ? "POSITION P&L · SOL" : d.onchainTrade ? "POSITION P&L · USD" : "NET P&L · USD", d.tradePnlUsd == null && d.onchainTrade ? formatTradeSol(d.onchainTrade.pnlSol) : formatCalloutMoney(d.tradePnlUsd), (d.tradePnlUsd ?? d.onchainTrade?.pnlSol ?? 0) < 0 ? "#ff8a9b" : LIME_CSS] : ["EARNED · LAST 30 DAYS", formatCalloutMoney(d.monthlyEarningsUsd), LIME_CSS],
    d.trader ? [d.onchainTrade ? "LATEST TRADE" : "TRADER", d.onchainTrade ? `${d.onchainTrade.side.toUpperCase()} $${d.onchainTrade.ticker}` : d.caller || d.name, INK] : ["MARKET CAP", d.cap, INK],
    d.trader ? ["SOURCE", d.onchainTrade ? `ON-CHAIN · ${d.onchainTrade.network.toUpperCase()}` : d.unselectedPreview ? "SELECT A COIN" : "USER REPORTED", INK] : [has ? (d.label === "SINCE CALL" ? "SINCE CALL" : "SINCE LAUNCH") : "TOKEN CHANGE", has ? `${ch >= 0 ? "+" : "−"}${Math.abs(ch * p).toFixed(1)}%` : "—", has ? (ch >= 0 ? LIME_CSS : "#ff8a9b") : INK],
  ];
  const PW = 340, PG = 28, PX = (1600 - (PW * 3 + PG * 2)) / 2, PY = 640, PH = 118;
  panels.forEach(([label, value, color], i) => {
    const px = PX + i * (PW + PG), pf = ease(seg(p, 0.25 + i * 0.1, 0.4));
    ctx.save(); ctx.globalAlpha = f * pf; ctx.translate(0, (1 - pf) * 22);
    const g = ctx.createLinearGradient(px, PY, px + PW, PY + PH);
    g.addColorStop(0, i === 0 ? `${LIME_CSS}1f` : "rgba(255,255,255,0.075)"); g.addColorStop(1, "rgba(255,255,255,0.02)");
    ctx.fillStyle = g; roundRect(ctx, px, PY, PW, PH, style.radius); ctx.fill();
    ctx.strokeStyle = i === 0 ? `${LIME_CSS}66` : "rgba(255,255,255,0.14)"; ctx.lineWidth = 1.5; roundRect(ctx, px + 0.75, PY + 0.75, PW - 1.5, PH - 1.5, style.radius); ctx.stroke();
    const sh = ctx.createLinearGradient(0, PY, 0, PY + PH * 0.5); sh.addColorStop(0, "rgba(255,255,255,0.1)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save(); roundRect(ctx, px, PY, PW, PH, style.radius); ctx.clip(); ctx.fillStyle = sh; ctx.fillRect(px, PY, PW, PH * 0.5); ctx.restore();
    ctx.fillStyle = MUTE; ctx.font = `600 13px ${SANS}`; letters(ctx, label, px + PW / 2, PY + 34, 3, "center");
    ctx.fillStyle = color; ctx.font = `${style.weight} 52px ${style.family}`; ctx.textAlign = "center";
    spacing(ctx, -1.5); ctx.fillText(value, px + PW / 2, PY + 92, PW - 40); spacing(ctx, 0);
    ctx.restore();
  });

  // the call + footer
  ctx.globalAlpha = f * ease(seg(p, 0.55, 0.4));
  ctx.fillStyle = "rgba(242,242,239,0.8)"; ctx.font = `${style.italic ? "italic " : ""}${style.weight} 25px ${style.family}`; ctx.textAlign = "center";
  ctx.fillText(`“${fitText(ctx, (d.body || "What's your call?").replace(/\s+/g, " "), 1100)}”`, 800, 826);
  ctx.globalAlpha = f;
  ctx.fillStyle = FAINT; ctx.font = `600 13px ${SANS}`; letters(ctx, "SOLCAMEO.COM", 64, 868, 3.5);
  if (solanaLogo) ctx.drawImage(solanaLogo, 1486, 820, 50, 50 * solanaLogo.naturalHeight / solanaLogo.naturalWidth);
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
  if (!url || (!/^https:\/\//.test(url) && !url.startsWith("/brand/"))) return Promise.resolve(null);
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve(null); }, 6000);
    loader.load(url, (t) => { clearTimeout(timer); if (settled) { t.dispose(); return; } settled = true; t.colorSpace = THREE.SRGBColorSpace; resolve(t); }, undefined, () => { clearTimeout(timer); settled = true; resolve(null); });
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
  scene: THREE.Scene; camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  resize?: (width: number, height: number, pixelRatio: number) => void;
  update: (t: number, p: number, pointer: { x: number; y: number }) => void;
  setData: (d: CalloutCardData) => void;
  dispose: () => void;
};

/** Builds the scene. Thumbnails and the avatar stream in after creation and appear on their bubbles. */
export function buildCalloutScene(initial: CalloutCardData, opts: { hudScale?: number; compact?: boolean } = {}): CalloutScene {
  if (opts.compact) return buildCompactCalloutScene(initial);
  const style = calloutStyle(initial.theme);
  const compactLayout = !!opts.compact;
  const W = 16, H = compactLayout ? 3.2 : 9;
  const bubbleLayout = compactLayout ? BUBBLES.map((b, i) => ({ ...b, x: b.slot === "lead" ? -7.7 : -2.8 + (i % 4) * 1.2, y: b.slot === "lead" ? 0 : i % 2 ? 1.15 : -1.15, r: b.slot === "lead" ? 0.55 : b.r * 0.35, z: -0.7, amp: 0.06 })) : BUBBLES;
  let data = initial;
  const LIME = new THREE.Color(calloutTheme(initial.theme).accent);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(calloutTheme(initial.theme).background);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  camera.position.z = H / 2 / Math.tan((30 * Math.PI) / 360);
  const rig = new THREE.Group(); scene.add(rig);
  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);

  const motif = createCalloutMotif(scene, initial.theme, H);
  keep(motif);

  // atmosphere
  const glowTex = keep(glowTexture());
  const haze = new THREE.Mesh(keep(new THREE.PlaneGeometry(13, H)), keep(new THREE.MeshBasicMaterial({ map: glowTex, color: LIME, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending })));
  haze.position.z = -2.5; scene.add(haze);
  const vignette = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 1.3, H * 1.3)), keep(new THREE.MeshBasicMaterial({ map: glowTex, color: 0x1a2a10, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })));
  vignette.position.z = -3; scene.add(vignette);

  // dust
  const DUST = compactLayout ? 35 : 150, dBase = new Float32Array(DUST * 3), dPos = new Float32Array(DUST * 3), dVel = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) { dBase[i * 3] = (Math.random() - 0.5) * 17; dBase[i * 3 + 1] = (Math.random() - 0.5) * (H + 0.6); dBase[i * 3 + 2] = -2 + Math.random() * 3.4; dVel[i] = 0.05 + Math.random() * 0.2; }
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
  const counterCenterY = compactLayout ? -0.05 : 0.15;
  const counterCenterX = compactLayout ? 5.05 : 0;
  let counterHalfW = 3;

  // bubbles
  const bubbles = bubbleLayout.map((b) => {
    const g = new THREE.Group(); g.name = "callout-floating-image";
    const mat = keep(new THREE.MeshBasicMaterial({ color: b.slot === null ? 0xffffff : 0x151a16, transparent: true, opacity: compactLayout ? b.slot === "lead" ? 0.3 : 0.12 : b.slot === null ? 0.08 : 1 }));
    const face = new THREE.Mesh(keep(new THREE.CircleGeometry(b.r, 48)), mat);
    const logoFace = new THREE.Mesh(keep(new THREE.PlaneGeometry(b.r * 2, b.r * 2)), mat);
    logoFace.name = "bare-preview-logo"; logoFace.visible = false;
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(b.r, b.r + (b.slot === "lead" ? 0.05 : 0.03), 64)), keep(new THREE.MeshBasicMaterial({ color: b.slot === "lead" ? LIME : 0xffffff, transparent: true, opacity: b.slot === "lead" ? 0.95 : b.slot === null ? 0.14 : 0.28 })));
    const halo = new THREE.Mesh(keep(new THREE.CircleGeometry(b.r + 0.26, 48)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.035, depthWrite: false })));
    halo.position.z = -0.01; ring.position.z = 0.01;
    g.add(halo, face, logoFace, ring);
    let pulse: THREE.Mesh | null = null;
    if (b.slot === "lead") { pulse = new THREE.Mesh(keep(new THREE.RingGeometry(b.r + 0.14, b.r + 0.17, 64)), keep(new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.35 }))); g.add(pulse); }
    g.position.set(b.x, b.y, b.z); rig.add(g);
    return { b, g, mat, pulse, face, logoFace, ring, halo };
  });
  // packets flowing from the lead + first thumbs into the counter
  const packetSrc = bubbleLayout.map((b, i) => ({ b, i })).filter(({ b }) => b.slot === "lead" || (typeof b.slot === "number" && b.slot <= 4)).slice(0, 4);
  const packetGeo = keep(new THREE.SphereGeometry(0.06, 10, 10));
  const packets = packetSrc.flatMap(({ i }) => [0, 1, 2, 3].map((k) => ({ i, k, mesh: new THREE.Mesh(packetGeo, keep(new THREE.MeshBasicMaterial({ color: k ? 0xffffff : LIME, transparent: true, opacity: 0 }))) })));
  packets.forEach((pk) => rig.add(pk.mesh));

  // HUD plane: type and glass panels drawn in 2D, mapped 1:1 onto the frame
  const logoImg = new Image(); logoImg.src = "/brand/solcameo-mark.png";
  const solanaImg = new Image(); solanaImg.src = "/brand/solana-user.png";
  const hudScale = opts.hudScale ?? 1;
  const hudCanvas = document.createElement("canvas"); hudCanvas.width = Math.round(1600 * hudScale); hudCanvas.height = Math.round(900 * hudScale);
  const hctx = hudCanvas.getContext("2d")!;
  const hudTex = keep(new THREE.CanvasTexture(hudCanvas)); hudTex.colorSpace = THREE.SRGBColorSpace; hudTex.anisotropy = 4;
  const hud = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, H)), keep(new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthWrite: false })));
  hud.visible = !compactLayout;
  hud.position.z = 2.2; scene.add(hud);
  hud.scale.setScalar((camera.position.z - 2.2) / camera.position.z);
  let lastHudP = -1, lastHudKey = "";
  logoImg.onload = solanaImg.onload = () => { lastHudKey = ""; lastHudP = -1; };
  if (typeof FontFace !== "undefined" && document.fonts) {
    const face = new FontFace(style.fontName, `url(/fonts/captions/${style.font})`, { weight: String(style.weight) });
    void face.load().then(font => { if (live.disposed) return; document.fonts.add(font); lastHudKey = ""; lastHudP = -1; }).catch(() => {});
  }
  const redrawHud = (p: number) => {
    if (compactLayout) return;
    const k = `${data.trader}|${data.caller}|${data.name}|${data.ticker}|${data.cap}|${data.videos}|${data.changePct}|${data.label}|${data.views}|${data.body}|${data.metric}|${data.theme}|${data.earningsUsd}|${data.monthlyEarningsUsd}|${data.tradePnlUsd}|${data.onchainTrade?.signature}|${data.onchainTrade?.pnlSol}`;
    if (Math.abs(p - lastHudP) < 0.004 && k === lastHudKey) return;
    lastHudP = p; lastHudKey = k;
    hctx.setTransform(hudScale, 0, 0, hudScale, 0, 0);
    drawHud(hctx, data, p, logoImg.complete && logoImg.naturalWidth ? logoImg : null, solanaImg.complete && solanaImg.naturalWidth ? solanaImg : null);
    hudTex.needsUpdate = true;
  };

  // image streaming
  const live = { disposed: false };
  const artworkMat = keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: ["aurora", "bullrun", "ferrari"].includes(initial.theme ?? "") ? 0.09 : compactLayout ? 0.2 : 0.16, depthWrite: false }));
  const artwork = new THREE.Mesh(keep(new THREE.PlaneGeometry(W * 1.25, H * 1.25)), artworkMat);
  artwork.position.z = -1.8; scene.add(artwork);
  const artworkUrl = calloutArtwork(initial.theme).image;
  void loadTexture(artworkUrl).then(tex => {
    if (!tex || live.disposed) { tex?.dispose(); return; }
    const image = tex.image as { width: number; height: number };
    const aspect = image.width / image.height, target = W / H;
    tex.repeat.set(aspect > target ? target / aspect : 1, aspect > target ? 1 : aspect / target);
    tex.offset.set((1 - tex.repeat.x) / 2, (1 - tex.repeat.y) / 2);
    artworkMat.map = keep(tex); artworkMat.needsUpdate = true;
  });
  if (initial.theme === "solana") {
    const markMat = keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }));
    const mark = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), markMat);
    mark.visible = false;
    mark.position.set(compactLayout ? -0.2 : 6.2, compactLayout ? 0.85 : 2.6, -0.1); rig.add(mark);
    void loadTexture("/brand/solana-user.png").then(tex => {
      if (!tex || live.disposed) { tex?.dispose(); return; }
      const image = tex.image as { width: number; height: number };
      const width = compactLayout ? 1.05 : 1.7;
      mark.scale.set(width, width * image.height / image.width, 1);
      markMat.map = keep(tex); markMat.needsUpdate = true; mark.visible = true;
    });
  }
  let loadedFor = "";
  const loadImages = () => {
    const fallback = "/brand/solcameo-mark.png";
    const urls = [data.imageUrl || fallback, ...Array.from({ length: 6 }, (_, i) => data.thumbs?.[i] || data.imageUrl || fallback)];
    const sig = `${!!data.unselectedPreview}|${urls.join("|")}`; if (sig === loadedFor) return; loadedFor = sig;
    urls.forEach((u, idx) => void loadTexture(u).then((tex) => {
      if (live.disposed || !tex || loadedFor !== sig) { tex?.dispose(); return; }
      const slot = idx === 0 ? "lead" : idx - 1;
      const target = bubbles.find((x) => x.b.slot === slot); if (!target) { tex.dispose(); return; }
      if (!data.unselectedPreview) coverFit(tex); keep(tex);
      target.mat.map = tex; target.mat.color.set(0xffffff); target.mat.needsUpdate = true;
    }));
  };
  loadImages();

  const setCounter = (t: number, p: number) => {
    const metric = data.metric ?? "earnings";
    const amount = metric === "views" ? data.views : metric === "trade" ? data.tradePnlUsd ?? data.onchainTrade?.pnlSol : data.earningsUsd;
    const animated = amount == null ? undefined : amount * ease(p / 0.6);
    const shown = animated == null ? "—" : metric === "views" ? compact(Math.round(animated)) : data.onchainTrade && data.tradePnlUsd == null ? `${animated < 0 ? "-" : "+"}${Math.abs(animated).toFixed(5)}` : `${animated < 0 ? "-" : ""}$${Math.abs(animated) >= 1000 ? compact(Math.abs(animated)) : Math.abs(animated).toFixed(2)}`;
    const chars = [...shown].filter((c) => GLYPHS[c]);
    const cols = Math.max(1, chars.length * 6 - 1), cell = Math.min(compactLayout ? 0.14 : 0.27, (compactLayout ? 4.5 : 6.4) / cols);
    counterHalfW = (cols * cell) / 2;
    const top = counterCenterY + (7 * cell) / 2;
    let n = 0;
    chars.forEach((c, ci) => GLYPHS[c].forEach((row, ry) => [...row].forEach((v, rx) => {
      if (v !== "X" || n >= MAX_CELLS) return;
      const gx = ci * 6 + rx, x = (gx - (cols - 1) / 2) * cell, y = top - (ry + 0.5) * cell;
      const shimmer = 0.9 + 0.1 * Math.sin(t * 3.2 - gx * 0.35), grow = ease(seg(p, 0.05 + gx * 0.004, 0.3));
      const s = cell * 0.82 * shimmer * grow;
      ps.set(x + counterCenterX, y, 0.2); sc.set(s, s, s * 1.1); m4.compose(ps, q, sc); cubes.setMatrixAt(n, m4);
      const gs = cell * 2.4 * grow; sc.set(gs, gs, 1); ps.set(x + counterCenterX, y, 0.45); m4.compose(ps, q, sc); cubeGlow.setMatrixAt(n, m4);
      n++;
    })));
    cubes.count = n; cubeGlow.count = n; cubes.instanceMatrix.needsUpdate = true; cubeGlow.instanceMatrix.needsUpdate = true;
  };

  const update: CalloutScene["update"] = (t, p, pointer) => {
    motif.update(t);
    redrawHud(p);
    const negative = data.metric === "trade" && (data.tradePnlUsd ?? data.onchainTrade?.pnlSol ?? 0) < 0;
    const counterColor = negative ? "#fb7185" : calloutTheme(data.theme).accent;
    cubeMat.color.set(counterColor); cubeMat.emissive.set(counterColor); glowMat.color.set(counterColor);
    artwork.position.x = Math.sin(t * 0.12) * 0.16 + pointer.x * 0.1;
    artwork.position.y = Math.cos(t * 0.1) * 0.08;
    artwork.rotation.z = Math.sin(t * 0.08) * 0.008;
    rig.rotation.y += (pointer.x * 0.06 - rig.rotation.y) * 0.06; rig.rotation.x += (-pointer.y * 0.04 - rig.rotation.x) * 0.06;
    haze.position.x = Math.cos(t * 0.5) * 2.2; haze.position.y = Math.sin(t * 1.0) * 0.4;
    setCounter(t, p);
    bubbles.forEach(({ b, g, pulse, face, logoFace, ring, halo, mat }) => {
      const bare = !!data.unselectedPreview;
      face.visible = !bare;
      logoFace.visible = bare && b.slot !== null && !!mat.map;
      ring.visible = halo.visible = !bare;
      if (pulse) pulse.visible = !bare;
      mat.opacity = bare ? 1 : compactLayout ? b.slot === "lead" ? 0.3 : 0.12 : b.slot === null ? 0.08 : 1;
      const e = ease(seg(p, b.delay, 0.3)), ph = Math.PI * 2 * (b.k * t * 0.12 + b.ph);
      g.position.set(b.x + b.amp * 0.55 * Math.cos(ph), b.y + b.amp * Math.sin(ph) - (1 - e) * 0.45, b.z);
      g.scale.setScalar(0.5 + 0.5 * e); g.visible = e > 0.01 && (!bare || b.slot !== null);
      if (pulse) { pulse.scale.setScalar(1 + 0.06 * Math.sin(t * 4)); (pulse.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.12 * Math.sin(t * 4); }
    });
    packets.forEach((pk, n) => {
      const src = bubbles[pk.i].g.position, side = src.x < 0 ? -1 : 1;
      const tx = counterCenterX + side * (counterHalfW + 0.5), ty = counterCenterY, cx = (src.x + tx) / 2, cy = Math.max(src.y, ty) + 1.2;
      const u = (0.34 * t + (n % 4) * 0.19 + pk.i * 0.07) % 1, v = Math.max(0, u - pk.k * 0.035), m = 1 - v;
      pk.mesh.position.set(m * m * src.x + 2 * m * v * cx + v * v * tx, m * m * src.y + 2 * m * v * cy + v * v * ty, 0.8);
      (pk.mesh.material as THREE.MeshBasicMaterial).opacity = seg(p, 0.35, 0.15) * Math.sin(Math.PI * v) * (0.9 - pk.k * 0.2);
    });
    for (let i = 0; i < DUST; i++) { const k = i * 3; const height = H + 0.8; const y = ((dBase[k + 1] + H / 2 + 0.4 + dVel[i] * t) % height + height) % height - H / 2 - 0.4; dPos[k + 1] = y; dPos[k] = dBase[k] + Math.sin(t * 0.4 + i) * 0.06; }
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
