// ───────────────────────── scenes ─────────────────────────
const P = i => bt(16 * i); // phrase starts: 3.224, 9.624, 16.024, 22.424, 28.824, 35.224, 41.624, 48.024, 54.424
const CITIES = [
  { c: 'TOKYO', cc: 'JP', cap: 'キラットで、加速しろ。', h: '@kilat.jp', lang: 'JA', pal: ['#1A0A2E', '#FF3D7F', '#FFE14D'], pat: 'sun', lon: 139.7, lat: 35.7 },
  { c: 'SÃO PAULO', cc: 'BR', cap: 'ACELERA COM KILAT', h: '@kilat.br', lang: 'PT', pal: ['#003B1F', '#18D26E', '#FFD400'], pat: 'stripes', lon: -46.6, lat: -23.5 },
  { c: 'SEOUL', cc: 'KR', cap: '킬라트로 더 빠르게', h: '@kilat.kr', lang: 'KO', pal: ['#0B0B2A', '#5B6CFF', '#FF5BD1'], pat: 'grid', lon: 127, lat: 37.5 },
  { c: 'LAGOS', cc: 'NG', cap: 'KILAT NA THE VIBE', h: '@kilat.ng', lang: 'PCM', pal: ['#0A2A12', '#00C25A', '#FFFFFF'], pat: 'waves', lon: 3.4, lat: 6.5 },
  { c: 'MUMBAI', cc: 'IN', cap: 'किलात के साथ रफ़्तार', h: '@kilat.in', lang: 'HI', pal: ['#2A0E00', '#FF7A00', '#FFE7B0'], pat: 'sun', lon: 72.9, lat: 19.1 },
  { c: 'DUBAI', cc: 'AE', cap: 'انطلق مع كيلات', h: '@kilat.ae', lang: 'AR', pal: ['#1C1400', '#E8B000', '#FFF6D6'], pat: 'dots', lon: 55.3, lat: 25.2 },
  { c: 'MEXICO CITY', cc: 'MX', cap: '¡DALE GAS CON KILAT!', h: '@kilat.mx', lang: 'ES', pal: ['#2A0012', '#FF2E63', '#2EF2C4'], pat: 'stripes', lon: -99.1, lat: 19.4 },
  { c: 'KUALA LUMPUR', cc: 'MY', cap: 'LAJU GILA DENGAN KILAT', h: '@kilat.my', lang: 'MS', pal: ['#001233', '#1F6BFF', '#FFD60A'], pat: 'grid', lon: 101.7, lat: 3.1 },
  { c: 'BANGKOK', cc: 'TH', cap: 'เร่งไปกับกิลัต', h: '@kilat.th', lang: 'TH', pal: ['#1E0030', '#B14DFF', '#FFC2F0'], pat: 'waves', lon: 100.5, lat: 13.8 },
  { c: 'PARIS', cc: 'FR', cap: 'PLUS VITE AVEC KILAT', h: '@kilat.fr', lang: 'FR', pal: ['#0A0A0A', '#F3F3F3', '#FF3B30'], pat: 'dots', lon: 2.35, lat: 48.9 },
  { c: 'JAKARTA', cc: 'ID', cap: 'GAS POL BARENG KILAT', h: '@kilat.id', lang: 'ID', pal: ['#2A0000', '#FF3030', '#FFFFFF'], pat: 'stripes', lon: 106.8, lat: -6.2 },
  { c: 'NEW YORK', cc: 'US', cap: 'FASTER WITH KILAT', h: '@kilat.us', lang: 'EN', pal: ['#06121F', '#2EC5FF', '#FFE600'], pat: 'grid', lon: -74, lat: 40.7 },
  { c: 'ISTANBUL', cc: 'TR', cap: 'KILAT İLE HIZLAN', h: '@kilat.tr', lang: 'TR', pal: ['#1F0006', '#E30A17', '#FFFFFF'], pat: 'sun', lon: 29, lat: 41 },
  { c: 'MANILA', cc: 'PH', cap: 'BILIS KASAMA ANG KILAT', h: '@kilat.ph', lang: 'TL', pal: ['#000F2E', '#0038A8', '#FCD116'], pat: 'waves', lon: 121, lat: 14.6 },
  { c: 'BERLIN', cc: 'DE', cap: 'SCHNELLER MIT KILAT', h: '@kilat.de', lang: 'DE', pal: ['#0D0D0D', '#FFCE00', '#DD0000'], pat: 'stripes', lon: 13.4, lat: 52.5 },
  { c: 'NAIROBI', cc: 'KE', cap: 'KILAT NI SPIDI', h: '@kilat.ke', lang: 'SW', pal: ['#0B1A00', '#7DD100', '#FF4B2B'], pat: 'dots', lon: 36.8, lat: -1.3 },
];
const ATTN = ['注目', '관심', 'ATENCIÓN', 'انتباه', 'ध्यान', 'ความสนใจ', 'PERHATIAN', 'ATTENZIONE', 'DİKKAT', 'AUFMERKSAMKEIT', 'ATENÇÃO', 'УВАГА', '注意力', 'PANSIN', 'ATTENTION'];

const OPER = [
  '....XXXX....', '...XXXXXX...', '...XXXXXX...', '...XXXXXX...', '....XXXX....', '............',
  '..XXXXXXXX..', '.XXXXXXXXXX.', 'XX.XXXXXX.XX', 'XX.XXXXXX.XX', 'XX.XXXXXX.XX', '...XXXXXX...',
  '...XX..XX...', '...XX..XX...', '...XX..XX...', '..XXX..XXX..'];

// ════════ S0 · LIGHTS (0 → 3.224) ════════
const LIGHTS = [0.62, 1.12, 1.62, 2.12, 2.62];
function S0(t) {
  bg(ctx, C.ink);
  const z = 1 + 0.08 * E.inOutCubic(prog(t, 0, 3.22));
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
  floor(ctx, t * 0.3, C.voltK, 0.55, 1, 700);
  pixelGrid(ctx, C.volt, 48, 0.06);
  const on = LIGHTS.filter(x => t >= x).length;
  // red floor glow
  if (on) { const g = ctx.createRadialGradient(W / 2, 760, 10, W / 2, 760, 700); g.addColorStop(0, `rgba(255,30,30,${0.07 * on})`); g.addColorStop(1, 'rgba(255,30,30,0)'); ctx.fillStyle = g; ctx.fillRect(0, 300, W, 780); }
  // gantry beam
  ctx.fillStyle = '#0d110d'; ctx.fillRect(W / 2 - 600, 236, 1200, 34);
  ctx.fillStyle = C.line; ctx.fillRect(W / 2 - 600, 270, 1200, 4);
  for (let i = 0; i < 5; i++) {
    const x = W / 2 + (i - 2) * 220, y = 300;
    rrect(ctx, x - 78, y, 156, 330, 18); ctx.fillStyle = '#090B09'; ctx.fill(); ctx.strokeStyle = '#1d241d'; ctx.lineWidth = 3; ctx.stroke();
    const lit = t >= LIGHTS[i];
    for (let j = 0; j < 2; j++) {
      const ly = y + 92 + j * 148;
      if (lit) {
        const age = t - LIGHTS[i];
        const g = ctx.createRadialGradient(x, ly, 4, x, ly, 150); g.addColorStop(0, 'rgba(255,40,40,0.55)'); g.addColorStop(1, 'rgba(255,40,40,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 160, ly - 160, 320, 320);
        pxCircle(ctx, x, ly, 52, 8, age < 0.06 ? '#FFFFFF' : C.red);
        pxCircle(ctx, x - 14, ly - 14, 14, 8, '#FF9A9A');
      } else pxCircle(ctx, x, ly, 52, 8, '#2A0707');
    }
  }
  ctx.restore();
  hud(ctx, 'VELLO GP  ·  SOLANA MAINNET', 60, 60);
  hud(ctx, `LAP 001/145`, W - 60, 60, { align: 'right' });
  hud(ctx, `GRID  ${String(on).padStart(2, '0')}/05`, 60, H - 60, { color: on ? C.red : C.grey });
  if (Math.floor(t * 4) % 2 === 0) hud(ctx, '● REC', W - 60, H - 60, { align: 'right', color: C.red });
  // tagline under lights
  const u = t - 0.15;
  if (u > 0) txt(ctx, 'ONE BRIEF', W / 2, 760, 30, { family: 'Silkscreen', italic: false, weight: 400, color: C.grey, ls: 14, alpha: 1 });
  if (t > 1.0) txt(ctx, '→ 145 COUNTRIES', W / 2, 810, 30, { family: 'Silkscreen', italic: false, weight: 400, color: on >= 3 ? C.white : C.grey, ls: 14 });
}

// ════════ S1 · HOOK (3.224 → 9.624) ════════
function S1(t) {
  const kb = (t - P(0)) / BT, k = Math.floor(kb), slot = Math.floor(k / 2), u = t - bt(slot * 2), ub = t - bt(k);
  const punch = 1 + 0.05 * Math.exp(-ub * 14);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(punch, punch); ctx.translate(-W / 2, -H / 2);
  if (slot === 0) {
    bg(ctx, C.ink); floor(ctx, t, C.voltD, 0.9, 5, 600); speedLines(ctx, t, C.white, 30, 2600, 0.35);
    slam(ctx, 'EVERY BRAND', W / 2, 470, 150, u, { color: C.white, smear: true, dx: 500, ls: 4 });
  } else if (slot === 1) {
    bg(ctx, C.volt); halftone(ctx, C.ink, 30, 0.16, t);
    slam(ctx, 'WANTS', W / 2, H / 2, 330, u, { color: C.ink, from: 2.2 });
  } else if (slot === 2) {
    bg(ctx, C.ink); speedLines(ctx, t, C.volt, 70, 3600, 0.5);
    slam(ctx, "THE WORLD'S", W / 2, H / 2, 170, u, { color: C.white, smear: true, dx: -500 });
    // Flash dashes across
    const p = prog(u, 0.05, 0.62), x = lerp(-500, W + 500, E.inOutExpo(p));
    if (p > 0 && p < 1) {
      ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = C.volt;
      for (let i = 0; i < 8; i++) ctx.fillRect(x - 360 - i * 90, 640 + i * 18, 300, 10);
      ctx.restore();
      img(ctx, SPR.flashPx, x, 690, 300);
    }
  } else if (slot === 3) {
    bg(ctx, C.ink);
    for (let i = 0; i < 3; i++) if (ub < 0.22 || (k === 7 && ub < 0.12)) lightning(ctx, 300 + i * 650, -20, 500 + i * 500 + rnd(k + i) * 200, H + 20, k * 17 + i * 5, 4, C.volt, 1 - ub * 3);
    slam(ctx, 'ATTENTION.', W / 2, H / 2, 210, u, { color: C.volt, from: 0.6 });
    hud(ctx, 'THE SCARCEST ASSET ON EARTH', W / 2, 680, { align: 'center', color: C.white, size: 26, ls: 8 });
  } else if (slot === 4) {
    bg(ctx, C.carbon); mapDots(ctx, t, 0.22);
    slam(ctx, 'BUT IT SPEAKS', W / 2, H / 2, 150, u, { color: C.white, smear: true, dx: 500 });
  } else if (slot === 5) {
    const i = Math.floor(u / (BT / 3)), q = i % 3;
    bg(ctx, [C.ink, C.volt, C.white][q]);
    const s = ATTN[i % ATTN.length];
    const sz = fit(ctx, s, 260, 1500);
    txt(ctx, s, W / 2, H / 2, sz, { color: [C.volt, C.ink, C.ink][q] });
    hud(ctx, `LANG ${String(i + 1).padStart(3, '0')}/145`, W / 2, 820, { align: 'center', color: q ? C.ink : C.volt, size: 26 });
  } else if (slot === 6) {
    bg(ctx, C.ink); mapDots(ctx, t, 0.5, true);
    slam(ctx, '145 LANGUAGES.', W / 2, H / 2, 150, u, { color: C.white, from: 0.7 });
  } else {
    bg(ctx, C.ink); floor(ctx, t, C.voltK, 0.8, 2, 640);
    slam(ctx, 'ONE BRIEF.', W / 2 - 50, H / 2, 210, u, { color: C.volt, smear: true, dx: 400 });
    font(ctx, 210); const ow = ctx.measureText('ONE BRIEF.').width; cursorBlock(ctx, W / 2 - 50 + ow / 2 + 30, H / 2, 170, t, C.volt);
  }
  ctx.restore();
}
function mapDots(c, t, a, lit) {
  const G = window.MAPGRID, cell = 10, ox = (W - 192 * cell) / 2, oy = (H - 96 * cell) / 2;
  c.save();
  for (let y = 0; y < 96; y++) for (let x = 0; x < 192; x++) if (G[y][x] === '1') {
    const f = lit ? (rnd(x * 31 + y * 7) < 0.25 && Math.sin(t * 9 + x) > 0.2 ? 1 : 0.35) : 1;
    c.globalAlpha = a * f; c.fillStyle = f === 1 && lit ? C.volt : C.voltD;
    c.fillRect(ox + x * cell, oy + y * cell, cell - 3, cell - 3);
  }
  c.restore();
}

// ════════ S2 · SCREEN RECORD — operator console (9.624 → 16.024) ════════
const BRIEF = 'Launch KILAT Energy worldwide. 15s vertical edits that feel native in every market: local language, local slang, local humor.';
const CUR = [ // [time, x, y] in UI space
  [0, 1180, 760], [0.55, 560, 340], [2.6, 560, 360], [2.95, 1032, 500], [3.9, 1050, 520], [4.55, 700, 826], [5.5, 700, 826]];
const CAM = [ // [time, zoom, cx, cy]
  [0, 1, 800, 470], [0.5, 1, 800, 470], [0.85, 1.75, 640, 360], [2.5, 1.75, 700, 380], [2.9, 1.45, 900, 560], [3.8, 1.45, 900, 580], [4.3, 1.0, 800, 470], [4.6, 1.0, 800, 470], [5.55, 2.0, 700, 826], [6.4, 2.25, 700, 826]];
function keyInterp(keys, u, n) {
  if (u <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (u <= b[0]) { const p = E.inOutCubic((u - a[0]) / (b[0] - a[0])); return a.slice(1).map((v, j) => lerp(v, b[j + 1], p)); }
  }
  return keys[keys.length - 1].slice(1);
}
function S2(t) {
  const u = t - P(1);
  bg(ctx, C.ink);
  // backdrop: lime gradient "studio" bg
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0E1A00'); g.addColorStop(0.5, '#040604'); g.addColorStop(1, '#152600');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); pixelGrid(ctx, C.volt, 40, 0.07);
  drawUI(u);
  let [z, cx, cy] = keyInterp(CAM, u);
  const slamIn = E.outExpo(prog(u, 0, 0.35));
  z *= lerp(1.25, 1, slamIn);
  const base = 1720 / 1600;
  const shake = u > 5.5 ? (rnd(Math.floor(t * 60)) - .5) * 26 * prog(u, 5.5, 6.3) : 0;
  ctx.save();
  ctx.translate(W / 2 + shake, H / 2 + shake * 0.6); ctx.scale(base * z, base * z); ctx.translate(-cx, -cy);
  ctx.shadowColor = 'rgba(200,255,0,0.25)'; ctx.shadowBlur = 60;
  rrect(ctx, 0, 0, 1600, 940, 18); ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0;
  ctx.save(); rrect(ctx, 0, 0, 1600, 940, 18); ctx.clip(); ctx.drawImage(SPR.ui, 0, 0); ctx.restore();
  ctx.strokeStyle = 'rgba(200,255,0,0.35)'; ctx.lineWidth = 2; rrect(ctx, 0, 0, 1600, 940, 18); ctx.stroke();
  // cursor + click ripples
  const [mx, my] = keyInterp(CUR, u);
  [0.55, 3.0, 5.6].forEach(ct => { const d = u - ct; if (d > 0 && d < 0.45) { ctx.strokeStyle = C.volt; ctx.globalAlpha = 1 - d / 0.45; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(mx, my, 10 + d * 160, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; } });
  const press = (u > 5.6 && u < 5.75) || (u > 0.55 && u < 0.65) || (u > 3.0 && u < 3.1) ? 0.85 : 1;
  drawCursor(ctx, mx, my, press);
  // lightning erupting from the button on click
  if (u > 5.6) {
    const d = u - 5.6;
    for (let i = 0; i < 6; i++) { const ang = -Math.PI / 2 + (i - 2.5) * 0.5 + (rnd(i + Math.floor(d * 20)) - .5) * .3; lightning(ctx, 700, 826, 700 + Math.cos(ang) * 900, 826 + Math.sin(ang) * 900, i * 13 + Math.floor(d * 15) * 3, 3, C.volt, 1); }
  }
  ctx.restore();
  // REC badge (screen-record feel)
  if (u > 0.3) { rrect(ctx, 40, 36, 210, 52, 26); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill(); pxCircle(ctx, 74, 62, 10, 4, Math.floor(t * 3) % 2 ? C.red : '#661111'); hud(ctx, 'REC  00:' + String(Math.floor(u + 12)).padStart(2, '0'), 96, 63, { color: C.white, size: 20 }); }
  if (u > 6.0) flashOver('#FFFFFF', E.inExpo(prog(u, 6.0, 6.4)));
}
function drawCursor(c, x, y, s = 1) {
  c.save(); c.translate(x, y); c.scale(1.5 * s, 1.5 * s);
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 26); c.lineTo(7, 19); c.lineTo(12, 30); c.lineTo(16, 28); c.lineTo(11, 18); c.lineTo(20, 18); c.closePath();
  c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke(); c.restore();
}
function drawUI(u) {
  const c = SPR.ui.getContext('2d');
  c.fillStyle = '#070907'; c.fillRect(0, 0, 1600, 940);
  // chrome
  c.fillStyle = '#101410'; c.fillRect(0, 0, 1600, 54);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(28 + i * 22, 27, 7, 0, 7); c.fill(); });
  rrect(c, 420, 12, 760, 30, 15); c.fillStyle = '#1A201A'; c.fill();
  txt(c, 'velloagents.com/launch', 800, 28, 16, { family: 'JetBrains Mono', weight: 400, italic: false, color: '#B9C7B9' });
  c.fillStyle = C.volt; c.fillRect(436, 22, 9, 11);
  // sidebar
  c.fillStyle = '#050705'; c.fillRect(0, 54, 250, 886); c.fillStyle = '#151B15'; c.fillRect(250, 54, 1, 886);
  img(c, IMG.logo, 112, 104, 150);
  ['Launch', 'Nodes', 'Agents', 'Arena', 'Earnings'].forEach((s, i) => {
    const y = 180 + i * 56, act = i === 0;
    if (act) { rrect(c, 16, y - 22, 218, 44, 10); c.fillStyle = 'rgba(200,255,0,0.1)'; c.fill(); c.fillStyle = C.volt; c.fillRect(16, y - 22, 4, 44); }
    c.fillStyle = act ? C.volt : '#4F5C4F'; c.fillRect(40, y - 7, 14, 14);
    txt(c, s, 70, y, 20, { family: 'Space Grotesk', weight: 500, italic: false, align: 'left', color: act ? C.white : '#8A978A' });
  });
  rrect(c, 16, 850, 218, 66, 12); c.fillStyle = '#0E130E'; c.fill(); c.strokeStyle = '#1E281E'; c.stroke();
  txt(c, 'Operator wallet', 34, 872, 13, { family: 'Space Grotesk', weight: 500, italic: false, align: 'left', color: '#6E7B6E' });
  txt(c, '7xKX…sAsU · 42.0 USDC', 34, 896, 15, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'left', color: C.white });
  // main
  txt(c, 'New campaign', 290, 110, 38, { family: 'Space Grotesk', weight: 700, italic: false, align: 'left', color: C.white });
  txt(c, 'One brief. Every market. Agents handle the rest.', 290, 150, 18, { family: 'Space Grotesk', weight: 500, italic: false, align: 'left', color: '#7D8B7D' });
  const label = (s, y) => hud(c, s, 290, y, { size: 14, color: '#6E7B6E' });
  label('BRAND', 196);
  rrect(c, 290, 212, 840, 54, 10); c.fillStyle = '#0E130E'; c.fill(); c.strokeStyle = '#243024'; c.lineWidth = 1.5; c.stroke();
  boltIcon(c, 318, 239, 24, C.volt);
  txt(c, 'KILAT Energy', 340, 240, 22, { family: 'Space Grotesk', weight: 700, italic: false, align: 'left', color: C.white });
  label('BRIEF', 296);
  const focus = u > 0.55 && u < 2.8;
  rrect(c, 290, 312, 840, 140, 10); c.fillStyle = '#0E130E'; c.fill(); c.strokeStyle = focus ? C.volt : '#243024'; c.lineWidth = focus ? 2.5 : 1.5; c.stroke();
  const n = Math.floor(clamp((u - 0.62) / 1.85) * BRIEF.length);
  const shown = BRIEF.slice(0, n);
  font(c, 22, { family: 'Space Grotesk', weight: 500, italic: false }); c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = C.white;
  const words = shown.split(' '); let line = '', ly = 344; const lines = [];
  words.forEach(w => { const tt = line ? line + ' ' + w : w; if (c.measureText(tt).width > 790) { lines.push(line); line = w; } else line = tt; });
  lines.push(line);
  lines.forEach((l, i) => c.fillText(l, 312, ly + i * 34));
  if (focus) { const lw = c.measureText(lines[lines.length - 1]).width; if (Math.floor(u * 4) % 2 === 0 || n < BRIEF.length) { c.fillStyle = C.volt; c.fillRect(314 + lw, ly + (lines.length - 1) * 34 - 13, 3, 26); } }
  // territories
  label('TERRITORIES', 496);
  const all = u > 3.0;
  ['Malaysia', 'Japan', 'Brazil', 'Nigeria', '+141'].forEach((s, i) => {
    const x = 290 + i * 118; rrect(c, x, 514, 108, 40, 20); c.fillStyle = all ? 'rgba(200,255,0,0.14)' : '#121812'; c.fill();
    txt(c, s, x + 54, 534, 15, { family: 'Space Grotesk', weight: 500, italic: false, color: all ? C.volt : '#B4C1B4' });
  });
  const hov = u > 2.9 && u < 3.0;
  rrect(c, 892, 512, 238, 44, 22); c.fillStyle = all ? C.volt : (hov ? '#1E281E' : '#121812'); c.fill(); c.strokeStyle = C.volt; c.lineWidth = 2; c.stroke();
  txt(c, all ? '✓ ALL 145 COUNTRIES' : 'ALL 145 COUNTRIES', 1011, 535, 17, { family: 'Space Grotesk', weight: 700, italic: false, color: all ? C.ink : C.volt });
  // mini pixel map
  const G = window.MAPGRID, mp = clamp((u - 3.0) / 0.9);
  for (let y = 0; y < 96; y += 2) for (let x = 0; x < 192; x += 2) if (G[y][x] === '1') {
    const lit = x / 192 < mp + rnd(x + y * 3) * 0.1 - 0.05 && mp > 0;
    c.fillStyle = lit ? C.volt : '#1D261D'; c.fillRect(290 + x * 2.6, 580 + y * 2.3, 4, 4);
  }
  // reach + list
  const reach = Math.floor(E.outCubic(clamp((u - 3.05) / 1.0)) * 48200000);
  hud(c, 'EST. REACH', 830, 600, { size: 14, color: '#6E7B6E' });
  txt(c, reach.toLocaleString('en-US'), 830, 645, 28, { family: 'Press Start 2P', weight: 400, italic: false, align: 'left', color: all ? C.volt : '#2C382C' });
  hud(c, 'COUNTRIES', 830, 700, { size: 14, color: '#6E7B6E' });
  txt(c, String(Math.floor(E.outCubic(mp) * 145)).padStart(3, '0') + '/145', 830, 738, 28, { family: 'Press Start 2P', weight: 400, italic: false, align: 'left', color: all ? C.white : '#2C382C' });
  // deploy button
  const hot = u > 4.5, pr = u > 5.6 && u < 5.75;
  c.save(); if (hot) { c.shadowColor = C.volt; c.shadowBlur = 30 + 20 * Math.sin(u * 20); }
  rrect(c, 290, 786 + (pr ? 4 : 0), 840, 80, 14); c.fillStyle = C.volt; c.fill(); c.restore();
  txt(c, 'DEPLOY TO AGENT NETWORK', 690, 828 + (pr ? 4 : 0), 30, { color: C.ink, stretch: 'expanded' });
  boltIcon(c, 1060, 826 + (pr ? 4 : 0), 40, C.ink);
  // right panel
  rrect(c, 1170, 90, 400, 776, 16); c.fillStyle = '#0B0F0B'; c.fill(); c.strokeStyle = '#1C251C'; c.lineWidth = 1.5; c.stroke();
  hud(c, 'NETWORK · LIVE', 1196, 126, { size: 14, color: C.volt });
  const st = [['Nodes online', '3,214'], ['Agents ready', '12,480'], ['Settlement', 'x402 · USDC'], ['Chain', 'Solana']];
  st.forEach(([a, b], i) => {
    const y = 176 + i * 62;
    txt(c, a, 1196, y, 17, { family: 'Space Grotesk', weight: 500, italic: false, align: 'left', color: '#7D8B7D' });
    txt(c, b, 1546, y, 19, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'right', color: C.white });
    c.fillStyle = '#1A221A'; c.fillRect(1196, y + 24, 350, 1);
  });
  hud(c, 'AGENT QUEUE', 1196, 446, { size: 14, color: '#6E7B6E' });
  for (let i = 0; i < 7; i++) {
    const ci = CITIES[i], y = 486 + i * 52, ready = u > 3.1 + i * 0.1;
    rrect(c, 1196, y - 20, 350, 42, 8); c.fillStyle = '#101610'; c.fill();
    c.drawImage(SPR.agents[i % 6], 1204, y - 16, 32, 32 * SPR.agents[i % 6].height / SPR.agents[i % 6].width);
    txt(c, `Agent · ${ci.c.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase())}`, 1246, y, 16, { family: 'Space Grotesk', weight: 500, italic: false, align: 'left', color: C.white });
    pxCircle(c, 1528, y, 6, 3, ready ? C.solG : '#3A443A');
  }
}

// ════════ S3 · DROP (16.024 → 22.424) ════════
function S3(t) {
  const kb = (t - P(2)) / BT, k = Math.floor(kb), u = t - P(2), ub = t - bt(32 + k);
  if (k < 4) {
    bg(ctx, C.ink);
    // rotating volt rays
    ctx.save(); ctx.translate(W / 2, H / 2 + 40); ctx.rotate(u * 0.6);
    for (let i = 0; i < 18; i++) { ctx.rotate(Math.PI * 2 / 18); ctx.fillStyle = i % 2 ? '#0B1400' : '#16290A'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1400, -120); ctx.lineTo(1400, 120); ctx.fill(); }
    ctx.restore();
    warp(ctx, t, W / 2, H / 2, C.volt, 140, 0.9, 1.8);
    // pixel shockwave
    const sw = u * 2400; ctx.save(); ctx.globalAlpha = clamp(1 - u * 1.4); pxRing(ctx, W / 2, H / 2, sw, 16, C.volt); ctx.restore();
    if (u < 0.3) for (let i = 0; i < 4; i++) lightning(ctx, 200 + i * 500, -40, W / 2 + (i - 1.5) * 120, H / 2, 900 + i * 7, 5, C.volt, 1 - u / 0.3);
    if (k >= 2 && ub < 0.2 && k === 2) for (let i = 0; i < 2; i++) lightning(ctx, i ? W + 40 : -40, 200, W / 2, 500, 400 + i, 4, C.white, 1 - ub * 5);
    const p = E.outBack(clamp(u / 0.42)), bob = Math.sin(u * 7) * 10, pu = 1 + 0.04 * Math.exp(-ub * 12);
    const mw = 760 * p * pu;
    ctx.save(); ctx.globalAlpha = 0.5; img(ctx, SPR.flashVolt, W / 2 + 18, (k >= 2 ? 440 : 540) + bob + 14, mw * 1.03); ctx.restore();
    img(ctx, IMG.flash, W / 2, (k >= 2 ? 440 : 540) + bob, mw);
    if (k >= 2) { const uu = t - bt(34); const s = lerp(1.6, 1, E.outExpo(clamp(uu / 0.15))); ctx.save(); ctx.translate(W / 2, 900); ctx.scale(s, s); img(ctx, IMG.word, 0, 0, 760); ctx.restore(); }
  } else if (k < 6) {
    bg(ctx, C.volt); halftone(ctx, C.ink, 28, 0.12, t);
    speedLines(ctx, t, C.ink, 40, 3000, 0.35);
    const uu = t - bt(36), s = lerp(2.4, 1, E.outExpo(clamp(uu / 0.2)));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(s, s); img(ctx, SPR.wordInk, 0, 0, 1500); ctx.restore();
    hud(ctx, 'THE ATTENTION NETWORK', W / 2, 860, { align: 'center', color: C.ink, size: 30, ls: 12 });
  } else if (k < 12) {
    bg(ctx, C.ink); speedLines(ctx, t, C.volt, 60, 4200, 0.55); floor(ctx, t, C.voltK, 0.5, 6, 760);
    const lines = [['THE GLOBAL', 6, C.white], ['ATTENTION', 8, C.volt], ['ECONOMY', 10, C.white]];
    lines.forEach(([s, kk, col], i) => {
      if (k < kk) return;
      const uu = t - bt(32 + kk);
      slam(ctx, s, W / 2, 300 + i * 220, 190, uu, { color: col, smear: true, dx: 900, from: 1.2 });
    });
    hud(ctx, 'VELLO · ' + (k < 8 ? 'BUILDING' : k < 10 ? 'FUELING' : 'POWERING') + ' THE', 80, 120, { color: C.volt, size: 22 });
  } else {
    bg(ctx, C.ink);
    const uu = t - bt(44);
    // solana gradient sweep
    const sweep = E.outExpo(clamp(uu / 0.4));
    ctx.save(); ctx.globalAlpha = 0.18; const gg = ctx.createLinearGradient(0, 0, W, 0); gg.addColorStop(0, C.solP); gg.addColorStop(1, C.solG); ctx.fillStyle = gg;
    for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(W * (sweep - 1) * 1.2, 0); ctx.transform(1, 0, -0.3, 1, 0, 0); ctx.fillRect(200 + i * 40, 250 + i * 210, W, 130); ctx.restore(); }
    ctx.restore();
    warp(ctx, t, W / 2, H / 2, C.solG, 80, 0.5, 1.2);
    slam(ctx, 'ON', W / 2, 340, 90, uu, { color: C.white });
    const u2 = t - bt(45);
    if (u2 > 0) {
      font(ctx, 260); const sw2 = ctx.measureText('SOLANA').width / 2; const g2 = ctx.createLinearGradient(-sw2, 0, sw2, 0); g2.addColorStop(0, C.solP); g2.addColorStop(1, C.solG);
      ctx.save(); const s = lerp(1.7, 1, E.outExpo(clamp(u2 / 0.18))); ctx.translate(W / 2, 560); ctx.scale(s, s);
      font(ctx, 260); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = g2; ctx.fillText('SOLANA', 0, 0); ctx.restore();
    }
    if (k >= 14) { const u3 = t - bt(46); ['400ms BLOCKS', 'AGENT-NATIVE PAYMENTS', 'GLOBAL BY DEFAULT'].forEach((s, i) => { if (u3 > i * 0.1) { rrect(ctx, W / 2 - 720 + i * 500, 790, 440, 64, 32); ctx.strokeStyle = C.solG; ctx.lineWidth = 2; ctx.stroke(); hud(ctx, s, W / 2 - 500 + i * 500, 822, { align: 'center', color: C.white, size: 22 }); } }); }
  }
}
function pxRing(c, cx, cy, r, cell, color) {
  c.fillStyle = color; const n = Math.max(24, Math.floor(r / 6));
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; c.fillRect(snap(cx + Math.cos(a) * r, cell), snap(cy + Math.sin(a) * r, cell), cell, cell); }
}

// ════════ S4 · OPERATORS → NODES (22.424 → 28.824) ════════
const NODES = (() => { const a = []; for (let i = 0; i < 90; i++) { const r = 70 * Math.sqrt(i) + rnd(i) * 30, an = i * 2.39996; a.push({ x: Math.cos(an) * r * 1.45, y: Math.sin(an) * r * 0.9, i }); } a.forEach((n, i) => { if (!i) return; let best = 0, bd = 1e9; for (let j = 0; j < i; j++) { const d = Math.hypot(a[j].x - n.x, a[j].y - n.y); if (d < bd) { bd = d; best = j; } } n.p = best; }); return a; })();
const NODE_LBL = { 3: 'TOKYO', 7: 'LAGOS', 11: 'SÃO PAULO', 16: 'MUMBAI', 21: 'SEOUL', 27: 'KUCHING', 34: 'DUBAI', 41: 'MEXICO CITY', 50: 'PARIS', 58: 'JAKARTA' };
function hexPath(c, x, y, r) { c.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; i ? c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); }
function S4(t) {
  const k = Math.floor((t - P(3)) / BT), u = t - P(3);
  bg(ctx, C.ink); pixelGrid(ctx, C.volt, 40, 0.06);
  if (k < 4) {
    floor(ctx, t, C.voltK, 0.4, 1.5, 720);
    const u0 = t - bt(48);
    slam(ctx, 'OPERATORS', W / 2, 200, 130, u0, { color: C.white, smear: true, dx: -600 });
    const morph = E.inOutExpo(prog(t, bt(50) - 0.1, bt(50) + 0.15));
    const cx = W / 2, cy = 570;
    if (morph < 1) { ctx.save(); ctx.globalAlpha = 1 - morph; sprite(ctx, OPER, cx - 12 * 12, cy - 8 * 18 - 30, 24, C.white); ctx.restore(); }
    if (morph > 0) {
      const r = 150 * E.outBack(morph);
      ctx.save(); ctx.shadowColor = C.volt; ctx.shadowBlur = 50; hexPath(ctx, cx, cy, r); ctx.fillStyle = '#0D1A00'; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = C.volt; ctx.stroke(); ctx.restore();
      img(ctx, IMG.mark, cx, cy, r * 0.9);
      pxRing(ctx, cx, cy, r + 40 + (t * 120) % 200, 8, C.voltD);
    }
    if (k >= 2) slam(ctx, 'BECOME NODES.', W / 2, 900, 130, t - bt(50), { color: C.volt, from: 0.6 });
  } else if (k < 12) {
    const uu = t - bt(52), z = lerp(1.7, 0.78, E.outCubic(clamp(uu / 3.2)));
    ctx.save(); ctx.translate(W / 2, H / 2 + 40); ctx.scale(z, z); ctx.rotate(uu * 0.05);
    const vis = NODES.filter(n => uu > n.i * 0.03);
    ctx.lineWidth = 2 / z;
    vis.forEach(n => { if (n.i) { const p = NODES[n.p], g = clamp((uu - n.i * 0.03) / 0.15); ctx.strokeStyle = 'rgba(200,255,0,0.35)'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(lerp(p.x, n.x, g), lerp(p.y, n.y, g)); ctx.stroke(); } });
    vis.forEach(n => { if (n.i) { const p = NODES[n.p], s = (rnd(n.i) + uu * 1.4) % 1; ctx.fillStyle = s > 0.5 ? C.gold : C.white; const sz = 8 / z; ctx.fillRect(lerp(p.x, n.x, s) - sz / 2, lerp(p.y, n.y, s) - sz / 2, sz, sz); } });
    vis.forEach(n => {
      const a = E.outBack(clamp((uu - n.i * 0.03) / 0.2)), r = (n.i ? 18 : 40) * a;
      hexPath(ctx, n.x, n.y, r); ctx.fillStyle = '#0B1400'; ctx.fill(); ctx.strokeStyle = C.volt; ctx.lineWidth = 3 / z; ctx.stroke();
      if (r > 4) { ctx.drawImage(SPR.agents[n.i % 6], n.x - r * 0.7, n.y - r * 0.8, r * 1.4, r * 1.4 * SPR.agents[0].height / SPR.agents[0].width); }
      if (NODE_LBL[n.i] && a > 0.9) { ctx.save(); ctx.translate(n.x + 28, n.y - 22); ctx.scale(1 / z, 1 / z); hud(ctx, 'NODE · ' + NODE_LBL[n.i], 0, 0, { color: C.volt, size: 18 }); ctx.restore(); }
    });
    ctx.restore();
    const msg = k < 8 ? ['EVERY OPERATOR', 'IS A NODE'] : ['EVERY NODE RUNS', 'AI AGENTS'];
    const mu = t - bt(k < 8 ? 52 : 56);
    rrect(ctx, 50, 60, 980, 230, 0); ctx.fillStyle = 'rgba(4,6,4,0.78)'; ctx.fill();
    slam(ctx, msg[0], 80, 135, 76, mu, { color: C.white, align: 'left', from: 1.1, dx: -300 });
    slam(ctx, msg[1], 80, 225, 76, mu - 0.08, { color: C.volt, align: 'left', from: 1.1, dx: -300 });
    hud(ctx, `NODES ONLINE ${String(vis.length * 37).padStart(5, '0')}`, W - 80, H - 70, { align: 'right', color: C.volt, size: 24 });
    hud(ctx, 'VIDEO GEN · EDIT · PUBLISH', 80, H - 70, { color: C.white, size: 24 });
  } else {
    const uu = t - bt(60);
    floor(ctx, t, C.voltK, 0.5, 3, 700);
    slam(ctx, 'SPIN UP AGENTS.', W / 2, 150, 110, uu, { color: C.white, smear: true, dx: 600 });
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3), x = W / 2 + (col - 1) * 420, y = 470 + row * 330;
      const f = E.outBack(clamp((uu - i * 0.07) / 0.25));
      if (f <= 0) continue;
      ctx.save(); ctx.translate(x, y); ctx.scale(Math.max(0.01, f), 1);
      rrect(ctx, -190, -140, 380, 290, 16); ctx.fillStyle = '#0B110B'; ctx.fill(); ctx.strokeStyle = i === 0 ? C.volt : '#2A362A'; ctx.lineWidth = 3; ctx.stroke();
      rrect(ctx, -170, -120, 130, 130, 10); ctx.fillStyle = '#141C14'; ctx.fill();
      const a = SPR.agents[i]; ctx.drawImage(a, -165, -115, 120, 120 * a.height / a.width);
      hud(ctx, `AGENT #${String(400 + i * 37).padStart(4, '0')}`, -20, -95, { color: C.white, size: 20 });
      hud(ctx, CITIES[i].c + ' · ' + CITIES[i].cc, -20, -60, { color: C.grey, size: 16 });
      hud(ctx, 'LANG ' + CITIES[i].lang, -20, -30, { color: C.grey, size: 16 });
      const minted = uu > 0.35 + i * 0.07;
      rrect(ctx, -170, 40, 340, 44, 22); ctx.fillStyle = minted ? C.volt : '#1A221A'; ctx.fill();
      hud(ctx, minted ? '✓ MINTED · LIVE' : 'MINTING…', 0, 62, { align: 'center', color: minted ? C.ink : C.grey, size: 18 });
      ctx.fillStyle = '#1A221A'; ctx.fillRect(-170, 104, 340, 10); ctx.fillStyle = C.volt; ctx.fillRect(-170, 104, 340 * clamp((uu - i * 0.07) / 0.6), 10);
      ctx.restore();
    }
  }
}

// ════════ S5 · GLOBE (28.824 → 35.224) ════════
const ORIGIN = { lon: 110.36, lat: 1.55 }; // Kuching
function v3(lon, lat) { const l = lon * Math.PI / 180, p = lat * Math.PI / 180; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; }
function proj(v, lon0, lat0, R, cx, cy, h = 0) {
  const l0 = lon0 * Math.PI / 180, p0 = lat0 * Math.PI / 180;
  // rotate around z by -l0, then around y by p0
  const x1 = v[0] * Math.cos(-l0) - v[1] * Math.sin(-l0), y1 = v[0] * Math.sin(-l0) + v[1] * Math.cos(-l0), z1 = v[2];
  const x2 = x1 * Math.cos(p0) + z1 * Math.sin(p0), z2 = -x1 * Math.sin(p0) + z1 * Math.cos(p0);
  const s = R * (1 + h);
  return [cx + y1 * s, cy - z2 * s, x2];
}
function globe(c, t, lon0, lat0, R, cx, cy, arcs, a = 1) {
  c.save();
  const g = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.25); g.addColorStop(0, 'rgba(200,255,0,0.18)'); g.addColorStop(1, 'rgba(200,255,0,0)');
  c.fillStyle = g; c.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fillStyle = '#060A04'; c.fill(); c.strokeStyle = 'rgba(200,255,0,0.4)'; c.lineWidth = 2; c.stroke();
  const pts = window.GLOBE, cell = Math.max(3, R / 70);
  for (let i = 0; i < pts.length; i++) {
    const [x, y, d] = proj(v3(pts[i][0], pts[i][1]), lon0, lat0, R, cx, cy);
    if (d <= 0) continue;
    c.globalAlpha = a * (0.25 + 0.75 * d); c.fillStyle = rnd(i) < 0.08 && Math.sin(t * 6 + i) > 0.6 ? C.white : C.volt;
    c.fillRect(x - cell / 2, y - cell / 2, cell, cell);
  }
  c.globalAlpha = a;
  if (arcs) {
    const o = v3(ORIGIN.lon, ORIGIN.lat);
    arcs.forEach(({ city, p, i }) => {
      const d = v3(city.lon, city.lat), om = Math.acos(clamp(o[0] * d[0] + o[1] * d[1] + o[2] * d[2], -1, 1));
      const N = 40, head = E.outCubic(p); let prev = null;
      c.lineWidth = 3; c.strokeStyle = C.gold;
      for (let s = 0; s <= N; s++) {
        const f = s / N * head, sa = Math.sin((1 - f) * om) / Math.sin(om), sb = Math.sin(f * om) / Math.sin(om);
        const v = [o[0] * sa + d[0] * sb, o[1] * sa + d[1] * sb, o[2] * sa + d[2] * sb];
        const q = proj(v, lon0, lat0, R, cx, cy, 0.09 * Math.sin(Math.PI * f) * om);
        q.push(q[2] > 0 || Math.hypot(q[0] - cx, q[1] - cy) > R);
        if (prev && q[3] && prev[3]) { c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(q[0], q[1]); c.stroke(); }
        prev = q;
      }
      if (p >= 1) {
        const [x, y, dd] = proj(d, lon0, lat0, R, cx, cy);
        if (dd > 0) { pxCircle(c, x, y, 10, 4, C.white); c.strokeStyle = C.volt; c.lineWidth = 2; c.globalAlpha = a * 0.7; c.beginPath(); c.arc(x, y, 14 + ((t * 40 + i * 9) % 30), 0, 7); c.stroke(); c.globalAlpha = a; if (i % 2 === 0) hud(c, city.c, x + 18, y - 16, { color: C.white, size: 16 }); }
      }
    });
  }
  c.restore();
}
function S5(t) {
  const k = Math.floor((t - P(4)) / BT), u = t - P(4);
  bg(ctx, C.ink); pixelGrid(ctx, C.volt, 48, 0.05);
  const zoomOut = k >= 12 ? E.inExpo(prog(t, bt(76), P(5))) : 0;
  const R = lerp(390, 2600, zoomOut), cx = lerp(1360, W / 2, zoomOut), cy = H / 2 + 20;
  const lon0 = 112 - u * 32, lat0 = 12 - u * 1.5;
  const arcs = CITIES.map((city, i) => ({ city, i, p: clamp((u - 0.25 - i * 0.22) / 0.5) })).filter(a => a.p > 0);
  globe(ctx, t, lon0, lat0, R, cx, cy, arcs);
  // left panel text
  ctx.save(); ctx.globalAlpha = 1 - zoomOut;
  slam(ctx, 'ONE BRIEF.', 110, 280, 110, t - bt(64), { color: C.white, align: 'left', from: 1.3, dx: -300 });
  if (k >= 2) slam(ctx, '145 COUNTRIES.', 110, 410, 78, t - bt(66), { color: C.volt, align: 'left', from: 1.3, dx: -300 });
  const cnt = Math.floor(E.inOutCubic(prog(t, bt(64), bt(75))) * 145);
  hud(ctx, 'COUNTRIES LIVE', 112, 560, { color: C.grey, size: 22 });
  txt(ctx, String(cnt).padStart(3, '0'), 110, 680, 130, { family: 'Press Start 2P', weight: 400, italic: false, align: 'left', color: C.volt });
  hud(ctx, 'ORIGIN · KUCHING, BORNEO', 112, 800, { color: C.gold, size: 20 });
  hud(ctx, 'ROUTED VIA AGENT NODES', 112, 836, { color: C.grey, size: 20 });
  ctx.restore();
}

// ════════ S6 · CULTURAL EDITS (35.224 → 41.624) ════════
function cardBg(c, w, h, city, tt) {
  const [b1, b2, ac] = city.pal;
  c.fillStyle = b1; c.fillRect(0, 0, w, h);
  c.save(); c.fillStyle = b2; c.globalAlpha = 0.85;
  if (city.pat === 'sun') { c.translate(w / 2, h * 0.38); c.rotate(tt * 0.6); for (let i = 0; i < 16; i++) { c.rotate(Math.PI / 8); c.beginPath(); c.moveTo(0, 0); c.lineTo(h, -h * 0.1); c.lineTo(h, h * 0.1); c.fill(); } }
  else if (city.pat === 'stripes') { c.rotate(-0.4); for (let i = -20; i < 40; i++) c.fillRect(i * w / 6 + (tt * 120) % (w / 3), -h, w / 12, h * 3); }
  else if (city.pat === 'grid') { const s = w / 8; for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) if (((x + y) / s + Math.floor(tt * 6)) % 2 < 1) c.fillRect(x, y, s, s); }
  else if (city.pat === 'waves') { c.lineWidth = w / 26; c.strokeStyle = b2; for (let i = 0; i < 14; i++) { c.beginPath(); for (let x = 0; x <= w; x += 8) { const y = i * h / 12 + Math.sin(x * 0.02 + tt * 5 + i) * w / 20; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); } }
  else { const s = w / 10; for (let y = 0; y < h + s; y += s) for (let x = 0; x < w + s; x += s) { c.beginPath(); c.arc(x + ((y / s) % 2) * s / 2, y, s * 0.28 * (0.6 + 0.4 * Math.sin(tt * 4 + x)), 0, 7); c.fill(); } }
  c.restore();
}
function drawCan(c, x, y, s, city, tt) {
  const [, b2, ac] = city.pal;
  c.save(); c.translate(x, y + Math.sin(tt * 8) * s * 0.08); c.rotate(Math.sin(tt * 3) * 0.15);
  rrect(c, -s * 0.32, -s * 0.6, s * 0.64, s * 1.2, s * 0.12); c.fillStyle = '#0A0D0A'; c.fill(); c.lineWidth = s * 0.03; c.strokeStyle = '#000'; c.stroke();
  c.fillStyle = C.volt; c.fillRect(-s * 0.32, -s * 0.3, s * 0.64, s * 0.5);
  boltIcon(c, 0, -s * 0.1, s * 0.34, C.ink);
  txt(c, 'KILAT', 0, s * 0.33, s * 0.15, { color: C.volt, stretch: 'expanded' });
  c.fillStyle = '#999'; c.fillRect(-s * 0.26, -s * 0.66, s * 0.52, s * 0.07);
  c.restore();
}
function drawCard(c, x, y, w, h, city, tt, full) {
  c.save(); rrect(c, x, y, w, h, w * 0.07); c.clip(); c.translate(x, y);
  cardBg(c, w, h, city, tt);
  drawCan(c, w / 2, h * 0.42, w * 0.62, city, tt);
  // caption
  const cap = city.cap, sz = fit(c, cap, w * 0.1, w * 0.88);
  const pop = full ? E.outBack(clamp(tt / 0.15)) : 1;
  c.save(); c.translate(w / 2, h * 0.76); c.scale(pop, pop);
  rrect(c, -w * 0.46, -sz * 0.9, w * 0.92, sz * 1.8, 8); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill();
  txt(c, cap, 0, 0, sz, { color: city.pal[2], stroke: sz * 0.18, strokeColor: '#000' });
  c.restore();
  // top bar
  hud(c, city.h, w * 0.06, h * 0.05, { color: C.white, size: Math.max(10, w * 0.045) });
  rrect(c, w * 0.72, h * 0.03, w * 0.22, h * 0.04, 6); c.fillStyle = C.red; c.fill();
  hud(c, 'LIVE', w * 0.83, h * 0.05, { align: 'center', color: C.white, size: Math.max(8, w * 0.038) });
  // side icons
  for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(w * 0.9, h * (0.45 + i * 0.08), w * 0.05, 0, 7); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill(); }
  // progress
  c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(0, h - h * 0.012, w, h * 0.012); c.fillStyle = C.volt; c.fillRect(0, h - h * 0.012, w * ((tt * 0.4) % 1), h * 0.012);
  c.restore();
}
function S6(t) {
  const k = Math.floor((t - P(5)) / BT), u = t - P(5);
  if (k < 8) {
    const city = CITIES[k], ub = t - bt(80 + k), [b1, b2, ac] = city.pal;
    bg(ctx, C.ink);
    // giant outlined city name behind
    ctx.save(); ctx.globalAlpha = 0.9; const sz = fit(ctx, city.c, 300, 1800);
    txt(ctx, city.c, W / 2 + (1 - E.outExpo(clamp(ub / 0.3))) * 300, H / 2 - 180, sz, { outline: 3, color: b2 });
    txt(ctx, city.c, W / 2 - (1 - E.outExpo(clamp(ub / 0.3))) * 300, H / 2 + 180, sz, { outline: 3, color: ac });
    ctx.restore();
    speedLines(ctx, t, b2, 30, 3000, 0.35, k % 2 ? 1 : -1, k * 9);
    const ph = 960, pw = ph * 9 / 16, s = lerp(1.12, 1, E.outExpo(clamp(ub / 0.2)));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.rotate((k % 2 ? 1 : -1) * 0.03);
    rrect(ctx, -pw / 2 - 14, -ph / 2 - 14, pw + 28, ph + 28, 48); ctx.fillStyle = '#000'; ctx.fill(); ctx.strokeStyle = '#2C2C2C'; ctx.lineWidth = 4; ctx.stroke();
    drawCard(ctx, -pw / 2, -ph / 2, pw, ph, city, ub + k, true);
    ctx.restore();
    // meta
    hud(ctx, `${city.c} · ${city.cc}`, 90, 140, { color: C.white, size: 30 });
    hud(ctx, `LANG ${city.lang} · CULTURAL EDIT`, 90, 186, { color: C.volt, size: 22 });
    hud(ctx, `AGENT #${String(400 + k * 37).padStart(4, '0')}`, 90, 222, { color: C.grey, size: 22 });
    hud(ctx, 'VIEWS', W - 90, 860, { align: 'right', color: C.grey, size: 22 });
    txt(ctx, Math.floor(80000 + rnd(k) * 900000 + ub * 1200000).toLocaleString('en-US'), W - 90, 920, 44, { family: 'Press Start 2P', weight: 400, italic: false, align: 'right', color: C.volt });
    hud(ctx, `${String(k + 1).padStart(3, '0')}/145`, W - 90, 140, { align: 'right', color: C.white, size: 30 });
  } else {
    const uu = t - bt(88), z = lerp(2.6, 1, E.outExpo(clamp(uu / 1.4)));
    bg(ctx, C.ink);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    const cw = 214, ch = cw * 16 / 9, gap = 24, cols = 9, rows = 3;
    const ox = (W - (cols * cw + (cols - 1) * gap)) / 2, oy = (H - (rows * ch + (rows - 1) * gap)) / 2;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const i = r * cols + q, yo = ((q % 2) ? -1 : 1) * ((uu * 60) % 40);
      drawCard(ctx, ox + q * (cw + gap), oy + r * (ch + gap) + yo, cw, ch, CITIES[(i * 5) % CITIES.length], uu + i * 0.3, false);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(4,6,4,0.55)'; ctx.fillRect(0, 0, W, H);
    const m = k < 10 ? ['ONE BRAND.', C.white] : k < 12 ? ['EVERY CULTURE.', C.volt] : k < 14 ? ['NATIVE EDITS.', C.white] : ['145 COUNTRIES.', C.volt];
    const mu = t - bt(80 + (k - (k % 2)));
    rrect(ctx, 0, H / 2 - 110, W, 220, 0); ctx.fillStyle = C.ink; ctx.fill();
    slam(ctx, m[0], W / 2, H / 2, 160, mu, { color: m[1], smear: true, dx: k % 4 ? -700 : 700 });
  }
}

// ════════ S7 · x402 (41.624 → 48.024) ════════
const TERM = [
  ['> POST /v1/render/localize  lang=ja-JP', C.white],
  ['< 402 PAYMENT REQUIRED  price=0.04 USDC', C.gold],
  ['> X-PAYMENT  sig=5h3K…9qPz  amt=0.04', C.white],
  ['< 200 OK  settled on Solana  412ms', C.solG],
  ['> POST /v1/publish  region=JP  slots=12', C.white],
  ['< 402 PAYMENT REQUIRED  price=0.02 USDC', C.gold],
  ['> X-PAYMENT  sig=9Zp1…kD2x  amt=0.02', C.white],
  ['< 200 OK  ✓ live @kilat.jp', C.solG]];
const BOARD = [['MY', 'kuching.node', 2.41, 1842.1], ['JP', 'shibuya.ops', 2.12, 1610.4], ['BR', 'sampa.clips', 1.87, 1422.9], ['NG', 'lagos.wave', 1.54, 1170.3], ['IN', 'bombay.edit', 1.31, 996.8]];
function S7(t) {
  const k = Math.floor((t - P(6)) / BT), u = t - P(6);
  bg(ctx, C.ink); pixelGrid(ctx, C.gold, 40, 0.05);
  if (k < 8) {
    slam(ctx, 'AGENTS PAY AGENTS.', 90, 130, 92, u, { color: C.white, align: 'left', from: 1.2, dx: -400 });
    hud(ctx, 'x402  ·  HTTP-NATIVE PAYMENTS  ·  USDC ON SOLANA', 94, 214, { color: C.gold, size: 24 });
    // two agents
    const A = [260, 640], B = [820, 640];
    [[A, 0, 'AGENT · TOKYO'], [B, 2, 'EDIT NODE · SEOUL']].forEach(([p, s, l], i) => {
      ctx.save(); ctx.shadowColor = C.volt; ctx.shadowBlur = 30; rrect(ctx, p[0] - 130, p[1] - 150, 260, 300, 18); ctx.fillStyle = '#0C120C'; ctx.fill(); ctx.restore();
      ctx.strokeStyle = i ? C.cyan : C.volt; ctx.lineWidth = 3; rrect(ctx, p[0] - 130, p[1] - 150, 260, 300, 18); ctx.stroke();
      const a = SPR.agents[s], bob = Math.sin(t * 6 + i * 2) * 8; ctx.drawImage(a, p[0] - 90, p[1] - 130 + bob, 180, 180 * a.height / a.width);
      hud(ctx, l, p[0], p[1] + 115, { align: 'center', color: C.white, size: 18 });
    });
    // coins flying A→B on each beat
    for (let j = 0; j < 8; j++) {
      const d = t - bt(96 + j); if (d < 0 || d > 0.55) continue;
      const p = E.inOutCubic(d / 0.55), x = lerp(A[0] + 130, B[0] - 130, p), y = 640 - Math.sin(p * Math.PI) * 220;
      pxCircle(ctx, x, y, 44, 8, C.gold); pxCircle(ctx, x, y, 24, 8, '#FFE9A0');
      hud(ctx, j % 2 ? '$0.02 USDC' : '$0.04 USDC', x, y - 72, { align: 'center', color: C.gold, size: 26 });
    }
    // terminal
    rrect(ctx, 1040, 300, 800, 620, 16); ctx.fillStyle = '#070A07'; ctx.fill(); ctx.strokeStyle = '#2A2410'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#110F06'; ctx.fillRect(1040, 300, 800, 46);
    hud(ctx, 'agent@tokyo-0412 : x402', 1066, 324, { color: C.gold, size: 16 });
    const n = Math.floor(u / (BT * 0.5)) + 1;
    TERM.slice(0, Math.min(n, 8)).forEach(([s, col], i) => txt(ctx, s, 1066, 390 + i * 62, 22, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'left', color: col }));
    cursorBlock(ctx, 1066, 390 + Math.min(n, 8) * 62, 26, t, C.gold);
  } else {
    const uu = t - bt(104);
    slam(ctx, 'VERIFIED PERFORMANCE.', 90, 130, 80, uu, { color: C.white, align: 'left', from: 1.2, dx: -400 });
    if (k >= 10) slam(ctx, 'REAL REWARDS.', 90, 230, 80, t - bt(106), { color: C.volt, align: 'left', from: 1.2, dx: -400 });
    rrect(ctx, 90, 320, 1740, 640, 18); ctx.fillStyle = '#090D09'; ctx.fill(); ctx.strokeStyle = '#243024'; ctx.lineWidth = 2; ctx.stroke();
    hud(ctx, 'ARENA · SEASON 1 · USDC', 130, 372, { color: C.gold, size: 22 });
    hud(ctx, 'COLLECTED VIEWS', 1130, 372, { color: C.grey, size: 18 });
    txt(ctx, Math.floor(41000000 + uu * 2400000).toLocaleString('en-US'), 1790, 372, 26, { family: 'Press Start 2P', weight: 400, italic: false, align: 'right', color: C.volt });
    BOARD.forEach(([cc, name, mv, usd], i) => {
      const y = 460 + i * 100, f = E.outExpo(clamp((uu - i * 0.06) / 0.4));
      ctx.save(); ctx.translate((1 - f) * -200, 0); ctx.globalAlpha = f;
      txt(ctx, String(i + 1), 150, y, 40, { family: 'Press Start 2P', weight: 400, italic: false, color: i === 0 ? C.gold : C.white });
      rrect(ctx, 210, y - 32, 64, 64, 10); ctx.fillStyle = '#141C14'; ctx.fill(); ctx.drawImage(SPR.agents[i], 216, y - 28, 52, 52 * SPR.agents[i].height / SPR.agents[i].width);
      hud(ctx, cc + ' · ' + name, 300, y, { color: C.white, size: 26 });
      const bw = 520 * mv / 2.41 * E.outCubic(clamp((uu - 0.1 - i * 0.06) / 0.8));
      ctx.fillStyle = '#1A221A'; ctx.fillRect(820, y - 10, 520, 20); ctx.fillStyle = i === 0 ? C.gold : C.volt; ctx.fillRect(820, y - 10, bw, 20);
      hud(ctx, (mv * clamp(uu / 1.2)).toFixed(2) + 'M VIEWS', 1360, y, { color: C.grey, size: 20 });
      txt(ctx, '+$' + (usd * clamp(uu / 1.6)).toFixed(2), 1790, y, 30, { family: 'JetBrains Mono', weight: 700, italic: false, align: 'right', color: C.solG });
      ctx.restore();
    });
    if (k >= 12) { const s = E.outBack(clamp((t - bt(108)) / 0.25)); ctx.save(); ctx.translate(1620, 220); ctx.rotate(-0.12); ctx.scale(s, s); rrect(ctx, -170, -50, 340, 100, 12); ctx.strokeStyle = C.volt; ctx.lineWidth = 6; ctx.stroke(); hud(ctx, '✓ VERIFIED', 0, 2, { align: 'center', color: C.volt, size: 40 }); ctx.restore(); }
  }
}

// ════════ S8 · MONTAGE (48.024 → 54.424) ════════
function S8(t) {
  const k = Math.floor((t - P(7)) / BT), ub = t - bt(112 + k), u = t - P(7);
  const half = ub >= BT / 2 ? 1 : 0, uh = ub - half * BT / 2;
  switch (k) {
    case 0: { // speedometer
      bg(ctx, C.ink); const cx = W / 2, cy = 620, R = 380, v = E.outExpo(clamp(ub / 0.3));
      for (let i = 0; i <= 40; i++) { const a = Math.PI * 0.8 + i / 40 * Math.PI * 1.4, on = i / 40 <= v; ctx.fillStyle = on ? (i > 32 ? C.red : C.volt) : '#1A221A'; ctx.save(); ctx.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.rotate(a); ctx.fillRect(-20, -8, 60, 16); ctx.restore(); }
      const na = Math.PI * 0.8 + v * Math.PI * 1.36 + Math.sin(t * 60) * 0.02; ctx.strokeStyle = C.white; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * (R - 60), cy + Math.sin(na) * (R - 60)); ctx.stroke();
      txt(ctx, Math.floor(v * 48213).toLocaleString('en-US'), cx, cy + 120, 64, { family: 'Press Start 2P', weight: 400, italic: false, color: C.volt });
      hud(ctx, 'VIEWS / SEC', cx, cy + 210, { align: 'center', color: C.white, size: 28 }); break;
    }
    case 1: { bg(ctx, C.volt); speedLines(ctx, t, C.ink, 70, 5000, 0.5); const x = lerp(-400, W + 400, E.inOutExpo(clamp(ub / 0.38))); img(ctx, SPR.flashPxBig, x, H / 2, 620); break; }
    case 2: { bg(ctx, C.ink); globe(ctx, t, 40 - ub * 400, 15, 470, W / 2, H / 2, CITIES.map((city, i) => ({ city, i, p: 1 }))); break; }
    case 3: { bg(ctx, C.ink); const city = CITIES[8 + half * 3]; const ph = 1000, pw = ph * 9 / 16; drawCard(ctx, W / 2 - pw / 2, 40, pw, ph, city, uh + 3, true); txt(ctx, city.c, half ? 1500 : 420, H / 2, 90, { outline: 3, color: city.pal[1] }); break; }
    case 4: { bg(ctx, half ? C.volt : C.ink); txt(ctx, half ? '→' : 'BRIEF', W / 2, H / 2, half ? 400 : 300, { color: half ? C.ink : C.white }); break; }
    case 5: { bg(ctx, C.volt); halftone(ctx, C.ink, 30, 0.15, t); txt(ctx, 'AGENTS', W / 2, H / 2, 300, { color: C.ink }); break; }
    case 6: { bg(ctx, C.ink); floor(ctx, t, C.voltD, 0.8, 8, 620); txt(ctx, '145', W / 2, H / 2 - 40, 520, { outline: 6, color: C.volt }); break; }
    case 7: { bg(ctx, C.ink); pixelGrid(ctx, C.gold, 32, 0.15); txt(ctx, 'x402', W / 2, H / 2, 380, { color: C.gold }); break; }
    case 8: {
      bg(ctx, C.ink);
      for (let i = 0; i < 40; i++) { const x = rnd(i) * W, y = ((rnd(i * 3) * H * 1.5 + ub * 2200 * (0.6 + rnd(i * 5))) % (H + 200)) - 100; pxCircle(ctx, x, y, 22, 6, C.gold); }
      txt(ctx, 'PAID.', W / 2, H / 2, 340, { color: C.solG, stroke: 20, strokeColor: C.ink }); break;
    }
    case 9: { // checkered flag
      bg(ctx, C.ink); const s = 90;
      for (let y = -2; y < 15; y++) for (let x = -2; x < 24; x++) { if ((x + y) % 2) continue; const wv = Math.sin(x * 0.5 + t * 14) * 40 + Math.sin(y * 0.4 + t * 9) * 20; ctx.fillStyle = C.volt; ctx.fillRect(x * s + wv * 0.4, y * s + wv, s, s); }
      txt(ctx, 'FASTEST NETWORK WINS', W / 2, H / 2, 110, { color: C.white, stroke: 26, strokeColor: C.ink }); break;
    }
    case 10: {
      bg(ctx, C.ink); ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(0.75, 0.75); ctx.rotate(t * 0.4);
      NODES.forEach(n => { if (n.i) { const p = NODES[n.p]; ctx.strokeStyle = 'rgba(200,255,0,0.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y); ctx.stroke(); } hexPath(ctx, n.x, n.y, 16); ctx.fillStyle = n.i % 7 ? C.voltD : C.gold; ctx.fill(); });
      ctx.restore(); hud(ctx, 'NODES · 3,214 · AGENTS · 12,480', W / 2, H - 90, { align: 'center', color: C.volt, size: 30 }); break;
    }
    case 11: { bg(ctx, C.ink); for (let i = 0; i < 4; i++) lightning(ctx, rnd(i + k) * W, -30, rnd(i * 3 + k) * W, H + 30, i * 77 + Math.floor(ub * 30), 5, i % 2 ? C.white : C.volt, 1); img(ctx, IMG.launch, W / 2, H / 2 - lerp(0, 120, ub / BT), 420); break; }
    default: {
      const words = [['THIS IS', C.ink, C.white], ['THE GLOBAL', C.volt, C.ink], ['ATTENTION', C.ink, C.volt], ['ECONOMY.', C.white, C.ink]];
      const [s, b, f] = words[k - 12]; bg(ctx, b);
      if (k === 15) { speedLines(ctx, t, C.volt, 40, 3000, 0.4); }
      if (k === 13) halftone(ctx, C.ink, 30, 0.15, t);
      slam(ctx, s, W / 2, H / 2, k === 12 ? 220 : 210, ub, { color: f, from: 1.8 });
    }
  }
}

// ════════ S9 · OUTRO (54.424 → 60) ════════
function S9(t) {
  const u = t - P(8);
  bg(ctx, C.ink);
  cover(ctx, IMG.jungle, 0.9, 1.08 + u * 0.02);
  const g = ctx.createRadialGradient(W / 2, 420, 50, W / 2, 420, 900); g.addColorStop(0, 'rgba(200,255,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (u < 1.2) warp(ctx, t, W / 2, 400, C.volt, 100, clamp(1 - u / 1.2), 2);
  if (u < 0.35) for (let i = 0; i < 3; i++) lightning(ctx, 300 + i * 650, -20, W / 2 + (i - 1) * 150, 420, 500 + i * 3, 5, C.volt, 1 - u / 0.35);
  const p = E.outBack(clamp(u / 0.45)), bob = Math.sin(u * 3) * 8;
  ctx.save(); ctx.globalAlpha = 0.45; img(ctx, SPR.flashVolt, W / 2 + 14, 380 + bob + 12, 560 * p * 1.03); ctx.restore();
  img(ctx, IMG.flash, W / 2, 380 + bob, 560 * p);
  const wu = u - 0.2; if (wu > 0) { const s = lerp(1.5, 1, E.outExpo(clamp(wu / 0.2))); ctx.save(); ctx.translate(W / 2, 735); ctx.scale(s, s); img(ctx, IMG.word, 0, 0, 640); ctx.restore(); }
  if (u > 0.5) { const a = clamp((u - 0.5) / 0.3); ctx.globalAlpha = a; hud(ctx, 'THE GLOBAL ATTENTION ECONOMY ON SOLANA', W / 2, 850, { align: 'center', color: C.white, size: 34, ls: 6 }); ctx.globalAlpha = 1; }
  if (u > 1.4) {
    const a = E.outBack(clamp((u - 1.4) / 0.35));
    ctx.save(); ctx.translate(W / 2, 950); ctx.scale(a, a);
    rrect(ctx, -330, -40, 420, 80, 40); ctx.fillStyle = C.volt; ctx.fill();
    txt(ctx, 'BECOME A NODE', -120, 2, 30, { color: C.ink });
    hud(ctx, 'velloagents.com', 120, 2, { align: 'left', color: C.white, size: 30, ls: 1 });
    ctx.restore();
  }
  hud(ctx, 'OPERATORS · BUILDERS · BRANDS', 60, 60, { color: C.grey, size: 18 });
  hud(ctx, 'x402 · SOLANA', W - 60, 60, { align: 'right', color: C.grey, size: 18 });
  if (u > 4.6) flashOver(C.ink, E.inOutCubic(prog(u, 4.6, 5.4)));
}
