// ───────── VELLO v6 shared scene library — house style: B/W, fast cuts, flashes, tracking HUD ─────────
import { W, H, C, K, X, clamp, lerp, E, rnd, mk, font, word, measure, vframe, img, cover, shot } from './core.js';
export { W, H, K, X, clamp, lerp, E, rnd, word, font, img, vframe, cover };
export const LOGO = 'assets/vello-logo-white.png', MARK = 'assets/vello-mark-lime.png';
export const JD = ['thumbs/jd8.jpg', 'thumbs/jd6.jpg', 'thumbs/jd4.jpg', 'thumbs/jd7.jpg', 'thumbs/jd1.jpg', 'thumbs/jd3.jpg'];
export const BIG = 112, MID = 64, HUGE = 170, BT = 0.6035, HB = BT / 2;
export const D = (a, b) => K(b) - K(a);
export const bg = (col) => { X.fillStyle = col; X.fillRect(0, 0, W, H); };
export const dark = a => { X.fillStyle = `rgba(0,0,0,${a})`; X.fillRect(0, 0, W, H); };
const tintC = {}; export function tinted(src, col) { const k = src + col; if (tintC[k]) return tintC[k]; const im = img(src); if (!im) return null; const c = mk(im.width, im.height), x = c.getContext('2d'); x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); return (tintC[k] = c); }
export function invert() { X.save(); X.globalCompositeOperation = 'difference'; X.fillStyle = '#fff'; X.fillRect(0, 0, W, H); X.restore(); }
const isFilm = c => /^(x_|d_|m_|sn_)/.test(c);
const isComp = c => /^cf/.test(c);
// crop defaults per source family: film edits hide bottom watermark, compilation hides centre captions as much as possible
export function cropFor(clip) { return isFilm(clip) ? { zoom: 1.2, zy: 0.18 } : isComp(clip) ? { zoom: 1.18, zy: 0.4 } : {}; }
export function film(clip, u, o = {}) { shot(X, clip, u, Object.assign({}, cropFor(clip), { z0: 1.0, zs: 0.04 }, o)); }
// beat pulse 0..1 (decays after each beat)
export function pulse(t) { let k = 0; while (K(k + 1) <= t && k < 400) k++; const d = t - K(k); return Math.exp(-d * 9); }

// ── face-tracked punch-in with HUD lock box ──
let SUBJ = 0;
export function faceShot(clip, u, o = {}) {
  const tr = window.FACES && window.FACES[clip]; const im = vframe(clip, (o.off || 0) + u * (o.speed || 1));
  if (!tr || !im) { film(clip, u, o); return false; }
  const c = window.CLIPS[clip]; const fi = Math.min(tr.length - 1, Math.max(0, Math.floor(((o.off || 0) + u * (o.speed || 1)) * c.fps)));
  const [fx, fy, fh] = tr[fi]; const iw = im.width, ih = im.height;
  let z = clamp((o.fh || 0.4) / fh, 1.08, 2.4) * (1 + (o.punch ?? 0.06) * (o.t != null ? pulse(o.t) : 0)) * (1 + 0.03 * u);
  const nw = iw / z, nh = ih / z, left = clamp(fx * iw - (o.ax ?? 0.5) * nw, 0, iw - nw), top = clamp(fy * ih - (o.ay ?? 0.42) * nh, 0, ih - nh);
  X.drawImage(im, left, top, nw, nh, 0, 0, W, H);
  if (o.dark) dark(o.dark);
  if (o.hud !== false) { // lock box
    const cx = (fx * iw - left) / nw * W, cy = (fy * ih - top) / nh * H, s = fh * ih / nh * H * 1.35, a = clamp(u / 0.15);
    X.save(); X.globalAlpha = a; X.strokeStyle = 'rgba(255,255,255,0.9)'; X.lineWidth = 2; const L = s * 0.18, x0 = cx - s / 2, y0 = cy - s / 2;
    [[x0, y0, 1, 1], [x0 + s, y0, -1, 1], [x0, y0 + s, 1, -1], [x0 + s, y0 + s, -1, -1]].forEach(([x, y, dx, dy]) => { X.beginPath(); X.moveTo(x + dx * L, y); X.lineTo(x, y); X.lineTo(x, y + dy * L); X.stroke(); });
    X.globalAlpha = a * 0.35; X.lineWidth = 1; X.beginPath(); X.moveTo(0, cy); X.lineTo(x0, cy); X.moveTo(x0 + s, cy); X.lineTo(W, cy); X.moveTo(cx, 0); X.lineTo(cx, y0); X.stroke();
    X.globalAlpha = a; font(X, 15, 500, 'JetBrains Mono'); X.textBaseline = 'bottom'; X.textAlign = 'left'; X.fillStyle = '#fff';
    X.fillText(`${o.label || 'SUBJECT_0' + ((SUBJ % 7) + 1)}  ● LOCKED`, x0, y0 - 8);
    X.textBaseline = 'top'; X.fillStyle = '#C8FF00'; X.fillText(o.tag || `ATTENTION ${(92 + (fi % 70) / 10).toFixed(1)}%`, x0, y0 + s + 8);
    X.restore();
  }
  return true;
}
// montage helper: list items are clip names or [clip, opts]
export function montage(u, list, step, o = {}) {
  const i = Math.floor(u / step), it = list[i % list.length]; const [clip, extra] = Array.isArray(it) ? it : [it, {}];
  const lu = u - i * step, oo = Object.assign({}, o, extra);
  if (oo.face && window.FACES && window.FACES[clip]) faceShot(clip, lu, oo); else film(clip, lu, oo);
  return i;
}
export function win(clip, u, x, y, w, h, o = {}) {
  const open = o.open == null ? 1 : o.open;
  X.save(); X.beginPath(); X.rect(x, y + h / 2 * (1 - open), w, h * open); X.clip(); X.fillStyle = '#000'; X.fillRect(x, y, w, h);
  const im = vframe(clip, (o.off || 0) + u * (o.speed || 1)); if (im) { const z = (o.z0 || 1) + (o.zs ?? 0.06) * u; X.translate(x + w / 2, y + h / 2); X.scale(z, z); cover(X, im, -w / 2, -h / 2, w, h, Object.assign({}, cropFor(clip), o)); }
  X.restore();
  if (o.stroke !== false) { X.strokeStyle = o.strokeCol || 'rgba(255,255,255,0.35)'; X.lineWidth = 1; X.strokeRect(x, y, w, h); }
}
// ── tracking HUD ──
export function trackLines(u, col = 'rgba(255,255,255,0.5)', label = 'THE GLOBAL ATTENTION ECONOMY', coord = 'N 40.7128°  W 74.0060°') {
  const c = X; c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
  [0.16, 0.84].forEach((y, i) => { const yy = y * H + Math.sin(u * 0.9 + i) * 6; c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke(); });
  [0.18, 0.5, 0.82].forEach((x, i) => { const xx = x * W + ((u * 40 * (i % 2 ? 1 : -1)) % 60); c.save(); c.setLineDash([2, 10]); c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, H); c.stroke(); c.restore(); });
  [[0.18, 0.16], [0.82, 0.16], [0.18, 0.84], [0.82, 0.84]].forEach(([x, y]) => { const px = x * W, py = y * H; c.beginPath(); c.moveTo(px - 14, py); c.lineTo(px + 14, py); c.moveTo(px, py - 14); c.lineTo(px, py + 14); c.stroke(); });
  font(c, 15, 500, 'JetBrains Mono'); c.textBaseline = 'middle';
  c.textAlign = 'left'; c.fillText(coord, 0.18 * W + 22, 0.16 * H - 16);
  c.textAlign = 'right'; c.fillText(`VLO-${String(Math.floor(u * 30)).padStart(5, '0')}  ●REC`, 0.82 * W - 22, 0.16 * H - 16);
  c.textAlign = 'left'; c.fillText(label, 0.18 * W + 22, 0.84 * H + 18);
  c.textAlign = 'right'; c.fillText(`${(48213 + Math.floor(u * 2917)).toLocaleString('en-US')} VIEWS / MIN`, 0.82 * W - 22, 0.84 * H + 18);
  c.globalAlpha = 0.25; c.fillRect(0, ((u * 0.6) % 1) * H, W, 1.5);
  c.restore();
}
// ── kinetic captions for an audio roll (word-timed from the transcript alignment) ──
const KEY = new Set(['rich', 'win', 'obsessed', 'opportunity', 'risk', 'takers', 'delusional', 'unbeatable', 'champions', 'daily', 'extraordinary', 'extra', 'control', 'dangerous', 'discipline', 'regret', 'tons', 'go', 'now', 'today', 'unstoppable', 'different', 'loss', 'what', 'if', 'best', 'normal', 'beat', 'grind', 'tired', 'up', 'time', 'nothing', 'money', 'obsession', 'lonely', 'right']);
export function caption(id, lu, o = {}) {
  const Wd = window.WORDS[id]; if (!Wd) return; const ws = Wd.w.map(w => [w[0], w[1] - (o.trim || 0), w[2] - (o.trim || 0)]).filter(w => w[1] > -0.05);
  // pages: ≤ maxw words, break on long gaps
  const maxw = o.maxw || 3, pages = []; let cur = [];
  ws.forEach((w, i) => { if (cur.length && (cur.length >= maxw || w[1] - cur[cur.length - 1][2] > 0.35)) { pages.push(cur); cur = []; } cur.push(w); }); if (cur.length) pages.push(cur);
  let pg = null; for (const p of pages) if (lu >= p[0][1] - 0.04) pg = p; if (!pg) return;
  const last = pages[pages.length - 1]; if (pg === last && lu > last[last.length - 1][2] + (o.hold ?? 0.5)) return;
  let size = o.size || BIG + 8; const sp = size * 0.28;
  const wid = pg.map(w => measure(w[0], size, KEY.has(w[0]) ? 700 : 500)); let tot = wid.reduce((a, b) => a + b, 0) + sp * (pg.length - 1);
  if (tot > W - 220) { size *= (W - 220) / tot; tot = W - 220; }
  const wid2 = pg.map(w => measure(w[0], size, KEY.has(w[0]) ? 700 : 500));
  let x = (o.x ?? W / 2) - tot / 2; const y = o.y ?? H / 2;
  pg.forEach((w, i) => { const k = KEY.has(w[0]); word(X, w[0], x, y, size, lu - w[1] + 0.04, { w: k ? 700 : 500, dur: 0.12, color: k ? '#ffffff' : (o.dim || '#d8d8d8') }); x += wid2[i] + sp; });
}
// roll = rapid montage + face tracking + kinetic captions
export function roll(u, t, o) {
  montage(u, o.clips, o.step || HB, { dark: o.dark ?? 0.42, face: o.face, t, zs: o.zs ?? 0.08, label: o.label, tag: o.tag, fh: o.fh });
  if (o.hud) trackLines(u, 'rgba(255,255,255,0.4)', o.hudLabel || 'THE NEW MONEY');
  (o.lines || []).forEach(([id, at, ex]) => caption(id, u - at, Object.assign({}, o.cap || {}, ex || {})));
}
// ── glitch thumbnails ──
const GT = mk(1000, 1000), GX = GT.getContext('2d');
export function gthumbs(u, list, spots, step = 0.22) {
  const c = X;
  spots.forEach(([x, y, w, ar], i) => {
    const t0 = i * step, q = clamp((u - t0) / 0.3); if (q <= 0) return;
    const src = list[i % list.length], isClip = !src.includes('/'); const im = isClip ? vframe(src, u - t0 + 0.2) : img(src); if (!im) return;
    const h = w * ar, p = E.outQuint(q), dir = i % 2 ? 1 : -1, off = (1 - p) * 320 * dir, live = u - t0;
    const jitter = (live < 0.16) || (Math.floor(u * 25 + i * 7) % 37 === 0);
    GX.setTransform(1, 0, 0, 1, 0, 0); GX.clearRect(0, 0, 1000, 1000); GX.filter = 'grayscale(1) contrast(1.3) brightness(1.2)';
    cover(GX, im, 0, 0, w, h, isClip ? cropFor(src) : { zoom: 1.08 + live * 0.04 }); GX.filter = 'none';
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
export const SPOTS4 = [[330, 250, 420, 0.5625], [1600, 280, 440, 0.5625], [400, 840, 400, 0.5625], [1560, 840, 380, 0.5625]];
export function counter(v, x, y, size, u, o = {}) { word(X, (o.pre || '') + Math.floor(v).toLocaleString('en-US') + (o.suf || ''), x, y, size, u, Object.assign({ w: 600, dur: 0.12 }, o)); }
// ── reusable scenes ──
export function dlgWin(u, o) { // dialogue: face window + stacked lines on the other side
  bg(o.light ? '#F4F4F2' : '#050505');
  const x = o.side === 'left' ? 150 : 1010, open = E.outExpo(clamp((u - 0.03) / 0.25));
  win(o.clip, u, x, 190, 760, 700, Object.assign({ open, zs: 0.04, strokeCol: o.light ? 'rgba(0,0,0,0.3)' : undefined }, o.crop));
  const tx = o.side === 'left' ? 1000 : 960, al = o.side === 'left' ? 'left' : 'right';
  (o.lines || []).forEach(([s, at, ex]) => word(X, s, tx, ex?.y ?? 540, ex?.size || BIG, u - at, Object.assign({ align: al, color: o.light ? '#0a0a0a' : '#fff', shadow: !o.light }, ex)));
  if (o.count) counter(o.count.v * E.outCubic(clamp((u - o.count.at) / (o.count.dur || 0.9))), tx, o.count.y || 450, HUGE, u - o.count.at, { pre: o.count.pre || '', align: al, color: o.light ? '#0a0a0a' : '#fff', shadow: !o.light });
  trackLines(u, o.light ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)', o.hud || 'NEW YORK — 1987');
}
export function windowSq(u, o) { // white field + square window cutting clips every half-beat; words split around the edge
  const i = Math.floor(u / HB), inv = o.invert !== false && i % 4 === 3;
  bg(inv ? '#060606' : '#F4F4F2');
  const sq = 600, x0 = W / 2 - sq / 2 + (o.dx ?? 150), y0 = H / 2 - sq / 2, open = E.outExpo(clamp(u / 0.25));
  win(o.clips[i % o.clips.length], u - i * HB, x0, y0, sq, sq, { open, off: 0.3, speed: 1.4, z0: 1.15, zs: 0.4, stroke: false });
  (o.out || []).forEach(([s, at, ex], k) => word(X, s, x0 - 24, y0 + 60 + k * 120, BIG, u - at, Object.assign({ align: 'right', color: inv ? '#fff' : '#0a0a0a', shadow: false }, ex)));
  (o.in || []).forEach(([s, at, ex], k, a) => word(X, s, x0 + 24, y0 + sq - 50 - (a.length - 1 - k) * 110, BIG, u - at, ex));
  trackLines(u, inv ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)', o.hud || 'NOW');
}
export function wall(u, o) { // 3×2 screen wall cutting clips, words on beats
  const k = Math.floor(u / BT); bg('#050505');
  const cw = 520, ch = 292, gx = 40, gy = 40, ox = (W - (3 * cw + 2 * gx)) / 2, oy = (H - (2 * ch + gy)) / 2;
  for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) {
    const n = r * 3 + q, a = clamp((u - n * 0.06) / 0.12); if (a <= 0) continue;
    const sub = Math.floor((u + n * 0.13) / HB), clip = o.clips[(sub + n * 3) % o.clips.length], x = ox + q * (cw + gx), y = oy + r * (ch + gy);
    X.save(); X.globalAlpha = a; win(clip, (u + n * 0.13) % HB, x, y, cw, ch, { off: 0.3 + n * 0.2, speed: 2, z0: 1.1 }); X.restore();
    if (n === (k * 2) % 6) { X.fillStyle = 'rgba(200,255,0,0.9)'; font(X, 18, 500, 'JetBrains Mono'); X.textAlign = 'left'; X.textBaseline = 'top'; X.fillText(o.badge || '● POSTED', x + 14, y + 12); }
  }
  dark(0.4);
  let cur = null; for (const w of o.words) if (u >= w[1]) cur = w;
  if (cur) word(X, cur[0], W / 2, H / 2, HUGE - 20, u - cur[1], { align: 'center', w: 600, dur: 0.18 });
  trackLines(u);
  if (k % 2 === 1 && (u % BT) < 0.07) invert();
}
export function logoCard(u, o = {}) { // paper logo slam (the drop)
  bg('#F2F2F0');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 30; i++) { X.beginPath(); X.arc(W * 0.8, -200, 300 + i * 60 + u * 60, 0, 7); X.stroke(); } X.restore();
  const lg = tinted(LOGO, '#0a0a0a'); if (lg) { const w = 1240, h = w * lg.height / lg.width, s = lerp(1.35, 1, E.outQuint(clamp(u / 0.45))) + Math.sin(u * 40) * 0.006 * (1 - clamp(u / 0.4)); X.save(); X.translate(W / 2, H / 2 - 40); X.scale(s, s); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
  word(X, o.sub || 'agents that clip, post and earn', W / 2, H / 2 + 240, MID - 6, u - 0.35, { align: 'center', color: '#444', shadow: false });
  trackLines(u, 'rgba(0,0,0,0.35)', o.hud || 'VELLO');
}
export function punch(u, o) { // one word per beat over clips (2 clips per beat)
  const k = Math.min(o.words.length - 1, Math.floor(u / BT)), lu = u - k * BT, [w, cl] = o.words[k], h = Math.floor(lu / HB);
  film(cl[h % cl.length], lu - h * HB, { dark: 0.25, zs: 0.2 });
  word(X, w, W / 2, H / 2, HUGE + 30, lu - 0.01, { align: 'center', w: 650, dur: 0.12 });
  if (o.ticker !== false) { X.save(); X.fillStyle = 'rgba(0,0,0,0.6)'; X.fillRect(0, H - 70, W, 70); font(X, 22, 500, 'JetBrains Mono'); X.textBaseline = 'middle'; X.textAlign = 'left';
    const tk = '▲ VIEWS +12,480   ▲ AGENT_0042 PAID   ▲ CLIP POSTED · TOKYO   ▲ VIEWS +3,211   ▲ AGENT_0117 PAID   ▲ CLIP POSTED · LAGOS   ▲ VIEWS +8,904   ';
    const tw = X.measureText(tk).width; X.fillStyle = '#C8FF00'; X.fillText(tk + tk, -((u * 420) % tw), H - 35); X.restore(); }
}
export function proof(u, o) { // 5,000+ videos → 100+ agents minted → the site went down
  const t1 = o.t1, t2 = o.t2;
  if (u < t1) {
    bg('#050505'); const n = Math.floor(clamp(u / t1) * 60) + 6, cols = 12, tw = 160, th = 90;
    for (let i = 0; i < n; i++) { const q = i % cols, r = Math.floor(i / cols), x = q * tw, y = 60 + r * th * 2.1; const src = o.tiles[i % o.tiles.length]; const im = src.includes('/') ? img(src) : vframe(src, 0.3 + (i % 5) * 0.1); if (im) { X.save(); X.globalAlpha = 0.55; X.filter = 'grayscale(1)'; cover(X, im, x + 4, y, tw - 8, th * 2 - 8, src.includes('/') ? {} : cropFor(src)); X.filter = 'none'; X.restore(); } }
    dark(0.5); counter(5000 * E.outExpo(clamp(u / 1.2)), W / 2, H / 2 - 40, HUGE + 20, u - 0.02, { align: 'center', suf: '+' });
    word(X, 'videos produced', W / 2, H / 2 + 120, MID + 6, u - 0.3, { align: 'center', color: '#bdbdbd' });
  } else if (u < t2) {
    const lu = u - t1, i = Math.floor(lu / HB);
    film(o.flip[i % o.flip.length], lu - i * HB, { zoom: i % 2 ? 1.2 : 1.05, zy: 0.3, dark: 0.35, zs: 0.1 });
    counter(100 * E.outExpo(clamp(lu / 1.0)), W / 2, H / 2 - 60, HUGE + 20, lu - 0.02, { align: 'center', suf: '+' });
    word(X, 'agents minted', W / 2, H / 2 + 80, BIG - 20, lu - 0.25, { align: 'center' }); word(X, 'in one night', W / 2, H / 2 + 175, MID, lu - 0.6, { align: 'center', color: '#bdbdbd' });
  } else {
    const lu = u - t2; bg('#050505');
    font(X, 26, 500, 'JetBrains Mono'); X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillStyle = 'rgba(255,255,255,0.7)';
    ['GET velloagents.com/mint', 'HTTP/1.1 503 SERVICE UNAVAILABLE', 'retry-after: too many agents'].forEach((s, i) => { if (lu > i * 0.18) X.fillText(s, 140, 200 + i * 44); });
    word(X, 'the site', W / 2, H / 2 + 20, HUGE, lu - 0.15, { align: 'center', w: 600 }); word(X, 'went down.', W / 2, H / 2 + 190, HUGE, lu - 0.45, { align: 'center', w: 600 });
    if (Math.floor(lu * 12) % 3 === 0) for (let s = 0; s < 6; s++) { const y = rnd(Math.floor(lu * 25) + s) * H; X.drawImage(X.canvas, 0, y, W, 40, (rnd(s + Math.floor(lu * 25)) - .5) * 160, y, W, 40); }
  }
  trackLines(u, 'rgba(255,255,255,0.4)', 'TRACTION — LIVE');
}
const MCITIES = [['TOKYO', 139.7, 35.7], ['SEOUL', 127, 37.5], ['KUALA LUMPUR', 101.7, 3.1], ['JAKARTA', 106.8, -6.2], ['MUMBAI', 72.9, 19.1], ['DUBAI', 55.3, 25.2], ['LAGOS', 3.4, 6.5], ['LONDON', -0.1, 51.5], ['PARIS', 2.35, 48.9], ['SÃO PAULO', -46.6, -23.5], ['MEXICO CITY', -99.1, 19.4], ['NEW YORK', -74, 40.7]];
export function map(u, o) {
  bg('#050505');
  const T = o.T, p = E.inOutCubic(clamp(u / T)), cell = 15, mw = 192 * cell, mh = 96 * cell;
  const camLon = lerp(120, -50, p), camLat = lerp(36, 32, p), zoom = lerp(1.0, 0.9, p);
  const toXY = (lon, lat) => [((lon + 180) / 360) * mw, ((90 - lat) / 180) * mh]; const [cx, cy] = toXY(camLon, camLat);
  X.save(); X.translate(W / 2, H / 2); X.scale(zoom, zoom); X.translate(-cx, -cy);
  const G = window.MAPGRID; X.fillStyle = 'rgba(255,255,255,0.28)';
  for (let y = 0; y < 96; y++) for (let x = 0; x < 192; x++) if (G[y][x] === '1') { for (const dx of [-mw, 0, mw]) { const px = x * cell + dx; if (Math.abs(px - cx) > W / zoom) continue; X.fillRect(px + 4, y * cell + 4, 4, 4); } }
  MCITIES.forEach(([name, lon, lat], i) => {
    const t0 = 0.05 + i * (o.gap || 0.17), q = clamp((u - t0) / 0.3); if (q <= 0) return;
    let [px, py] = toXY(lon, lat); if (px - cx > mw / 2) px -= mw; if (cx - px > mw / 2) px += mw;
    const s = E.outQuint(q), tw = 150, th = 266, lift = 150;
    X.fillStyle = '#fff'; X.beginPath(); X.arc(px, py, 6, 0, 7); X.fill();
    X.strokeStyle = 'rgba(255,255,255,0.6)'; X.lineWidth = 1.2; X.beginPath(); X.arc(px, py, 12 + ((u * 30 + i * 7) % 26), 0, 7); X.stroke();
    X.beginPath(); X.moveTo(px, py); X.lineTo(px, py - lift * s); X.stroke();
    X.save(); X.translate(px, py - lift * s - th / 2); X.scale(s, s);
    const clip = o.clips[i % o.clips.length]; const im = vframe(clip, 0.3 + (u - t0)); if (im) cover(X, im, -tw / 2, -th / 2, tw, th, cropFor(clip));
    X.strokeStyle = 'rgba(255,255,255,0.7)'; X.strokeRect(-tw / 2, -th / 2, tw, th);
    font(X, 22, 600); X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillStyle = '#fff'; X.fillText(name, -tw / 2, th / 2 + 22);
    font(X, 19, 500, 'JetBrains Mono'); X.fillStyle = '#C8FF00'; X.fillText(`▲ ${Math.floor((20 + rnd(i) * 80) * 1000 * (0.3 + (u - t0) * 2)).toLocaleString('en-US')} views`, -tw / 2, th / 2 + 50);
    X.restore();
  });
  X.restore();
  const vg = X.createLinearGradient(0, H * 0.55, 0, H); vg.addColorStop(0, 'rgba(5,5,5,0)'); vg.addColorStop(1, 'rgba(5,5,5,0.92)'); X.fillStyle = vg; X.fillRect(0, 0, W, H);
  let cur = null; for (const w of o.words) if (u >= w[1]) cur = w;
  if (cur) word(X, cur[0], 110, H - 150, BIG + 20, u - cur[1], { w: 600 });
  trackLines(u);
}
export function solanaWin(u, o = {}) {
  bg('#F4F4F2');
  X.save(); X.strokeStyle = 'rgba(0,0,0,0.08)'; [W / 3, 2 * W / 3].forEach(x => { X.beginPath(); X.moveTo(x, 0); X.lineTo(x, H); X.stroke(); }); [H / 3, 2 * H / 3].forEach(y => { X.beginPath(); X.moveTo(0, y); X.lineTo(W, y); X.stroke(); }); X.restore();
  const i = Math.floor(u / HB), clips = o.clips; const sq = 640, x0 = W / 2 - sq / 2, y0 = H / 2 - sq / 2, open = E.outExpo(clamp(u / 0.3));
  win(clips[i % clips.length], u - i * HB, x0, y0, sq, sq, { open, z0: 1.1, zs: 0.3, stroke: false });
  X.save(); X.beginPath(); X.rect(x0, y0, sq, sq); X.clip(); dark(0.25); const m = tinted(MARK, '#ffffff'); if (m) X.drawImage(m, W / 2 - 110, H / 2 - 110, 220, 220); X.restore();
  const [a, b, c2, d2] = o.words || ['settled', '', 'on', 'solana'];
  word(X, a, x0 - 20, y0 + 50, BIG, u - 0.3, { shadow: false, color: '#0a0a0a', align: 'right' }); if (b) word(X, b, x0 + 20, y0 + 50, BIG, u - 0.5);
  word(X, c2, x0 + sq - 20, y0 + sq - 50, BIG, u - 0.9, { align: 'right' }); word(X, d2, x0 + sq + 20, y0 + sq - 50, BIG, u - 1.1, { color: '#0a0a0a', shadow: false });
  const lu = u - 1.1; if (lu > 0 && d2 === 'solana') { const g = X.createLinearGradient(x0 + sq + 20, 0, x0 + sq + 400, 0); g.addColorStop(0, '#9945FF'); g.addColorStop(1, '#14F195'); X.fillStyle = g; X.fillRect(x0 + sq + 22, y0 + sq + 10, 370 * E.outExpo(clamp(lu / 0.5)), 5); }
  trackLines(u, 'rgba(0,0,0,0.4)');
}
export function bigWord(u, o) { // single statement on paper or ink
  bg(o.light ? '#F4F4F2' : '#050505');
  (o.lines || []).forEach(([s, at, ex], k, a) => word(X, s, W / 2, H / 2 + (k - (a.length - 1) / 2) * (o.gap || 150), ex?.size || HUGE, u - at, Object.assign({ align: 'center', w: 600, color: o.light ? '#0a0a0a' : '#fff', shadow: !o.light }, ex)));
  trackLines(u, o.light ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.45)', o.hud || 'VELLO');
}
// ── the flashy end sequence (long Vello flash) ──
export function endFlash(u, t, o) {
  const k = Math.floor(u / BT), lu = u - k * BT, phase = u < BT * 4; // first 4 beats = strobe flips + clip flashes
  if (phase) {
    const lightBg = k % 2 === 1; bg(lightBg ? '#F2F2F0' : '#050505');
    if (lu < HB && o.clips) { X.save(); X.globalAlpha = 0.35; const im = vframe(o.clips[(k * 2 + (lu > HB / 2 ? 1 : 0)) % o.clips.length], 0.4); if (im) { cover(X, im, 0, 0, W, H, cropFor(o.clips[0])); } X.restore(); if (lightBg) { X.fillStyle = 'rgba(242,242,240,0.6)'; X.fillRect(0, 0, W, H); } }
    const lg = lightBg ? tinted(LOGO, '#0a0a0a') : img(LOGO); if (lg) { const w = 980, h = w * lg.height / lg.width, s = 1 + 0.18 * Math.exp(-lu * 10); X.save(); X.translate(W / 2 + (rnd(k) - .5) * 16 * Math.exp(-lu * 12), H / 2 - 30); X.scale(s, s); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
    if (lu < 0.05 || (lu > HB && lu < HB + 0.04)) invert();
    trackLines(u, lightBg ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)', 'VELLO');
  } else {
    const v = u - BT * 4; bg('#050505');
    const lg = img(LOGO); if (lg) { const w = 820, h = w * lg.height / lg.width, s = 1 + 0.03 * pulse(t); X.save(); X.translate(W / 2, H / 2 - 40); X.scale(s, s); X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore(); }
    word(X, o.tagline, W / 2, H / 2 + 150, MID - 10, v - 0.15, { align: 'center', color: '#a8a8a8' });
    font(X, 24, 500, 'JetBrains Mono'); X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillStyle = `rgba(200,255,0,${clamp((v - 0.5) / 0.3)})`; X.fillText('VELLOAGENTS.COM', W / 2, H / 2 + 232);
    font(X, 14, 500, 'JetBrains Mono'); X.fillStyle = `rgba(255,255,255,${0.35 * clamp((v - 0.8) / 0.3)})`; X.fillText('EARNINGS DEPEND ON VERIFIED VIEWS AND CAMPAIGN AVAILABILITY. NOT FINANCIAL ADVICE.', W / 2, H - 60);
    trackLines(u, 'rgba(255,255,255,0.55)', 'THE GLOBAL ATTENTION ECONOMY');
    const bb = v % BT; if (v < BT * 6 && bb < 0.04 && Math.floor(v / BT) % 2 === 1) invert(); // keep a heartbeat flash on the logo
  }
}
