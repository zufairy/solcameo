// ───────── VELLO — shot list (structure mirrors the reference, rewritten for Vello) ─────────
import { W, H, C, K, X, clamp, lerp, prog, E, rnd, mk, rrect, font, word, measure, vframe, img, cover, shot, glyph, GLYPHS, tile, lineArt, dots, flash } from './core.js';
import { renderMark, renderCard, renderStack } from './gl.js';

const LOGO = 'assets/vello-logo-white.png', MARK = 'assets/vello-mark-lime.png';
const THUMBS = ['thumbs/jd1.jpg', 'thumbs/jd3.jpg', 'thumbs/jd4.jpg', 'thumbs/jd6.jpg', 'thumbs/jd7.jpg', 'thumbs/jd8.jpg'];
const PHONES = ['thumbs/ph_2148.jpg', 'thumbs/ph_2196.jpg', 'thumbs/ph_2244.jpg', 'thumbs/ph_2292.jpg', 'thumbs/ph_2340.jpg', 'thumbs/ph_2388.jpg'];
const tintC = {}; function tinted(src, col) { const k = src + col; if (tintC[k]) return tintC[k]; const im = img(src); if (!im) return null; const c = mk(im.width, im.height), x = c.getContext('2d'); x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); return (tintC[k] = c); }
const bg = (c, col) => { c.fillStyle = col; c.fillRect(0, 0, W, H); };
const SZ = 54; // body word size (reference: small, centred, lowercase)

// floating colour thumbnails that pop in over monochrome footage
function thumbs(c, u, list, spots, step = 0.29) {
  spots.forEach(([x, y, w, ar], i) => {
    const t0 = i * step, q = clamp((u - t0) / 0.25); if (q <= 0) return;
    const im = img(list[i % list.length]); if (!im) return;
    const s = E.outBack(q), h = w * ar, dx = Math.sin(u * 0.8 + i) * 6, dy = -u * 10;
    c.save(); c.translate(x + dx, y + dy); c.scale(s, s);
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 30; cover(c, im, -w / 2, -h / 2, w, h); c.shadowBlur = 0;
    c.restore();
  });
}

// ════ ACT I — attention never sleeps ════
function A0(u, t) { // giant outline word scroll + glyph flicker (reference 0:00)
  bg(X, C.ink);
  font(X, 760, 600); X.textBaseline = 'middle'; X.textAlign = 'left';
  const s = 'attention', x0 = 300 - u * 900;
  X.save(); X.lineWidth = 2; X.strokeStyle = 'rgba(255,255,255,0.22)'; X.strokeText(s, x0, H / 2 + 20);
  const g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(255,255,255,0)'); X.fillStyle = g; X.fillText(s, x0, H / 2 + 20); X.restore();
  const i = Math.floor(u / (0.5785 / 2)), type = GLYPHS[i % GLYPHS.length];
  const pop = E.outBack(clamp((u % (0.5785 / 2)) / 0.1));
  X.save(); X.shadowColor = 'rgba(255,255,255,0.6)'; X.shadowBlur = 40; X.translate(W / 2, H / 2); X.scale(pop, pop); glyph(X, type, 0, 0, 150, C.white); X.restore();
}
function A1(u) { // liquid chrome: "every" "feed"
  shot(X, 'chrome', u, { off: 0.2, zs: 0.05 });
  word(X, 'every', W * 0.36, H / 2, SZ, u - 0.15, { out: 1.05 });
  word(X, 'feed,', W * 0.56, H / 2, SZ, u - 0.55, { out: 0.65 });
  word(X, 'every', W * 0.36, H / 2, SZ, u - 1.3);
  word(X, 'second.', W * 0.56, H / 2, SZ, u - 1.65);
}
function A2(u) { // chart crash → particle earth: "attention never stops"
  const cut = K(10) - K(8);
  if (u < cut) shot(X, 'chart', u, { off: 0.2, zs: 0.08, rot: 0.01 });
  else { shot(X, 'earth', u - cut, { off: 0.5, zs: 0.05 }); }
  // dot dissolve right at the cut
  const d = u - cut;
  if (d > -0.18 && d < 0.18) { bg(X, C.ink); dots(X, vframe(d < 0 ? 'chart' : 'earth', d < 0 ? 0.2 + u : 0.5 + Math.max(0, d)), u, 1 - Math.abs(d) / 0.18); }
  word(X, 'attention never stops', W / 2, H / 2, SZ, u - 0.3, { align: 'center' });
}
function A3(u) { // runners of light + warp burst + line-art silhouette: "every second," / "across 145 countries"
  const c1 = K(13) - K(12), c2 = K(14) - K(12);
  if (u < c1) { shot(X, 'runner', u, { off: 1.2, zs: 0.04 }); }
  else if (u < c2) { shot(X, 'warp', u - c1, { off: 0, speed: 1.2, zs: 0.2 }); }
  else { bg(X, C.ink); lineArt(X, vframe('creator2', 2 + u - c2), u); }
  word(X, 'everywhere,', W * 0.08, H * 0.44, SZ, u - 0.2);
  word(X, 'across 145 countries', W * 0.92, H * 0.6, SZ, u - c1 - 0.1, { align: 'right' });
}
function A4(u) { // city lights
  shot(X, 'bokeh', u, { off: 0.5, zs: 0.1 });
  word(X, 'the world runs on attention', W / 2, H / 2, SZ, u - 0.1, { align: 'center' });
}
function A5(u) { // creators chase it — creator / scroll / edit / tired, one word per beat
  const b = 0.5785, i = Math.min(3, Math.floor(u / (2 * b))), uu = u - i * 2 * b;
  const clip = ['creator', 'creator2', 'edit', 'tired'][i], wd = ['create.', 'post.', 'edit.', 'repeat.'][i];
  shot(X, clip, uu, { off: 0.3 + i * 0.3, zs: 0.06, dark: 0.15 });
  word(X, wd, W / 2, H / 2, 96, uu - 0.05, { align: 'center', w: 600, dur: 0.18 });
  if (i === 3) word(X, 'for scraps of reach', W / 2, H / 2 + 90, 40, uu - 0.45, { align: 'center', color: C.grey });
}
// grid wall of tiles, attention icons scattered (reference 0:06–0:11)
const SPOTS = [[0.26, 0.28], [0.72, 0.24], [0.84, 0.47], [0.18, 0.66], [0.55, 0.16], [0.63, 0.78], [0.35, 0.82], [0.9, 0.73], [0.42, 0.35], [0.1, 0.4]];
function wall(c, inv, glow = 0) {
  const s = 128, gap = 10;
  for (let y = -s / 2; y < H + s; y += s + gap) for (let x = -s / 2; x < W + s; x += s + gap) {
    rrect(c, x, y, s, s, 22); c.fillStyle = inv ? '#FAFAFA' : '#0D0D0D'; c.fill();
    c.strokeStyle = inv ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'; c.lineWidth = 1.5; c.stroke();
  }
}
function A6(u) { // "but your reach gets scattered"
  bg(X, C.ink); wall(X, false);
  SPOTS.forEach(([x, y], i) => { const q = clamp((u - i * 0.17) / 0.2); if (q > 0) tile(X, GLYPHS[i], x * W, y * H, 92 * E.outBack(q)); });
  word(X, 'but your reach', W * 0.3, H / 2, 28, u - 0.2, { color: '#cfcfcf', shadow: false });
  word(X, 'gets scattered', W * 0.7, H / 2, 28, u - 0.9, { color: '#cfcfcf', shadow: false, align: 'right' });
}
// ════ ACT II — what if your agent did it all ════
function B0(u) {
  const inv = u < 0.12; bg(X, inv ? '#F4F4F4' : C.ink); wall(X, inv);
  SPOTS.forEach(([x, y], i) => tile(X, GLYPHS[i], x * W + Math.sin(u + i) * 8, y * H + Math.cos(u * 0.8 + i) * 8, 92, 1, inv));
  const ws = ['what', 'if', 'your', 'agent', 'did', 'it', 'all?'], size = 30; let tw = 0; const ww = ws.map(s => { const w = measure(s + ' ', size); tw += w; return w; });
  let x = W / 2 - tw / 2; ws.forEach((s, i) => { const q = clamp((u - 0.4 - i * 0.32) / 0.3); font(X, size); X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillStyle = inv ? C.ink : `rgba(244,244,242,${0.15 + 0.85 * q})`; X.fillText(s, x, H / 2); x += ww[i]; });
}
function B1(u) { // icons converge into a cluster, then the Vello mark
  bg(X, C.ink); wall(X, false);
  const p = E.inOutExpo(clamp(u / 0.75));
  SPOTS.forEach(([x, y], i) => { const tx = W / 2 + (rnd(i) - .5) * 120 * (1 - p * 0.6), ty = H / 2 + (rnd(i * 3) - .5) * 90 * (1 - p * 0.6); tile(X, GLYPHS[i], lerp(x * W, tx, p), lerp(y * H, ty, p), 92 * lerp(1, 0.8, p), 1 - clamp((u - 0.75) / 0.12)); });
  if (u > 0.72) { const q = E.outBack(clamp((u - 0.72) / 0.3)); const m = tinted(MARK, '#ffffff'); if (m) { X.save(); X.translate(W / 2, H / 2); X.scale(q, q); X.drawImage(m, -95, -95, 190, 190); X.restore(); } }
}
function B2(u) { // white card: vello wordmark (reference "Frontier Traders" on white)
  bg(X, '#F2F2F0');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.05)'; X.lineWidth = 1; for (let i = 0; i < 30; i++) { X.beginPath(); X.arc(W * 0.8, -200, 300 + i * 60 + u * 20, 0, 7); X.stroke(); } X.restore();
  const lg = tinted(LOGO, '#0a0a0a'); if (lg) { const w = 980, h = w * lg.height / lg.width, s = lerp(1.06, 1, E.outCubic(clamp(u / 1.6))); X.save(); X.translate(W / 2, H / 2); X.scale(s, s); X.globalAlpha = clamp(u / 0.15); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
  word(X, 'agents that create, publish and earn', W / 2, H / 2 + 230, 30, u - 0.6, { align: 'center', color: '#555', shadow: false });
}
function B3(u) { // chrome mark (three.js) then the tilted agent card
  const c1 = K(44) - K(41);
  if (u < c1) {
    const g = X.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H * 0.45, 1100); g.addColorStop(0, '#2a2a2a'); g.addColorStop(1, '#030303'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    X.drawImage(renderMark(u), 0, 0);
  } else {
    const g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1b1b1b'); g.addColorStop(1, '#070707'); X.fillStyle = g; X.fillRect(0, 0, W, H);
    X.drawImage(renderCard(u - c1), 0, 0);
  }
}
function B4(u) { shot(X, 'car', u, { off: 0.5, speed: 1.4, zs: 0.1, px: -60 }); }
// ════ ACT III — agents earn ════
function C0(u) { // split screen: "get paid" ticker (reference 0:14.5)
  bg(X, '#F4F4F2');
  const bx = W * 0.52, by = 0, bw = W * 0.48, bh = H * 0.52;
  X.fillStyle = '#060606'; X.fillRect(bx, by, bw, bh);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) { const px = bx + 40 + x * 58 + (y % 2) * 29, py = by + 40 + y * 58, a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(u * 3 + x * 0.6 + y)); X.fillStyle = `rgba(255,255,255,${a})`; X.fillRect(px, py, 3, 3); }
  // dashed guides
  X.save(); X.setLineDash([4, 6]); X.strokeStyle = 'rgba(0,0,0,0.35)'; X.lineWidth = 1; X.beginPath(); X.moveTo(0, bh); X.lineTo(W, bh); X.moveTo(bx, 0); X.lineTo(bx, H); X.stroke(); X.restore();
  // rising line chart into the corner
  const n = 60, pr = E.outCubic(clamp(u / 2.2));
  X.beginPath(); for (let i = 0; i <= n * pr; i++) { const x = W * 0.12 + i / n * (bx - W * 0.12), y = H * 0.9 - (i / n) * (H * 0.9 - bh) + Math.sin(i * 1.7) * 12 * (1 - i / n); i ? X.lineTo(x, y) : X.moveTo(x, y); } X.strokeStyle = '#0a0a0a'; X.lineWidth = 2.2; X.stroke();
  X.fillStyle = '#0a0a0a'; X.beginPath(); X.arc(bx, bh, 6, 0, 7); X.fill();
  const v = 2071.79 + u * 2.8; word(X, '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), bx + 22, bh + 32, 28, 0.5, { color: '#0a0a0a', shadow: false });
  word(X, 'agents', 70, 110, 52, u - 0.1, { color: '#0a0a0a', shadow: false });
  word(X, 'get paid', 70, 168, 52, u - 0.45, { color: '#0a0a0a', shadow: false });
  word(X, 'for every', W - 70, H - 150, 52, u - 1.0, { color: '#0a0a0a', shadow: false, align: 'right' });
  word(X, 'verified view', W - 70, H - 92, 52, u - 1.3, { color: '#0a0a0a', shadow: false, align: 'right' });
}
function C1(u) { // headlights + floating edits: "a–z. no editing."
  shot(X, 'head', u, { off: 0.6, zs: 0.05 });
  thumbs(X, u, PHONES, [[260, 260, 150, 1.77], [1680, 300, 170, 1.77], [420, 820, 140, 1.77], [1560, 820, 150, 1.77]]);
  word(X, u < 1.2 ? 'brief in. edits out.' : 'you never touch the timeline', W / 2, H / 2, SZ, u < 1.2 ? u - 0.1 : u - 1.2, { align: 'center' });
}
function C2(u) { // jet: "verified views"
  shot(X, 'jet', u, { off: 0.5, zs: 0.04, px: -30 });
  thumbs(X, u, THUMBS, [[640, 250, 220, 0.5625], [1500, 700, 260, 0.5625], [300, 760, 200, 0.5625]]);
  word(X, 'verified views', W / 2, H / 2, SZ, u - 0.1, { align: 'center' });
}
function C3(u) { // statue / dome: "a global network of agents"
  const cut = (K(62) - K(59)) / 2;
  shot(X, u < cut ? 'aerial' : 'earth2', u < cut ? u : u - cut, { off: 0.5, zs: 0.05 });
  thumbs(X, u, PHONES.slice(2).concat(PHONES), [[1600, 230, 150, 1.77], [330, 700, 150, 1.77], [1550, 820, 140, 1.77]]);
  word(X, 'one global network', W / 2, H / 2, SZ, u - 0.1, { align: 'center' });
}
function C4(u) { // white field, square window with the mark over rotating textures (reference "Trade anywhere on solana")
  bg(X, '#F4F4F2');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.08)'; X.lineWidth = 1; [W / 3, 2 * W / 3].forEach(x => { X.beginPath(); X.moveTo(x, 0); X.lineTo(x, H); X.stroke(); }); [H / 3, 2 * H / 3].forEach(y => { X.beginPath(); X.moveTo(0, y); X.lineTo(W, y); X.stroke(); }); X.restore();
  const b = 0.5785, i = Math.floor(u / b), clips = ['earth2', 'chrome2', 'city', 'chrome', 'aerial'];
  const sq = 620, x0 = W / 2 - sq / 2, y0 = H / 2 - sq / 2, open = E.outExpo(clamp(u / 0.35));
  X.save(); X.beginPath(); X.rect(x0 + sq / 2 * (1 - open), y0, sq * open, sq); X.clip();
  X.fillStyle = '#000'; X.fillRect(x0, y0, sq, sq);
  const im = vframe(clips[i % clips.length], 0.3 + u - i * b);
  if (im) { X.save(); X.translate(W / 2, H / 2); X.rotate(u * (i % 2 ? -0.25 : 0.25)); cover(X, im, -sq * 0.75, -sq * 0.75, sq * 1.5, sq * 1.5); X.restore(); }
  const m = tinted(MARK, '#ffffff'); if (m) X.drawImage(m, W / 2 - 110, H / 2 - 110, 220, 220);
  X.restore();
  word(X, 'earn', x0 - 16, y0 + 30, 52, u - 0.3, { shadow: false, color: '#0a0a0a', align: 'right' });
  word(X, 'anywhere', x0 + 16, y0 + 30, 52, u - 0.55, { shadow: true });
  word(X, 'on', x0 + sq - 16, y0 + sq - 30, 52, u - 1.2, { align: 'right' });
  word(X, 'solana', x0 + sq + 16, y0 + sq - 30, 52, u - 1.4, { color: '#0a0a0a', shadow: false });
}
function C5(u) { // line field resolving into a grid (reference 0:23)
  bg(X, C.ink);
  const p = E.inOutCubic(clamp(u / 1.5)), cols = 30, rows = 12, sx = W / cols, sy = H / rows;
  X.strokeStyle = C.white; X.lineWidth = 2.2; X.lineCap = 'round';
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const i = r * cols + q, local = clamp(p * 1.8 - (1 - q / cols) * 0.8), ang = lerp(rnd(i) * 6.28 + u * (rnd(i * 3) - .5) * 4, (i % 2) * Math.PI / 2, E.outCubic(local));
    const cx = q * sx + sx / 2 + (rnd(i * 5) - .5) * 30 * (1 - local), cy = r * sy + sy / 2 + (rnd(i * 7) - .5) * 30 * (1 - local), L = sx * 0.42;
    X.beginPath(); X.moveTo(cx - Math.cos(ang) * L, cy - Math.sin(ang) * L); X.lineTo(cx + Math.cos(ang) * L, cy + Math.sin(ang) * L); X.stroke();
  }
}
function C6(u) { // 3D agent passes fan in (reference 0:24.75)
  bg(X, C.ink);
  X.save(); X.strokeStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < 40; i++) { const x = (i * 53 + u * 40) % W; X.beginPath(); X.moveTo(x, 0); X.lineTo(x, H); X.stroke(); } X.restore();
  const out = clamp((u - (K(78) - K(70))) / 0.4);
  const glc = renderStack(u, E.inExpo(out));
  if (out > 0) { for (let k = 4; k >= 1; k--) { X.globalAlpha = 0.12; X.drawImage(glc, -k * 50 * out, 0); } X.globalAlpha = 1; }
  X.drawImage(glc, 0, 0);
  word(X, 'every agent. every view. every payout.', W / 2, H - 56, 28, u - 0.8, { align: 'center', color: '#bdbdbd', out: K(78) - K(70) - 0.1 });
}
function D0(u) { // logo lockup on black (reference end card)
  bg(X, C.ink);
  const lg = img(LOGO); if (lg) { const w = 620, h = w * lg.height / lg.width, p = E.outQuint(clamp(u / 0.9)); X.save(); X.globalAlpha = p * (1 - clamp((u - 1.9) / 0.4)); X.translate(W / 2 - (1 - p) * 60, H / 2 - 30); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
  word(X, 'the global attention economy', W / 2, H / 2 + 120, 30, u - 0.5, { align: 'center', color: '#a8a8a8', out: 1.9 });
}

export const SHOTS = [
  [0, A0], [K(4), A1], [K(8), A2], [K(12), A3], [K(16), A4], [K(18), A5], [K(26), A6],
  [K(30), B0], [K(36), B1], [K(38), B2], [K(41), B3], [K(45.5), B4],
  [K(47), C0], [K(52), C1], [K(56), C2], [K(59), C3], [K(62), C4], [K(67), C5], [K(70), C6],
  [K(79), D0]];
export const DUR = 48.6;
