// ───────── VELLO v5 — "the new money" — Wolf-style FOMO edit on rockstar (remix) ─────────
import { W, H, C, K, X, clamp, lerp, E, rnd, mk, rrect, font, word, measure, vframe, img, cover, shot, glyph, GLYPHS, tile, dots, flash } from './core.js';
import { renderMark } from './gl.js';

const LOGO = 'assets/vello-logo-white.png', MARK = 'assets/vello-mark-lime.png';
const JD = ['thumbs/jd8.jpg', 'thumbs/jd6.jpg', 'thumbs/jd4.jpg', 'thumbs/jd7.jpg', 'thumbs/jd1.jpg', 'thumbs/jd3.jpg'];
const BIG = 112, MID = 64, HUGE = 170;
const BT = 0.6035, HB = BT / 2;
const D = (a, b) => K(b) - K(a);
const bg = (c, col) => { c.fillStyle = col; c.fillRect(0, 0, W, H); };
const tintC = {}; function tinted(src, col) { const k = src + col; if (tintC[k]) return tintC[k]; const im = img(src); if (!im) return null; const c = mk(im.width, im.height), x = c.getContext('2d'); x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); return (tintC[k] = c); }
export function invert() { X.save(); X.globalCompositeOperation = 'difference'; X.fillStyle = '#fff'; X.fillRect(0, 0, W, H); X.restore(); }

// film shot: crops the bottom (editor watermarks) by default
const WM = { zoom: 1.2, zy: 0.18 };
function film(clip, u, o = {}) { shot(X, clip, u, Object.assign({}, WM, { z0: 1.0, zs: 0.04 }, o)); }
// montage: cut through a list every `step` seconds
function montage(u, list, step, o = {}) { const i = Math.floor(u / step), it = list[i % list.length]; const [clip, extra] = Array.isArray(it) ? it : [it, {}]; film(clip, u - i * step, Object.assign({}, o, extra)); return i; }
// footage inside a window (clip rect), crop with zoom/zx/zy
function win(clip, u, x, y, w, h, o = {}) {
  const open = o.open == null ? 1 : o.open;
  X.save(); X.beginPath(); X.rect(x, y + h / 2 * (1 - open), w, h * open); X.clip(); X.fillStyle = '#000'; X.fillRect(x, y, w, h);
  const im = vframe(clip, (o.off || 0) + u * (o.speed || 1)); if (im) { const z = (o.z0 || 1) + (o.zs ?? 0.06) * u; X.translate(x + w / 2, y + h / 2); X.scale(z, z); cover(X, im, -w / 2, -h / 2, w, h, o); }
  X.restore();
  if (o.stroke !== false) { X.strokeStyle = o.strokeCol || 'rgba(255,255,255,0.35)'; X.lineWidth = 1; X.strokeRect(x, y, w, h); }
}

// ── tracking lines HUD (house style) ──
export function trackLines(c, u, col = 'rgba(255,255,255,0.55)', label = 'THE NEW MONEY') {
  c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
  [0.16, 0.84].forEach((y, i) => { const yy = y * H + Math.sin(u * 0.9 + i) * 6; c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke(); });
  [0.18, 0.5, 0.82].forEach((x, i) => { const xx = x * W + ((u * 40 * (i % 2 ? 1 : -1)) % 60); c.save(); c.setLineDash([2, 10]); c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, H); c.stroke(); c.restore(); });
  [[0.18, 0.16], [0.82, 0.16], [0.18, 0.84], [0.82, 0.84]].forEach(([x, y]) => { const px = x * W, py = y * H; c.beginPath(); c.moveTo(px - 14, py); c.lineTo(px + 14, py); c.moveTo(px, py - 14); c.lineTo(px, py + 14); c.stroke(); });
  font(c, 15, 500, 'JetBrains Mono'); c.textBaseline = 'middle';
  c.textAlign = 'left'; c.fillText(`N 40.7128°  W 74.0060°`, 0.18 * W + 22, 0.16 * H - 16);
  c.textAlign = 'right'; c.fillText(`VLO-${String(Math.floor(u * 50)).padStart(5, '0')}  ●REC`, 0.82 * W - 22, 0.16 * H - 16);
  c.textAlign = 'left'; c.fillText(label, 0.18 * W + 22, 0.84 * H + 18);
  c.textAlign = 'right'; c.fillText(`${(48213 + Math.floor(u * 2917)).toLocaleString('en-US')} VIEWS / MIN`, 0.82 * W - 22, 0.84 * H + 18);
  c.globalAlpha = 0.25; c.fillRect(0, ((u * 0.6) % 1) * H, W, 1.5);
  c.restore();
}
// ── glitch thumbnails ──
const GT = mk(1000, 1000), GX = GT.getContext('2d');
function gthumbs(c, u, list, spots, step = 0.22) {
  spots.forEach(([x, y, w, ar], i) => {
    const t0 = i * step, q = clamp((u - t0) / 0.3); if (q <= 0) return;
    const src = list[i % list.length], isClip = !src.includes('/'); const im = isClip ? vframe(src, u - t0 + 0.2) : img(src); if (!im) return;
    const h = w * ar, p = E.outQuint(q), dir = i % 2 ? 1 : -1, off = (1 - p) * 320 * dir, live = u - t0;
    const jitter = (live < 0.16) || (Math.floor(u * 25 + i * 7) % 37 === 0);
    GX.setTransform(1, 0, 0, 1, 0, 0); GX.clearRect(0, 0, 1000, 1000); GX.filter = 'grayscale(1) contrast(1.3) brightness(1.2)';
    cover(GX, im, 0, 0, w, h, isClip ? { zoom: 1.2, zy: 0.2 } : { zoom: 1.08 + live * 0.04 }); GX.filter = 'none';
    const by = ((live * 260 + i * 90) % (h + 60)) - 30; GX.fillStyle = 'rgba(255,255,255,0.10)'; GX.fillRect(0, by, w, 10);
    c.save(); c.translate(x + off + Math.sin(u * 0.9 + i) * 5, y - live * 8);
    if (p < 1) for (let k = 3; k >= 1; k--) { c.globalAlpha = 0.18 * (1 - p); c.drawImage(GT, 0, 0, w, h, -w / 2 - dir * k * 40 * (1 - p), -h / 2, w, h); }
    c.globalAlpha = 1;
    if (jitter) {
      c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5;
      c.filter = 'sepia(1) hue-rotate(-50deg) saturate(6)'; c.drawImage(GT, 0, 0, w, h, -w / 2 - 9, -h / 2, w, h);
      c.filter = 'sepia(1) hue-rotate(140deg) saturate(6)'; c.drawImage(GT, 0, 0, w, h, -w / 2 + 9, -h / 2, w, h);
      c.filter = 'none'; c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      for (let s = 0; s < 6; s++) { const sy = rnd(Math.floor(u * 25) * 7 + s + i) * h, sh = 6 + rnd(s * 3 + i) * 30, sx = (rnd(s * 5 + Math.floor(u * 25)) - .5) * 60; c.drawImage(GT, 0, sy, w, sh, -w / 2 + sx, -h / 2 + sy, w, sh); }
    } else c.drawImage(GT, 0, 0, w, h, -w / 2, -h / 2, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.strokeRect(-w / 2, -h / 2, w, h);
    c.restore();
  });
}
// big counting number
function counter(v, x, y, size, u, o = {}) { word(X, (o.pre || '') + Math.floor(v).toLocaleString('en-US') + (o.suf || ''), x, y, size, u, Object.assign({ w: 600, dur: 0.12 }, o)); }
const dark = a => { X.fillStyle = `rgba(0,0,0,${a})`; X.fillRect(0, 0, W, H); };

// ════ ACT I — the old money (song breakdown, dialogue) ════
function A0(u) { // "how much money you make?"
  bg(X, '#050505');
  const open = E.outExpo(clamp((u - 0.05) / 0.3));
  win('d_donnie1', u, 1010, 190, 760, 700, { open, zoom: 2.0, zx: 0.08, zy: 0.0, zs: 0.04 });
  word(X, 'how much', 960, 330, BIG, u - 0.25, { align: 'right' });
  word(X, 'money', 960, 470, BIG, u - 0.45, { align: 'right' });
  word(X, 'you make?', 960, 610, BIG, u - 0.75, { align: 'right', color: '#9a9a9a' });
  trackLines(X, u, 'rgba(255,255,255,0.35)', 'NEW YORK — 1987');
}
function A1(u) { // "seventy thousand last month"
  bg(X, '#F4F4F2');
  const open = E.outExpo(clamp(u / 0.25));
  win('d_jordan1', u, 150, 190, 760, 700, { open, zoom: 1.7, zx: 0.62, zy: 0.08, zs: 0.04, strokeCol: 'rgba(0,0,0,0.3)' });
  const v = 70000 * E.outCubic(clamp((u - 0.75) / 0.9));
  counter(v, 1000, 450, HUGE, u - 0.7, { pre: '$', color: '#0a0a0a', shadow: false });
  word(X, 'last month.', 1010, 610, MID + 6, u - 1.5, { color: '#555', shadow: false });
  trackLines(X, u, 'rgba(0,0,0,0.4)', 'NEW YORK — 1987');
}
function A2(u) { // "you make 72 grand a month?" / "yeah."
  const yeah = u >= D(9, 12) - 0.05, lu = yeah ? u - D(9, 12) + 0.05 : u;
  bg(X, yeah ? '#F4F4F2' : '#050505');
  win(yeah ? 'd_donnie3' : 'd_donnie2', lu, 1010, 190, 760, 700, { zoom: 2.15, zx: 0.06, zy: 0.0, zs: 0.04, open: E.outExpo(clamp(lu / 0.2)), strokeCol: yeah ? 'rgba(0,0,0,0.3)' : undefined });
  if (!yeah) { counter(72000, 960, 470, HUGE, u - 0.15, { pre: '$', align: 'right' }); word(X, 'a month?', 960, 620, MID + 6, u - 0.6, { align: 'right', color: '#9a9a9a' }); }
  else word(X, 'yeah.', 960, 540, HUGE + 20, lu, { align: 'right', w: 600, color: '#0a0a0a', shadow: false });
  trackLines(X, u, yeah ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)', 'NEW YORK — 1987');
}
function A3(u) { // "that was the old money... selling stocks on a phone."
  montage(u, ['x_ph1', 'x_ph2', 'x_crowdb', 'x_ph3', 'x_yell', 'x_ph3', 'x_jonah', 'x_crowdb'], HB, { dark: 0.4 });
  word(X, 'the old money', W / 2, H / 2 - 70, BIG, u - 0.1, { align: 'center' });
  word(X, 'sold stocks.', W / 2, H / 2 + 70, BIG, u - 1.2, { align: 'center', color: '#bdbdbd' });
  trackLines(X, u, 'rgba(255,255,255,0.4)', 'STRATTON OAKMONT — 1989');
}
const NEWCLIPS = ['creator', 'head', 'city', 'creator2', 'edit', 'bokeh', 'aerial', 'runner'];
function A4(u) { // "the new money? sells attention."
  const i = Math.floor(u / HB), inv = i % 4 === 3;
  bg(X, inv ? '#060606' : '#F4F4F2');
  const sq = 600, x0 = W / 2 - sq / 2 + 150, y0 = H / 2 - sq / 2, open = E.outExpo(clamp(u / 0.25));
  win(NEWCLIPS[i % NEWCLIPS.length], u - i * HB, x0, y0, sq, sq, { open, off: 0.5 + i * 0.3, speed: 1.5, z0: 1.15, zs: 0.4, stroke: false });
  word(X, 'the new money', x0 - 24, y0 + 60, BIG, u - 0.05, { align: 'right', color: inv ? '#fff' : '#0a0a0a', shadow: false });
  word(X, 'sells', x0 + 24, y0 + sq - 150, BIG, u - 1.0);
  word(X, 'attention.', x0 + 24, y0 + sq - 50, BIG, u - 1.25);
  trackLines(X, u, inv ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)', 'NOW');
}
function A5(u) { // "your agent clips it. posts it. everywhere." — screen wall
  const k = Math.floor(u / BT);
  bg(X, '#050505');
  const cw = 520, ch = 292, gx = 40, gy = 40, ox = (W - (3 * cw + 2 * gx)) / 2, oy = (H - (2 * ch + gy)) / 2;
  const SRC = ['creator', 'x_parker', 'edit', 'city', 'x_laptop', 'head', 'creator2', 'aerial', 'bokeh', 'runner'];
  for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) {
    const n = r * 3 + q, a = clamp((u - n * 0.06) / 0.12); if (a <= 0) continue;
    const sub = Math.floor((u + n * 0.13) / HB), clip = SRC[(sub + n * 3) % SRC.length], x = ox + q * (cw + gx), y = oy + r * (ch + gy);
    X.save(); X.globalAlpha = a; win(clip, (u + n * 0.13) % HB, x, y, cw, ch, { off: 0.4 + n * 0.3, speed: 2, z0: 1.1, zoom: clip.startsWith('x_') ? 1.2 : 1, zy: 0.2 }); X.restore();
    if (n === (k * 2) % 6) { X.fillStyle = 'rgba(200,255,0,0.9)'; font(X, 18, 500, 'JetBrains Mono'); X.textAlign = 'left'; X.textBaseline = 'top'; X.fillText('● POSTED', x + 14, y + 12); }
  }
  dark(0.4);
  const ws = [['clip it.', 0], ['post it.', D(24, 25.5)], ['everywhere.', D(24, 27)]]; let cur = ws[0]; for (const w of ws) if (u >= w[1]) cur = w;
  word(X, cur[0], W / 2, H / 2, HUGE - 20, u - cur[1], { align: 'center', w: 600, dur: 0.18 });
  trackLines(X, u);
  if (k % 2 === 1 && (u % BT) < 0.08) invert();
}

// ════ ACT II — the drop ════
function B0(u) { // logo card slam on the drop
  bg(X, '#F2F2F0');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 30; i++) { X.beginPath(); X.arc(W * 0.8, -200, 300 + i * 60 + u * 60, 0, 7); X.stroke(); } X.restore();
  const lg = tinted(LOGO, '#0a0a0a'); if (lg) { const w = 1240, h = w * lg.height / lg.width, s = lerp(1.35, 1, E.outQuint(clamp(u / 0.45))) + Math.sin(u * 40) * 0.006 * (1 - clamp(u / 0.4)); X.save(); X.translate(W / 2, H / 2 - 40); X.scale(s, s); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
  word(X, 'agents that clip, post and earn', W / 2, H / 2 + 240, MID - 6, u - 0.35, { align: 'center', color: '#444', shadow: false });
  trackLines(X, u, 'rgba(0,0,0,0.35)', 'VELLO — THE NEW MONEY');
}
const CHEER = ['x_cheer', 'x_glass', 'x_yell', 'x_helmet', 'x_crowd2', 'x_armsb', 'x_scream', 'x_houseyell'];
function B1(u) { // wolf montage + "paid for every view… while you sleep."
  const sleep = u >= D(31, 33.6);
  montage(u, sleep ? ['x_yacht', 'x_pool', 'x_yacht2', 'x_mansion', 'x_balc', 'x_shades'] : CHEER, HB, { dark: 0.3, zs: 0.12 });
  if (!sleep) { word(X, 'paid for', W / 2, H / 2 - 70, BIG + 10, u - 0.15, { align: 'center' }); word(X, 'every view.', W / 2, H / 2 + 70, BIG + 10, u - 0.6, { align: 'center' }); }
  else word(X, 'while you sleep.', W / 2, H / 2, BIG + 10, u - D(31, 33.2), { align: 'center', color: '#e6e6e6' });
}
function B2(u) { // brief in. clips out. — glitch thumbnails over the corridor walk
  film(u < D(35, 37) ? 'x_corr' : 'x_stage', u < D(35, 37) ? u : u - D(35, 37), { dark: 0.35, zs: 0.05 });
  gthumbs(X, u, [JD[0], 'x_ph3', JD[2], 'x_jonah', JD[4], JD[1]], [[330, 250, 420, 0.5625], [1600, 280, 440, 0.5625], [400, 840, 400, 0.5625], [1560, 840, 380, 0.5625]], 0.2);
  const two = u >= D(35, 37);
  word(X, two ? 'clips out.' : 'brief in.', W / 2, H / 2, BIG + 30, two ? u - D(35, 37) : u - 0.05, { align: 'center', w: 600 });
}
const PUNCH = [['clip.', ['x_boat1', 'x_boat2']], ['post.', ['x_boat3', 'x_flag']], ['earn.', ['x_count', 'x_bill2']], ['repeat.', ['x_throw', 'x_party']]];
function B3(u) { // word punches per beat over money shots
  const k = Math.min(3, Math.floor(u / BT)), lu = u - k * BT, [w, cl] = PUNCH[k], h = Math.floor(lu / HB);
  film(cl[h % 2], lu - h * HB, { dark: 0.25, zs: 0.2 });
  word(X, w, W / 2, H / 2, HUGE + 30, lu - 0.01, { align: 'center', w: 650, dur: 0.12 });
  // ticker strip
  X.save(); X.fillStyle = 'rgba(0,0,0,0.6)'; X.fillRect(0, H - 70, W, 70); font(X, 22, 500, 'JetBrains Mono'); X.textBaseline = 'middle'; X.textAlign = 'left';
  const tk = '▲ VIEWS +12,480   ▲ AGENT_0042 PAID   ▲ CLIP POSTED · TOKYO   ▲ VIEWS +3,211   ▲ AGENT_0117 PAID   ▲ CLIP POSTED · LAGOS   ▲ VIEWS +8,904   ';
  X.fillStyle = '#C8FF00'; X.fillText(tk + tk, -((u * 420) % measureMono(tk)), H - 35); X.restore();
}
let MM = 0; function measureMono(s) { if (!MM) { font(X, 22, 500, 'JetBrains Mono'); MM = X.measureText(s).width; } return MM; }
function B4(u) { // proof: 5,000+ videos / 100+ agents minted in one night / the site went down.
  const t1 = D(43, 46), t2 = D(43, 49.5);
  if (u < t1) { // wall of thumbnails filling up + counter
    bg(X, '#050505');
    const n = Math.floor(clamp(u / t1) * 60) + 6, cols = 12, tw = 160, th = 90, g = 0;
    for (let i = 0; i < n; i++) { const q = i % cols, r = Math.floor(i / cols), x = q * tw, y = 60 + r * th * 2.1; const src = [...JD, 'x_ph3', 'x_jonah', 'x_party', 'creator', 'head'][i % 11]; const im = src.includes('/') ? img(src) : vframe(src, 0.3 + (i % 5) * 0.1); if (im) { X.save(); X.globalAlpha = 0.55; X.filter = 'grayscale(1)'; cover(X, im, x + 4, y, tw - 8, th * 2 - 8, src.includes('/') ? {} : { zoom: 1.2, zy: 0.2 }); X.filter = 'none'; X.restore(); } }
    dark(0.5);
    counter(5000 * E.outExpo(clamp(u / 1.2)), W / 2, H / 2 - 40, HUGE + 20, u - 0.02, { align: 'center', suf: '+' });
    word(X, 'videos produced', W / 2, H / 2 + 120, MID + 6, u - 0.3, { align: 'center', color: '#bdbdbd' });
  } else if (u < t2) { // flip counter + crowd → agents minted
    const lu = u - t1, i = Math.floor(lu / HB);
    film(['x_counter', 'x_crowd2', 'x_counter', 'x_helmet', 'x_counter', 'x_cheer', 'x_counter'][i % 7], lu - i * HB, { zoom: i % 2 ? 1.2 : 1.05, zy: 0.3, dark: 0.35, zs: 0.1 });
    counter(100 * E.outExpo(clamp(lu / 1.0)), W / 2, H / 2 - 60, HUGE + 20, lu - 0.02, { align: 'center', suf: '+' });
    word(X, 'agents minted', W / 2, H / 2 + 80, BIG - 20, lu - 0.25, { align: 'center' });
    word(X, 'in one night', W / 2, H / 2 + 175, MID, lu - 0.6, { align: 'center', color: '#bdbdbd' });
  } else { // the site went down.
    const lu = u - t2; bg(X, '#050505');
    font(X, 26, 500, 'JetBrains Mono'); X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillStyle = 'rgba(255,255,255,0.7)';
    ['GET velloagents.com/mint', 'HTTP/1.1 503 SERVICE UNAVAILABLE', 'retry-after: too many agents'].forEach((s, i) => { if (lu > i * 0.18) X.fillText(s, 140, 200 + i * 44); });
    word(X, 'the site', W / 2, H / 2 + 20, HUGE, lu - 0.15, { align: 'center', w: 600 });
    word(X, 'went down.', W / 2, H / 2 + 190, HUGE, lu - 0.45, { align: 'center', w: 600 });
    // heavy stutter glitch
    if (Math.floor(lu * 12) % 3 === 0) { for (let s = 0; s < 6; s++) { const y = rnd(Math.floor(lu * 25) + s) * H; X.drawImage(X.canvas, 0, y, W, 40, (rnd(s + Math.floor(lu * 25)) - .5) * 160, y, W, 40); } }
  }
  trackLines(X, u, 'rgba(255,255,255,0.4)', 'TRACTION — LIVE');
}
// world map: 1 agent, 145 countries
const MCITIES = [['TOKYO', 139.7, 35.7], ['SEOUL', 127, 37.5], ['KUALA LUMPUR', 101.7, 3.1], ['JAKARTA', 106.8, -6.2], ['MUMBAI', 72.9, 19.1], ['DUBAI', 55.3, 25.2], ['LAGOS', 3.4, 6.5], ['LONDON', -0.1, 51.5], ['PARIS', 2.35, 48.9], ['SÃO PAULO', -46.6, -23.5], ['MEXICO CITY', -99.1, 19.4], ['NEW YORK', -74, 40.7]];
const MCLIPS = ['creator', 'x_party', 'head', 'x_cheer', 'city', 'x_toast', 'creator2', 'x_flag', 'edit', 'x_shades', 'bokeh', 'x_smile'];
function B5(u) {
  bg(X, '#050505');
  const T = D(52, 56), p = E.inOutCubic(clamp(u / T)), cell = 15, mw = 192 * cell, mh = 96 * cell;
  const camLon = lerp(120, -50, p), camLat = lerp(36, 32, p), zoom = lerp(1.0, 0.9, p);
  const toXY = (lon, lat) => [((lon + 180) / 360) * mw, ((90 - lat) / 180) * mh]; const [cx, cy] = toXY(camLon, camLat);
  X.save(); X.translate(W / 2, H / 2); X.scale(zoom, zoom); X.translate(-cx, -cy);
  const G = window.MAPGRID; X.fillStyle = 'rgba(255,255,255,0.28)';
  for (let y = 0; y < 96; y++) for (let x = 0; x < 192; x++) if (G[y][x] === '1') { for (const dx of [-mw, 0, mw]) { const px = x * cell + dx; if (Math.abs(px - cx) > W / zoom) continue; X.fillRect(px + 4, y * cell + 4, 4, 4); } }
  MCITIES.forEach(([name, lon, lat], i) => {
    const t0 = 0.05 + i * 0.17, q = clamp((u - t0) / 0.3); if (q <= 0) return;
    let [px, py] = toXY(lon, lat); if (px - cx > mw / 2) px -= mw; if (cx - px > mw / 2) px += mw;
    const s = E.outQuint(q), tw = 150, th = 266, lift = 150;
    X.fillStyle = '#fff'; X.beginPath(); X.arc(px, py, 6, 0, 7); X.fill();
    X.strokeStyle = 'rgba(255,255,255,0.6)'; X.lineWidth = 1.2; X.beginPath(); X.arc(px, py, 12 + ((u * 30 + i * 7) % 26), 0, 7); X.stroke();
    X.beginPath(); X.moveTo(px, py); X.lineTo(px, py - lift * s); X.stroke();
    X.save(); X.translate(px, py - lift * s - th / 2); X.scale(s, s);
    const clip = MCLIPS[i]; const im = vframe(clip, 0.3 + (u - t0)); if (im) cover(X, im, -tw / 2, -th / 2, tw, th, clip.startsWith('x_') ? { zoom: 1.2, zy: 0.2 } : {});
    X.strokeStyle = 'rgba(255,255,255,0.7)'; X.strokeRect(-tw / 2, -th / 2, tw, th);
    font(X, 22, 600); X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillStyle = '#fff'; X.fillText(name, -tw / 2, th / 2 + 22);
    font(X, 19, 500, 'JetBrains Mono'); X.fillStyle = '#C8FF00'; X.fillText(`▲ ${Math.floor((20 + rnd(i) * 80) * 1000 * (0.3 + (u - t0) * 2)).toLocaleString('en-US')} views`, -tw / 2, th / 2 + 50);
    X.restore();
  });
  X.restore();
  const vg = X.createLinearGradient(0, H * 0.55, 0, H); vg.addColorStop(0, 'rgba(5,5,5,0)'); vg.addColorStop(1, 'rgba(5,5,5,0.92)'); X.fillStyle = vg; X.fillRect(0, 0, W, H);
  const two = u >= D(52, 54);
  word(X, two ? '145 countries.' : '1 agent.', 110, H - 150, BIG + 20, two ? u - D(52, 54) : u - 0.05, { w: 600 });
  trackLines(X, u);
}
function B6(u) { // settled on solana — window
  bg(X, '#F4F4F2');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.08)'; [W / 3, 2 * W / 3].forEach(x => { X.beginPath(); X.moveTo(x, 0); X.lineTo(x, H); X.stroke(); }); [H / 3, 2 * H / 3].forEach(y => { X.beginPath(); X.moveTo(0, y); X.lineTo(W, y); X.stroke(); }); X.restore();
  const i = Math.floor(u / HB), clips = ['x_count', 'x_bill2', 'x_boat2', 'x_watch', 'x_box', 'x_throw', 'x_yacht2', 'x_toast'];
  const sq = 640, x0 = W / 2 - sq / 2, y0 = H / 2 - sq / 2, open = E.outExpo(clamp(u / 0.3));
  win(clips[i % clips.length], u - i * HB, x0, y0, sq, sq, { open, zoom: 1.3, zy: 0.2, z0: 1.1, zs: 0.3, stroke: false });
  X.save(); X.beginPath(); X.rect(x0, y0, sq, sq); X.clip(); dark(0.25); const m = tinted(MARK, '#ffffff'); if (m) X.drawImage(m, W / 2 - 110, H / 2 - 110, 220, 220); X.restore();
  word(X, 'settled', x0 - 20, y0 + 50, BIG, u - 0.5, { shadow: false, color: '#0a0a0a', align: 'right' });
  word(X, 'on', x0 + sq - 20, y0 + sq - 50, BIG, u - 0.9, { align: 'right' });
  word(X, 'solana', x0 + sq + 20, y0 + sq - 50, BIG, u - 1.1, { color: '#0a0a0a', shadow: false });
  const lu = u - 1.1; if (lu > 0) { const g = X.createLinearGradient(x0 + sq + 20, 0, x0 + sq + 400, 0); g.addColorStop(0, '#9945FF'); g.addColorStop(1, '#14F195'); X.fillStyle = g; X.fillRect(x0 + sq + 22, y0 + sq + 10, 370 * E.outExpo(clamp(lu / 0.5)), 5); }
  trackLines(X, u, 'rgba(0,0,0,0.4)');
}

// ════ ACT III — crazy? / delusional / be early ════
function C0(u) { // "you're looking at me like I'm crazy"
  bg(X, '#050505');
  win('d_jcrazy', u, 1000, 190, 760, 700, { zoom: 1.55, zx: 0.68, zy: 0.05, zs: 0.04, open: E.outExpo(clamp(u / 0.25)) });
  word(X, 'you\'re looking', 950, 400, BIG - 10, u - 0.1, { align: 'right' });
  word(X, 'at me like', 950, 520, BIG - 10, u - 0.45, { align: 'right' });
  word(X, 'i\'m crazy.', 950, 640, BIG - 10, u - 0.85, { align: 'right', color: '#9a9a9a' });
  trackLines(X, u, 'rgba(255,255,255,0.35)');
}
function C1(u) { // "crazy? this is obscene." + views exploding
  const cut = 1.25;
  if (u < cut) { film('d_max', u + 0.35, { zoom: 1.95, zx: 0.1, zy: 0.12, zs: 0.03, dark: 0.3 }); word(X, 'crazy?', W / 2, H / 2, HUGE, u - 0.05, { align: 'center', w: 600 }); }
  else { const lu = u - cut, i = Math.floor(lu / (HB / 2)); film(['x_watch', 'x_boat3', 'x_ferrari', 'x_count', 'x_yacht', 'x_throw', 'x_bill', 'x_party'][i % 8], lu % (HB / 2), { dark: 0.35, zs: 0.3 });
    counter(1000 + 9.8e6 * E.inCubic(clamp(lu / 1.4)), W / 2, H / 2 - 60, HUGE, 1, { align: 'center', suf: '', pre: '▲ ' });
    word(X, 'this is obscene.', W / 2, H / 2 + 110, BIG - 10, lu - 0.15, { align: 'center' }); }
  trackLines(X, u);
}
function C2(u) { // complete delusion → only delusional until it works
  const two = u >= D(68, 70.4);
  if (!two) film(u < D(68, 69) ? 'x_floor2' : 'x_floor', u < D(68, 69) ? u : u - D(68, 69), { dark: 0.4, zs: 0.06 });
  else { const lu = u - D(68, 70.4); film(lu < D(70.4, 72.4) ? 'x_stage' : 'x_glass', lu < D(70.4, 72.4) ? lu * 0.5 : (lu - D(70.4, 72.4)) * 0.5, { dark: 0.45, zs: 0.04 }); }
  if (!two) word(X, 'complete delusion.', W / 2, H / 2, BIG + 10, u - 0.2, { align: 'center' });
  else { const lu = u - D(68, 70.4); word(X, 'it\'s only delusional', W / 2, H / 2 - 70, BIG + 10, lu - 0.15, { align: 'center' }); word(X, 'until it works.', W / 2, H / 2 + 80, BIG + 10, lu - 1.4, { align: 'center', w: 600 }); }
  trackLines(X, u, 'rgba(255,255,255,0.4)');
}
function C3(u) { // everyone's gonna say they were early → be early.
  const be = u >= D(75, 78.2);
  if (!be) { montage(u, ['x_parker', 'x_crowdb', 'x_laptop', 'x_cheer', 'x_parker'], BT, { dark: 0.45, zoom: 1.12, zs: 0.05 });
    word(X, 'everyone says', W / 2, H / 2 - 70, BIG, u - 0.1, { align: 'center' }); word(X, 'they were early.', W / 2, H / 2 + 70, BIG, u - 0.6, { align: 'center', color: '#bdbdbd' }); }
  else { const lu = u - D(75, 78.2); bg(X, '#F4F4F2'); word(X, 'be early.', W / 2, H / 2, HUGE + 20, lu - 0.05, { align: 'center', color: '#0a0a0a', shadow: false, w: 600 }); trackLines(X, lu, 'rgba(0,0,0,0.4)'); }
}
function C4(u) { // CTA — you in? mint your agent
  bg(X, '#050505');
  const k = Math.floor(u / HB);
  win(['x_toast', 'creator', 'x_smile', 'head', 'x_shades', 'creator2'][k % 6], u - k * HB, W / 2 - 300, 170, 600, 600, { zoom: 1.25, zy: 0.2, z0: 1.1, zs: 0.3 });
  word(X, 'you in?', W / 2, 870, BIG, u - 0.05, { align: 'center' });
  font(X, 30, 500, 'JetBrains Mono'); X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillStyle = `rgba(200,255,0,${clamp((u - 0.6) / 0.2)})`; X.fillText('MINT YOUR AGENT → VELLOAGENTS.COM', W / 2, 960);
  trackLines(X, u);
}
function D0(u) { // end card — flashy slam
  bg(X, '#050505');
  const lg = img(LOGO); if (lg) { const w = 820, h = w * lg.height / lg.width, p = E.outQuint(clamp(u / 0.5)), s = lerp(1.6, 1, p); X.save(); X.globalAlpha = clamp(u / 0.06); X.translate(W / 2, H / 2 - 40); X.scale(s, s); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
  word(X, 'the new money is attention.', W / 2, H / 2 + 150, MID - 10, u - 0.6, { align: 'center', color: '#a8a8a8' });
  font(X, 22, 500, 'JetBrains Mono'); X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillStyle = `rgba(200,255,0,${clamp((u - 1.0) / 0.3)})`; X.fillText('VELLOAGENTS.COM', W / 2, H / 2 + 230);
  font(X, 14, 500, 'JetBrains Mono'); X.fillStyle = `rgba(255,255,255,${0.35 * clamp((u - 1.2) / 0.3)})`; X.fillText('EARNINGS DEPEND ON VERIFIED VIEWS AND CAMPAIGN AVAILABILITY. NOT FINANCIAL ADVICE.', W / 2, H - 60);
  X.save(); X.globalAlpha = clamp(u / 0.4); trackLines(X, u, 'rgba(255,255,255,0.55)', 'THE GLOBAL ATTENTION ECONOMY'); X.restore();
  // stutter inverts on the first beats
  const st = [0, 0.15, 0.3, BT, BT + 0.15, 2 * BT]; for (const s of st) if (u >= s && u < s + 0.05) invert();
}

export const SHOTS = [
  [0, A0], [K(4), A1], [K(9), A2], [K(14), A3], [K(20), A4], [K(24), A5],
  [K(29), B0], [K(31), B1], [K(35), B2], [K(39), B3], [K(43), B4], [K(52), B5], [K(56), B6],
  [K(61), C0], [K(64), C1], [K(68), C2], [K(75), C3], [K(80), C4], [K(84), D0]];
export const DUR = 55.6;
export const CUTS = [4, 9, 14, 20, 24, 29, 31, 35, 39, 43, 46, 49.5, 52, 56, 61, 64, 68, 75, 78.2, 80, 84];
// flash policy: which beats get an inverted frame
export function wantFlash(k) {
  if (CUTS.includes(k)) return true;
  if (k < 29) return k % 4 === 2;                // breakdown: sparse
  if (k < 61) return k % 2 === 0;                // drop: every other beat
  if (k >= 61 && k < 75) return false;           // dialogue + delusion: only on cuts
  if (k >= 75 && k < 84) return k % 2 === 1;
  return false;
}
