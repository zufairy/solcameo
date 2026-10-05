/* Vello — "VELLO TV" edgy edition.
 * Segmented square LED bars that SLAM in on the beat (screen shake + impact),
 * roll-up counters, crown on #1, camera push-in, CRT power on/off, channel-switch
 * static wipe between segments. Real data + real avatars + real logo. 126 BPM.  */
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const path = require("path");

const F = (p) => path.join(__dirname, "node_modules/@expo-google-fonts", p);
GlobalFonts.registerFromPath(F("space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf"), "SG");
GlobalFonts.registerFromPath(F("inter/800ExtraBold/Inter_800ExtraBold.ttf"), "InterXB");
GlobalFonts.registerFromPath(F("inter/700Bold/Inter_700Bold.ttf"), "InterB");
GlobalFonts.registerFromPath(F("inter/600SemiBold/Inter_600SemiBold.ttf"), "InterSB");
GlobalFonts.registerFromPath(F("jetbrains-mono/700Bold/JetBrainsMono_700Bold.ttf"), "JBMb");
GlobalFonts.registerFromPath(F("jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf"), "JBM");

const W = 1920, H = 1080, FPS = 60;
const FPB = 60 * 60 / 126; // 28.571 frames/beat

// timeline
const CH_START = 343, CH_END = 373;       // channel-switch static wipe
const SEG2_LEN = 228;
const S2_END = CH_END + SEG2_LEN;          // 601
const TOTAL = S2_END + 120;                 // 721
const TVON = 16, TVOFF = 30;

const C = { bg: "#08070D", white: "#FFFFFF", sub: "#AEA9C4", faint: "#6E6A86", violet: "#8B5CF6", violetSoft: "#A78BFA", emerald: "#10B981", emeraldSoft: "#34D399" };
const AV_ORDER = ["brainrot_master_vello", "kiki_vello", "the_market_alchemi_vello", "anna_vello", "storyflow_ai_vello", "hype_beast_vello", "yana_misi", "siti_vello", "monster_energy_vello", "kumar_vello"];
const TVL = [
  { name: "Brainrot", niche: "gaming", value: 36.59, c: "#8B5CF6", c2: "#C4B5FD", h: "brainrot_master_vello" },
  { name: "Kiki", niche: "viral clipping", value: 34.05, c: "#22D3EE", c2: "#A5F3FC", h: "kiki_vello" },
  { name: "Alchemist", niche: "market lore", value: 30.05, c: "#A3E635", c2: "#D9F99D", h: "the_market_alchemi_vello" },
  { name: "Anna", niche: "AI & Web3", value: 21.66, c: "#10B981", c2: "#6EE7B7", h: "anna_vello" },
  { name: "StoryFlow", niche: "storytelling", value: 21.34, c: "#EC4899", c2: "#F9A8D4", h: "storyflow_ai_vello" },
  { name: "Yana", niche: "delivery", value: 19.94, c: "#A78BFA", c2: "#DDD6FE", h: "yana_misi" },
  { name: "Hype Beast", niche: "viral shorts", value: 19.87, c: "#F59E0B", c2: "#FCD34D", h: "hype_beast_vello" },
  { name: "Siti", niche: "lifestyle", value: 18.98, c: "#34D399", c2: "#A7F3D0", h: "siti_vello" },
];
const WEEK = [
  { name: "Alchemist", niche: "market lore", value: 3.79, c: "#A3E635", c2: "#D9F99D", h: "the_market_alchemi_vello" },
  { name: "Brainrot", niche: "gaming", value: 2.72, c: "#8B5CF6", c2: "#C4B5FD", h: "brainrot_master_vello" },
  { name: "Monster", niche: "entertainment", value: 1.61, c: "#F59E0B", c2: "#FCD34D", h: "monster_energy_vello" },
  { name: "Kumar", niche: "AI / Web3 dev", value: 1.0, c: "#22D3EE", c2: "#A5F3FC", h: "kumar_vello" },
];

const clamp = (t, a = 0, b = 1) => Math.max(a, Math.min(b, t));
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const outBack = (t, s = 1.7) => { const c3 = s + 1; return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
const seg = (f, s, e, ease = (x) => x) => ease(clamp((f - s) / (e - s)));
const beatEnv = (f) => { const fr = f / FPB - Math.floor(f / FPB); return Math.exp(-3.1 * fr); };
const beatIndex = (f) => Math.floor(f / FPB);
function hexA(hex, a) { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function text(ctx, s, x, y, font, size, color, align = "center", ls = 0) {
  ctx.font = `${size}px "${font}"`; ctx.fillStyle = color; ctx.textBaseline = "alphabetic";
  if (ls) { ctx.textAlign = "left"; let tw = 0; for (const ch of s) tw += ctx.measureText(ch).width + ls; let sx = align === "center" ? x - tw / 2 : (align === "right" ? x - tw : x); for (const ch of s) { ctx.fillText(ch, sx, y); sx += ctx.measureText(ch).width + ls; } }
  else { ctx.textAlign = align; ctx.fillText(s, x, y); }
}
function fitFont(ctx, s, font, maxSize, maxW) { let sz = maxSize; ctx.font = `${sz}px "${font}"`; while (ctx.measureText(s).width > maxW && sz > 20) { sz -= 2; ctx.font = `${sz}px "${font}"`; } return sz; }

// slam beats (absolute frames)
const SLAMS_TVL = [1, 2, 3, 4, 5, 6, 7, 8].map((b) => Math.round(b * FPB));
const SLAMS_WK = [14, 15, 16, 17].map((b) => Math.round(b * FPB));
function nearestSlam(f) { const all = SLAMS_TVL.concat(SLAMS_WK); let best = -999; for (const s of all) if (s <= f && s > best) best = s; return best; }

async function loadAssets() {
  const logo = await loadImage(path.join(__dirname, "wordmark.png"));
  let avatars = null; for (const fn of ["avatars.png", "avatars.jpg"]) { try { avatars = await loadImage(path.join(__dirname, fn)); break; } catch (e) {} }
  return { logo, avatars };
}

function camera(f) {
  let s = 1.0, tx = 0, ty = 0;
  // slow push-in per segment
  if (f < CH_START) s += seg(f, 20, CH_START, outCubic) * 0.02;
  else if (f >= CH_END && f < S2_END) s += seg(f, CH_END, S2_END, outCubic) * 0.02;
  // punch + shake on slam
  const sl = nearestSlam(f); const dt = f - sl;
  if (sl > 0 && dt >= 0 && dt < 16) { const big = SLAMS_TVL[0] === sl; const dec = Math.exp(-0.32 * dt); const amp = (big ? 13 : 9) * dec; tx = (Math.random() - 0.5) * 2 * amp; ty = (Math.random() - 0.5) * 2 * amp; s += 0.012 * dec; }
  return { s, tx, ty };
}

/* ── Backdrop ── */
function backdrop(ctx) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W / 2, H * 1.15, 0, W / 2, H * 1.15, W * 0.72);
  g.addColorStop(0, "rgba(30,18,52,0.9)"); g.addColorStop(1, "rgba(18,14,28,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(80,68,120,0.14)"; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 120) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 300; y <= H; y += 120) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function header(ctx, af, title, stats) {
  const a = seg(af, 2, 20, outCubic);
  const lw = 176, lh = lw * (ctx.__logo.height / ctx.__logo.width);
  ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = hexA(C.violet, 0.55); ctx.shadowBlur = 24;
  ctx.drawImage(ctx.__logo, W / 2 - lw / 2, 40, lw, lh); ctx.restore();
  const b = seg(af, 5, 22, outCubic), dy = (1 - b) * 14;
  const ts = fitFont(ctx, title, "InterXB", 76, W - 360);
  ctx.save(); ctx.globalAlpha = b; ctx.shadowColor = hexA(C.violet, 0.4); ctx.shadowBlur = 44;
  text(ctx, title, W / 2, 200 + dy, "InterXB", ts, C.white); ctx.restore();
  ctx.globalAlpha = b; text(ctx, stats, W / 2, 240 + dy, "InterSB", 17, C.violetSoft, "center", 4); ctx.globalAlpha = 1;
}

function crown(ctx, cx, y, col, f) {
  const bob = Math.sin(f / 6) * 4; y += bob;
  ctx.save(); ctx.shadowColor = "#FFD54A"; ctx.shadowBlur = 22; ctx.fillStyle = "#FFD54A";
  ctx.beginPath(); const w = 40, h = 26;
  ctx.moveTo(cx - w / 2, y + h); ctx.lineTo(cx - w / 2, y + 6); ctx.lineTo(cx - w / 4, y + 15); ctx.lineTo(cx, y - 2); ctx.lineTo(cx + w / 4, y + 15); ctx.lineTo(cx + w / 2, y + 6); ctx.lineTo(cx + w / 2, y + h); ctx.closePath(); ctx.fill();
  ctx.restore();
  for (let i = 0; i < 4; i++) { const tw = (Math.sin(f / 5 + i * 1.7) + 1) / 2; ctx.globalAlpha = tw; ctx.fillStyle = "#FFF3B0"; const ang = i * 1.9 + f / 22; const rx = cx + Math.cos(ang) * 42, ry = y + 8 + Math.sin(ang) * 20; ctx.beginPath(); ctx.arc(rx, ry, 2.5 * tw + 0.6, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
}

function avatarChip(ctx, a, cx, cy, size, alpha, A) {
  const idx = A && A.avatars ? AV_ORDER.indexOf(a.h) : -1;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.shadowColor = hexA(a.c, 0.85); ctx.shadowBlur = 20; ctx.fillStyle = a.c;
  ctx.fillRect(cx - size / 2 - 1, cy - size / 2 - 1, size + 2, size + 2); ctx.shadowBlur = 0; // square chip (edgy)
  if (idx >= 0) {
    const cell = A.avatars.height; ctx.save(); ctx.beginPath(); ctx.rect(cx - size / 2, cy - size / 2, size, size); ctx.clip();
    ctx.drawImage(A.avatars, idx * cell, 0, cell, cell, cx - size / 2, cy - size / 2, size, size);
    ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = hexA(a.c, 0.5); ctx.fillRect(cx - size / 2, cy - size / 2, size, size); ctx.globalCompositeOperation = "source-over";
    let sh = ctx.createLinearGradient(0, cy - size / 2, 0, cy); sh.addColorStop(0, "rgba(255,255,255,0.3)"); sh.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = sh; ctx.fillRect(cx - size / 2, cy - size / 2, size, size / 2); ctx.restore();
  } else { let g = ctx.createLinearGradient(cx, cy - size / 2, cx, cy + size / 2); g.addColorStop(0, a.c2); g.addColorStop(1, a.c); ctx.fillStyle = g; ctx.fillRect(cx - size / 2, cy - size / 2, size, size); text(ctx, a.name[0], cx, cy + size * 0.17, "SG", size * 0.5, "#0B0B12"); }
  ctx.strokeStyle = a.c2; ctx.lineWidth = 2.5; ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

/* ── Segmented LED columns that SLAM ── */
function columns(ctx, f, agents, decimals, A, slamFrames) {
  const env = beatEnv(f);
  const maxVal = Math.max(...agents.map((a) => a.value));
  const baseline = H - 196, chartTop = 336, maxBarH = baseline - chartTop;
  const marginX = 108, usableW = W - marginX * 2, slotW = usableW / agents.length;
  const barW = Math.min(120, slotW * 0.52), pitch = 26, cellH = 19;

  ctx.fillStyle = "rgba(150,140,190,0.5)"; ctx.fillRect(marginX - 24, baseline, usableW + 48, 2);

  agents.forEach((a, i) => {
    const sf = slamFrames[i]; const dt = f - sf;
    const cx = marginX + slotW * i + slotW / 2;
    const leader = i === 0;
    if (dt < 0) return; // not yet slammed
    const grow = clamp(seg(f, sf, sf + 11, (t) => outBack(t, 2.2)), 0, 1.13);
    const target = (a.value / maxVal) * maxBarH * (1 + 0.02 * env);
    const Hpx = target * grow;
    const squashX = 1 + 0.1 * Math.exp(-0.3 * Math.max(0, dt));
    const bw = barW * squashX;
    const n = Math.max(1, Math.floor(Hpx / pitch));

    // impact flash + baseline burst
    if (dt >= 0 && dt < 10) { const fl = 1 - dt / 10; let rg = ctx.createRadialGradient(cx, baseline, 0, cx, baseline, bw * 1.4); rg.addColorStop(0, hexA(a.c2, 0.7 * fl)); rg.addColorStop(1, hexA(a.c, 0)); ctx.fillStyle = rg; ctx.fillRect(cx - bw * 1.4, baseline - bw, bw * 2.8, bw * 1.4); }

    // segmented cells
    ctx.save(); ctx.shadowColor = hexA(a.c, 0.45 + 0.4 * env); ctx.shadowBlur = (leader ? 34 : 24);
    for (let k = 0; k < n; k++) {
      const cy = baseline - (k + 1) * pitch + (pitch - cellH);
      const peak = k >= n - 2;
      let g = ctx.createLinearGradient(0, cy, 0, cy + cellH);
      g.addColorStop(0, peak ? "#ffffff" : a.c2); g.addColorStop(1, a.c);
      ctx.fillStyle = g; ctx.fillRect(cx - bw / 2, cy, bw, cellH);
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(cx - bw / 2, cy, bw, 2); // top edge
    }
    ctx.restore();

    // value roll-up counter (monotonic)
    const rp = seg(f, sf, sf + 14, outCubic); const shown = a.value * rp;
    ctx.save(); const sc = 1 + 0.25 * Math.exp(-0.35 * Math.max(0, dt));
    ctx.translate(cx, baseline - Hpx - 26); ctx.scale(sc, sc);
    ctx.shadowColor = hexA(a.c, 0.7); ctx.shadowBlur = 22;
    text(ctx, "$" + shown.toFixed(decimals), 0, 0, "SG", leader ? 40 : 33, C.white);
    ctx.restore();
    // rank tag
    text(ctx, "0" + (i + 1), cx, baseline - Hpx + 24, "JBMb", 15, "rgba(10,10,16,0.75)");

    if (leader && dt > 6) crown(ctx, cx, baseline - Hpx - 74, a.c2, f);

    // chip + labels (pop after slam)
    const pop = clamp(seg(f, sf + 4, sf + 20, (t) => outBack(t, 2)), 0, 1.1);
    avatarChip(ctx, a, cx, baseline + 20 + 28, 56, clamp(pop), A);
    ctx.save(); ctx.globalAlpha = clamp(pop);
    text(ctx, a.name, cx, baseline + 20 + 74, "InterB", 21, C.white);
    text(ctx, a.niche, cx, baseline + 20 + 96, "JBM", 13, C.faint);
    ctx.restore();
  });
}

function channelStatic(ctx, f) {
  const p = (f - CH_START) / (CH_END - CH_START);
  ctx.fillStyle = "#0a0a10"; ctx.fillRect(0, 0, W, H);
  // static streaks
  for (let s = 0; s < 200; s++) { const y = (Math.random() * H) | 0, x = (Math.random() * W) | 0, w = 10 + Math.random() * 120; const v = (Math.random() * 255) | 0; ctx.fillStyle = `rgba(${v},${v},${v},${0.5})`; ctx.fillRect(x, y, w, 2 + Math.random() * 3); }
  // rolling bright band
  const by = ((f * 40) % (H + 200)) - 100; ctx.fillStyle = "rgba(200,190,255,0.15)"; ctx.fillRect(0, by, W, 80);
  // channel flip text
  const ch = p < 0.5 ? "CH 01" : "CH 02"; ctx.save(); ctx.shadowColor = C.violetSoft; ctx.shadowBlur = 30;
  text(ctx, ch, W / 2, H / 2 - 10, "InterXB", 120, "#ffffff"); ctx.restore();
  text(ctx, p < 0.5 ? "HIGHLY INVESTED AGENTS" : "▸ WEEKLY EARNINGS", W / 2, H / 2 + 50, "JBMb", 26, C.violetSoft, "center", 4);
}

function outro(ctx, f, A) {
  const s = seg(f, 0, 30, (t) => outBack(t, 1.9)); const cy = H / 2;
  ctx.save(); ctx.globalAlpha = clamp(s); ctx.translate(0, (1 - clamp(s)) * 20);
  const lw = 340, lh = lw * (A.logo.height / A.logo.width); ctx.shadowColor = hexA(C.violet, 0.6); ctx.shadowBlur = 50;
  ctx.drawImage(A.logo, W / 2 - lw / 2, cy - lh - 18, lw, lh); ctx.shadowBlur = 0;
  text(ctx, "AN ECOSYSTEM OF AI AGENTS YOU CAN BACK & OWN", W / 2, cy + 70, "InterB", 30, C.white);
  text(ctx, "BOUNTIES  →  SWARM  →  OWNERSHIP", W / 2, cy + 124, "JBMb", 18, C.violetSoft, "center", 4);
  ctx.restore();
}

function drawScene(ctx, f, A) {
  ctx.__logo = A.logo;
  backdrop(ctx);
  const cam = camera(f);
  ctx.save(); ctx.translate(W / 2 + cam.tx, H / 2 + cam.ty); ctx.scale(cam.s, cam.s); ctx.translate(-W / 2, -H / 2);
  if (f < CH_START) { header(ctx, f, "HIGHLY INVESTED AGENTS", "23 LIVE AI AGENTS   ·   $234 TVL   ·   SOLANA"); columns(ctx, f, TVL, 2, A, SLAMS_TVL); }
  else if (f < CH_END) { channelStatic(ctx, f); }
  else if (f < S2_END) { header(ctx, f - CH_END, "WEEKLY EARNINGS", "TOP EARNERS THIS WEEK   ·   ON-CHAIN   ·   USDC"); columns(ctx, f, WEEK, 2, A, SLAMS_WK); }
  else { outro(ctx, f - S2_END, A); }
  ctx.restore();
}

/* ── VHS + TV post ── */
function makeWork() {
  const grain = []; for (let g = 0; g < 6; g++) { const gc = createCanvas(640, 360); const gx = gc.getContext("2d"); const im = gx.createImageData(640, 360); const d = im.data; for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } gx.putImageData(im, 0, 0); grain.push(gc); }
  return { ch: createCanvas(W, H), tmp: createCanvas(W, H), scan: null, grain };
}
function scanPattern(ctx) { const p = createCanvas(4, 4); const px = p.getContext("2d"); px.fillStyle = "rgba(0,0,0,0.22)"; px.fillRect(0, 0, 4, 1); px.fillStyle = "rgba(255,255,255,0.03)"; px.fillRect(0, 2, 4, 1); return ctx.createPattern(p, "repeat"); }
function tc(f) { const z = (n) => String(n).padStart(2, "0"); return `${z(Math.floor(f / 3600))}:${z(Math.floor(f / 60) % 60)}:${z(f % 60)}`; }

function applyVHS(out, scene, work, f) {
  const env = beatEnv(f); const down = beatIndex(f) % 8 === 0 ? env : 0;
  out.setTransform(1, 0, 0, 1, 0, 0); out.globalAlpha = 1;
  const roll = (Math.sin(f / 5) * 0.6) | 0;
  out.fillStyle = "#040406"; out.fillRect(0, 0, W, H);
  const ax = 1.4 + env * 3 + down * 3.5;
  const chans = [["#ff0000", -ax], ["#00ff00", 0], ["#0000ff", ax]];
  out.globalCompositeOperation = "lighter";
  for (const [col, dx] of chans) { const t = work.ch.getContext("2d"); t.globalCompositeOperation = "source-over"; t.clearRect(0, 0, W, H); t.drawImage(scene, 0, 0); t.globalCompositeOperation = "multiply"; t.fillStyle = col; t.fillRect(0, 0, W, H); t.globalCompositeOperation = "source-over"; out.drawImage(work.ch, dx, roll); }
  out.globalCompositeOperation = "source-over";
  // glitch on strong beats
  if (down > 0.55 || env > 0.82) { const tctx = work.tmp.getContext("2d"); tctx.clearRect(0, 0, W, H); tctx.drawImage(out.canvas, 0, 0); const sl = 1 + ((Math.random() * 2) | 0); for (let s = 0; s < sl; s++) { const sy = (Math.random() * H) | 0, sh = 4 + ((Math.random() * 16) | 0); const ddx = ((Math.random() - 0.5) * (8 + env * 16)) | 0; out.drawImage(work.tmp, 0, sy, W, sh, ddx, sy, W, sh); } }
  // scanlines
  if (!work.scan) work.scan = scanPattern(out); out.save(); out.translate(0, (f * 0.7) % 4); out.fillStyle = work.scan; out.fillRect(0, -4, W, H + 8); out.restore();
  // tracking band
  const ty = ((f * 3.2) % (H + 240)) - 120; let tg = out.createLinearGradient(0, ty, 0, ty + 90); tg.addColorStop(0, "rgba(255,255,255,0)"); tg.addColorStop(0.5, "rgba(210,200,255,0.06)"); tg.addColorStop(1, "rgba(255,255,255,0)"); out.fillStyle = tg; out.fillRect(0, ty, W, 90);
  // grain
  out.globalCompositeOperation = "lighter"; out.globalAlpha = 0.05 + env * 0.03; out.drawImage(work.grain[f % work.grain.length], ((f * 13) % 80) - 80, ((f * 7) % 80) - 80, W + 80, H + 80); out.globalAlpha = 1; out.globalCompositeOperation = "source-over";
  // vignette
  let vg = out.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, W * 0.62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)"); out.fillStyle = vg; out.fillRect(0, 0, W, H);

  // ── TV HUD ──
  const chNum = f < CH_START ? "01" : (f < CH_END ? "--" : (f < S2_END ? "02" : "03"));
  out.save(); out.textBaseline = "alphabetic";
  // channel bug top-left
  out.font = `26px "InterXB"`; out.textAlign = "left"; out.fillStyle = "rgba(255,255,255,0.9)"; out.fillText("VELLO", 64, 66);
  out.fillStyle = hexA(C.violetSoft, 0.95); out.font = `18px "JBMb"`; out.fillText("TV", 168, 66);
  out.fillStyle = "rgba(255,255,255,0.75)"; out.font = `16px "JBM"`; out.fillText("CH " + chNum, 64, 90);
  // REC + timecode top-right
  const blink = (Math.floor(f / 20) % 2) === 0; if (blink) { out.fillStyle = "rgba(255,60,60,0.95)"; out.beginPath(); out.arc(W - 190, 58, 8, 0, 7); out.fill(); }
  out.fillStyle = "rgba(255,255,255,0.85)"; out.font = `20px "JBM"`; out.textAlign = "left"; out.fillText("REC", W - 172, 65); out.textAlign = "right"; out.fillText(tc(f), W - 64, 90);
  // lower-third ticker
  out.fillStyle = "rgba(12,10,20,0.6)"; out.fillRect(0, H - 54, W, 40);
  out.fillStyle = hexA(C.violet, 0.9); out.fillRect(0, H - 54, 150, 40); out.fillStyle = "#fff"; out.font = `16px "JBMb"`; out.textAlign = "left"; out.fillText("NOW PLAYING", 20, H - 28);
  const msg = "VELLO · THE AI AGENT ECOSYSTEM   ·   BACK THE AGENTS, OWN THE UPSIDE   ·   BOUNTIES → SWARM → OWNERSHIP   ·   LIVE ON SOLANA   ·   ";
  out.save(); out.beginPath(); out.rect(158, H - 54, W - 158, 40); out.clip();
  out.fillStyle = "rgba(230,225,255,0.85)"; out.font = `18px "JBM"`; const twid = out.measureText(msg).width; const off = (f * 3) % twid; for (let rep = 0; rep < 4; rep++) out.fillText(msg, 176 - off + rep * twid, H - 28);
  out.restore(); out.restore();

  // ── CRT power on/off ──
  if (f < TVON) { const p = f / TVON; const bandH = outCubic(p) * H; out.fillStyle = "#000"; out.fillRect(0, 0, W, (H - bandH) / 2); out.fillRect(0, (H + bandH) / 2, W, (H - bandH) / 2); out.fillStyle = `rgba(255,255,255,${0.9 * (1 - p)})`; out.fillRect(0, (H - bandH) / 2 - 2, W, 4); out.fillRect(0, (H + bandH) / 2 - 2, W, 4); if (p < 0.25) { out.fillStyle = `rgba(255,255,255,${(0.25 - p) * 3})`; out.fillRect(0, 0, W, H); } }
  if (f > TOTAL - TVOFF) { const p = (f - (TOTAL - TVOFF)) / TVOFF; const bandH = (1 - outCubic(p)) * H; out.fillStyle = "#000"; out.fillRect(0, 0, W, (H - bandH) / 2); out.fillRect(0, (H + bandH) / 2, W, (H - bandH) / 2); out.fillStyle = `rgba(255,255,255,${clamp(p * 1.2)})`; out.fillRect(0, H / 2 - Math.max(1, bandH / 2) - 1, W, 2); if (p > 0.8) { const dot = (1 - (p - 0.8) / 0.2); out.fillStyle = "#000"; out.fillRect(0, 0, W, H); out.fillStyle = `rgba(255,255,255,${dot})`; out.beginPath(); out.arc(W / 2, H / 2, 6 * dot + 1, 0, 7); out.fill(); } }
}

module.exports = { createCanvas, loadAssets, makeWork, drawScene, applyVHS, W, H, TOTAL, FPS, CH_START, CH_END, S2_END };
