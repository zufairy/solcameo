// ───────────────────────── v2 timeline: shots + transitions + footage loading ─────────────────────────
const HIGH2 = t => t >= bt(32) && t < bt(128);
function shotAt(t) { let i = 0; for (let k = 0; k < SHOTS.length; k++) if (t >= SHOTS[k][0]) i = k; return i; }
function drawShot(i, t, target) {
  const prev = ctx; ctx = target.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  const [s0, fn] = SHOTS[i];
  ctx.save(); fn(t - s0, t); ctx.restore();
  ctx = prev;
}
function renderInner(t) {
  ctx = MAINCTX;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  // find transition window around a cut
  let tr = null;
  for (let k = 1; k < SHOTS.length; k++) {
    const [c, , type, td] = SHOTS[k];
    if (type && t >= c - td / 2 && t < c + td / 2) { tr = { k, c, type, td }; break; }
  }
  // beat shake
  let sx = 0, sy = 0;
  if (HIGH2(t)) { const d = ((t - B0) % BT), a = 10 * Math.exp(-d * 16); sx = (rnd(Math.floor(t * 60) * 1.3) - .5) * a; sy = (rnd(Math.floor(t * 60) * 2.7) - .5) * a; }
  if (tr) {
    drawShot(tr.k - 1, t, SPR.bufA); drawShot(tr.k, t, SPR.bufB);
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
    transition(tr.type, (t - (tr.c - tr.td / 2)) / tr.td, SPR.bufA, SPR.bufB, tr.k * 31);
  } else {
    drawShot(shotAt(t), t, SPR.bufA);
    ctx.save(); if (sx || sy) { ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(1.02, 1.02); ctx.translate(-W / 2, -H / 2); }
    ctx.drawImage(SPR.bufA, 0, 0); ctx.restore();
  }
  if (COLLECT) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // tiny post-cut kick on every cut
  const k = shotAt(t), d = t - SHOTS[k][0];
  if (k > 0 && d < 0.06 && d >= 0) flashOver('#FFFFFF', 0.12 * (1 - d / 0.06));
  if (HIGH2(t)) { const dd = (t - B0) % (BT * 4); flashOver(C.volt, 0.06 * Math.exp(-dd * 18)); }
  ctx.imageSmoothingEnabled = false; ctx.drawImage(SPR.grain[Math.floor(t * 30) % 6], 0, 0, W, H); ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.5; ctx.drawImage(SPR.scan, 0, 0); ctx.globalAlpha = 1;
  ctx.drawImage(SPR.vig, 0, 0);
}
function loadV(u) { return new Promise(res => { const i = new Image(); i.onload = () => { VCACHE.set(u, i); res(); }; i.onerror = () => res(); i.src = u; }); }
async function render(t) {
  COLLECT = new Set(); renderInner(t); const need = [...COLLECT]; COLLECT = null;
  await Promise.all(need.filter(u => !VCACHE.has(u)).map(loadV));
  if (VCACHE.size > 400) { const keep = new Set(need); for (const k of VCACHE.keys()) { if (VCACHE.size <= 250) break; if (!keep.has(k)) VCACHE.delete(k); } }
  renderInner(t);
}
async function init() {
  const faces = [
    new FontFace('Archivo', 'url(fonts/archivo-latin-wdth-italic.woff2)', { style: 'italic', weight: '100 900', stretch: '62% 125%' }),
    new FontFace('Archivo', 'url(fonts/archivo-latin-wdth-normal.woff2)', { style: 'normal', weight: '100 900', stretch: '62% 125%' }),
    new FontFace('Silkscreen', 'url(fonts/silkscreen-latin-400-normal.woff2)', { weight: '400' }),
    new FontFace('Silkscreen', 'url(fonts/silkscreen-latin-700-normal.woff2)', { weight: '700' }),
    new FontFace('Press Start 2P', 'url(fonts/press-start-2p-latin-400-normal.woff2)', { weight: '400' }),
    new FontFace('JetBrains Mono', 'url(fonts/jetbrains-mono-latin-400-normal.woff2)', { weight: '400' }),
    new FontFace('JetBrains Mono', 'url(fonts/jetbrains-mono-latin-700-normal.woff2)', { weight: '700' }),
    new FontFace('Space Grotesk', 'url(fonts/space-grotesk-latin-500-normal.woff2)', { weight: '500' }),
    new FontFace('Space Grotesk', 'url(fonts/space-grotesk-latin-700-normal.woff2)', { weight: '700' }),
    new FontFace('Noto Sans Arabic', 'url(fonts/noto-sans-arabic-arabic-900-normal.woff2)', { weight: '100 900' }),
    new FontFace('Noto Sans Devanagari', 'url(fonts/noto-sans-devanagari-devanagari-700-normal.woff2)', { weight: '100 900' }),
    new FontFace('Noto Sans Thai', 'url(fonts/noto-sans-thai-thai-700-normal.woff2)', { weight: '100 900' }),
  ];
  for (const f of faces) { await f.load(); document.fonts.add(f); }
  await Promise.all(Object.entries(IMGLIST).map(async ([k, v]) => IMG[k] = await loadImg(v)));
  buildSprites();
  font(ctx, 40); ctx.fillText('注目 관심 ध्यान انتباه ความสนใจ 자두두 ジャドゥドゥ', -1000, -1000);
  await document.fonts.ready;
  window.READY = true;
}
window.render = render;
init();
