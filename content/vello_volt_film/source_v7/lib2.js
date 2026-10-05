// ───────── VELLO v7 additions: type styles, cinematic endings, radar / terminal / chapter scenes, 3D chrome ─────────
import * as L from './lib.js';
import { W, H, K, X, clamp, lerp, E, rnd, word, font, img, vframe, cover } from './lib.js';
import { measure, mk } from './core.js';
import { renderMark } from './gl.js';
export * from './lib.js';
const GLYPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@*+=/<>';

// ── TYPE STYLES ──
// scramble: random glyphs resolve left→right into the word (mono while scrambling, Inter when settled)
export function scramble(s, x, y, size, u, o = {}) {
  if (u < 0) return; const dur = o.dur || 0.45, n = s.length, p = clamp(u / dur);
  font(X, size, o.w || 600); X.textBaseline = 'middle'; const tw = X.measureText(s).width;
  let cx = o.align === 'center' ? x - tw / 2 : o.align === 'right' ? x - tw : x;
  X.save(); X.fillStyle = o.color || '#fff'; if (o.shadow !== false) { X.shadowColor = 'rgba(0,0,0,0.5)'; X.shadowBlur = 20; }
  for (let i = 0; i < n; i++) {
    const ch = s[i]; font(X, size, o.w || 600); const cw = X.measureText(ch).width; const done = p * (n + 3) - 3 > i;
    if (done || ch === ' ') { X.textAlign = 'left'; X.fillText(ch, cx, y); }
    else if (p * (n + 3) > i) { const g = GLYPH[Math.floor(rnd(i * 13 + Math.floor(u * 30)) * 26)].toLowerCase(); X.save(); X.globalAlpha = 0.55; X.textAlign = 'left'; X.beginPath(); X.rect(cx, y - size, cw, size * 2); X.clip(); X.fillText(g, cx, y); X.restore(); }
    cx += cw;
  }
  X.restore();
}
// mono typewriter with blinking block cursor; o.upper for military / terminal
export function typeMono(s, x, y, size, u, o = {}) {
  if (u < 0) return; const cps = o.cps || 38, t = o.upper ? s.toUpperCase() : s, n = Math.min(t.length, Math.floor(u * cps));
  font(X, size, 500, 'JetBrains Mono'); X.textBaseline = 'middle'; X.textAlign = 'left'; X.fillStyle = o.color || '#fff';
  const sub = t.slice(0, n), tw = X.measureText(t).width, x0 = o.align === 'center' ? x - tw / 2 : x; X.fillText(sub, x0, y);
  if (n < t.length || Math.floor(u * 2.5) % 2 === 0) { const cw = X.measureText(sub).width; X.fillRect(x0 + cw + 4, y - size * 0.45, size * 0.55, size * 0.9); }
}
// tracking: thin, wide letter-spacing collapsing to normal with per-letter fade (luxury)
export function trackText(s, x, y, size, u, o = {}) {
  if (u < 0) return; const p = E.outCubic(clamp(u / (o.dur || 1.1))), sp = lerp(size * (o.from ?? 0.6), size * (o.to ?? 0.12), p);
  font(X, size, o.w || 300); X.letterSpacing = '0px'; X.textBaseline = 'middle'; X.textAlign = 'left';
  const ws = [...s].map(c => X.measureText(c).width), tw = ws.reduce((a, b) => a + b, 0) + sp * (s.length - 1);
  let cx = o.align === 'left' ? x : x - tw / 2;
  [...s].forEach((c, i) => { const a = clamp((u - i * (o.stagger ?? 0.04)) / 0.35) * (o.out != null ? 1 - clamp((u - o.out) / 0.4) : 1); X.globalAlpha = a; X.fillStyle = o.color || '#fff'; X.fillText(c, cx, y); cx += ws[i] + sp; });
  X.globalAlpha = 1;
}
// mask: each word rises from behind a hard mask line (rigid, editorial)
export function maskText(s, x, y, size, u, o = {}) {
  if (u < 0) return; const ws = s.split(' '); font(X, size, o.w || 600); X.textBaseline = 'alphabetic'; X.textAlign = 'left';
  const sp = size * 0.26, wd = ws.map(w => X.measureText(w).width), tw = wd.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
  let cx = o.align === 'left' ? x : o.align === 'right' ? x - tw : x - tw / 2; const base = y + size * 0.35;
  ws.forEach((w, i) => { const p = E.outExpo(clamp((u - i * (o.stagger ?? 0.07)) / 0.45)); X.save(); X.beginPath(); X.rect(cx - 4, base - size * 1.05, wd[i] + 8, size * 1.3); X.clip(); X.fillStyle = o.color || '#fff'; X.fillText(w, cx, base + (1 - p) * size * 1.15); X.restore(); cx += wd[i] + sp; });
  if (o.rule) { X.fillStyle = o.color || '#fff'; X.fillRect(o.align === 'left' ? x : x - tw / 2, base + size * 0.25, tw * E.outExpo(clamp(u / 0.5)), 3); }
}
// slam: scales down from big with ghost trail, hard stop (rigid impact)
export function slamText(s, x, y, size, u, o = {}) {
  if (u < 0) return; const p = clamp(u / (o.dur || 0.16)), sc = lerp(o.from || 1.9, 1, E.outQuint(p));
  X.save(); X.translate(x, y); for (let k = 3; k >= 0; k--) { const s2 = k ? sc + k * 0.08 * (1 - p) : sc; if (k && p >= 1) continue; X.save(); X.scale(s2, s2); X.globalAlpha = k ? 0.15 * (1 - p) : clamp(p * 3); word(X, s, 0, 0, size, 1, { align: o.align || 'center', w: o.w || 700, color: o.color, shadow: o.shadow }); X.restore(); }
  X.restore();
}
// outline → fill numeral (chapters / countdown)
export function outlineNum(s, x, y, size, u, o = {}) {
  if (u < 0) return; font(X, size, 800); X.textAlign = o.align || 'center'; X.textBaseline = 'middle';
  X.save(); X.lineWidth = 2; X.strokeStyle = o.color || 'rgba(255,255,255,0.9)'; X.globalAlpha = clamp(u / 0.2); X.strokeText(s, x, y);
  const f = clamp((u - (o.fillAt ?? 0.25)) / 0.3); if (f > 0) { const m = font; X.beginPath(); X.rect(x - size * 2, y + size * 0.6 - size * 1.2 * f, size * 4, size * 1.2 * f); X.clip(); X.fillStyle = o.color || '#fff'; X.fillText(s, x, y); }
  X.restore();
}
// caption with a chosen style, word-timed from WORDS (transcript alignment)
export function caption2(id, lu, o = {}) {
  const st = o.style || 'kinetic'; if (st === 'kinetic') return L.caption(id, lu, o);
  const Wd = window.WORDS[id]; if (!Wd) return; const ws = Wd.w.map(w => [w[0], w[1] - (o.trim || 0), w[2] - (o.trim || 0)]).filter(w => w[1] > -0.05);
  const maxw = o.maxw || 3, pages = []; let cur = [];
  ws.forEach(w => { if (cur.length && (cur.length >= maxw || w[1] - cur[cur.length - 1][2] > 0.4)) { pages.push(cur); cur = []; } cur.push(w); }); if (cur.length) pages.push(cur);
  let pg = null; for (const p of pages) if (lu >= p[0][1] - 0.04) pg = p; if (!pg) return;
  const last = pages[pages.length - 1]; if (pg === last && lu > last[last.length - 1][2] + (o.hold ?? 0.5)) return;
  const txt = pg.map(w => w[0]).join(' '), t0 = pg[0][1], x = o.x ?? W / 2, y = o.y ?? H / 2, size = o.size || 104;
  if (st === 'mono') { typeMono(txt, x, y, o.size || 54, lu - t0, { upper: true, align: 'center', cps: Math.max(18, txt.length / Math.max(0.3, pg[pg.length - 1][2] - t0)) }); }
  else if (st === 'scramble') scramble(txt, x, y, size, lu - t0, { align: 'center', dur: Math.max(0.25, Math.min(0.6, pg[pg.length - 1][2] - t0)) });
  else if (st === 'track') trackText(txt, x, y, o.size || 84, lu - t0, { dur: 0.9, stagger: 0.025 });
  else if (st === 'mask') maskText(txt, x, y, size, lu - t0, {});
  else if (st === 'slam') { const lastW = pg.filter(w => lu >= w[1] - 0.04); slamText(lastW.map(w => w[0]).join(' '), x, y, size, lu - lastW[lastW.length - 1][1]); }
}
// roll2 = montage (optional face lock) + styled captions
export function roll2(u, t, o) {
  L.montage(u, o.clips, o.step || L.HB, { dark: o.dark ?? 0.42, face: o.face, t, zs: o.zs ?? 0.08, label: o.label, tag: o.tag, fh: o.fh, hud: o.hudLock });
  if (o.lb) letterbox(o.lb);
  if (o.hud) L.trackLines(u, 'rgba(255,255,255,0.4)', o.hudLabel || 'VELLO');
  (o.lines || []).forEach(([id, at, ex]) => caption2(id, u - at, Object.assign({ style: o.style }, o.cap || {}, ex || {})));
}
export function letterbox(a = 1) { const h = H * 0.12 * clamp(a); X.fillStyle = '#000'; X.fillRect(0, 0, W, h); X.fillRect(0, H - h, W, h); }

// ── SCENES ──
// terminal boot log (agent deploy / brand brief)
export function terminal(u, o) {
  L.bg('#050505'); if (o.clip) { X.save(); X.globalAlpha = 0.22; L.film(o.clip, u, { zs: 0.05 }); X.restore(); }
  let y = 210, t = 0; (o.lines || []).forEach(([s, at, col]) => { typeMono(s, 180, y, 34, u - at, { color: col || (s.startsWith('>') ? '#C8FF00' : 'rgba(255,255,255,0.85)'), cps: 60 }); y += 58; });
  if (o.big) scramble(o.big, W / 2, H - 230, 120, u - o.bigAt, { align: 'center', w: 700 });
  L.trackLines(u, 'rgba(255,255,255,0.35)', o.hud || 'VELLO://AGENT');
}
// military radar with city blips (mission map)
const CITIES = [['TOKYO', 0.82, 0.38], ['SEOUL', 0.79, 0.35], ['KUALA LUMPUR', 0.72, 0.56], ['LAGOS', 0.5, 0.55], ['DUBAI', 0.6, 0.45], ['LONDON', 0.48, 0.28], ['SÃO PAULO', 0.33, 0.72], ['NEW YORK', 0.27, 0.34], ['MUMBAI', 0.66, 0.48], ['MEXICO CITY', 0.18, 0.46], ['PARIS', 0.49, 0.31], ['JAKARTA', 0.76, 0.6]];
export function radar(u, o) {
  L.bg('#040404'); if (o.clip) { X.save(); X.globalAlpha = 0.25; L.film(o.clip, u, { zs: 0.04 }); X.restore(); }
  const cx = W / 2, cy = H / 2, R = 430, ang = u * 2.4;
  X.save(); X.strokeStyle = 'rgba(255,255,255,0.35)'; X.lineWidth = 1; for (let r = 1; r <= 4; r++) { X.beginPath(); X.arc(cx, cy, R * r / 4, 0, 7); X.stroke(); }
  X.beginPath(); X.moveTo(cx - R, cy); X.lineTo(cx + R, cy); X.moveTo(cx, cy - R); X.lineTo(cx, cy + R); X.stroke();
  const g = X.createConicGradient ? X.createConicGradient(ang - 0.6, cx, cy) : null; if (g) { g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.1, 'rgba(255,255,255,0.18)'); g.addColorStop(0.101, 'rgba(255,255,255,0)'); X.fillStyle = g; X.beginPath(); X.arc(cx, cy, R, 0, 7); X.fill(); }
  CITIES.forEach(([n, px, py], i) => { const bx = cx + (px - 0.5) * R * 1.8, by = cy + (py - 0.48) * R * 1.8; if (Math.hypot(bx - cx, by - cy) > R) return; const t0 = 0.25 + i * (o.gap || 0.22); const q = clamp((u - t0) / 0.2); if (q <= 0) return;
    X.fillStyle = '#fff'; X.beginPath(); X.arc(bx, by, 5, 0, 7); X.fill(); X.strokeStyle = 'rgba(255,255,255,0.7)'; X.beginPath(); X.arc(bx, by, 10 + ((u * 40 + i * 9) % 30), 0, 7); X.stroke();
    font(X, 15, 500, 'JetBrains Mono'); X.fillStyle = '#fff'; X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillText(n, bx + 14, by - 8); X.fillStyle = '#C8FF00'; X.fillText(`LOCK ▲ ${Math.floor((u - t0) * 4100 + rnd(i) * 900).toLocaleString('en-US')}`, bx + 14, by + 10); });
  X.restore();
  if (o.title) typeMono(o.title, 140, 150, 30, u - 0.1, { upper: true });
  let cur = null; for (const w of (o.words || [])) if (u >= w[1]) cur = w; if (cur) maskText(cur[0], W / 2, H - 120, 96, u - cur[1], {});
  L.trackLines(u, 'rgba(255,255,255,0.4)', o.hud || 'MISSION // 145 COUNTRIES');
}
// chapter card: outline numeral + mask title (+ optional clip behind)
export function chapter(u, o) {
  L.bg(o.light ? '#F4F4F2' : '#050505'); if (o.clip) { X.save(); X.globalAlpha = o.light ? 0.15 : 0.3; L.film(o.clip, u, { zs: 0.06 }); X.restore(); }
  const col = o.light ? '#0a0a0a' : '#fff';
  outlineNum(o.n, 360, H / 2, 380, u, { color: col });
  maskText(o.title, 700, H / 2 - 40, 96, u - 0.25, { align: 'left', color: col, rule: true });
  if (o.sub) maskText(o.sub, 700, H / 2 + 80, 50, u - 0.6, { align: 'left', color: o.light ? '#555' : '#bdbdbd', w: 500 });
  L.trackLines(u, o.light ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)', o.hud || 'HOW IT WORKS');
}
// before / after split
export function beforeAfter(u, o) {
  L.bg('#050505'); const sw = W / 2, p = E.outExpo(clamp(u / 0.4));
  X.save(); X.beginPath(); X.rect(0, 0, sw * p, H); X.clip(); L.film(o.left, u, { zs: 0.05, dark: 0.35 }); X.restore();
  X.save(); X.beginPath(); X.rect(W - sw * p, 0, sw * p, H); X.clip(); L.film(o.right, u, { zs: 0.05, dark: 0.25 }); X.restore();
  X.fillStyle = '#fff'; X.fillRect(sw - 1, 0, 2, H * p);
  maskText(o.lt || 'before.', sw / 2, H / 2, 110, u - 0.2, {}); maskText(o.rt || 'after.', sw + sw / 2, H / 2, 110, u - 0.55, {});
  L.trackLines(u);
}
// countdown / telemetry overlay on footage
export function telemetry(u, t, o) {
  L.montage(u, o.clips, o.step || L.HB, { dark: 0.4, zs: 0.1 });
  const n = Math.max(0, Math.ceil((o.from || 10) - u * (o.rate || 3)));
  outlineNum(`T-${String(n).padStart(2, '0')}`, W / 2, H / 2 - 40, 240, 1, { fillAt: 0 });
  if (o.line) maskText(o.line, W / 2, H / 2 + 150, 64, u - 0.3, { w: 500 });
  font(X, 18, 500, 'JetBrains Mono'); X.textAlign = 'left'; X.fillStyle = '#C8FF00'; X.fillText(`ALT ${(u * 1240).toFixed(0)} M   VEL ${(u * 310).toFixed(0)} M/S   STATUS ${o.status || 'NOMINAL'}`, 140, H - 140);
  L.trackLines(u, 'rgba(255,255,255,0.4)', o.hud || 'LAUNCH // TELEMETRY');
}
// 3D chrome mark over a clip
export function chrome(u, o = {}) {
  if (o.clip) { L.film(o.clip, u, { zs: 0.05, dark: 0.55 }); } else { const g = X.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H * 0.45, 1100); g.addColorStop(0, '#2a2a2a'); g.addColorStop(1, '#030303'); X.fillStyle = g; X.fillRect(0, 0, W, H); }
  const m = renderMark(u * (o.spin || 1.6)); if (m) X.drawImage(m, 0, 0);
  if (o.text) maskText(o.text, W / 2, H - 105, 60, u - (o.textAt ?? 0.6), { w: 500 });
  L.trackLines(u, 'rgba(255,255,255,0.4)', o.hud || 'VELLO');
}
// ── cinematic ending: letterboxed slow montage → styled logo reveal → long hold with the music ──
export function endCine(u, t, o) {
  const T1 = o.montage ?? 4.5; // seconds of montage before the logo
  if (u < T1) {
    const i = Math.floor(u / (o.step || 1.5)), clip = o.clips[i % o.clips.length], lu = u - i * (o.step || 1.5);
    L.film(clip, lu, { speed: 0.6, z0: 1.04, zs: 0.03, dark: 0.3 });
    letterbox(1); if (o.line) { const [s, at] = o.line; trackText(s, W / 2, H / 2, 64, u - at, { w: 400, out: T1 - 0.6 - at }); }
    if (u > T1 - 0.35) { X.fillStyle = `rgba(0,0,0,${clamp((u - (T1 - 0.35)) / 0.35)})`; X.fillRect(0, 0, W, H); }
    return;
  }
  const v = u - T1; L.bg('#050505');
  if (o.bgClip) { X.save(); X.globalAlpha = 0.18 * clamp(v / 1.5); L.film(o.bgClip, v, { speed: 0.5, zs: 0.02 }); X.restore(); }
  const lg = img(L.LOGO), st = o.logo || 'fade';
  if (lg) { const w = 860, h = w * lg.height / lg.width; X.save(); X.translate(W / 2, H / 2 - 40);
    if (st === 'slam') { const p = clamp(v / 0.18), s = lerp(1.8, 1, E.outQuint(p)); X.scale(s, s); X.globalAlpha = clamp(p * 3); }
    else if (st === 'wipe') { const p = E.inOutCubic(clamp(v / 0.9)); X.beginPath(); X.rect(-w / 2, -h, w * p, h * 2); X.clip(); }
    else if (st === 'scramble') { X.globalAlpha = clamp((v - 0.5) / 0.3); }
    else { X.globalAlpha = E.outCubic(clamp(v / 1.4)); const s = lerp(1.06, 1, E.outCubic(clamp(v / 2.5))); X.scale(s, s); }
    X.drawImage(lg, -w / 2, -h / 2, w, h); X.restore();
    if (st === 'scramble' && v < 0.8) scramble('vello', W / 2 + 80, H / 2 - 40, 170, v, { align: 'center', w: 700, dur: 0.5 });
    if (st === 'slam' && v < 0.06) L.invert();
  }
  if (o.tagline) trackText(o.tagline, W / 2, H / 2 + 150, 46, v - 0.9, { w: 400, from: 0.4, to: 0.1 });
  font(X, 22, 500, 'JetBrains Mono'); X.textAlign = 'center'; X.textBaseline = 'middle'; X.fillStyle = `rgba(200,255,0,${clamp((v - 1.6) / 0.4)})`; X.fillText('VELLOAGENTS.COM', W / 2, H / 2 + 222);
  font(X, 13, 500, 'JetBrains Mono'); X.fillStyle = `rgba(255,255,255,${0.3 * clamp((v - 2) / 0.5)})`; X.fillText('EARNINGS DEPEND ON VERIFIED VIEWS AND CAMPAIGN AVAILABILITY. NOT FINANCIAL ADVICE.', W / 2, H - 56);
  letterbox(1 - clamp(v / 1.2)); X.save(); X.globalAlpha = clamp((v - 0.6) / 0.6); L.trackLines(u, 'rgba(255,255,255,0.45)', o.hud || 'THE GLOBAL ATTENTION ECONOMY'); X.restore();
  if (o.fadeAt != null && v > o.fadeAt) { X.fillStyle = `rgba(0,0,0,${clamp((v - o.fadeAt) / 1.5)})`; X.fillRect(0, 0, W, H); }
}
