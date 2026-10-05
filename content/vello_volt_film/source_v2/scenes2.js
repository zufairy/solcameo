// ───────────────────────── VELLO // VOLT v2 — shots ─────────────────────────
// helpers reused from scenes.js: P, mapDots, keyInterp, drawCursor, pxRing, hexPath, NODES, NODE_LBL, v3, proj, globe, OPER, BRIEF/CUR/CAM (CUR, CAM reused)
const jcrop = (cx, z = 1) => { const w = 0.316 / z, h = 1 / z; return [clamp(cx - w / 2, 0, 1 - w), (1 - h) / 2, w, h]; };
const JD = { A: 0.4, B: 5.2, C: 17.6, D: 28.2, E: 32.5 };
const MK = [ // markets for native edits / globe
  { c: 'SEOUL', cc: 'KR', lang: 'KO', lon: 127, lat: 37.5 },
  { c: 'TOKYO', cc: 'JP', lang: 'JA', lon: 139.7, lat: 35.7 },
  { c: 'SÃO PAULO', cc: 'BR', lang: 'PT', lon: -46.6, lat: -23.5 },
  { c: 'DUBAI', cc: 'AE', lang: 'AR', lon: 55.3, lat: 25.2 },
  { c: 'MUMBAI', cc: 'IN', lang: 'HI', lon: 72.9, lat: 19.1 },
  { c: 'MEXICO CITY', cc: 'MX', lang: 'ES', lon: -99.1, lat: 19.4 },
  { c: 'NEW YORK', cc: 'US', lang: 'EN', lon: -74, lat: 40.7 },
  { c: 'JAKARTA', cc: 'ID', lang: 'ID', lon: 106.8, lat: -6.2 },
  { c: 'LAGOS', cc: 'NG', lang: 'PCM', lon: 3.4, lat: 6.5 },
  { c: 'PARIS', cc: 'FR', lang: 'FR', lon: 2.35, lat: 48.9 },
  { c: 'ISTANBUL', cc: 'TR', lang: 'TR', lon: 29, lat: 41 },
  { c: 'MANILA', cc: 'PH', lang: 'TL', lon: 121, lat: 14.6 },
  { c: 'BERLIN', cc: 'DE', lang: 'DE', lon: 13.4, lat: 52.5 },
  { c: 'BANGKOK', cc: 'TH', lang: 'TH', lon: 100.5, lat: 13.8 },
  { c: 'NAIROBI', cc: 'KE', lang: 'SW', lon: 36.8, lat: -1.3 },
  { c: 'KUALA LUMPUR', cc: 'MY', lang: 'MS', lon: 101.7, lat: 3.1 }];
const KS = { family: 'Archivo' };

// ════════ INTRO — F1 start lights ════════
const LIGHTS2 = [0.62, 1.12, 1.62, 2.12, 2.62];
function I0(u, t) {
  bg(ctx, C.ink);
  const z = 1 + 0.1 * E.inOutCubic(prog(t, 0, 3.2)), rot = lerp(-0.035, 0.0, E.outCubic(prog(t, 0, 3.2)));
  const on = LIGHTS2.filter(x => t >= x).length;
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
  // wet-track floor glow
  const g = ctx.createRadialGradient(W / 2, 720, 20, W / 2, 720, 900); g.addColorStop(0, `rgba(200,255,0,${0.05 * on})`); g.addColorStop(1, 'rgba(200,255,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 300, W, 800);
  const pods = (mirror) => {
    for (let i = 0; i < 5; i++) {
      const x = W / 2 + (i - 2) * 230, y = 210;
      ctx.save(); if (mirror) { ctx.translate(0, 1220); ctx.scale(1, -1); ctx.globalAlpha = 0.16; }
      const pg = ctx.createLinearGradient(0, y, 0, y + 330); pg.addColorStop(0, '#151815'); pg.addColorStop(1, '#070807');
      rrect(ctx, x - 82, y, 164, 330, 22); ctx.fillStyle = pg; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.stroke();
      const lit = t >= LIGHTS2[i], age = t - LIGHTS2[i];
      for (let j = 0; j < 2; j++) {
        const ly = y + 92 + j * 148;
        ctx.beginPath(); ctx.arc(x, ly, 58, 0, 7); ctx.fillStyle = '#030403'; ctx.fill();
        if (lit) {
          const k = age < 0.08 ? 1.6 : 1 + 0.05 * Math.sin(t * 40 + i);
          const gl = ctx.createRadialGradient(x, ly, 4, x, ly, 190 * k); gl.addColorStop(0, 'rgba(200,255,0,0.55)'); gl.addColorStop(0.4, 'rgba(200,255,0,0.12)'); gl.addColorStop(1, 'rgba(200,255,0,0)');
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl; ctx.fillRect(x - 200, ly - 200, 400, 400); ctx.restore();
          // LED matrix
          for (let yy = -48; yy <= 48; yy += 12) for (let xx = -48; xx <= 48; xx += 12) if (xx * xx + yy * yy < 2400) {
            const d = Math.hypot(xx, yy) / 50; ctx.fillStyle = d < 0.35 ? '#FFFFFF' : d < 0.7 ? '#E9FF8A' : C.volt; ctx.beginPath(); ctx.arc(x + xx, ly + yy, 4.6, 0, 7); ctx.fill();
          }
        } else for (let yy = -48; yy <= 48; yy += 12) for (let xx = -48; xx <= 48; xx += 12) if (xx * xx + yy * yy < 2400) { ctx.fillStyle = '#141A0C'; ctx.beginPath(); ctx.arc(x + xx, ly + yy, 4.6, 0, 7); ctx.fill(); }
      }
      ctx.restore();
    }
  };
  ctx.fillStyle = '#0c0f0c'; ctx.fillRect(W / 2 - 640, 170, 1280, 30);
  pods(false); pods(true);
  ctx.restore();
  // kinetic words built light by light
  const w1 = [['ONE', 0], ['BRIEF.', 1]], w2 = [['145', 2], ['COUNTRIES.', 3]];
  const line = (w1, w2, y, t1, t2, s1, s2, col) => {
    const sz = 96, a = layout(ctx, w1 + ' ', sz, {}).width, b2 = layout(ctx, w2, sz, {}).width, x0 = W / 2 - (a + b2) / 2;
    ktext(ctx, w1, x0, y, sz, t - t1, { style: s1, color: col, align: 'left', drift: 0, mask: s1 === 'rise' });
    ktext(ctx, w2, x0 + a, y, sz, t - t2, { style: s2, color: col, align: 'left', drift: 0, mask: s2 === 'rise' });
  };
  line('ONE', 'BRIEF.', 690, LIGHTS2[0], LIGHTS2[1], 'flip', 'rise', C.white);
  line('145', 'COUNTRIES.', 800, LIGHTS2[2], LIGHTS2[3], 'decode', 'flip', C.volt);
  if (t > LIGHTS2[4]) { const a = 0.5 + 0.5 * Math.sin(t * 30); hud(ctx, 'LIGHTS OUT IN 3… 2… 1…', W / 2, 900, { align: 'center', color: `rgba(243,255,227,${a})`, size: 20, ls: 8 }); }
}

// ════════ HOOK ════════
function H0(u) { shot(ctx, 'b31196472', u, { off: 2, speed: 1.8, dark: 0.32, zs: 0.12 }); speedLines(ctx, u, C.white, 24, 3000, 0.18); ktext(ctx, 'EVERY BRAND', W / 2, H / 2, 170, u, { style: 'stretch' }); }
function H1(u) {
  bg(ctx, C.ink); shot(ctx, 'b39904068', u, { off: 3, dark: 0.82 });
  const s = lerp(1.25, 1, E.outExpo(clamp(u / 0.3)));
  vtext(ctx, 'WANTS', W / 2, H / 2, 380 * s, 'b39904068', 3 + u, { zoom: 1.2 });
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(s, s); font(ctx, 380); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(200,255,0,0.8)'; ctx.strokeText('WANTS', 0, 0); ctx.restore();
}
function H2(u) { shot(ctx, 'b18447538', u, { off: 1, dark: 0.3, rot: 0.02 }); ktext(ctx, "THE WORLD'S", W / 2, H / 2, 160, u, { style: 'rise', mask: true }); }
function H3(u) {
  shot(ctx, 'b16001003', u, { off: 2.4, dark: 0.35, zs: 0.1 });
  if (u < 0.16) lightning(ctx, W * 0.7, -30, W * 0.55, H + 30, 77, 3, C.white, 1 - u / 0.16);
  ktext(ctx, 'ATTENTION.', W / 2, H / 2, 210, u, { style: 'scatter', color: C.volt, stagger: 0.018 });
}
function H4(u) { shot(ctx, 'b33637800', u, { off: 2, dark: 0.4, zs: 0.08, rot: -0.015 }); ktext(ctx, 'BUT IT SPEAKS', W / 2, H / 2, 150, u, { style: 'track' }); }
function H5(u) {
  const clips = ['b3088697', 'b9823146', 'b31196475', 'b13866489', 'b18447540', 'b10825391'];
  const i = Math.max(0, Math.floor(u / (BT / 3))), uu = u - i * BT / 3;
  shot(ctx, clips[i % clips.length], uu, { off: 1 + i * 0.4, dark: 0.45 });
  const s = ATTN[i % ATTN.length], sz = fit(ctx, s, 250, 1500);
  ktext(ctx, s, W / 2, H / 2, sz, uu + 0.02, { style: 'decode', color: i % 2 ? C.volt : C.white, stagger: 0.008, dur: 0.08, drift: 0 });
  hud(ctx, `LANG ${String(i * 23 + 7).padStart(3, '0')}/145`, W / 2, 840, { align: 'center', color: C.white, size: 22 });
}
function H6(u) { shot(ctx, 'b38581107', u, { off: 2, dark: 0.55 }); ktext(ctx, '145 LANGUAGES.', W / 2, H / 2 - 20, 150, u, { style: 'flip' }); ktext(ctx, 'ONE FEED. ZERO REACH.', W / 2, H / 2 + 120, 34, u - 0.2, { style: 'track', family: 'Silkscreen', italic: false, weight: 400, color: C.volt, ls: 6 }); }
function H7(u) {
  bg(ctx, C.ink); floor(ctx, u, C.voltK, 0.7, 2.5, 640);
  const w = ktext(ctx, 'ONE BRIEF.', W / 2 - 40, H / 2, 210, u, { style: 'decode', color: C.volt, stagger: 0.02, dur: 0.14 });
  if (u > 0.4) cursorBlock(ctx, W / 2 - 40 + (w || 1300) / 2 + 40, H / 2, 170, u, C.volt);
}

// ════════ SCREEN — operator console (Jadoodoo campaign) ════════
const BRIEF2 = "Clip Jadoodoo's +$40K $NEAR win at the Seoul Trading Showdown into native edits for every market: local language, local memes, local humor.";
function SCR(u, t) {
  bg(ctx, C.ink);
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0E1A00'); g.addColorStop(0.5, '#040604'); g.addColorStop(1, '#152600');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); pixelGrid(ctx, C.volt, 40, 0.06);
  drawUI2(u);
  let [z, cx, cy] = keyInterp(CAM, u);
  const slamIn = E.outExpo(prog(u, 0, 0.35)); z *= lerp(1.25, 1, slamIn);
  const base = 1720 / 1600, shake = u > 5.5 ? (rnd(Math.floor(t * 60)) - .5) * 26 * prog(u, 5.5, 6.3) : 0;
  ctx.save(); ctx.translate(W / 2 + shake, H / 2 + shake * 0.6); ctx.scale(base * z, base * z); ctx.rotate(lerp(-0.02, 0, slamIn)); ctx.translate(-cx, -cy);
  ctx.shadowColor = 'rgba(200,255,0,0.25)'; ctx.shadowBlur = 60; rrect(ctx, 0, 0, 1600, 940, 18); ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0;
  ctx.save(); rrect(ctx, 0, 0, 1600, 940, 18); ctx.clip(); ctx.drawImage(SPR.ui, 0, 0); ctx.restore();
  ctx.strokeStyle = 'rgba(200,255,0,0.35)'; ctx.lineWidth = 2; rrect(ctx, 0, 0, 1600, 940, 18); ctx.stroke();
  const [mx, my] = keyInterp(CUR, u);
  [0.55, 3.0, 5.6].forEach(ct => { const d = u - ct; if (d > 0 && d < 0.45) { ctx.strokeStyle = C.volt; ctx.globalAlpha = 1 - d / 0.45; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(mx, my, 10 + d * 160, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; } });
  const press = (u > 5.6 && u < 5.75) || (u > 0.55 && u < 0.65) || (u > 3.0 && u < 3.1) ? 0.85 : 1;
  drawCursor(ctx, mx, my, press);
  if (u > 5.6) { const d = u - 5.6; for (let i = 0; i < 6; i++) { const ang = -Math.PI / 2 + (i - 2.5) * 0.5 + (rnd(i + Math.floor(d * 20)) - .5) * .3; lightning(ctx, 700, 826, 700 + Math.cos(ang) * 900, 826 + Math.sin(ang) * 900, i * 13 + Math.floor(d * 15) * 3, 3, C.volt, 1); } }
  ctx.restore();
  if (u > 0.3) { rrect(ctx, 40, 36, 210, 52, 26); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill(); pxCircle(ctx, 74, 62, 10, 4, Math.floor(t * 3) % 2 ? C.red : '#661111'); hud(ctx, 'REC  00:' + String(Math.floor(u + 12)).padStart(2, '0'), 96, 63, { color: C.white, size: 20 }); }
}
function drawUI2(u) {
  const c = SPR.ui.getContext('2d'), sg = { family: 'Space Grotesk', italic: false };
  c.fillStyle = '#070907'; c.fillRect(0, 0, 1600, 940);
  c.fillStyle = '#101410'; c.fillRect(0, 0, 1600, 54);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(28 + i * 22, 27, 7, 0, 7); c.fill(); });
  rrect(c, 420, 12, 760, 30, 15); c.fillStyle = '#1A201A'; c.fill();
  txt(c, 'velloagents.com/launch', 800, 28, 16, { family: 'JetBrains Mono', weight: 400, italic: false, color: '#B9C7B9' });
  c.fillStyle = '#050705'; c.fillRect(0, 54, 250, 886); c.fillStyle = '#151B15'; c.fillRect(250, 54, 1, 886);
  img(c, IMG.logo, 100, 104, 128);
  ['Launch', 'Nodes', 'Agents', 'Arena', 'Earnings'].forEach((s, i) => {
    const y = 180 + i * 56, act = i === 0;
    if (act) { rrect(c, 16, y - 22, 218, 44, 10); c.fillStyle = 'rgba(200,255,0,0.1)'; c.fill(); c.fillStyle = C.volt; c.fillRect(16, y - 22, 4, 44); }
    c.fillStyle = act ? C.volt : '#4F5C4F'; c.fillRect(40, y - 7, 14, 14);
    txt(c, s, 70, y, 20, { ...sg, weight: 500, align: 'left', color: act ? C.white : '#8A978A' });
  });
  rrect(c, 16, 850, 218, 66, 12); c.fillStyle = '#0E130E'; c.fill(); c.strokeStyle = '#1E281E'; c.stroke();
  txt(c, 'Operator wallet', 34, 872, 13, { ...sg, weight: 500, align: 'left', color: '#6E7B6E' });
  txt(c, '7xKX…sAsU · 42.0 USDC', 34, 896, 15, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'left', color: C.white });
  txt(c, 'New campaign', 290, 110, 38, { ...sg, weight: 700, align: 'left', color: C.white });
  txt(c, 'One brief. Every market. Agents handle the rest.', 290, 150, 18, { ...sg, weight: 500, align: 'left', color: '#7D8B7D' });
  const label = (s, y) => hud(c, s, 290, y, { size: 14, color: '#6E7B6E' });
  label('CAMPAIGN', 196);
  rrect(c, 290, 212, 840, 54, 10); c.fillStyle = '#0E130E'; c.fill(); c.strokeStyle = '#243024'; c.lineWidth = 1.5; c.stroke();
  boltIcon(c, 318, 239, 24, C.volt);
  txt(c, 'Jadoodoo Went Viral', 340, 240, 22, { ...sg, weight: 700, align: 'left', color: C.white });
  txt(c, 'source: jadoodoo_seoul_showdown.mp4', 1110, 240, 14, { family: 'JetBrains Mono', weight: 400, italic: false, align: 'right', color: '#6E7B6E' });
  label('BRIEF', 296);
  const focus = u > 0.55 && u < 2.8;
  rrect(c, 290, 312, 840, 140, 10); c.fillStyle = '#0E130E'; c.fill(); c.strokeStyle = focus ? C.volt : '#243024'; c.lineWidth = focus ? 2.5 : 1.5; c.stroke();
  const n = Math.floor(clamp((u - 0.62) / 1.85) * BRIEF2.length), shown = BRIEF2.slice(0, n);
  font(c, 22, { ...sg, weight: 500 }); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = C.white;
  const words = shown.split(' '); let line = ''; const lines = [];
  words.forEach(w => { const tt = line ? line + ' ' + w : w; if (c.measureText(tt).width > 790) { lines.push(line); line = w; } else line = tt; }); lines.push(line);
  lines.forEach((l, i) => c.fillText(l, 312, 344 + i * 34));
  if (focus) { const lw = c.measureText(lines[lines.length - 1]).width; if (Math.floor(u * 4) % 2 === 0 || n < BRIEF2.length) { c.fillStyle = C.volt; c.fillRect(314 + lw, 344 + (lines.length - 1) * 34 - 13, 3, 26); } }
  label('TERRITORIES', 496);
  const all = u > 3.0;
  ['Korea', 'Japan', 'Brazil', 'UAE', '+141'].forEach((s, i) => { const x = 290 + i * 118; rrect(c, x, 514, 108, 40, 20); c.fillStyle = all ? 'rgba(200,255,0,0.14)' : '#121812'; c.fill(); txt(c, s, x + 54, 534, 15, { ...sg, weight: 500, color: all ? C.volt : '#B4C1B4' }); });
  rrect(c, 892, 512, 238, 44, 22); c.fillStyle = all ? C.volt : (u > 2.9 ? '#1E281E' : '#121812'); c.fill(); c.strokeStyle = C.volt; c.lineWidth = 2; c.stroke();
  txt(c, all ? '✓ ALL 145 COUNTRIES' : 'ALL 145 COUNTRIES', 1011, 535, 17, { ...sg, weight: 700, color: all ? C.ink : C.volt });
  const G = window.MAPGRID, mp = clamp((u - 3.0) / 0.9);
  for (let y = 0; y < 96; y += 2) for (let x = 0; x < 192; x += 2) if (G[y][x] === '1') { const lit = x / 192 < mp + rnd(x + y * 3) * 0.1 - 0.05 && mp > 0; c.fillStyle = lit ? C.volt : '#1D261D'; c.fillRect(290 + x * 2.6, 580 + y * 2.3, 4, 4); }
  const reach = Math.floor(E.outCubic(clamp((u - 3.05) / 1.0)) * 48200000);
  hud(c, 'EST. REACH', 830, 600, { size: 14, color: '#6E7B6E' });
  txt(c, reach.toLocaleString('en-US'), 830, 645, 28, { family: 'Press Start 2P', weight: 400, italic: false, align: 'left', color: all ? C.volt : '#2C382C' });
  hud(c, 'COUNTRIES', 830, 700, { size: 14, color: '#6E7B6E' });
  txt(c, String(Math.floor(E.outCubic(mp) * 145)).padStart(3, '0') + '/145', 830, 738, 28, { family: 'Press Start 2P', weight: 400, italic: false, align: 'left', color: all ? C.white : '#2C382C' });
  const hot = u > 4.5, pr = u > 5.6 && u < 5.75;
  c.save(); if (hot) { c.shadowColor = C.volt; c.shadowBlur = 30 + 20 * Math.sin(u * 20); } rrect(c, 290, 786 + (pr ? 4 : 0), 840, 80, 14); c.fillStyle = C.volt; c.fill(); c.restore();
  txt(c, 'DEPLOY TO AGENT NETWORK', 690, 828 + (pr ? 4 : 0), 30, { color: C.ink });
  boltIcon(c, 1060, 826 + (pr ? 4 : 0), 40, C.ink);
  // right panel: live source clip + network
  rrect(c, 1170, 90, 400, 776, 16); c.fillStyle = '#0B0F0B'; c.fill(); c.strokeStyle = '#1C251C'; c.lineWidth = 1.5; c.stroke();
  hud(c, 'SOURCE CLIP', 1196, 122, { size: 14, color: C.volt });
  c.save(); rrect(c, 1196, 140, 350, 197, 10); c.clip(); vid(c, 'jds', JD.C + 1 + u, 1196, 140, 350, 197); c.restore();
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(1196, 310, 350, 27); hud(c, '▶ 00:' + String(18 + Math.floor(u)).padStart(2, '0') + ' / 00:45', 1206, 324, { size: 13, color: C.white });
  const st = [['Nodes online', '3,214'], ['Agents ready', '12,480'], ['Settlement', 'x402 · USDC'], ['Chain', 'Solana']];
  st.forEach(([a, b], i) => { const y = 380 + i * 50; txt(c, a, 1196, y, 16, { ...sg, weight: 500, align: 'left', color: '#7D8B7D' }); txt(c, b, 1546, y, 17, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'right', color: C.white }); c.fillStyle = '#1A221A'; c.fillRect(1196, y + 20, 350, 1); });
  hud(c, 'AGENT QUEUE', 1196, 600, { size: 14, color: '#6E7B6E' });
  for (let i = 0; i < 5; i++) {
    const m = MK[i], y = 638 + i * 46, ready = u > 3.1 + i * 0.1;
    rrect(c, 1196, y - 18, 350, 38, 8); c.fillStyle = '#101610'; c.fill();
    c.drawImage(SPR.agents[i], 1204, y - 14, 28, 28);
    txt(c, `Agent · ${m.c.charAt(0) + m.c.slice(1).toLowerCase()} · ${m.lang}`, 1244, y, 15, { ...sg, weight: 500, align: 'left', color: C.white });
    pxCircle(c, 1528, y, 6, 3, ready ? C.solG : '#3A443A');
  }
}

// ════════ DROP ════════
function D0(u, t) {
  bg(ctx, C.ink); shot(ctx, 'b31196472', u, { off: 5, speed: 2.2, dark: 0.82, zs: 0.15 });
  warp(ctx, t, W / 2, H / 2, '#ffffff', 90, 0.35, 1.6);
  const p = E.outExpo(clamp(u / 0.5)), s = lerp(1.7, 1, p);
  // chroma converge
  [[C.cyan, -1], [C.pink, 1]].forEach(([col, d]) => { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 * (1 - p); ctx.translate(W / 2 + d * 40 * (1 - p), H / 2 - 20); ctx.scale(s, s); ctx.drawImage(logoTint(col), -430, -129); ctx.restore(); });
  ctx.save(); ctx.globalAlpha = clamp(u / 0.06); ctx.translate(W / 2, H / 2 - 20); ctx.scale(s, s); img(ctx, IMG.logo, 0, 0, 860); ctx.restore();
  if (u > 0.35) shine(ctx, IMG.logo, W / 2, H / 2 - 20, 860, E.inOutCubic(prog(u, 0.35, 1.1)), 0.9);
  const lw = 860 * E.outExpo(clamp((u - 0.25) / 0.5)); ctx.fillStyle = C.volt; ctx.fillRect(W / 2 - lw / 2, H / 2 + 150, lw, 3);
  ktext(ctx, 'THE ATTENTION NETWORK ON SOLANA', W / 2, H / 2 + 205, 24, u - 0.45, { style: 'track', family: 'Silkscreen', italic: false, weight: 400, color: C.white, ls: 10, drift: 0 });
  if (u < 0.14) lightning(ctx, W * 0.2, -30, W * 0.45, H / 2, 55, 3, C.white, 1 - u / 0.14);
}
function D1(u) { shot(ctx, 'b33637800', u, { off: 5, dark: 0.35, zs: 0.1, rot: 0.02 }); ktext(ctx, 'THE GLOBAL', W / 2, H / 2, 200, u, { style: 'stretch', exit: 0.62, exitStyle: 'zoom' }); }
function D2(u) { shot(ctx, 'b18447536', u, { off: 0.6, dark: 0.3, speed: 1.4 }); ktext(ctx, 'ATTENTION', W / 2, H / 2, 220, u, { style: 'scatter', color: C.volt, stagger: 0.015, exit: 0.65, exitStyle: 'scatter' }); }
function D3(u) { shot(ctx, 'b39904068', u, { off: 6, dark: 0.35, zs: 0.14 }); ktext(ctx, 'ECONOMY', W / 2, H / 2, 230, u, { style: 'zoom', exit: 0.66, exitStyle: 'up' }); }
function D4(u) {
  shot(ctx, 'b16001003', u, { off: 6, dark: 0.55, rot: -0.03 });
  [['THE GLOBAL', C.white], ['ATTENTION', C.volt], ['ECONOMY', C.white]].forEach(([s, col], i) => ktext(ctx, s, W / 2, 330 + i * 210, 160, u - i * 0.07, { style: 'flip', color: col, stagger: 0.015 }));
}
function D5(u, t) {
  shot(ctx, 'b38440687', u, { off: 2, dark: 0.72, tint: C.solP });
  warp(ctx, t, W / 2, H / 2, C.solG, 70, 0.4, 1.2);
  ktext(ctx, 'ON', W / 2, 330, 90, u, { style: 'rise', mask: true });
  if (u > 0.4) {
    const u2 = u - 0.4, s = lerp(1.7, 1, E.outExpo(clamp(u2 / 0.2)));
    ctx.save(); ctx.translate(W / 2, 540); ctx.scale(s, s); font(ctx, 260); const sw = ctx.measureText('SOLANA').width / 2;
    const g = ctx.createLinearGradient(-sw, 0, sw, 0); g.addColorStop(0, C.solP); g.addColorStop(1, C.solG); ctx.fillStyle = g; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SOLANA', 0, 0); ctx.restore();
  }
  if (u > 0.8) ['400ms BLOCKS', 'AGENT-NATIVE PAYMENTS', 'GLOBAL BY DEFAULT'].forEach((s, i) => { const q = E.outBack(clamp((u - 0.8 - i * 0.08) / 0.3)); if (q <= 0) return; ctx.save(); ctx.translate(W / 2 - 500 + i * 500, 790); ctx.scale(q, q); rrect(ctx, -220, -32, 440, 64, 32); ctx.strokeStyle = C.solG; ctx.lineWidth = 2; ctx.stroke(); hud(ctx, s, 0, 2, { align: 'center', color: C.white, size: 22 }); ctx.restore(); });
}

// ════════ NODES ════════
function N0(u, t) {
  shot(ctx, 'b33637800', u, { off: 1, dark: 0.82, zs: 0.04 });
  ktext(ctx, 'OPERATORS', W / 2, 190, 130, u, { style: 'rise', mask: true });
  const morph = E.inOutExpo(prog(u, 0.7, 0.95)), cx = W / 2, cy = 540;
  if (morph < 1) { ctx.save(); ctx.globalAlpha = 1 - morph; sprite(ctx, OPER, cx - 12 * 12, cy - 8 * 18 - 30, 24, C.white); ctx.restore(); }
  if (morph > 0) {
    const r = 150 * E.outBack(morph);
    ctx.save(); ctx.shadowColor = C.volt; ctx.shadowBlur = 50; hexPath(ctx, cx, cy, r); ctx.fillStyle = '#0D1A00'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = C.volt; ctx.stroke(); ctx.restore();
    img(ctx, SPR.markWhite, cx, cy, r * 0.85);
    pxRing(ctx, cx, cy, r + 40 + (t * 120) % 200, 8, C.voltD);
  }
  ktext(ctx, 'BECOME NODES.', W / 2, 890, 130, u - 0.8, { style: 'scatter', color: C.volt, stagger: 0.02 });
}
function N1(u, t) {
  shot(ctx, 'b33637800', u, { off: 3, dark: 0.86, zs: 0.03 });
  const z = lerp(1.7, 0.78, E.outCubic(clamp(u / 3.2)));
  ctx.save(); ctx.translate(W / 2, H / 2 + 40); ctx.scale(z, z); ctx.rotate(u * 0.05);
  const vis = NODES.filter(n => u > n.i * 0.03); ctx.lineWidth = 2 / z;
  vis.forEach(n => { if (n.i) { const p = NODES[n.p], g = clamp((u - n.i * 0.03) / 0.15); ctx.strokeStyle = 'rgba(200,255,0,0.35)'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(lerp(p.x, n.x, g), lerp(p.y, n.y, g)); ctx.stroke(); } });
  vis.forEach(n => { if (n.i) { const p = NODES[n.p], s = (rnd(n.i) + u * 1.4) % 1; ctx.fillStyle = s > 0.5 ? C.gold : C.white; const sz = 8 / z; ctx.fillRect(lerp(p.x, n.x, s) - sz / 2, lerp(p.y, n.y, s) - sz / 2, sz, sz); } });
  vis.forEach(n => {
    const a = E.outBack(clamp((u - n.i * 0.03) / 0.2)), r = (n.i ? 18 : 40) * a;
    hexPath(ctx, n.x, n.y, r); ctx.fillStyle = '#0B1400'; ctx.fill(); ctx.strokeStyle = C.volt; ctx.lineWidth = 3 / z; ctx.stroke();
    if (r > 4) ctx.drawImage(SPR.agents[n.i % 12], n.x - r * 0.6, n.y - r * 0.6, r * 1.2, r * 1.2);
    if (NODE_LBL[n.i] && a > 0.9) { ctx.save(); ctx.translate(n.x + 28, n.y - 22); ctx.scale(1 / z, 1 / z); hud(ctx, 'NODE · ' + NODE_LBL[n.i], 0, 0, { color: C.volt, size: 18 }); ctx.restore(); }
  });
  ctx.restore();
  const two = u >= 1.6, mu = two ? u - 1.6 : u, msg = two ? ['EVERY NODE RUNS', 'AI AGENTS'] : ['EVERY OPERATOR', 'IS A NODE'];
  ctx.fillStyle = 'rgba(4,6,4,0.7)'; ctx.fillRect(50, 60, 1000, 230);
  ktext(ctx, msg[0], 80, 135, 76, mu, { style: 'rise', align: 'left', mask: true, exit: two ? 9 : 1.45, exitStyle: 'up' });
  ktext(ctx, msg[1], 80, 225, 76, mu - 0.1, { style: 'rise', align: 'left', mask: true, color: C.volt, exit: two ? 9 : 1.35, exitStyle: 'up' });
  hud(ctx, `NODES ONLINE ${String(vis.length * 37).padStart(5, '0')}`, W - 80, H - 70, { align: 'right', color: C.volt, size: 24 });
  hud(ctx, 'VIDEO GEN · EDIT · PUBLISH', 80, H - 70, { color: C.white, size: 24 });
}
function N2(u) {
  shot(ctx, 'b16605636', u, { off: 2, dark: 0.8 });
  ktext(ctx, 'SPIN UP AGENTS.', W / 2, 150, 110, u, { style: 'stretch' });
  for (let i = 0; i < 6; i++) {
    const col = i % 3, row = Math.floor(i / 3), x = W / 2 + (col - 1) * 420, y = 480 + row * 320, f = E.outBack(clamp((u - 0.1 - i * 0.06) / 0.28));
    if (f <= 0) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate((1 - f) * (i % 2 ? 0.4 : -0.4)); ctx.scale(f, f);
    rrect(ctx, -190, -135, 380, 280, 16); ctx.fillStyle = 'rgba(11,17,11,0.92)'; ctx.fill(); ctx.strokeStyle = i === 0 ? C.volt : '#2A362A'; ctx.lineWidth = 3; ctx.stroke();
    ctx.drawImage(SPR.agents[i], -170, -115, 120, 120);
    hud(ctx, `AGENT #${String(400 + i * 37).padStart(4, '0')}`, -30, -95, { color: C.white, size: 20 });
    hud(ctx, MK[i].c + ' · ' + MK[i].cc, -30, -60, { color: C.grey, size: 16 });
    hud(ctx, 'LANG ' + MK[i].lang, -30, -30, { color: C.grey, size: 16 });
    const minted = u > 0.45 + i * 0.06;
    rrect(ctx, -170, 30, 340, 44, 22); ctx.fillStyle = minted ? C.volt : '#1A221A'; ctx.fill();
    hud(ctx, minted ? '✓ LIVE · CLIPPING JADOODOO' : 'MINTING…', 0, 52, { align: 'center', color: minted ? C.ink : C.grey, size: 15 });
    ctx.fillStyle = '#1A221A'; ctx.fillRect(-170, 98, 340, 10); ctx.fillStyle = C.volt; ctx.fillRect(-170, 98, 340 * clamp((u - i * 0.06) / 0.7), 10);
    ctx.restore();
  }
}

// ════════ GLOBE ════════
function GL(u, t) {
  bg(ctx, C.ink); shot(ctx, 'b33637800', u, { off: 6, dark: 0.9 });
  const zoomOut = u > 5.2 ? E.inExpo(prog(u, 5.2, 6.4)) : 0;
  const R = lerp(390, 2600, zoomOut), cx = lerp(1360, W / 2, zoomOut), cy = H / 2 + 20, lon0 = 112 - u * 32, lat0 = 12 - u * 1.5;
  const arcs = MK.map((city, i) => ({ city, i, p: clamp((u - 0.25 - i * 0.22) / 0.5) })).filter(a => a.p > 0);
  globe(ctx, t, lon0, lat0, R, cx, cy, arcs);
  // live clip thumbnails riding the arc heads
  arcs.forEach(({ city, p, i }) => {
    if (p >= 1 && u - 0.25 - i * 0.22 > 0.9) return;
    const o = v3(ORIGIN.lon, ORIGIN.lat), d = v3(city.lon, city.lat), om = Math.acos(clamp(o[0] * d[0] + o[1] * d[1] + o[2] * d[2], -1, 1)), f = E.outCubic(p);
    const sa = Math.sin((1 - f) * om) / Math.sin(om), sb = Math.sin(f * om) / Math.sin(om);
    const q = proj([o[0] * sa + d[0] * sb, o[1] * sa + d[1] * sb, o[2] * sa + d[2] * sb], lon0, lat0, R, cx, cy, 0.09 * Math.sin(Math.PI * f) * om);
    if (q[2] < 0 && Math.hypot(q[0] - cx, q[1] - cy) < R) return;
    ctx.save(); ctx.globalAlpha = 1 - zoomOut; rrect(ctx, q[0] - 36, q[1] - 64, 72, 128, 8); ctx.clip(); vid(ctx, 'jds', JD.C + 3 + (i % 3) * 0.6 + u, q[0] - 36, q[1] - 64, 72, 128, { src: jcrop(0.31) }); ctx.restore();
    ctx.strokeStyle = C.volt; ctx.lineWidth = 2; rrect(ctx, q[0] - 36, q[1] - 64, 72, 128, 8); ctx.stroke();
  });
  ctx.save(); ctx.globalAlpha = 1 - zoomOut;
  ktext(ctx, 'ONE BRIEF.', 110, 280, 110, u, { style: 'rise', align: 'left', mask: true });
  ktext(ctx, '145 COUNTRIES.', 110, 410, 78, u - 0.8, { style: 'decode', align: 'left', color: C.volt });
  const cnt = Math.floor(E.inOutCubic(prog(u, 0, 4.4)) * 145);
  hud(ctx, 'COUNTRIES LIVE', 112, 560, { color: C.grey, size: 22 });
  txt(ctx, String(cnt).padStart(3, '0'), 110, 680, 130, { family: 'Press Start 2P', weight: 400, italic: false, align: 'left', color: C.volt });
  hud(ctx, 'ORIGIN · KUCHING, BORNEO', 112, 800, { color: C.gold, size: 20 });
  hud(ctx, 'NOW SHIPPING · JADOODOO WENT VIRAL', 112, 836, { color: C.white, size: 20 });
  ctx.restore();
}

// ════════ NATIVE EDITS — 7 unique designs, real footage ════════
function stroked(c, s, x, y, size, fill, strokes, o = {}) { // multi-layer sticker text
  if (o.max) { font(c, size, o); const mw = c.measureText(s).width; if (mw > o.max) { const k = o.max / mw; size *= k; strokes = strokes.map(([w, cl]) => [w * k, cl]); } }
  font(c, size, o); c.textAlign = o.align || 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  strokes.forEach(([w, col]) => { c.lineWidth = w; c.strokeStyle = col; c.strokeText(s, x, y); });
  c.fillStyle = fill; c.fillText(s, x, y);
}
function rgbSplit(c, x, y, w, h, amt) { // cheap chroma offset of a region
  if (amt <= 0) return; const b = SPR.tmp.getContext('2d'); b.clearRect(0, 0, w, h); b.drawImage(c.canvas, x, y, w, h, 0, 0, w, h);
  c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = 0.5; c.filter = 'none';
  const t2 = SPR.tmp2.getContext('2d'); [[C.pink, -amt], [C.cyan, amt]].forEach(([col, d]) => { t2.globalCompositeOperation = 'source-over'; t2.clearRect(0, 0, w, h); t2.drawImage(SPR.tmp, 0, 0, w, h, 0, 0, w, h); t2.globalCompositeOperation = 'multiply'; t2.fillStyle = col; t2.fillRect(0, 0, w, h); c.drawImage(SPR.tmp2, 0, 0, w, h, x + d, y, w, h); });
  c.restore();
}
function blocks(c, x, y, w, h, n, seed, amt) { // datamosh-ish block displacement
  for (let i = 0; i < n; i++) { const bw = 20 + rnd(seed + i) * w * 0.4, bh = 10 + rnd(seed + i * 3) * h * 0.08, bx = x + rnd(seed + i * 5) * (w - bw), by = y + rnd(seed + i * 7) * (h - bh); c.drawImage(c.canvas, bx, by, bw, bh, bx + (rnd(seed + i * 9) - .5) * 80 * amt, by, bw, bh); }
}
const EDITS = [
  { // 0 SEOUL — variety show
    m: 0, bg: ['#FF3D9A', '#FFE14D'], draw(c, w, h, u, clip, big) {
      const pz = 1.15 + (u % BT < 0.08 ? 0.15 : 0);
      vid(c, clip, JD.C + 3.0 + u * 0.8, 0, 0, w, h, { src: jcrop(0.31), zoom: pz });
      c.fillStyle = 'rgba(255,61,154,0.18)'; c.fillRect(0, 0, w, h);
      rrect(c, w * 0.06, h * 0.04, w * 0.3, h * 0.045, h * 0.02); c.fillStyle = '#FFE14D'; c.fill();
      txt(c, '실시간', w * 0.21, h * 0.063, w * 0.06, { color: C.ink, italic: false });
      const pp = E.outBack(clamp(u / 0.18));
      c.save(); c.translate(w / 2, h * 0.7); c.rotate(-0.06); c.scale(pp, pp);
      stroked(c, '자두두 미쳤다!!', 0, 0, w * 0.115, '#FFE14D', [[w * 0.06, '#FF3D9A'], [w * 0.03, '#000']], { max: w * 0.9 });
      stroked(c, '4만 달러 벌었다', 0, w * 0.14, w * 0.09, '#FFFFFF', [[w * 0.04, '#000']], { max: w * 0.9 });
      c.restore();
      for (let i = 0; i < 4; i++) { c.save(); c.translate(w * (0.15 + 0.23 * i), h * (0.18 + 0.05 * (i % 2))); c.rotate(u * 3 + i); star(c, w * 0.035, i % 2 ? '#FFE14D' : '#FFFFFF'); c.restore(); }
    } },
  { // 1 TOKYO — breaking-news telop
    m: 1, bg: ['#0B1A4A', '#E8002D'], draw(c, w, h, u, clip) {
      vid(c, clip, JD.B + 1.2 + u, 0, 0, w, h, { src: jcrop(0.86, 1.05) });
      c.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 2);
      const jy = (rnd(Math.floor(u * 30)) - .5) * 6;
      rrect(c, w * 0.04, h * 0.04, w * 0.22, h * 0.04, 4); c.fillStyle = '#E8002D'; c.fill(); txt(c, '速報', w * 0.15, h * 0.06, w * 0.06, { color: '#fff', italic: false });
      txt(c, 'LIVE 19:42', w * 0.94, h * 0.06, w * 0.045, { family: 'JetBrains Mono', italic: false, weight: 700, align: 'right', color: '#fff' });
      const bp = E.outExpo(clamp(u / 0.2));
      c.save(); c.translate(0, jy);
      c.fillStyle = '#E8002D'; c.fillRect(0, h * 0.74, w * 0.16 * bp, h * 0.11);
      c.fillStyle = '#FFFFFF'; c.fillRect(w * 0.16, h * 0.74, w * 0.84 * bp, h * 0.11);
      const g = c.createLinearGradient(0, h * 0.85, 0, h * 0.9); g.addColorStop(0, '#1C3FA8'); g.addColorStop(1, '#0B1A4A'); c.fillStyle = g; c.fillRect(0, h * 0.85, w * bp, h * 0.05);
      if (bp > 0.6) { txt(c, '4万ドル', w * 0.08, h * 0.795, w * 0.04, { color: '#fff', italic: false }); stroked(c, 'ジャドゥドゥ爆益！', w * 0.58, h * 0.795, w * 0.085, '#111', [], { italic: false }); txt(c, 'NEAR 25倍ロング的中', w * 0.5, h * 0.875, w * 0.05, { color: '#fff', italic: false }); }
      c.restore();
    } },
  { // 2 SÃO PAULO — deep-fried meme
    m: 2, bg: ['#009C3B', '#FFDF00'], draw(c, w, h, u, clip) {
      c.save(); c.filter = 'saturate(1.9) contrast(1.35)'; vid(c, clip, JD.B + 6.5 + u, 0, 0, w, h, { src: jcrop(0.87, 1.05), zoom: 1.05 + u * 0.3 }); c.restore();
      if (Math.floor(u * 10) % 3 === 0) blocks(c, 0, 0, w, h, 10, Math.floor(u * 30), 1);
      stroked(c, 'QUANDO O LONG', w / 2, h * 0.09, w * 0.1, '#fff', [[w * 0.03, '#000']], { max: w * 0.9 });
      stroked(c, 'DÁ CERTO', w / 2, h * 0.16, w * 0.1, '#fff', [[w * 0.03, '#000']], { max: w * 0.9 });
      const pp = E.outElastic(clamp(u / 0.4));
      c.save(); c.translate(w / 2, h * 0.86); c.scale(pp, pp); c.rotate(0.05); stroked(c, '+40 MIL DÓLARES', 0, 0, w * 0.105, '#FFDF00', [[w * 0.05, '#009C3B'], [w * 0.025, '#000']], { max: w * 0.9 }); c.restore();
    } },
  { // 3 DUBAI — finance split-screen
    m: 3, bg: ['#0A0A0A', '#E8B000'], draw(c, w, h, u, clip) {
      c.fillStyle = '#05070D'; c.fillRect(0, 0, w, h);
      vid(c, clip, JD.D + 0.5 + u, 0, h * 0.08, w, h * 0.36, { src: [0, 0.18, 0.62, 0.6] });
      vid(c, clip, JD.D + 0.5 + u, 0, h * 0.52, w, h * 0.4, { src: jcrop(0.86, 1.2) });
      const bp = E.outExpo(clamp(u / 0.2)); c.fillStyle = '#E8B000'; c.fillRect(w * (1 - bp), h * 0.44, w, h * 0.08);
      if (bp > 0.5) txt(c, 'جادودو تربح ٤٠ ألف دولار', w * 0.95, h * 0.48, w * 0.075, { color: '#111', italic: false, align: 'right', weight: 900 });
      txt(c, 'MARKETS · LIVE', w * 0.05, h * 0.04, w * 0.042, { family: 'JetBrains Mono', italic: false, weight: 700, align: 'left', color: '#E8B000' });
      c.fillStyle = '#E8B000'; c.fillRect(0, h * 0.93, w, h * 0.07);
      const tk = 'NEAR +25x  ·  +$39,416  ·  SOLANA  ·  x402  ·  ';
      txt(c, tk + tk, -((u * 260) % (w * 1.2)), h * 0.965, w * 0.045, { family: 'JetBrains Mono', italic: false, weight: 700, align: 'left', color: '#111' });
    } },
  { // 4 MUMBAI — cricket-commentary bug
    m: 4, bg: ['#FF7A00', '#138808'], draw(c, w, h, u, clip) {
      vid(c, clip, JD.C + 3.7 + u * 0.6, 0, 0, w, h, { src: jcrop(0.30), zoom: 1.05 + 0.4 * E.outExpo(clamp(u / 0.6)) });
      halftoneRect(c, w, h, '#FF7A00', u);
      const bp = E.outBack(clamp(u / 0.25));
      c.save(); c.translate(w / 2, h * 0.07); c.scale(bp, 1);
      rrect(c, -w * 0.45, -h * 0.03, w * 0.9, h * 0.06, 6); c.fillStyle = '#0A2A6E'; c.fill();
      c.fillStyle = '#FF7A00'; c.fillRect(-w * 0.45, -h * 0.03, w * 0.3, h * 0.06);
      txt(c, 'NEAR 25x', -w * 0.3, 0, w * 0.045, { color: '#fff', italic: false }); txt(c, '+$40K', w * 0.05, 0, w * 0.05, { color: '#FFE14D' }); txt(c, '● LIVE', w * 0.33, 0, w * 0.04, { color: '#fff', italic: false });
      c.restore();
      stroked(c, 'जादूदू ने कमाए $40K!', w / 2, h * 0.84, w * 0.085, '#FFFFFF', [[w * 0.05, '#138808'], [w * 0.025, '#000']], { italic: false, max: w * 0.9 });
    } },
  { // 5 MEXICO CITY — telenovela drama
    m: 5, bg: ['#3A0008', '#FF2E63'], draw(c, w, h, u, clip) {
      const z = 1.0 + u * 0.7 + (u % BT < 0.06 ? 0.2 : 0);
      vid(c, clip, JD.B + 3.0 + u * 0.5, 0, 0, w, h, { src: jcrop(0.87, 1.1), zoom: z, zy: 0.35 });
      const g = c.createRadialGradient(w / 2, h * 0.4, w * 0.2, w / 2, h * 0.4, h * 0.7); g.addColorStop(0, 'rgba(120,0,20,0)'); g.addColorStop(1, 'rgba(120,0,20,0.85)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      if (u % BT < 0.05) { c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(0, 0, w, h); }
      ktextLocal(c, '¡NO PUEDE SER!', w / 2, h * 0.72, w * 0.12, u, { style: 'scatter', stretch: 'condensed', stagger: 0.015 });
      txt(c, 'GANÓ $40K EN VIVO', w / 2, h * 0.82, w * 0.07, { color: '#FF2E63', stroke: w * 0.02, strokeColor: '#000' });
    } },
  { // 6 NEW YORK — degen terminal
    m: 6, bg: ['#000000', '#14F195'], draw(c, w, h, u, clip) {
      vid(c, clip, JD.E + 1 + u, 0, 0, w, h, { src: jcrop(0.24, 1.1) });
      c.fillStyle = 'rgba(0,20,10,0.35)'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(w * 0.05, h * 0.06, w * 0.9, h * 0.2);
      const lines = ['> pnl --trader jadoodoo', 'NEAR-PERP  25x  LONG', 'REALIZED  +$39,416.00'], n = Math.floor(u / 0.08);
      lines.forEach((l, i) => { if (i * 3 <= n) txt(c, l.slice(0, (n - i * 3) * 6), w * 0.08, h * (0.1 + i * 0.055), w * 0.045, { family: 'JetBrains Mono', italic: false, weight: 700, align: 'left', color: i === 2 ? '#14F195' : '#E6FFE6' }); });
      stroked(c, 'SHE WENT 25X LONG', w / 2, h * 0.82, w * 0.08, '#FFFFFF', [[w * 0.03, '#000']], { max: w * 0.9 });
      stroked(c, '...AND WON.', w / 2, h * 0.89, w * 0.08, '#14F195', [[w * 0.03, '#000']], { max: w * 0.9 });
    } },
  { // 7 JAKARTA — shake + checker
    m: 7, bg: ['#E00000', '#FFFFFF'], draw(c, w, h, u, clip) {
      const sh = (rnd(Math.floor(u * 40)) - .5) * w * 0.04;
      c.save(); c.translate(sh, -sh * 0.5); vid(c, clip, JD.C + 5.6 + u, 0, 0, w, h, { src: jcrop(0.36), zoom: 1.15 }); c.restore();
      stroked(c, 'GAS POL!!', w / 2, h * 0.16, w * 0.15, '#FFFFFF', [[w * 0.05, '#E00000'], [w * 0.02, '#000']], { max: w * 0.9 });
      stroked(c, 'CUAN 40 RIBU DOLAR', w / 2, h * 0.86, w * 0.085, '#FFE14D', [[w * 0.035, '#000']], { max: w * 0.9 });
    } },
];
function star(c, r, col) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fillStyle = col; c.fill(); c.lineWidth = r * 0.15; c.strokeStyle = '#000'; c.stroke(); }
function halftoneRect(c, w, h, col, u) { c.save(); c.fillStyle = col; c.globalAlpha = 0.25; const s = w / 22; for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { const r = s * 0.35 * (0.5 + 0.5 * Math.sin(x * 0.02 + y * 0.03 + u * 6)); c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); } c.restore(); }
function ktextLocal(c, s, x, y, size, u, o) { const prev = ctx; ctx = c; ktext(c, s, x, y, size, u, { drift: 0, ...o }); ctx = prev; }
function phone(c, cx, cy, ph, ed, u, clip, o = {}) {
  const pw = ph * 9 / 16;
  c.save(); c.translate(cx, cy); c.rotate(o.rot || 0); c.scale(o.s || 1, o.s || 1);
  rrect(c, -pw / 2 - ph * 0.015, -ph / 2 - ph * 0.015, pw + ph * 0.03, ph * 1.03, ph * 0.05); c.fillStyle = '#000'; c.fill(); c.strokeStyle = '#2C2C2C'; c.lineWidth = 3; c.stroke();
  rrect(c, -pw / 2, -ph / 2, pw, ph, ph * 0.04); c.clip(); c.translate(-pw / 2, -ph / 2);
  ed.draw(c, pw, ph, u, clip);
  // platform chrome
  for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(pw * 0.91, ph * (0.42 + i * 0.075), pw * 0.04, 0, 7); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill(); }
  c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(0, ph * 0.99, pw, ph * 0.01); c.fillStyle = C.volt; c.fillRect(0, ph * 0.99, pw * ((u * 0.5 + 0.1) % 1), ph * 0.01);
  c.restore();
}
function NE(i) {
  return (u, t) => {
    const ed = EDITS[i], m = MK[ed.m], [b1, b2] = ed.bg;
    bg(ctx, C.ink);
    // themed backdrop: footage echo + brand colours
    shot(ctx, i % 2 ? 'jd' : 'jd', u, { off: [JD.C + 2, JD.B + 2, JD.A, JD.D, JD.C + 4, JD.B + 5][i] || JD.C, dark: 0.8, zs: 0.05 });
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = b1; ctx.globalAlpha = 0.65; ctx.fillRect(0, 0, W, H); ctx.restore();
    speedLines(ctx, t, b2, 26, 3400, 0.35, i % 2 ? 1 : -1, i * 9);
    const sz = fit(ctx, m.c, 280, 1750), sl = (1 - E.outExpo(clamp(u / 0.35))) * 400;
    txt(ctx, m.c, W / 2 + sl, H / 2 - 200, sz, { outline: 3, color: b2 });
    txt(ctx, m.c, W / 2 - sl, H / 2 + 200, sz, { outline: 3, color: C.white });
    const ph = 960, s = lerp(1.25, 1, E.outExpo(clamp(u / 0.25))), rot = (i % 2 ? 1 : -1) * lerp(0.2, 0.035, E.outExpo(clamp(u / 0.3)));
    phone(ctx, W / 2, H / 2, ph, ed, u, 'jd', { s, rot });
    if (u % BT < 0.09) rgbSplit(ctx, 0, 0, W, H, 14);
    ktext(ctx, `${m.c} · ${m.cc}`, 90, 140, 30, u, { style: 'decode', family: 'Silkscreen', italic: false, weight: 400, align: 'left', drift: 0, stagger: 0.012 });
    hud(ctx, `LANG ${m.lang} · CULTURAL EDIT`, 90, 186, { color: C.volt, size: 22 });
    hud(ctx, `AGENT #${String(400 + i * 37).padStart(4, '0')}`, 90, 222, { color: C.grey, size: 22 });
    hud(ctx, 'VIEWS', W - 90, 860, { align: 'right', color: C.grey, size: 22 });
    txt(ctx, Math.floor(120000 + rnd(i) * 900000 + u * 1600000).toLocaleString('en-US'), W - 90, 920, 44, { family: 'Press Start 2P', weight: 400, italic: false, align: 'right', color: C.volt });
    hud(ctx, `${String(i + 1).padStart(3, '0')}/145`, W - 90, 140, { align: 'right', color: C.white, size: 30 });
  };
}
function NW(u, t) { // wall of every edit
  const z = lerp(2.4, 1, E.outExpo(clamp(u / 1.1)));
  bg(ctx, C.ink);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.rotate(lerp(0.12, 0, E.outExpo(clamp(u / 1.1)))); ctx.translate(-W / 2, -H / 2);
  const ch = 330, cw = ch * 9 / 16, gap = 22, cols = 10, rows = 3, ox = (W - (cols * cw + (cols - 1) * gap)) / 2, oy = (H - (rows * ch + (rows - 1) * gap)) / 2;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) { const i = r * cols + q, yo = ((q % 2) ? -1 : 1) * ((u * 70) % 44); phone(ctx, ox + q * (cw + gap) + cw / 2, oy + r * (ch + gap) + ch / 2 + yo, ch, EDITS[(i * 3) % EDITS.length], u + i * 0.13, 'jds'); }
  ctx.restore();
  ctx.fillStyle = 'rgba(4,6,4,0.45)'; ctx.fillRect(0, 0, W, H);
  const two = u >= 0.8; rrect(ctx, 0, H / 2 - 110, W, 220, 0); ctx.fillStyle = C.ink; ctx.fill();
  if (!two) ktext(ctx, 'ONE CLIP.', W / 2, H / 2, 160, u, { style: 'stretch' });
  else ktext(ctx, 'EVERY CULTURE.', W / 2, H / 2, 160, u - 0.8, { style: 'scatter', color: C.volt, stagger: 0.015 });
}

// ════════ x402 ════════
const TERM2 = [
  ['> POST /v1/clip/localize  src=jadoodoo_seoul.mp4  lang=ko-KR', C.white],
  ['< 402 PAYMENT REQUIRED  price=0.04 USDC', C.gold],
  ['> X-PAYMENT  sig=5h3K…9qPz  amt=0.04', C.white],
  ['< 200 OK  settled on Solana  412ms', C.solG],
  ['> POST /v1/publish  region=KR  slots=12', C.white],
  ['< 402 PAYMENT REQUIRED  price=0.02 USDC', C.gold],
  ['> X-PAYMENT  sig=9Zp1…kD2x  amt=0.02', C.white],
  ['< 200 OK  ✓ live in 145 markets', C.solG]];
function X0(u, t) {
  shot(ctx, 'b38581107', u, { off: 1, dark: 0.82 }); pixelGrid(ctx, C.gold, 40, 0.05);
  ktext(ctx, 'AGENTS PAY AGENTS.', 90, 130, 92, u, { style: 'rise', align: 'left', mask: true });
  ktext(ctx, 'x402  ·  HTTP-NATIVE PAYMENTS  ·  USDC ON SOLANA', 94, 214, 22, u - 0.3, { style: 'track', family: 'Silkscreen', italic: false, weight: 400, align: 'left', color: C.gold, ls: 3, drift: 0 });
  const A = [260, 640], B = [820, 640];
  [[A, 0, 'CLIP AGENT · SEOUL'], [B, 1, 'EDIT NODE · TOKYO']].forEach(([p, s, l], i) => {
    const f = E.outBack(clamp((u - 0.15 - i * 0.1) / 0.3)); if (f <= 0) return;
    ctx.save(); ctx.translate(p[0], p[1]); ctx.scale(f, f);
    ctx.shadowColor = C.volt; ctx.shadowBlur = 30; rrect(ctx, -130, -150, 260, 300, 18); ctx.fillStyle = 'rgba(12,18,12,0.92)'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = i ? C.cyan : C.volt; ctx.lineWidth = 3; rrect(ctx, -130, -150, 260, 300, 18); ctx.stroke();
    ctx.drawImage(SPR.agents[s], -80, -125 + Math.sin(t * 6 + i * 2) * 8, 160, 160);
    hud(ctx, l, 0, 115, { align: 'center', color: C.white, size: 17 }); ctx.restore();
  });
  for (let j = 0; j < 8; j++) {
    const d = t - bt(96 + j); if (d < 0 || d > 0.55) continue;
    const p = E.inOutCubic(d / 0.55), x = lerp(A[0] + 130, B[0] - 130, p), y = 640 - Math.sin(p * Math.PI) * 220;
    pxCircle(ctx, x, y, 44, 8, C.gold); pxCircle(ctx, x, y, 24, 8, '#FFE9A0');
    hud(ctx, j % 2 ? '$0.02 USDC' : '$0.04 USDC', x, y - 72, { align: 'center', color: C.gold, size: 26 });
  }
  rrect(ctx, 1040, 300, 820, 620, 16); ctx.fillStyle = 'rgba(7,10,7,0.92)'; ctx.fill(); ctx.strokeStyle = '#2A2410'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#110F06'; ctx.fillRect(1040, 300, 820, 46); hud(ctx, 'agent@seoul-0400 : x402', 1066, 324, { color: C.gold, size: 16 });
  const n = Math.floor(u / (BT * 0.5)) + 1;
  TERM2.slice(0, Math.min(n, 8)).forEach(([s, col], i) => { const age = u - i * BT * 0.5; txt(ctx, age < 0.12 ? s.slice(0, Math.floor(age / 0.12 * s.length)) : s, 1066, 390 + i * 62, 19, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'left', color: col }); });
  cursorBlock(ctx, 1066, 390 + Math.min(n, 8) * 62, 26, t, C.gold);
}
const BOARD2 = [['KR', 'seoul.node', 4.21, 2412.6], ['JP', 'shibuya.ops', 3.38, 1934.2], ['BR', 'sampa.clips', 2.87, 1642.9], ['ID', 'jkt.cuan', 2.31, 1321.3], ['IN', 'bombay.edit', 1.96, 1121.8]];
function X1(u, t) {
  shot(ctx, 'jd', u, { off: JD.D + 0.4, dark: 0.85, zs: 0.03 });
  ktext(ctx, 'VERIFIED PERFORMANCE.', 90, 130, 80, u, { style: 'rise', align: 'left', mask: true });
  ktext(ctx, 'REAL REWARDS.', 90, 230, 80, u - 0.8, { style: 'scatter', align: 'left', color: C.volt, stagger: 0.02 });
  rrect(ctx, 90, 320, 1740, 640, 18); ctx.fillStyle = 'rgba(9,13,9,0.9)'; ctx.fill(); ctx.strokeStyle = '#243024'; ctx.lineWidth = 2; ctx.stroke();
  hud(ctx, 'CAMPAIGN · JADOODOO WENT VIRAL · USDC', 130, 372, { color: C.gold, size: 22 });
  hud(ctx, 'VERIFIED VIEWS', 1130, 372, { color: C.grey, size: 18 });
  txt(ctx, Math.floor(41000000 + u * 2400000).toLocaleString('en-US'), 1790, 372, 26, { family: 'Press Start 2P', weight: 400, italic: false, align: 'right', color: C.volt });
  BOARD2.forEach(([cc, name, mv, usd], i) => {
    const y = 460 + i * 100, f = E.outExpo(clamp((u - i * 0.06) / 0.4));
    ctx.save(); ctx.translate((1 - f) * -200, 0); ctx.globalAlpha = f;
    txt(ctx, String(i + 1), 150, y, 40, { family: 'Press Start 2P', weight: 400, italic: false, color: i === 0 ? C.gold : C.white });
    ctx.drawImage(SPR.agents[i + 3], 214, y - 30, 60, 60);
    hud(ctx, cc + ' · ' + name, 300, y, { color: C.white, size: 26 });
    const bw = 520 * mv / 4.21 * E.outCubic(clamp((u - 0.1 - i * 0.06) / 0.8));
    ctx.fillStyle = '#1A221A'; ctx.fillRect(820, y - 10, 520, 20); ctx.fillStyle = i === 0 ? C.gold : C.volt; ctx.fillRect(820, y - 10, bw, 20);
    hud(ctx, (mv * clamp(u / 1.2)).toFixed(2) + 'M VIEWS', 1360, y, { color: C.grey, size: 20 });
    txt(ctx, '+$' + (usd * clamp(u / 1.6)).toFixed(2), 1790, y, 30, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'right', color: C.solG });
    ctx.restore();
  });
  if (u > 1.6) { const s = E.outBack(clamp((u - 1.6) / 0.25)); ctx.save(); ctx.translate(1620, 220); ctx.rotate(-0.12); ctx.scale(s, s); rrect(ctx, -170, -50, 340, 100, 12); ctx.strokeStyle = C.volt; ctx.lineWidth = 6; ctx.stroke(); hud(ctx, '✓ VERIFIED', 0, 2, { align: 'center', color: C.volt, size: 40 }); ctx.restore(); }
}

// ════════ MONTAGE — one shot per beat ════════
const MONT = [
  u => { shot(ctx, 'jd', u, { off: JD.C + 1.6, dark: 0.15, zs: 0.25 }); ktext(ctx, '+$40K', W / 2, H / 2, 300, u, { style: 'stretch', color: C.volt, stroke: 14, strokeColor: C.ink }); },
  u => { shot(ctx, 'b31196472', u, { off: 3.5, speed: 2.5, dark: 0.3 }); ktext(ctx, 'ONE BRIEF', W / 2, H / 2, 220, u, { style: 'zoom' }); },
  u => { shot(ctx, 'b39904068', u, { off: 4.5, dark: 0.3 }); ktext(ctx, 'AGENTS', W / 2, H / 2, 280, u, { style: 'scatter', color: C.volt, stagger: 0.015 }); },
  u => { shot(ctx, 'jd', u, { off: JD.B + 2.0, dark: 0.15, zs: 0.3 }); ktext(ctx, '145 MARKETS', W / 2, 860, 130, u, { style: 'rise', mask: true, stroke: 10, strokeColor: C.ink }); },
  u => { shot(ctx, 'b3088697', u, { off: 4, dark: 0.35 }); ktext(ctx, 'x402', W / 2, H / 2, 340, u, { style: 'flip', color: C.gold }); },
  u => { shot(ctx, 'b16001003', u, { off: 8, dark: 0.3 }); ktext(ctx, 'PAID.', W / 2, H / 2, 340, u, { style: 'zoom', color: C.solG }); },
  u => { bg(ctx, C.ink); shot(ctx, 'b33637800', u, { off: 7, dark: 0.6 }); globe(ctx, u + 50, 40 - u * 400, 15, 430, W / 2, H / 2, MK.map((city, i) => ({ city, i, p: 1 }))); },
  u => { bg(ctx, C.ink); [[JD.C + 3.0, 0.31], [JD.C + 4.6, 0.44], [JD.A + 1.2, 0.5]].forEach(([tt, cx], i) => { vid(ctx, 'jd', tt + u, i * W / 3, 0, W / 3, H, { src: [cx - 0.1, 0, 0.2, 1] }); ctx.fillStyle = C.volt; ctx.fillRect(i * W / 3 - 3, 0, 6, H); }); ktext(ctx, 'SHE WENT VIRAL', W / 2, H / 2, 150, u, { style: 'stretch', stroke: 12, strokeColor: C.ink }); },
  u => { shot(ctx, 'b18447540', u, { off: 0.5, dark: 0.35 }); const v = E.outExpo(clamp(u / 0.3)); txt(ctx, Math.floor(v * 48213).toLocaleString('en-US'), W / 2, H / 2 - 30, 120, { family: 'Press Start 2P', italic: false, weight: 400, color: C.volt }); hud(ctx, 'VIEWS / SEC', W / 2, H / 2 + 80, { align: 'center', color: C.white, size: 34 }); },
  u => { shot(ctx, 'b38440687', u, { off: 5, dark: 0.5 }); ktext(ctx, 'VERIFIED', W / 2, H / 2, 260, u, { style: 'decode', stagger: 0.012, dur: 0.1 }); },
  u => { bg(ctx, C.ink); const s = 90; for (let y = -2; y < 15; y++) for (let x = -2; x < 24; x++) { if ((x + y) % 2) continue; const wv = Math.sin(x * 0.5 + u * 14) * 40 + Math.sin(y * 0.4 + u * 9) * 20; ctx.fillStyle = C.volt; ctx.fillRect(x * s + wv * 0.4, y * s + wv, s, s); } ktext(ctx, 'FASTEST NETWORK WINS', W / 2, H / 2, 110, u, { style: 'track', dur: 0.25, stroke: 24, strokeColor: C.ink }); },
  u => { shot(ctx, 'b16605636', u, { off: 4, dark: 0.3 }); ktext(ctx, 'NODES', W / 2, H / 2, 300, u, { style: 'rise', mask: true, color: C.volt }); },
  u => { shot(ctx, 'jd', u, { off: JD.C + 2.6, dark: 0.45 }); ktext(ctx, 'THIS IS', W / 2, H / 2, 230, u, { style: 'zoom' }); },
  u => { bg(ctx, C.volt); halftone(ctx, C.ink, 30, 0.12, u); ktext(ctx, 'THE GLOBAL', W / 2, H / 2, 210, u, { style: 'stretch', color: C.ink }); },
  u => { shot(ctx, 'b31196475', u, { off: 0.2, speed: 2, dark: 0.35 }); ktext(ctx, 'ATTENTION', W / 2, H / 2, 230, u, { style: 'scatter', color: C.volt, stagger: 0.012 }); },
  u => { bg(ctx, C.white); ktext(ctx, 'ECONOMY.', W / 2, H / 2, 240, u, { style: 'flip', color: C.ink }); }];

// ════════ OUTRO — white logo, less is more ════════
function OUT(u, t) {
  bg(ctx, C.ink);
  shot(ctx, 'b31196472', u, { off: 1, speed: 0.4, dark: 0.93, zs: 0.02 });
  const p = E.outExpo(clamp(u / 0.8));
  for (let k = 5; k >= 0; k--) { ctx.save(); ctx.globalAlpha = k ? 0.08 * (1 - p) : p; ctx.translate(W / 2, 470); const s = lerp(1.25, 1, p) * (1 + k * 0.03 * (1 - p)); ctx.scale(s, s); img(ctx, IMG.logo, 0, 0, 720); ctx.restore(); }
  if (u > 0.6) shine(ctx, IMG.logo, W / 2, 470, 720, E.inOutCubic(prog(u, 0.6, 1.5)), 0.85);
  ktext(ctx, 'THE GLOBAL ATTENTION ECONOMY ON SOLANA', W / 2, 650, 26, u - 0.7, { style: 'track', family: 'Space Grotesk', italic: false, weight: 500, color: '#BFC8BF', ls: 9, drift: 0, dur: 0.9 });
  if (u > 1.6) {
    const a = E.outCubic(clamp((u - 1.6) / 0.5));
    ctx.globalAlpha = a; txt(ctx, 'velloagents.com', W / 2, 780, 30, { family: 'Space Grotesk', italic: false, weight: 700, color: C.white, ls: 2 }); ctx.globalAlpha = 1;
    const lw = 250 * E.inOutCubic(clamp((u - 1.8) / 0.6)); ctx.fillStyle = C.volt; ctx.fillRect(W / 2 - lw / 2, 812, lw, 2);
  }
  if (u > 4.7) flashOver(C.ink, E.inOutCubic(prog(u, 4.7, 5.45)));
}

const _LT = {}; function logoTint(col) { return _LT[col] || (_LT[col] = tint(IMG.logo, col, 860, 258)); }

// ════════ SHOT LIST (start time, draw, transition-in type, transition duration) ════════
const SHOTS = [
  [0, (u, t) => I0(u, t)],
  [bt(0), H0, 'zoom', 0.3], [bt(2), H1, 'whip', 0.22], [bt(4), H2, 'slice', 0.25], [bt(6), H3, 'spin', 0.24],
  [bt(8), H4, 'pixel', 0.18], [bt(10), H5, 'glitch', 0.12], [bt(12), H6, 'iris', 0.26], [bt(14), H7, 'wipe', 0.24],
  [bt(16), SCR, 'zoom', 0.3],
  [bt(32), D0, 'flash', 0.2], [bt(36), D1, 'slice', 0.24], [bt(38), D2, 'whip', 0.22], [bt(40), D3, 'spin', 0.24], [bt(42), D4, 'split', 0.26], [bt(44), D5, 'iris', 0.26],
  [bt(48), N0, 'glitch', 0.14], [bt(52), N1, 'zoom', 0.28], [bt(60), N2, 'wipe', 0.24],
  [bt(64), GL, 'iris', 0.3],
  [bt(80), NE(0), 'glitch', 0.14], [bt(82), NE(1), 'slice', 0.22], [bt(84), NE(2), 'whip', 0.2], [bt(86), NE(3), 'pixel', 0.16], [bt(88), NE(4), 'spin', 0.22], [bt(90), NE(5), 'split', 0.24],
  [bt(92), NW, 'zoom', 0.26],
  [bt(96), X0, 'wipe', 0.26], [bt(104), X1, 'slice', 0.24],
  ...MONT.map((f, k) => [bt(112 + k), f, ['glitch', 'whip', 'zoom', 'glitch', 'spin', 'flash', 'iris', 'slice', 'glitch', 'pixel', 'wipe', 'whip', 'zoom', 'glitch', 'whip', 'flash'][k], 0.12]),
  [bt(128), OUT, 'flash', 0.3]];
