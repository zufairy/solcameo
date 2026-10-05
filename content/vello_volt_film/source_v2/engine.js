// ───────────────────────── VELLO // VOLT motion engine ─────────────────────────
// Deterministic: render(t) draws the exact frame for time t (seconds).
const W = 1920, H = 1080;
const cv = document.getElementById('c');
let ctx = cv.getContext('2d');
const MAINCTX = ctx;

// Brand tokens — "VOLT" system
const C = {
  volt: '#C8FF00', voltD: '#8BD100', voltK: '#3E5E00',
  ink: '#040604', carbon: '#0A0E0A', smoke: '#141A14', line: '#1F2A1F',
  white: '#F3FFE3', grey: '#7D8B7D', gold: '#FFC83D', red: '#FF2D2D',
  solP: '#9945FF', solG: '#14F195', cyan: '#3DF5FF', pink: '#FF3D9A'
};

// Music grid (measured from the track): 150 BPM, first downbeat at 3.224s
const B0 = 3.224, BT = 0.4;
const bt = k => B0 + k * BT;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, u) => a + (b - a) * u;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  outExpo: u => u >= 1 ? 1 : 1 - Math.pow(2, -10 * u),
  inExpo: u => u <= 0 ? 0 : Math.pow(2, 10 * u - 10),
  inOutCubic: u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2,
  inOutExpo: u => u <= 0 ? 0 : u >= 1 ? 1 : u < .5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2,
  outBack: u => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); },
  outCubic: u => 1 - Math.pow(1 - u, 3),
  inCubic: u => u * u * u,
  outElastic: u => u === 0 ? 0 : u === 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - .75) * (2 * Math.PI) / 3) + 1,
};
function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const snap = (v, g) => Math.round(v / g) * g;

// ── fonts ──
const SCRIPT = "'Noto Sans CJK JP','Noto Sans Arabic','Noto Sans Devanagari','Noto Sans Thai'";
function font(c, size, o = {}) {
  const fam = o.family || 'Archivo';
  const w = o.weight || 900, it = o.italic === false ? '' : (fam === 'Archivo' ? 'italic ' : '');
  c.font = `${it}${w} ${size}px ${fam === 'Archivo' ? 'Archivo' : `'${fam}'`}, ${SCRIPT}, sans-serif`;
  c.fontStretch = o.stretch || (fam === 'Archivo' ? 'expanded' : 'normal');
  c.letterSpacing = (o.ls || 0) + 'px';
}
function txt(c, s, x, y, size, o = {}) {
  font(c, size, o);
  c.textAlign = o.align || 'center';
  c.textBaseline = o.base || 'middle';
  if (o.stroke) { c.lineWidth = o.stroke; c.strokeStyle = o.strokeColor || C.ink; c.lineJoin = 'round'; c.strokeText(s, x, y); }
  if (o.outline) { c.lineWidth = o.outline; c.strokeStyle = o.color || C.white; c.strokeText(s, x, y); return; }
  c.fillStyle = o.color || C.white;
  c.fillText(s, x, y);
}
function fit(c, s, size, maxW, o = {}) {
  font(c, size, o); const w = c.measureText(s).width;
  return w > maxW ? size * maxW / w : size;
}
// slam-in text with scale punch + directional smear
function slam(c, s, x, y, size, u, o = {}) {
  const p = E.outExpo(clamp(u / (o.dur || 0.16)));
  const sc = lerp(o.from || 1.55, 1, p);
  const dx = (o.dx || 0) * (1 - p), dy = (o.dy || 0) * (1 - p);
  c.save();
  c.translate(x + dx, y + dy); c.scale(sc, sc);
  if (o.smear && p < 1) {
    for (let k = 4; k >= 1; k--) {
      c.globalAlpha = 0.18 * (1 - p);
      txt(c, s, (o.dx || -300) * 0.12 * k * (1 - p) * -1, 0, size, o);
    }
  }
  c.globalAlpha = (o.alpha ?? 1) * clamp(u / 0.03);
  txt(c, s, 0, 0, size, o);
  c.restore();
}

// ── images ──
const IMG = {};
const IMGLIST = {
  mark: 'assets/vello-mark-lime.png', logo: 'assets/vello-logo-white.png'
};
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

// derived sprites
const SPR = {};
function tint(img, color, w, h) {
  const c = mk(w || img.width, h || img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}
function pixelize(img, cells, filter) {
  const ar = img.height / img.width;
  const sw = cells, sh = Math.round(cells * ar);
  const s = mk(sw, sh), sx = s.getContext('2d');
  if (filter) sx.filter = filter;
  sx.drawImage(img, 0, 0, sw, sh);
  // hard alpha
  const d = sx.getImageData(0, 0, sw, sh);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 110 ? 255 : 0;
  sx.putImageData(d, 0, 0);
  const out = mk(sw * 8, sh * 8), ox = out.getContext('2d');
  ox.imageSmoothingEnabled = false; ox.drawImage(s, 0, 0, out.width, out.height);
  return out;
}
function buildSprites() {
  SPR.markWhite = tint(IMG.mark, C.white);
  SPR.logoInk = tint(IMG.logo, C.ink);
  SPR.agents = Array.from({ length: 12 }, (_, i) => identicon(i));
  // overlays
  SPR.scan = mk(W, H); { const x = SPR.scan.getContext('2d'); x.fillStyle = 'rgba(0,0,0,0.10)'; for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1); }
  SPR.vig = mk(W, H); { const x = SPR.vig.getContext('2d'); const g = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
  SPR.grain = [];
  for (let k = 0; k < 6; k++) {
    const g = mk(480, 270), x = g.getContext('2d'); const d = x.createImageData(480, 270);
    for (let i = 0; i < d.data.length; i += 4) { const v = rnd(i * 0.37 + k * 999.1) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 16; }
    x.putImageData(d, 0, 0); SPR.grain.push(g);
  }
  SPR.small = mk(W, H); SPR.tmp = mk(W, H); SPR.tmp2 = mk(W, H);
  SPR.ui = mk(1600, 940);
  SPR.bufA = mk(W, H); SPR.bufB = mk(W, H); SPR.bufC = mk(W, H);
}

// ── primitives ──
function bg(c, color) { c.fillStyle = color; c.fillRect(-200, -200, W + 400, H + 400); }
function rrect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function pxCircle(c, cx, cy, r, cell, color) {
  c.fillStyle = color;
  for (let y = -r; y <= r; y += cell) for (let x = -r; x <= r; x += cell)
    if (x * x + y * y <= r * r) c.fillRect(Math.round(cx + x - cell / 2), Math.round(cy + y - cell / 2), cell - 1, cell - 1);
}
function sprite(c, rows, x, y, cell, color) {
  c.fillStyle = color;
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === 'X') c.fillRect(x + i * cell, y + j * cell, cell - 1, cell - 1); });
}
const BOLT = [[0.58, 0], [0.12, 0.56], [0.44, 0.56], [0.34, 1], [0.88, 0.40], [0.55, 0.40], [0.72, 0]];
function boltIcon(c, x, y, s, color) {
  c.fillStyle = color; c.beginPath();
  BOLT.forEach(([a, b], i) => i ? c.lineTo(x + a * s - s / 2, y + b * s - s / 2) : c.moveTo(x + a * s - s / 2, y + b * s - s / 2));
  c.closePath(); c.fill();
}
function boltPts(x1, y1, x2, y2, seed, disp, depth, grid) {
  let pts = [[x1, y1], [x2, y2]];
  for (let d = 0; d < depth; d++) {
    const np = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const o = (rnd(seed + i * 13.1 + d * 71.7) - .5) * disp;
      np.push([mx - dy / L * o, my + dx / L * o], pts[i + 1]);
    }
    pts = np; disp *= 0.55;
  }
  if (grid) pts = pts.map(([x, y]) => [snap(x, grid), snap(y, grid)]);
  return pts;
}
function drawBolt(c, pts, w, color, a = 1) {
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineJoin = 'miter'; c.lineCap = 'square';
  const pass = (lw, col, al) => { c.globalAlpha = al * a; c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); };
  pass(w * 9, color, 0.08); pass(w * 4, color, 0.22); pass(w * 1.6, color, 0.9); pass(w * 0.6, '#ffffff', 1);
  c.restore();
}
function lightning(c, x1, y1, x2, y2, seed, w, color, a) {
  const p = boltPts(x1, y1, x2, y2, seed, Math.hypot(x2 - x1, y2 - y1) * 0.35, 6, 6);
  drawBolt(c, p, w, color, a);
  // branches
  for (let b = 0; b < 3; b++) {
    const i = Math.floor(rnd(seed + b * 5.3) * (p.length - 6)) + 2, [bx, by] = p[i];
    const ang = Math.atan2(y2 - y1, x2 - x1) + (rnd(seed + b * 9) - .5) * 1.8, L = 80 + rnd(seed + b) * 220;
    drawBolt(c, boltPts(bx, by, bx + Math.cos(ang) * L, by + Math.sin(ang) * L, seed + b * 31, L * 0.4, 4, 6), w * 0.5, color, a * 0.8);
  }
}
// horizontal pixel speed lines
function speedLines(c, t, color, n = 60, speed = 3200, a = 1, dir = -1, seed = 1) {
  c.save(); c.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const y = snap(rnd(i + seed) * H, 6), len = 120 + rnd(i * 3 + seed) * 700, th = [2, 4, 6, 10][Math.floor(rnd(i * 7 + seed) * 4)];
    const sp = speed * (0.5 + rnd(i * 11 + seed));
    let x = ((rnd(i * 5 + seed) * (W + len) + t * sp) % (W + len * 2)) - len;
    if (dir < 0) x = W - x;
    c.globalAlpha = a * (0.25 + rnd(i * 13 + seed) * 0.75);
    c.fillRect(snap(x, 6), y, len, th);
  }
  c.restore();
}
// radial warp lines from center
function warp(c, t, cx, cy, color, n = 120, a = 1, speed = 1.4) {
  c.save(); c.strokeStyle = color; c.lineCap = 'butt';
  for (let i = 0; i < n; i++) {
    const ang = rnd(i) * Math.PI * 2, ph = (rnd(i * 3) + t * speed * (0.6 + rnd(i * 7))) % 1;
    const r1 = Math.pow(ph, 2.2) * 1400, r2 = r1 + 40 + ph * 380;
    c.globalAlpha = a * ph; c.lineWidth = 1 + ph * 7;
    c.beginPath(); c.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); c.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2); c.stroke();
  }
  c.restore();
}
// perspective racing floor
function floor(c, t, color, a = 1, speed = 3, horizon = 640) {
  c.save(); c.strokeStyle = color; c.globalAlpha = a;
  const cx = W / 2;
  for (let i = -24; i <= 24; i++) { c.lineWidth = i === 0 ? 3 : 1.5; c.beginPath(); c.moveTo(cx + i * 6, horizon); c.lineTo(cx + i * 260, H + 40); c.stroke(); }
  for (let k = 0; k < 22; k++) {
    const z = ((k - t * speed) % 22 + 22) % 22, y = horizon + Math.pow(z / 22, 2.4) * (H - horizon + 80);
    c.lineWidth = 1 + (y - horizon) / 160; c.globalAlpha = a * clamp((y - horizon) / 120);
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }
  const g = c.createLinearGradient(0, horizon - 10, 0, horizon + 140); g.addColorStop(0, 'rgba(4,6,4,1)'); g.addColorStop(1, 'rgba(4,6,4,0)');
  c.globalAlpha = 1; c.fillStyle = g; c.fillRect(0, horizon - 10, W, 150);
  c.restore();
}
function halftone(c, color, cell = 24, a = 0.25, t = 0) {
  c.save(); c.fillStyle = color; c.globalAlpha = a;
  for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
    const s = 2 + 6 * (0.5 + 0.5 * Math.sin(x * 0.004 + y * 0.006 + t * 3));
    c.fillRect(x, y, s, s);
  }
  c.restore();
}
function pixelGrid(c, color, cell = 48, a = 0.08) {
  c.save(); c.fillStyle = color; c.globalAlpha = a;
  for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) c.fillRect(x, y, 2, 2);
  c.restore();
}
function hud(c, s, x, y, o = {}) { txt(c, s, x, y, o.size || 20, { family: 'Silkscreen', weight: 400, italic: false, align: o.align || 'left', color: o.color || C.grey, ls: o.ls ?? 2 }); }
function cursorBlock(c, x, y, h, t, color) { if (Math.floor(t * 5) % 2 === 0) { c.fillStyle = color; c.fillRect(x, y - h / 2, h * 0.5, h); } }
function img(c, im, cx, cy, w, a = 1) { const h = w * im.height / im.width; c.globalAlpha = a; c.drawImage(im, cx - w / 2, cy - h / 2, w, h); c.globalAlpha = 1; }
function cover(c, im, a = 1, z = 1, ox = 0, oy = 0) {
  const s = Math.max(W / im.width, H / im.height) * z, w = im.width * s, h = im.height * s;
  c.globalAlpha = a; c.drawImage(im, (W - w) / 2 + ox, (H - h) / 2 + oy, w, h); c.globalAlpha = 1;
}

// ── post FX ──
function mosaic(px) {
  if (px <= 1.5) return;
  const sw = Math.max(1, Math.ceil(W / px)), sh = Math.max(1, Math.ceil(H / px));
  const s = SPR.small.getContext('2d');
  s.imageSmoothingEnabled = true; s.clearRect(0, 0, sw, sh); s.drawImage(ctx.canvas, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(SPR.small, 0, 0, sw, sh, 0, 0, W, H); ctx.imageSmoothingEnabled = true;
}
function glitch(amt, seed) {
  if (amt <= 0.01) return;
  const tc = SPR.tmp.getContext('2d'); tc.clearRect(0, 0, W, H); tc.drawImage(ctx.canvas, 0, 0);
  const t2 = SPR.tmp2.getContext('2d');
  // chroma ghosts
  [[C.pink, -1], [C.cyan, 1]].forEach(([col, s]) => {
    t2.globalCompositeOperation = 'source-over'; t2.clearRect(0, 0, W, H); t2.drawImage(SPR.tmp, 0, 0);
    t2.globalCompositeOperation = 'multiply'; t2.fillStyle = col; t2.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.55 * amt; ctx.drawImage(SPR.tmp2, s * 22 * amt, 0); ctx.restore();
  });
  const n = Math.floor(6 + amt * 14);
  for (let i = 0; i < n; i++) {
    const y = snap(rnd(seed * 7 + i) * H, 8), h = 8 + snap(rnd(seed * 3 + i * 5) * 90, 8), dx = (rnd(seed + i * 9) - .5) * 260 * amt;
    ctx.drawImage(SPR.tmp, 0, y, W, h, dx, y, W, h);
  }
}
function flashOver(color, a) { if (a <= 0.005) return; ctx.save(); ctx.globalAlpha = clamp(a); ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); ctx.restore(); }

// original pixel identicon avatars for agents (no mascot)
const AGCOL = ['#C8FF00', '#3DF5FF', '#FF3D9A', '#FFC83D', '#9945FF', '#14F195', '#FF6A2D', '#FFFFFF', '#7CFFB2', '#5B8CFF', '#FF2D2D', '#E3FF6B'];
function identicon(i) {
  const n = 8, cell = 16, c = mk(n * cell, n * cell), x = c.getContext('2d');
  x.fillStyle = '#0A0F0A'; x.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < n; y++) for (let k = 0; k < n / 2; k++) if (rnd(i * 97 + y * 13 + k * 7) > 0.48) {
    x.fillStyle = (y + k) % 5 === 0 ? '#FFFFFF' : AGCOL[i % AGCOL.length];
    x.fillRect(k * cell, y * cell, cell - 1, cell - 1); x.fillRect((n - 1 - k) * cell, y * cell, cell - 1, cell - 1);
  }
  return c;
}
