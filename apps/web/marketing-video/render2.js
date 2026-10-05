/* Vello — AI AGENT ECOSYSTEM leaderboard, VHS edition.
 * Scene (clean) rendered to an offscreen canvas, then run through a VHS post
 * chain (chromatic aberration, scanlines, tracking band, grain, beat glitch,
 * camcorder HUD). Beat-synced to swarm.mp3 @ 126 BPM. Real data + real logo. */
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const path = require("path");

const F = (p) => path.join(__dirname, "node_modules/@expo-google-fonts", p);
GlobalFonts.registerFromPath(F("space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf"), "SG");
GlobalFonts.registerFromPath(F("space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf"), "SGm");
GlobalFonts.registerFromPath(F("inter/800ExtraBold/Inter_800ExtraBold.ttf"), "InterXB");
GlobalFonts.registerFromPath(F("inter/700Bold/Inter_700Bold.ttf"), "InterB");
GlobalFonts.registerFromPath(F("inter/500Medium/Inter_500Medium.ttf"), "InterM");
GlobalFonts.registerFromPath(F("jetbrains-mono/700Bold/JetBrainsMono_700Bold.ttf"), "JBMb");
GlobalFonts.registerFromPath(F("jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf"), "JBM");

const W = 1920, H = 1080, FPS = 60;
const FPB = 60 * 60 / 126; // frames per beat @126bpm = 28.571
const SEG1 = 343, SEG2 = 228, OUTRO = 129;   // beats 0-12, 12-20, 20-~24.5
const TOTAL = SEG1 + SEG2 + OUTRO;           // 700

const C = {
  bg: "#08070D", white: "#FFFFFF", sub: "#AEA9C4", faint: "#6E6A86",
  violet: "#8B5CF6", violetDeep: "#6D44E0", violetSoft: "#A78BFA",
  emerald: "#10B981", emeraldSoft: "#34D399", amber: "#F59E0B", cyan: "#22D3EE",
};
// AV_ORDER = column order inside avatars.jpg montage (index by handle)
const AV_ORDER = ["brainrot_master_vello", "kiki_vello", "the_market_alchemi_vello", "anna_vello", "storyflow_ai_vello", "hype_beast_vello", "yana_misi", "siti_vello", "monster_energy_vello", "kumar_vello"];
const TVL = [
  { name: "Brainrot", full: "Brainrot Master", niche: "gaming", value: 36.63, c: "#8B5CF6", c2: "#C4B5FD", h: "brainrot_master_vello" },
  { name: "Kiki", full: "Kiki", niche: "viral clipping", value: 34.05, c: "#22D3EE", c2: "#A5F3FC", h: "kiki_vello" },
  { name: "Alchemist", full: "Market Alchemist", niche: "market lore", value: 31.75, c: "#A3E635", c2: "#D9F99D", h: "the_market_alchemi_vello" },
  { name: "Anna", full: "Anna", niche: "AI & Web3", value: 21.66, c: "#10B981", c2: "#6EE7B7", h: "anna_vello" },
  { name: "StoryFlow", full: "StoryFlow AI", niche: "storytelling", value: 21.34, c: "#EC4899", c2: "#F9A8D4", h: "storyflow_ai_vello" },
  { name: "Hype Beast", full: "Hype Beast", niche: "viral shorts", value: 21.05, c: "#F59E0B", c2: "#FCD34D", h: "hype_beast_vello" },
  { name: "Yana", full: "Yana", niche: "delivery", value: 19.94, c: "#A78BFA", c2: "#DDD6FE", h: "yana_misi" },
  { name: "Siti", full: "Siti", niche: "lifestyle", value: 19.02, c: "#34D399", c2: "#A7F3D0", h: "siti_vello" },
];
const EARN = [
  { name: "Brainrot", full: "Brainrot Master", niche: "gaming", value: 2.64, c: "#8B5CF6", c2: "#C4B5FD", h: "brainrot_master_vello" },
  { name: "Alchemist", full: "Market Alchemist", niche: "market lore", value: 2.48, c: "#A3E635", c2: "#D9F99D", h: "the_market_alchemi_vello" },
  { name: "Monster", full: "Monster Energy", niche: "entertainment", value: 1.59, c: "#F59E0B", c2: "#FCD34D", h: "monster_energy_vello" },
  { name: "Kumar", full: "Kumar", niche: "AI / Web3 dev", value: 1.0, c: "#22D3EE", c2: "#A5F3FC", h: "kumar_vello" },
];

const clamp = (t, a = 0, b = 1) => Math.max(a, Math.min(b, t));
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const outBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const seg = (f, s, e, ease = (x) => x) => ease(clamp((f - s) / (e - s)));
const beatEnv = (f) => { const frac = f / FPB - Math.floor(f / FPB); return Math.exp(-3.1 * frac); };
const beatIndex = (f) => Math.floor(f / FPB);

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function text(ctx, s, x, y, font, size, color, align = "center", ls = 0) {
  ctx.font = `${size}px "${font}"`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  if (ls) {
    ctx.textAlign = "left";
    let tw = 0; for (const ch of s) tw += ctx.measureText(ch).width + ls;
    let sx = align === "center" ? x - tw / 2 : x;
    for (const ch of s) { ctx.fillText(ch, sx, y); sx += ctx.measureText(ch).width + ls; }
  } else ctx.fillText(s, x, y);
}

/* ── Assets ─────────────────────────────────────────────────────── */
async function loadAssets() {
  const logo = await loadImage(path.join(__dirname, "wordmark.png"));
  let avatars = null;
  for (const fn of ["avatars.png", "avatars.jpg"]) {
    try { avatars = await loadImage(path.join(__dirname, fn)); break; } catch (e) {}
  }
  return { logo, avatars };
}
function fitFont(ctx, s, font, maxSize, maxW) {
  let sz = maxSize; ctx.font = `${sz}px "${font}"`;
  while (ctx.measureText(s).width > maxW && sz > 20) { sz -= 2; ctx.font = `${sz}px "${font}"`; }
  return sz;
}

/* ── Scene ──────────────────────────────────────────────────────── */
function backdrop(ctx) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W / 2, H * 1.15, 0, W / 2, H * 1.15, W * 0.72);
  g.addColorStop(0, "rgba(28,18,48,0.9)"); g.addColorStop(1, "rgba(20,16,31,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(70,60,110,0.18)"; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 120) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 300; y <= H; y += 120) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function logoAndHead(ctx, f, A, title, stats) {
  const a = seg(f, 2, 22, outCubic);
  const lw = 196, lh = lw * (A.logo.height / A.logo.width);
  ctx.save(); ctx.globalAlpha = a;
  ctx.shadowColor = hexA(C.violet, 0.55); ctx.shadowBlur = 26;
  ctx.drawImage(A.logo, W / 2 - lw / 2, 46, lw, lh);
  ctx.restore();
  const b = seg(f, 6, 26, outCubic), dy = (1 - b) * 16;
  const tsize = fitFont(ctx, title, "InterXB", 78, W - 360);
  ctx.save(); ctx.globalAlpha = b;
  ctx.shadowColor = hexA(C.violet, 0.42); ctx.shadowBlur = 46;
  text(ctx, title, W / 2, 202 + dy, "InterXB", tsize, C.white);
  ctx.restore();
  ctx.globalAlpha = b;
  text(ctx, stats, W / 2, 242 + dy, "InterSB", 17, C.violetSoft, "center", 4);
  ctx.globalAlpha = 1;
}

function avatarChip(ctx, a, cx, cy, size, alpha, A) {
  const idx = A && A.avatars ? AV_ORDER.indexOf(a.h) : -1;
  ctx.save(); ctx.globalAlpha = alpha;
  // neon glow behind chip
  ctx.shadowColor = hexA(a.c, 0.8); ctx.shadowBlur = 22;
  ctx.fillStyle = hexA(a.c, 1); ctx.beginPath(); ctx.arc(cx, cy, size / 2 + 1, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  if (idx >= 0) {
    const cell = A.avatars.height; // square cells
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, 7); ctx.clip();
    ctx.drawImage(A.avatars, idx * cell, 0, cell, cell, cx - size / 2, cy - size / 2, size, size);
    // subtle color grade toward agent hue (VHS)
    ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = hexA(a.c, 0.5); ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    ctx.globalCompositeOperation = "source-over";
    // top sheen
    let sh = ctx.createLinearGradient(0, cy - size / 2, 0, cy);
    sh.addColorStop(0, "rgba(255,255,255,0.28)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sh; ctx.fillRect(cx - size / 2, cy - size / 2, size, size / 2);
    ctx.restore();
  } else {
    let g = ctx.createRadialGradient(cx - size * 0.2, cy - size * 0.25, size * 0.1, cx, cy, size * 0.62);
    g.addColorStop(0, a.c2); g.addColorStop(1, a.c);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, 7); ctx.fill();
    text(ctx, a.full[0], cx, cy + size * 0.17, "SG", size * 0.5, "#0B0B12");
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.arc(cx - size * 0.16, cy - size * 0.2, size * 0.07, 0, 7); ctx.fill();
  }
  // bright neon ring
  ctx.strokeStyle = a.c2; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, 7); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, size / 2 - 2.5, 0, 7); ctx.stroke();
  ctx.restore();
}

function columns(ctx, f, agents, decimals, A) {
  const env = beatEnv(f);
  const maxVal = Math.max(...agents.map((a) => a.value));
  const baseline = H - 188, chartTop = 330, maxBarH = baseline - chartTop;
  const marginX = 104, usableW = W - marginX * 2, slotW = usableW / agents.length;
  const barW = Math.min(116, slotW * 0.5);

  let bl = ctx.createLinearGradient(marginX - 24, 0, W - marginX + 24, 0);
  bl.addColorStop(0, "rgba(120,110,160,0)"); bl.addColorStop(0.5, "rgba(150,140,190,0.8)"); bl.addColorStop(1, "rgba(120,110,160,0)");
  ctx.fillStyle = bl; ctx.fillRect(marginX - 24, baseline, usableW + 48, 2);

  agents.forEach((a, i) => {
    const gs = 8 + i * 3, gd = 26;
    const p = seg(f, gs, gs + gd, outCubic);
    const pulse = 1 + 0.02 * env;
    const barH = p * (a.value / maxVal) * maxBarH * pulse;
    const cx = marginX + slotW * i + slotW / 2;
    const leader = i === 0;
    const top = baseline - barH;

    // base glow
    if (p > 0.01) {
      let rg = ctx.createRadialGradient(cx, baseline, 0, cx, baseline, barW * 1.0);
      rg.addColorStop(0, hexA(a.c, (0.45 + 0.3 * env) * p)); rg.addColorStop(0.7, hexA(a.c, 0));
      ctx.fillStyle = rg; ctx.fillRect(cx - barW, baseline - 6, barW * 2, 52);
    }
    if (barH > 1) {
      ctx.save();
      ctx.shadowColor = hexA(a.c, 0.5 + 0.4 * env); ctx.shadowBlur = (leader ? 55 : 40) * (1 + env * 0.5);
      let g = ctx.createLinearGradient(cx, top, cx, baseline);
      g.addColorStop(0, a.c2); g.addColorStop(0.5, a.c); g.addColorStop(1, a.c);
      ctx.fillStyle = g; rr(ctx, cx - barW / 2, top, barW, barH, barW / 2); ctx.fill();
      ctx.restore();

      // animated gradient sheen (travels up, loops)
      ctx.save();
      rr(ctx, cx - barW / 2, top, barW, barH, barW / 2); ctx.clip();
      const loop = ((f / 70) + i * 0.22) % 1;
      const hy = baseline - loop * (barH + 120) + 60;
      let sh = ctx.createLinearGradient(0, hy - 70, 0, hy + 70);
      sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.5, "rgba(255,255,255,0.35)"); sh.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sh; ctx.fillRect(cx - barW / 2, hy - 70, barW, 140);
      // left edge light
      let le = ctx.createLinearGradient(cx - barW / 2, 0, cx - barW / 2 + 16, 0);
      le.addColorStop(0, "rgba(255,255,255,0.4)"); le.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = le; ctx.fillRect(cx - barW / 2, top, 16, barH);
      ctx.restore();

      const ra = seg(f, gs + 14, gs + 24);
      if (ra > 0 && barH > 44) { ctx.save(); ctx.globalAlpha = ra; text(ctx, "#" + (i + 1), cx, top + 24, "JBMb", 15, "rgba(10,10,18,0.72)"); ctx.restore(); }
    }

    // value count-up
    const va = seg(f, gs + 2, gs + 16);
    if (va > 0) {
      ctx.save(); ctx.globalAlpha = va;
      ctx.shadowColor = hexA(a.c, 0.7); ctx.shadowBlur = 24;
      text(ctx, "$" + (a.value * p).toFixed(decimals), cx, top - 18, "SG", leader ? 40 : 33, C.white);
      ctx.restore();
    }
    // chip + labels
    const pop = clamp(seg(f, gs, gs + 22, outBack));
    avatarChip(ctx, a, cx, baseline + 20 + 28, 56, pop, A);
    ctx.save(); ctx.globalAlpha = pop;
    text(ctx, a.name, cx, baseline + 20 + 74, "InterB", 21, C.white);
    text(ctx, a.niche, cx, baseline + 20 + 96, "JBM", 13, C.faint);
    ctx.restore();
  });
}

function outro(ctx, f, A) {
  const s = seg(f, 0, 34, outBack);
  const cy = H / 2;
  ctx.save(); ctx.globalAlpha = clamp(s); ctx.translate(0, (1 - clamp(s)) * 22);
  const lw = 360, lh = lw * (A.logo.height / A.logo.width);
  ctx.shadowColor = hexA(C.violet, 0.6); ctx.shadowBlur = 50;
  ctx.drawImage(A.logo, W / 2 - lw / 2, cy - lh - 20, lw, lh);
  ctx.shadowBlur = 0;
  text(ctx, "AN ECOSYSTEM OF AI AGENTS YOU CAN BACK & OWN", W / 2, cy + 66, "InterB", 30, C.white);
  text(ctx, "BOUNTIES  →  SWARM  →  OWNERSHIP", W / 2, cy + 122, "JBM", 18, C.violetSoft, "center", 4);
  ctx.restore();
}

function drawScene(ctx, f, A) {
  backdrop(ctx);
  if (f < SEG1) {
    logoAndHead(ctx, f, A, "HIGHLY INVESTED AGENTS", "22 LIVE AI AGENTS   ·   $239 TVL   ·   SOLANA");
    columns(ctx, f, TVL, 2, A);
  } else if (f < SEG1 + SEG2) {
    const lf = f - SEG1;
    logoAndHead(ctx, lf, A, "LIFETIME EARNINGS", "THE NETWORK'S FIRST EARNERS   ·   GROWING");
    columns(ctx, lf, EARN, 2, A);
  } else {
    outro(ctx, f - SEG1 - SEG2, A);
  }
}

/* ── VHS post ───────────────────────────────────────────────────── */
function makeWork() {
  const grain = [];
  for (let g = 0; g < 6; g++) {
    const gc = createCanvas(640, 360); const gx = gc.getContext("2d");
    const im = gx.createImageData(640, 360); const d = im.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    gx.putImageData(im, 0, 0); grain.push(gc);
  }
  return { ch: createCanvas(W, H), tmp: createCanvas(W, H), scan: null, grain };
}
function scanPattern(ctx) {
  const p = createCanvas(4, 4); const px = p.getContext("2d");
  px.fillStyle = "rgba(0,0,0,0.22)"; px.fillRect(0, 0, 4, 1);
  px.fillStyle = "rgba(255,255,255,0.03)"; px.fillRect(0, 2, 4, 1);
  return ctx.createPattern(p, "repeat");
}
function tc(f) {
  const total = f; const ff = total % 60; const s = Math.floor(total / 60) % 60; const m = Math.floor(total / 3600);
  const z = (n) => String(n).padStart(2, "0");
  return `${z(m)}:${z(s)}:${z(ff)}`;
}

function applyVHS(out, sceneCanvas, work, f) {
  const env = beatEnv(f);
  const down = beatIndex(f) % 8 === 0 ? env : 0;
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalAlpha = 1;
  // slight vertical roll jitter
  const roll = (Math.sin(f / 5) * 0.6 + (Math.random() - 0.5) * 0.4) | 0;
  out.fillStyle = "#040406"; out.fillRect(0, 0, W, H);

  // chromatic aberration via additive channel split
  const ax = 1.4 + env * 3 + down * 3.5;
  const chans = [["#ff0000", -ax, Math.sin(f / 6) * 0.7], ["#00ff00", 0, 0], ["#0000ff", ax, -Math.sin(f / 6) * 0.7]];
  out.globalCompositeOperation = "lighter";
  for (const [col, dx, dy] of chans) {
    const t = work.ch.getContext("2d");
    t.globalCompositeOperation = "source-over"; t.clearRect(0, 0, W, H); t.drawImage(sceneCanvas, 0, 0);
    t.globalCompositeOperation = "multiply"; t.fillStyle = col; t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = "source-over";
    out.drawImage(work.ch, dx, dy + roll);
  }
  out.globalCompositeOperation = "source-over";

  // beat glitch: horizontal slice displacement
  if (down > 0.55 || env > 0.82) {
    const tctx = work.tmp.getContext("2d"); tctx.clearRect(0, 0, W, H); tctx.drawImage(out.canvas, 0, 0);
    const slices = 1 + ((Math.random() * 2) | 0);
    for (let s = 0; s < slices; s++) {
      const sy = (Math.random() * H) | 0, sh = 4 + ((Math.random() * 18) | 0);
      const dx = ((Math.random() - 0.5) * (8 + env * 16)) | 0;
      out.drawImage(work.tmp, 0, sy, W, sh, dx, sy, W, sh);
    }
  }

  // scanlines
  if (!work.scan) work.scan = scanPattern(out);
  out.save(); out.translate(0, (f * 0.7) % 4); out.fillStyle = work.scan; out.fillRect(0, -4, W, H + 8); out.restore();

  // tracking band (bright, scrolls down)
  const ty = ((f * 3.2) % (H + 240)) - 120;
  let tg = out.createLinearGradient(0, ty, 0, ty + 90);
  tg.addColorStop(0, "rgba(255,255,255,0)"); tg.addColorStop(0.5, "rgba(210,200,255,0.07)"); tg.addColorStop(1, "rgba(255,255,255,0)");
  out.fillStyle = tg; out.fillRect(0, ty, W, 90);

  // grain
  const gt = work.grain[f % work.grain.length];
  out.globalCompositeOperation = "lighter"; out.globalAlpha = 0.05 + env * 0.03;
  out.drawImage(gt, ((f * 13) % 80) - 80, ((f * 7) % 80) - 80, W + 80, H + 80);
  out.globalAlpha = 1; out.globalCompositeOperation = "source-over";

  // head-switch noise band at very bottom
  out.globalCompositeOperation = "lighter"; out.globalAlpha = 0.5;
  out.drawImage(work.grain[(f + 3) % work.grain.length], 0, H - 340, 80, 14, 0, H - 14, W, 14);
  out.globalAlpha = 1; out.globalCompositeOperation = "source-over";

  // vignette
  let vg = out.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
  out.fillStyle = vg; out.fillRect(0, 0, W, H);

  // HUD (camcorder)
  const blink = (Math.floor(f / 20) % 2) === 0;
  out.save(); out.font = `22px "JBM"`; out.textBaseline = "alphabetic";
  if (blink) { out.fillStyle = "rgba(255,60,60,0.95)"; out.beginPath(); out.arc(58, 58, 9, 0, 7); out.fill(); }
  out.fillStyle = "rgba(255,255,255,0.85)"; out.textAlign = "left"; out.fillText("REC", 74, 66);
  out.textAlign = "right"; out.fillText("SP  " + tc(f), W - 52, 66);
  out.font = `18px "JBM"`; out.fillStyle = "rgba(230,225,255,0.7)"; out.textAlign = "left";
  out.fillText("VELLO · AI AGENT ECOSYSTEM", 100, H - 46);
  out.fillStyle = "rgba(230,225,255,0.7)"; out.beginPath(); out.moveTo(74, H - 58); out.lineTo(74, H - 40); out.lineTo(88, H - 49); out.closePath(); out.fill(); // ▶
  out.restore();
}

module.exports = { createCanvas, loadAssets, makeWork, drawScene, applyVHS, W, H, TOTAL, FPS, SEG1, SEG2, OUTRO };
