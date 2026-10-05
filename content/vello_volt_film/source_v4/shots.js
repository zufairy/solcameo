// ───────── VELLO v4 — synced to "let me know" (remix), beats from the track ─────────
import { W, H, C, K, X, clamp, lerp, prog, E, rnd, mk, rrect, font, word, measure, vframe, img, cover, shot, glyph, GLYPHS, tile, lineArt, dots, flash } from './core.js';
import { renderMark } from './gl.js';
import { renderIntro, renderTunnel, renderGlobe, INTRO_URLS, TUNNEL_URLS, GLOBE_URLS } from './gl2.js';

const LOGO = 'assets/vello-logo-white.png', MARK = 'assets/vello-mark-lime.png';
const BW = ['seq/head/00040.jpg', 'seq/aerial/00060.jpg', 'seq/creator2/00120.jpg', 'seq/city/00050.jpg', 'seq/jet/00080.jpg', 'seq/chrome/00100.jpg', 'seq/earth2/00090.jpg', 'seq/runner/00120.jpg'];
const JD = ['thumbs/jd8.jpg', 'thumbs/jd6.jpg', 'thumbs/jd4.jpg', 'thumbs/jd7.jpg', 'thumbs/jd1.jpg', 'thumbs/jd3.jpg'];
const tintC = {}; function tinted(src, col) { const k = src + col; if (tintC[k]) return tintC[k]; const im = img(src); if (!im) return null; const c = mk(im.width, im.height), x = c.getContext('2d'); x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); return (tintC[k] = c); }
const bg = (c, col) => { c.fillStyle = col; c.fillRect(0, 0, W, H); };
const BIG = 112, MID = 64; // text scale (bigger, per feedback)
const D = (a, b) => K(b) - K(a); // duration between beats

// ── digital glitch thumbnails: slide-in with trail, RGB split, tracking bands ──
const GT = mk(1000, 1000), GX = GT.getContext('2d');
function gthumbs(c, u, list, spots, step = 0.28) {
  spots.forEach(([x, y, w, ar], i) => {
    const t0 = i * step, q = clamp((u - t0) / 0.3); if (q <= 0) return;
    const im = img(list[i % list.length]); if (!im) return;
    const h = w * ar, p = E.outQuint(q), dir = i % 2 ? 1 : -1, off = (1 - p) * 320 * dir;
    const live = u - t0, jitter = (live < 0.16) || (Math.floor(u * 25 + i * 7) % 37 === 0);
    // render plate into buffer (grayscale, contrast)
    GX.setTransform(1, 0, 0, 1, 0, 0); GX.clearRect(0, 0, 1000, 1000); GX.filter = 'grayscale(1) contrast(1.3) brightness(1.3)';
    cover(GX, im, 0, 0, w, h, { zoom: 1.08 + live * 0.04 }); GX.filter = 'none';
    // tracking band moving down
    const by = ((live * 260 + i * 90) % (h + 60)) - 30; GX.fillStyle = 'rgba(255,255,255,0.10)'; GX.fillRect(0, by, w, 10); GX.fillStyle = 'rgba(255,255,255,0.05)'; GX.fillRect(0, by + 14, w, 3);
    c.save(); c.translate(x + off + Math.sin(u * 0.9 + i) * 5, y - live * 8);
    if (p < 1) { for (let k = 3; k >= 1; k--) { c.globalAlpha = 0.18 * (1 - p); c.drawImage(GT, 0, 0, w, h, -w / 2 - dir * k * 40 * (1 - p), -h / 2, w, h); } }
    c.globalAlpha = 1;
    if (jitter) { // RGB split + horizontal slice displacement
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

// ════ ACT I (song breakdown) ════
function I0(u) { // glass + urban plates stacking over the Vello logo, cut every half-beat
  bg(X, '#050505');
  INTRO_URLS.forEach(img); const lg = img(LOGO);
  const g = renderIntro(u, 0.5573, lg); if (g) X.drawImage(g, 0, 0);
  // hard-cut flash frames on half-beats + logo outline punch
  const hb = u % (0.5573 / 2); if (hb < 0.03) flash(X, '#fff', 0.25);
}
function A1(u) {
  shot(X, 'chrome', u, { off: 0.2, zs: 0.05 });
  word(X, 'every', W * 0.30, H / 2, BIG, u - 0.1, { out: 1.05 });
  word(X, 'feed,', W * 0.56, H / 2, BIG, u - 0.45, { out: 0.75 });
  word(X, 'every second.', W / 2, H / 2, BIG, u - 1.25, { align: 'center' });
}
function A2(u) {
  const cut = D(12, 14);
  if (u < cut) shot(X, 'chart', u, { off: 0.2, zs: 0.08, rot: 0.01 }); else shot(X, 'earth', u - cut, { off: 0.5, zs: 0.05 });
  const d = u - cut; if (d > -0.18 && d < 0.18) { bg(X, C.ink); dots(X, vframe(d < 0 ? 'chart' : 'earth', d < 0 ? 0.2 + u : 0.5 + Math.max(0, d)), u, 1 - Math.abs(d) / 0.18); }
  word(X, 'attention never stops', W / 2, H / 2, BIG, u - 0.25, { align: 'center' });
}
function A3(u) {
  const c1 = D(16, 17), c2 = D(16, 18);
  if (u < c1) shot(X, 'runner', u, { off: 1.2, zs: 0.04 }); else if (u < c2) shot(X, 'warp', u - c1, { speed: 1.2, zs: 0.2 }); else { bg(X, C.ink); lineArt(X, vframe('creator2', 2 + u - c2), u); }
  word(X, 'everywhere,', 110, H * 0.4, BIG, u - 0.15);
  word(X, 'across 145 countries', W - 110, H * 0.62, BIG, u - c1, { align: 'right' });
}
function A4(u) { // 3D feed tunnel — billions of eyes
  TUNNEL_URLS.forEach(img); const g = renderTunnel(u); if (g) X.drawImage(g, 0, 0);
  const r = X.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 900); r.addColorStop(0, 'rgba(0,0,0,0.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); X.fillStyle = r; X.fillRect(0, 0, W, H);
  const two = u >= D(20, 22);
  word(X, two ? 'on every screen' : 'billions of eyes', W / 2, H / 2, BIG, two ? u - D(20, 22) : u - 0.05, { align: 'center', out: two ? 9 : D(20, 22) - 0.2 });
}
const SPOTS = [[0.24, 0.24], [0.74, 0.2], [0.86, 0.47], [0.16, 0.7], [0.55, 0.12], [0.64, 0.82], [0.36, 0.86], [0.9, 0.76], [0.42, 0.3], [0.08, 0.42]];
function wall(c, inv) { const s = 128, gap = 10; for (let y = -s / 2; y < H + s; y += s + gap) for (let x = -s / 2; x < W + s; x += s + gap) { rrect(c, x, y, s, s, 22); c.fillStyle = inv ? '#FAFAFA' : '#0D0D0D'; c.fill(); c.strokeStyle = inv ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'; c.lineWidth = 1.5; c.stroke(); } }
function A6(u) {
  bg(X, C.ink); wall(X, false);
  SPOTS.forEach(([x, y], i) => { const q = clamp((u - i * 0.17) / 0.2); if (q > 0) tile(X, GLYPHS[i], x * W, y * H, 100 * E.outBack(q)); });
  word(X, 'but your reach', W / 2, H / 2 - 50, MID + 10, u - 0.15, { align: 'center', shadow: false });
  word(X, 'gets scattered', W / 2, H / 2 + 40, MID + 10, u - 0.8, { align: 'center', color: '#9a9a9a', shadow: false });
}
function B0(u) { // what if your agent did it all? → icons converge into the mark exactly on the drop
  const conv = D(28, 30.5), inv = u < 0.1;
  bg(X, inv ? '#F4F4F4' : C.ink); wall(X, inv);
  const p = E.inOutExpo(clamp((u - conv) / (D(28, 32) - conv - 0.12)));
  SPOTS.forEach(([x, y], i) => { const tx = W / 2 + (rnd(i) - .5) * 100 * (1 - p), ty = H / 2 + (rnd(i * 3) - .5) * 80 * (1 - p); tile(X, GLYPHS[i], lerp(x * W + Math.sin(u + i) * 8, tx, p), lerp(y * H, ty, p), 100 * lerp(1, 0.75, p), 1 - clamp((p - 0.92) / 0.08), inv); });
  if (u < conv + 0.3) {
    const ws = ['what', 'if', 'your', 'agent', 'did', 'it', 'all?'], size = MID; let tw = 0; const ww = ws.map(s => { const w = measure(s + ' ', size); tw += w; return w; });
    let x = W / 2 - tw / 2; ws.forEach((s, i) => { const q = clamp((u - 0.15 - i * 0.2) / 0.25); font(X, size); X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillStyle = inv ? C.ink : `rgba(244,244,242,${(0.12 + 0.88 * q) * (1 - clamp((u - conv) / 0.3))})`; X.fillText(s, x, H / 2); x += ww[i]; });
  }
}
// ════ ACT II (the drop) ════
function B2(u) {
  bg(X, '#F2F2F0');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 30; i++) { X.beginPath(); X.arc(W * 0.8, -200, 300 + i * 60 + u * 30, 0, 7); X.stroke(); } X.restore();
  const lg = tinted(LOGO, '#0a0a0a'); if (lg) { const w = 1180, h = w * lg.height / lg.width, s = lerp(1.12, 1, E.outQuint(clamp(u / 0.6))); X.save(); X.translate(W / 2, H / 2 - 30); X.scale(s, s); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
  word(X, 'agents that create, publish and earn', W / 2, H / 2 + 250, MID - 10, u - 0.5, { align: 'center', color: '#444', shadow: false });
}
function B3(u) { const g = X.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H * 0.45, 1100); g.addColorStop(0, '#2a2a2a'); g.addColorStop(1, '#030303'); X.fillStyle = g; X.fillRect(0, 0, W, H); X.drawImage(renderMark(u * 1.6), 0, 0); }
function C0(u) {
  bg(X, '#F4F4F2');
  const bx = W * 0.52, bh = H * 0.52, bw = W - bx;
  X.fillStyle = '#060606'; X.fillRect(bx, 0, bw, bh);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) { const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(u * 3 + x * 0.6 + y)); X.fillStyle = `rgba(255,255,255,${a})`; X.fillRect(bx + 40 + x * 58 + (y % 2) * 29, 40 + y * 58, 3, 3); }
  X.save(); X.setLineDash([4, 6]); X.strokeStyle = 'rgba(0,0,0,0.35)'; X.beginPath(); X.moveTo(0, bh); X.lineTo(W, bh); X.moveTo(bx, 0); X.lineTo(bx, H); X.stroke(); X.restore();
  const n = 60, pr = E.outCubic(clamp(u / 1.6));
  X.beginPath(); for (let i = 0; i <= n * pr; i++) { const x = W * 0.12 + i / n * (bx - W * 0.12), y = H * 0.9 - (i / n) * (H * 0.9 - bh) + Math.sin(i * 1.7) * 12 * (1 - i / n); i ? X.lineTo(x, y) : X.moveTo(x, y); } X.strokeStyle = '#0a0a0a'; X.lineWidth = 2.5; X.stroke();
  X.fillStyle = '#0a0a0a'; X.beginPath(); X.arc(bx, bh, 7, 0, 7); X.fill();
  word(X, '$' + (2071.79 + u * 3.7).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), bx + 26, bh + 46, 44, 0.5, { color: '#0a0a0a', shadow: false });
  word(X, 'agents', 80, 130, BIG, u - 0.05, { color: '#0a0a0a', shadow: false });
  word(X, 'get paid', 80, 250, BIG, u - 0.3, { color: '#0a0a0a', shadow: false });
  word(X, 'for every', W - 80, H - 250, BIG, u - 0.8, { color: '#0a0a0a', shadow: false, align: 'right' });
  word(X, 'verified view', W - 80, H - 130, BIG, u - 1.05, { color: '#0a0a0a', shadow: false, align: 'right' });
}
function C1(u) { shot(X, 'head', u, { off: 0.6, zs: 0.05, dark: 0.2 }); gthumbs(X, u, JD, [[330, 250, 420, 0.5625], [1600, 280, 440, 0.5625], [400, 840, 400, 0.5625], [1560, 840, 380, 0.5625]]); word(X, u < D(44, 45.6) ? 'brief in.' : 'edits out.', W / 2, H / 2, BIG + 20, u < D(44, 45.6) ? u - 0.05 : u - D(44, 45.6), { align: 'center' }); }
function C2(u) { shot(X, 'jet', u, { off: 0.5, zs: 0.04, px: -30, dark: 0.45 }); gthumbs(X, u, BW, [[360, 240, 420, 0.5625], [1560, 820, 440, 0.5625], [330, 850, 380, 0.5625], [1580, 240, 400, 0.5625]]); word(X, 'no timeline.', W / 2, H / 2 - 75, BIG + 20, u - 0.05, { align: 'center' }); word(X, 'no editing.', W / 2, H / 2 + 85, BIG + 20, u - 0.6, { align: 'center', color: '#d0d0d0' }); }
function C3(u) { const cut = D(52, 54); shot(X, u < cut ? 'aerial' : 'earth2', u < cut ? u : u - cut, { off: 0.5, zs: 0.05 }); gthumbs(X, u, JD.slice(2).concat(BW), [[1580, 230, 420, 0.5625], [340, 760, 420, 0.5625], [1560, 860, 380, 0.5625]]); word(X, 'one global network', W / 2, H / 2, BIG, u - 0.05, { align: 'center' }); }
function C4(u) {
  bg(X, '#F4F4F2');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.08)'; [W / 3, 2 * W / 3].forEach(x => { X.beginPath(); X.moveTo(x, 0); X.lineTo(x, H); X.stroke(); }); [H / 3, 2 * H / 3].forEach(y => { X.beginPath(); X.moveTo(0, y); X.lineTo(W, y); X.stroke(); }); X.restore();
  const i = Math.floor(u / 0.5573), clips = ['earth2', 'chrome2', 'city', 'chrome', 'aerial'];
  const sq = 640, x0 = W / 2 - sq / 2, y0 = H / 2 - sq / 2, open = E.outExpo(clamp(u / 0.3));
  X.save(); X.beginPath(); X.rect(x0 + sq / 2 * (1 - open), y0, sq * open, sq); X.clip(); X.fillStyle = '#000'; X.fillRect(x0, y0, sq, sq);
  const im = vframe(clips[i % clips.length], 0.3 + u - i * 0.5573); if (im) { X.save(); X.translate(W / 2, H / 2); X.rotate(u * (i % 2 ? -0.25 : 0.25)); cover(X, im, -sq * 0.75, -sq * 0.75, sq * 1.5, sq * 1.5); X.restore(); }
  const m = tinted(MARK, '#ffffff'); if (m) X.drawImage(m, W / 2 - 115, H / 2 - 115, 230, 230); X.restore();
  word(X, 'earn', x0 - 20, y0 + 50, BIG, u - 0.2, { shadow: false, color: '#0a0a0a', align: 'right' });
  word(X, 'anywhere', x0 + 20, y0 + 50, BIG, u - 0.45);
  word(X, 'on', x0 + sq - 20, y0 + sq - 50, BIG, u - 1.0, { align: 'right' });
  word(X, 'solana', x0 + sq + 20, y0 + sq - 50, BIG, u - 1.2, { color: '#0a0a0a', shadow: false });
}
function C5(u) {
  bg(X, C.ink); const p = E.inOutCubic(clamp(u / 1.0)), cols = 30, rows = 12, sx = W / cols, sy = H / rows;
  X.strokeStyle = C.white; X.lineWidth = 2.4; X.lineCap = 'round';
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) { const i = r * cols + q, local = clamp(p * 1.8 - (1 - q / cols) * 0.8), ang = lerp(rnd(i) * 6.28 + u * (rnd(i * 3) - .5) * 6, (i % 2) * Math.PI / 2, E.outCubic(local)); const cx = q * sx + sx / 2 + (rnd(i * 5) - .5) * 30 * (1 - local), cy = r * sy + sy / 2 + (rnd(i * 7) - .5) * 30 * (1 - local), L = sx * 0.42; X.beginPath(); X.moveTo(cx - Math.cos(ang) * L, cy - Math.sin(ang) * L); X.lineTo(cx + Math.cos(ang) * L, cy + Math.sin(ang) * L); X.stroke(); }
}
// ════ agents everywhere — point-cloud globe, cut per beat ════
const GWORDS = [[0, 'agents'], [2, 'everywhere'], [4, 'create.'], [5, 'edit.'], [6, 'distribute.'], [7, 'earn.'], [8, '145 countries'], [10, 'one network'], [12, 'always on'], [14, 'the attention economy']];
function G0(u) {
  const kk = (() => { let k = 0; while (k < 16 && K(62 + k + 1) - K(62) <= u) k++; return k; })();
  GLOBE_URLS.forEach(img);
  const g = renderGlobe(u, 0.5573, kk); if (g) X.drawImage(g, 0, 0);
  // fast B/W footage inserts on odd beats in the second half (fast-cut energy)
  if (kk >= 8 && kk % 2 === 1 && kk < 14) { const lk = u - D(62, 62 + kk); const clip = ['aerial', 'city', 'head'][kk % 3]; X.save(); X.globalAlpha = 0.9; shot(X, clip, lk, { off: 1, zs: 0.2 }); X.restore(); }
  let cur = null; for (const w of GWORDS) if (kk >= w[0]) cur = w;
  const big = cur[1] === 'the attention economy', lu = u - D(62, 62 + cur[0]);
  word(X, cur[1], W / 2, H / 2, big ? BIG + 30 : BIG + 20, lu - 0.02, { align: 'center', w: big ? 600 : 500, dur: 0.18 });
  if (kk >= 4 && kk < 8) { const labels = ['create', 'edit', 'distribute', 'earn']; labels.forEach((s, i) => { const on = i <= kk - 4; font(X, 26, 500); X.textAlign = 'center'; X.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.25)'; X.fillText(s.toUpperCase(), W / 2 + (i - 1.5) * 220, H - 110); }); }
}
function E0(u) { bg(X, C.ink); if (u < 0.08) flash(X, '#fff', 1 - u / 0.08); }
function D0(u) {
  bg(X, C.ink);
  const lg = img(LOGO); if (lg) { const w = 760, h = w * lg.height / lg.width, p = E.outQuint(clamp(u / 0.8)); X.save(); X.globalAlpha = p * (1 - clamp((u - 2.2) / 0.5)); X.translate(W / 2 - (1 - p) * 60, H / 2 - 40); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
  word(X, 'the global attention economy', W / 2, H / 2 + 140, MID - 10, u - 0.4, { align: 'center', color: '#a8a8a8', out: 2.2 });
}
export const SHOTS = [
  [0, I0], [K(8), A1], [K(12), A2], [K(16), A3], [K(20), A4], [K(24), A6], [K(28), B0],
  [K(32), B2], [K(36), B3], [K(40), C0], [K(44), C1], [K(48), C2], [K(52), C3], [K(56), C4], [K(60), C5],
  [K(62), G0], [K(78), E0], [K(80), D0]];
export const DUR = 47.0;
