// ───────────────────────── FX: footage, kinetic type, transitions ─────────────────────────
// ── footage (pre-extracted graded JPEG sequences) ──
let COLLECT = null;
const VCACHE = new Map();
function vurl(clip, t) {
  const c = window.CLIPS[clip]; let i = Math.floor(Math.max(0, t) * c.fps);
  if (c.loop) i = i % c.n; i = Math.max(0, Math.min(c.n - 1, i));
  return `seq/${clip}/${String(i + 1).padStart(5, '0')}.jpg`;
}
function vframe(clip, t) { const u = vurl(clip, t); if (COLLECT) { COLLECT.add(u); return null; } return VCACHE.get(u) || null; }
// draw footage covering dst rect; src = normalized crop [sx,sy,sw,sh] of the 16:9 frame
function vid(c, clip, t, dx = 0, dy = 0, dw = W, dh = H, o = {}) {
  const im = vframe(clip, t); if (!im) return;
  const iw = im.width, ih = im.height;
  let [sx, sy, sw, sh] = o.src || [0, 0, 1, 1];
  sx *= iw; sy *= ih; sw *= iw; sh *= ih;
  // cover-fit crop to dst aspect
  const ar = dw / dh;
  if (sw / sh > ar) { const nw = sh * ar; sx += (sw - nw) * (o.ax ?? 0.5); sw = nw; } else { const nh = sw / ar; sy += (sh - nh) * (o.ay ?? 0.5); sh = nh; }
  const z = o.zoom || 1; if (z !== 1) { const nw = sw / z, nh = sh / z; sx += (sw - nw) * (o.zx ?? 0.5); sy += (sh - nh) * (o.zy ?? 0.5); sw = nw; sh = nh; }
  c.save(); c.globalAlpha = o.alpha ?? 1;
  c.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
  c.restore();
}
// full-frame footage shot with push-in, drift-rotate, darkening
function shot(c, clip, t, o = {}) {
  const z = (o.z0 ?? 1.04) + (o.zs ?? 0.06) * t, r = (o.rot ?? 0) * t;
  c.save(); c.translate(W / 2, H / 2); c.rotate(r); c.scale(z, z); c.translate(-W / 2, -H / 2);
  vid(c, clip, (o.off || 0) + t * (o.speed || 1), -20, -20, W + 40, H + 40, o);
  c.restore();
  if (o.dark !== 0) { c.fillStyle = `rgba(4,6,4,${o.dark ?? 0.38})`; c.fillRect(0, 0, W, H); }
  if (o.tint) { c.save(); c.globalCompositeOperation = 'soft-light'; c.fillStyle = o.tint; c.globalAlpha = 0.5; c.fillRect(0, 0, W, H); c.restore(); }
}

// ── kinetic typography ──
// per-letter layout
function layout(c, s, size, o) {
  font(c, size, o);
  const ls = o.ls || 0; let x = 0; const out = [];
  for (const ch of [...s]) { const w = c.measureText(ch).width; out.push({ ch, x, w }); x += w + ls; }
  return { chars: out, width: x - ls };
}
const GLY = '!<>-_\\/[]{}=+*^?#01ABXZ$%';
/**
 * ktext(c, s, x, y, size, u, o)
 * o.style: rise | scatter | flip | decode | track | zoom | stretch | slice | wave
 * o.exit: local time when exit starts; o.exitStyle: up | zoom | scatter | slide
 */
function ktext(c, s, x, y, size, u, o = {}) {
  if (u < 0) return;
  const st = o.style || 'rise', stg = o.stagger ?? 0.028, col = o.color || C.white;
  const L = layout(c, s, size, o);
  const align = o.align || 'center';
  const x0 = align === 'center' ? -L.width / 2 : align === 'right' ? -L.width : 0;
  const n = L.chars.length;
  let ex = 0; if (o.exit != null && u > o.exit) ex = clamp((u - o.exit) / (o.exitDur || 0.2));
  c.save(); c.translate(x, y);
  // continuous camera on the word: slow zoom + rotation drift
  const drift = o.drift ?? 1;
  c.rotate((o.rot || 0) + drift * 0.012 * Math.sin(u * 1.7)); const zs = 1 + drift * 0.03 * u; c.scale(zs, zs);
  if (st === 'zoom' || st === 'stretch') {
    const p = E.outExpo(clamp(u / (o.dur || 0.28)));
    const sx = st === 'stretch' ? lerp(3.2, 1, p) : lerp(3, 1, p), sy = st === 'stretch' ? lerp(0.4, 1, p) : sx;
    for (let k = (p < 1 ? 4 : 0); k >= 0; k--) {
      c.save(); const kk = 1 + k * 0.08 * (1 - p); c.scale(sx * kk, sy * kk); if (st === 'stretch') c.transform(1, 0, -0.25 * (1 - p), 1, 0, 0);
      c.globalAlpha = (k ? 0.12 : 1) * clamp(u / 0.04) * (1 - ex);
      drawRun(c, L, x0, 0, size, o, col); c.restore();
    }
  } else if (st === 'track') {
    const p = E.outExpo(clamp(u / (o.dur || 0.5)));
    const extra = (1 - p) * size * 0.9;
    font(c, size, o); c.textAlign = 'left'; c.textBaseline = 'middle';
    const tw = L.width + extra * (n - 1);
    L.chars.forEach((ch, i) => { c.globalAlpha = p * (1 - ex); fillCh(c, ch.ch, -tw / 2 + ch.x + extra * i, 0, o, col); });
  } else {
    if (o.mask) { c.beginPath(); c.rect(x0 - size, -size * 0.62, L.width + size * 2, size * 1.24); c.clip(); }
    font(c, size, o); c.textAlign = 'left'; c.textBaseline = 'middle';
    L.chars.forEach((ch, i) => {
      const di = (o.reverse ? n - 1 - i : i) * stg, q = clamp((u - di) / (o.dur || 0.38));
      if (q <= 0) return;
      const p = E.outExpo(q), pb = E.outBack(q);
      let tx = x0 + ch.x, ty = 0, rot = 0, sc = 1, sx = 1, sy = 1, a = 1, chr = ch.ch;
      if (st === 'rise') { ty = (1 - p) * size * 0.95; rot = (1 - p) * 0.4; a = clamp(q * 3); }
      else if (st === 'scatter') { tx += (rnd(i * 3 + n) - .5) * 900 * (1 - p); ty += (rnd(i * 5 + n) - .5) * 600 * (1 - p); rot = (rnd(i * 7) - .5) * 3 * (1 - p); sc = lerp(2.6, 1, p); a = clamp(q * 2.5); }
      else if (st === 'flip') { sy = pb; sx = lerp(1.4, 1, p); a = clamp(q * 4); }
      else if (st === 'decode') { if (q < 1) chr = ch.ch === ' ' ? ' ' : GLY[Math.floor(rnd(i * 31 + Math.floor(u * 30)) * GLY.length)]; a = clamp(q * 5); }
      else if (st === 'wave') { ty = Math.sin(u * 8 - i * 0.5) * size * 0.06 + (1 - p) * -size; a = clamp(q * 3); }
      else if (st === 'slice') { sx = 1; ty = 0; }
      // exit
      if (ex > 0) {
        const qe = clamp(ex * 1.4 - (i / n) * 0.4);
        const es = o.exitStyle || 'up';
        if (es === 'up') { ty -= E.inExpo(qe) * size * 1.2; rot -= qe * 0.3; a *= 1 - qe; }
        else if (es === 'scatter') { tx += (rnd(i * 11) - .5) * 1400 * E.inCubic(qe); ty += (rnd(i * 13) - .5) * 800 * E.inCubic(qe); rot += (rnd(i) - .5) * 4 * qe; a *= 1 - qe; }
        else if (es === 'zoom') { sc *= 1 + E.inExpo(qe) * 6; a *= 1 - qe; }
        else if (es === 'slide') { tx += E.inExpo(qe) * 1600; a *= 1 - qe * 0.5; }
      }
      c.save(); c.translate(tx + ch.w / 2, ty); c.rotate(rot); c.scale(sc * sx, sc * sy); c.globalAlpha = a;
      if (st === 'decode' && q < 1) fillCh(c, chr, -ch.w / 2, 0, o, C.volt); else fillCh(c, chr, -ch.w / 2, 0, o, col);
      c.restore();
    });
  }
  c.restore();
  return L.width;
}
function drawRun(c, L, x0, y, size, o, col) { font(c, size, o); c.textAlign = 'left'; c.textBaseline = 'middle'; L.chars.forEach(ch => fillCh(c, ch.ch, x0 + ch.x, y, o, col)); }
function fillCh(c, ch, x, y, o, col) {
  if (o.stroke) { c.lineWidth = o.stroke; c.strokeStyle = o.strokeColor || C.ink; c.lineJoin = 'round'; c.strokeText(ch, x, y); }
  if (o.outline) { c.lineWidth = o.outline; c.strokeStyle = col; c.strokeText(ch, x, y); return; }
  c.fillStyle = col; c.fillText(ch, x, y);
}
// text filled with footage (video inside letters)
function vtext(c, s, x, y, size, clip, t, o = {}) {
  const b = SPR.bufC.getContext('2d'); b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.clearRect(0, 0, W, H);
  vid(b, clip, t, 0, 0, W, H, o);
  b.globalCompositeOperation = 'destination-in';
  b.save(); b.translate(x, y); const sc = o.scale || 1; b.scale(sc, sc); font(b, size, o); b.textAlign = 'center'; b.textBaseline = 'middle'; b.fillStyle = '#fff'; b.fillText(s, 0, 0); b.restore();
  b.globalCompositeOperation = 'source-over';
  c.drawImage(SPR.bufC, 0, 0);
}

// ── transitions: combine A (outgoing) and B (incoming) canvases, p: 0→1 ──
function transition(type, p, A, B, seed) {
  const c = ctx;
  const draw = (im, a = 1, sx = 1, r = 0, dx = 0, dy = 0) => { c.save(); c.globalAlpha = a; c.translate(W / 2 + dx, H / 2 + dy); c.rotate(r); c.scale(sx, sx); c.drawImage(im, -W / 2, -H / 2); c.restore(); };
  switch (type) {
    case 'zoom': { // zoom-through: A punches in, B lands from small
      if (p < 0.5) { const q = E.inExpo(p * 2); for (let k = 4; k >= 0; k--) draw(A, k ? 0.16 : 1, 1 + q * 2.6 * (1 + k * 0.06)); flashOver('#fff', q * 0.5); }
      else { const q = E.outExpo((p - 0.5) * 2); draw(B, 1, lerp(1.35, 1, q)); flashOver('#fff', (1 - q) * 0.6); }
      break;
    }
    case 'whip': { // horizontal whip pan with motion smear
      const q = E.inOutExpo(p), off = q * W * 1.1;
      for (let k = 5; k >= 0; k--) { draw(A, k ? 0.1 : 1, 1, 0, -off - k * 60 * Math.sin(q * Math.PI)); draw(B, k ? 0.1 : 1, 1, 0, W * 1.1 - off + k * 60 * Math.sin(q * Math.PI)); }
      break;
    }
    case 'spin': { // rotate-zoom
      if (p < 0.5) { const q = E.inExpo(p * 2); draw(A, 1, 1 + q * 1.8, q * 0.9); flashOver(C.volt, q * 0.35); }
      else { const q = E.outExpo((p - 0.5) * 2); draw(B, 1, lerp(1.9, 1, q), (1 - q) * -0.9); flashOver(C.volt, (1 - q) * 0.35); }
      break;
    }
    case 'slice': { // horizontal strips slide alternately
      draw(A); const n = 7, sh = H / n;
      for (let i = 0; i < n; i++) {
        const q = E.inOutExpo(clamp(p * 1.6 - i * 0.06)), dir = i % 2 ? 1 : -1;
        c.save(); c.beginPath(); c.rect(0, i * sh, W, sh + 1); c.clip();
        c.drawImage(B, dir * (1 - q) * W, 0); c.restore();
        if (q > 0 && q < 1) { c.fillStyle = C.volt; c.fillRect(dir > 0 ? (1 - q) * W - 6 : q * W - W + W - 6 - (1 - q) * 0, i * sh, 6, sh); }
      }
      break;
    }
    case 'wipe': { // diagonal volt bar wipe
      const q = E.inOutExpo(p), x = lerp(-W * 0.4, W * 1.4, q);
      draw(A);
      c.save(); c.beginPath(); c.moveTo(x - 300, -10); c.lineTo(-W, -10); c.lineTo(-W, H + 10); c.lineTo(x - 300 - 400, H + 10); c.closePath(); c.clip(); c.drawImage(B, 0, 0); c.restore();
      c.save(); c.fillStyle = C.volt; c.beginPath(); c.moveTo(x - 300, -10); c.lineTo(x, -10); c.lineTo(x - 400, H + 10); c.lineTo(x - 700, H + 10); c.closePath(); c.fill();
      c.fillStyle = C.ink; c.beginPath(); c.moveTo(x - 330, -10); c.lineTo(x - 300, -10); c.lineTo(x - 700, H + 10); c.lineTo(x - 730, H + 10); c.closePath(); c.fill(); c.restore();
      break;
    }
    case 'iris': {
      draw(A, 1, 1 + p * 0.2); const r = E.inOutExpo(p) * 1250;
      c.save(); c.beginPath(); c.arc(W / 2, H / 2, r, 0, 7); c.clip(); draw(B, 1, lerp(1.3, 1, p)); c.restore();
      c.strokeStyle = C.volt; c.lineWidth = 14 * (1 - p) + 2; c.beginPath(); c.arc(W / 2, H / 2, r, 0, 7); c.stroke();
      break;
    }
    case 'pixel': {
      draw(p < 0.5 ? A : B); const m = p < 0.5 ? p * 2 : (1 - p) * 2; mosaic(1 + E.inCubic(m) * 60);
      break;
    }
    case 'glitch': {
      draw(p < 0.5 ? A : B); glitch(1 - Math.abs(p - 0.5) * 2, seed + Math.floor(p * 12));
      break;
    }
    case 'split': { // A splits vertically open revealing B
      draw(B, 1, lerp(1.25, 1, E.outExpo(p)));
      const q = E.inOutExpo(p);
      c.save(); c.beginPath(); c.rect(0, 0, W / 2, H); c.clip(); c.drawImage(A, -q * W / 2, 0); c.restore();
      c.save(); c.beginPath(); c.rect(W / 2, 0, W / 2, H); c.clip(); c.drawImage(A, q * W / 2, 0); c.restore();
      c.fillStyle = C.volt; c.fillRect(W / 2 - q * W / 2 - 4, 0, 8, H); c.fillRect(W / 2 + q * W / 2 - 4, 0, 8, H);
      break;
    }
    case 'flash': default: {
      draw(p < 0.5 ? A : B); flashOver('#FFFFFF', 1 - Math.abs(p - 0.5) * 2);
    }
  }
}

// light sweep across an image (premium logo shine)
function shine(c, im, cx, cy, w, p, a = 1) {
  const h = w * im.height / im.width, b = SPR.bufC.getContext('2d');
  b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-over'; b.clearRect(0, 0, W, H);
  b.drawImage(im, cx - w / 2, cy - h / 2, w, h);
  b.globalCompositeOperation = 'source-in';
  const x = lerp(cx - w, cx + w, p), g = b.createLinearGradient(x - 160, 0, x + 160, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  b.fillStyle = g; b.fillRect(0, 0, W, H); b.globalCompositeOperation = 'source-over';
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = a; c.drawImage(SPR.bufC, 0, 0); c.restore();
}
