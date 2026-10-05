// ───────── VELLO — "the global attention economy" — core (2D compositor) ─────────
export const W = 1920, H = 1080;
export const cv = document.getElementById('c');
export const X = cv.getContext('2d');
export const C = { ink: '#050505', white: '#F4F4F2', grey: '#8A8A8A', dim: '#3A3A3A', volt: '#C8FF00' };
// music grid (measured): 103.7 BPM, beat 0 at 0.599s
import { BEATS } from './beats.js';
export const K = k => { const i = Math.floor(k), f = k - i; const a = BEATS[Math.min(i, BEATS.length - 1)], b = BEATS[Math.min(i + 1, BEATS.length - 1)]; return a + (b - a) * f; };
export const BT = 0.5573;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const E = {
  outExpo: u => u >= 1 ? 1 : 1 - Math.pow(2, -10 * u), inExpo: u => u <= 0 ? 0 : Math.pow(2, 10 * u - 10),
  inOutCubic: u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2, outCubic: u => 1 - Math.pow(1 - u, 3),
  inOutExpo: u => u <= 0 ? 0 : u >= 1 ? 1 : u < .5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2,
  outBack: u => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); },
  inCubic: u => u * u * u, outQuint: u => 1 - Math.pow(1 - u, 5),
};
export function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
export function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function rrect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

// ── type: Inter, lowercase, editorial ──
export function font(c, size, w = 500, fam = 'Inter') { c.font = `${w} ${size}px ${fam === 'Inter' ? 'InterV' : `'${fam}'`}, 'Noto Sans CJK JP', sans-serif`; c.letterSpacing = (size > 120 ? -size * 0.04 : -size * 0.015) + 'px'; }
// a word that fades in from blur + slight rise; o.out fades it
export function word(c, s, x, y, size, u, o = {}) {
  if (u < 0) return;
  const p = E.outCubic(clamp(u / (o.dur || 0.28)));
  let a = p; if (o.out != null && u > o.out) a *= 1 - clamp((u - o.out) / 0.2);
  if (a <= 0) return;
  font(c, size, o.w || 500, o.fam); c.textAlign = o.align || 'left'; c.textBaseline = 'middle';
  const col = o.color || C.white, dy = (1 - p) * 14;
  c.save();
  if (o.shadow !== false) { c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 24; }
  for (let k = 3; k >= 1 && p < 1; k--) { c.globalAlpha = a * 0.18 * (1 - p); c.fillStyle = col; c.fillText(s, x + (k - 2) * 6 * (1 - p), y + dy); }
  c.globalAlpha = a; c.fillStyle = col; c.fillText(s, x, y + dy);
  c.restore();
}
export function measure(s, size, w = 500) { font(X, size, w); return X.measureText(s).width; }

// ── footage (pre-extracted B/W JPEG sequences) ──
export let COLLECT = null; export function setCollect(v) { COLLECT = v; }
export const VCACHE = new Map();
function vurl(clip, t) { const c = window.CLIPS[clip]; if (!c) return null; let i = Math.floor(Math.max(0, t) * c.fps); i = c.loop ? i % c.n : Math.min(c.n - 1, i); return `seq/${clip}/${String(i + 1).padStart(5, '0')}.jpg`; }
export function vframe(clip, t) { const u = vurl(clip, t); if (!u) return null; if (COLLECT) { COLLECT.add(u); return null; } return VCACHE.get(u) || null; }
export function img(url) { if (COLLECT) { COLLECT.add(url); return null; } return VCACHE.get(url) || null; }
export function cover(c, im, dx = 0, dy = 0, dw = W, dh = H, o = {}) {
  if (!im) return; const iw = im.width, ih = im.height; let sw = iw, sh = ih, sx = 0, sy = 0;
  const ar = dw / dh; if (sw / sh > ar) { sw = sh * ar; sx = (iw - sw) * (o.ax ?? 0.5); } else { sh = sw / ar; sy = (ih - sh) * (o.ay ?? 0.5); }
  const z = o.zoom || 1; if (z !== 1) { const nw = sw / z, nh = sh / z; sx += (sw - nw) * (o.zx ?? 0.5); sy += (sh - nh) * (o.zy ?? 0.5); sw = nw; sh = nh; }
  c.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
}
// full-frame footage with slow push and drift
export function shot(c, clip, u, o = {}) {
  const im = vframe(clip, (o.off || 0) + u * (o.speed || 1)); if (!im) return;
  const z = (o.z0 ?? 1.02) + (o.zs ?? 0.03) * u;
  c.save(); c.translate(W / 2 + (o.px || 0) * u, H / 2); c.rotate((o.rot || 0) * u); c.scale(z, z); c.translate(-W / 2, -H / 2);
  cover(c, im, 0, 0, W, H, o); c.restore();
  if (o.dark) { c.fillStyle = `rgba(0,0,0,${o.dark})`; c.fillRect(0, 0, W, H); }
}

// ── generic attention glyphs (original, no platform logos) ──
export function glyph(c, type, x, y, s, col = C.ink) {
  c.save(); c.translate(x, y); c.fillStyle = col; c.strokeStyle = col; c.lineWidth = s * 0.11; c.lineCap = 'round'; c.lineJoin = 'round';
  const r = s / 2;
  switch (type) {
    case 'play': c.beginPath(); c.moveTo(-r * 0.45, -r * 0.6); c.lineTo(r * 0.65, 0); c.lineTo(-r * 0.45, r * 0.6); c.closePath(); c.fill(); break;
    case 'heart': c.beginPath(); c.moveTo(0, r * 0.6); c.bezierCurveTo(-r * 1.1, -r * 0.1, -r * 0.5, -r * 0.95, 0, -r * 0.35); c.bezierCurveTo(r * 0.5, -r * 0.95, r * 1.1, -r * 0.1, 0, r * 0.6); c.fill(); break;
    case 'chat': rrect(c, -r * 0.7, -r * 0.55, r * 1.4, r * 0.95, r * 0.3); c.fill(); c.beginPath(); c.moveTo(-r * 0.3, r * 0.3); c.lineTo(-r * 0.5, r * 0.75); c.lineTo(0, r * 0.38); c.fill(); break;
    case 'share': c.beginPath(); c.moveTo(-r * 0.6, r * 0.5); c.quadraticCurveTo(-r * 0.5, -r * 0.2, r * 0.3, -r * 0.2); c.stroke(); c.beginPath(); c.moveTo(r * 0.1, -r * 0.6); c.lineTo(r * 0.65, -r * 0.2); c.lineTo(r * 0.1, r * 0.2); c.fill(); break;
    case 'eye': c.beginPath(); c.ellipse(0, 0, r * 0.75, r * 0.42, 0, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, r * 0.2, 0, 7); c.fill(); break;
    case 'note': c.beginPath(); c.arc(-r * 0.25, r * 0.4, r * 0.22, 0, 7); c.fill(); c.fillRect(-r * 0.08, -r * 0.6, r * 0.12, r * 1.0); c.fillRect(-r * 0.08, -r * 0.6, r * 0.5, r * 0.14); break;
    case 'cam': rrect(c, -r * 0.7, -r * 0.4, r * 1.0, r * 0.8, r * 0.12); c.fill(); c.beginPath(); c.moveTo(r * 0.35, -r * 0.1); c.lineTo(r * 0.75, -r * 0.35); c.lineTo(r * 0.75, r * 0.35); c.lineTo(r * 0.35, r * 0.1); c.fill(); break;
    case 'bolt': c.beginPath(); [[0.1, -0.7], [-0.45, 0.1], [-0.05, 0.1], [-0.15, 0.7], [0.45, -0.1], [0.05, -0.1]].forEach(([a, b], i) => i ? c.lineTo(a * r, b * r) : c.moveTo(a * r, b * r)); c.closePath(); c.fill(); break;
    case 'globe': c.beginPath(); c.arc(0, 0, r * 0.62, 0, 7); c.stroke(); c.beginPath(); c.ellipse(0, 0, r * 0.28, r * 0.62, 0, 0, 7); c.stroke(); c.beginPath(); c.moveTo(-r * 0.62, 0); c.lineTo(r * 0.62, 0); c.stroke(); break;
    case 'coin': c.beginPath(); c.arc(0, 0, r * 0.62, 0, 7); c.stroke(); font(c, r * 0.8, 700); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', 0, r * 0.04); break;
  }
  c.restore();
}
export const GLYPHS = ['play', 'heart', 'chat', 'share', 'eye', 'note', 'cam', 'bolt', 'globe', 'coin'];
export function tile(c, type, x, y, s, a = 1, inv = false) {
  c.save(); c.globalAlpha = a; rrect(c, x - s / 2, y - s / 2, s, s, s * 0.14); c.fillStyle = inv ? C.ink : C.white; c.fill();
  glyph(c, type, x, y, s * 0.62, inv ? C.white : C.ink); c.restore();
}

// ── image FX ──
const SM = mk(320, 180), SMX = SM.getContext('2d', { willReadFrequently: true });
function lumGrid(im, w, h, o = {}) { SMX.clearRect(0, 0, 320, 180); cover(SMX, im, 0, 0, w, h, o); return SMX.getImageData(0, 0, w, h).data; }
// line-art: horizontal lines displaced/thickened by luminance (silhouette look)
export function lineArt(c, im, u, o = {}) {
  if (!im) return; const gw = 240, gh = 135, d = lumGrid(im, gw, gh, o), sx = W / gw, sy = H / gh;
  c.save(); c.strokeStyle = C.white; c.lineCap = 'round';
  for (let r = 0; r < gh; r += 2) {
    c.beginPath(); let first = true;
    for (let x = 0; x < gw; x++) {
      const l = clamp((d[(r * gw + x) * 4] / 255 - 0.25) * 1.8), yy = r * sy + Math.sin(x * 0.09 + u * 3 + r * 0.15) * 10 * l - l * 8;
      first ? c.moveTo(x * sx, yy) : c.lineTo(x * sx, yy); first = false;
    }
    c.lineWidth = 1.6; c.globalAlpha = 0.9; c.stroke();
  }
  c.restore();
}
// dot particles from footage, with explode factor
export function dots(c, im, u, ex = 0, o = {}) {
  if (!im) return; const gw = 192, gh = 108, d = lumGrid(im, gw, gh, o), s = W / gw;
  c.save(); c.fillStyle = C.white;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const l = d[(y * gw + x) * 4] / 255; if (l < 0.12) continue;
    const i = y * gw + x, ang = rnd(i) * 6.283, dist = ex * (200 + rnd(i * 3) * 900);
    const px = x * s + s / 2 + Math.cos(ang) * dist + (x - gw / 2) * ex * 6, py = y * s + s / 2 + Math.sin(ang) * dist;
    const r = l * s * 0.48 * (1 - ex * 0.5); c.globalAlpha = clamp(1 - ex * 0.8); c.fillRect(px - r, py - r, r * 2, r * 2);
  }
  c.restore();
}
export function flash(c, col, a) { if (a <= 0) return; c.save(); c.globalAlpha = clamp(a); c.fillStyle = col; c.fillRect(0, 0, W, H); c.restore(); }
