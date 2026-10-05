// ───────────────────────── timeline + post ─────────────────────────
const SCENES = [[0, S0], [P(0), S1], [P(1), S2], [P(2), S3], [P(3), S4], [P(4), S5], [P(5), S6], [P(6), S7], [P(7), S8], [P(8), S9]];
const DUR = 60;
// cut events → post effect type
const CUTS = [];
(function () {
  for (let k = 0; k < 16; k += 2) CUTS.push([bt(k), k % 4 ? 'glitch' : 'mosaic']);           // hook slots
  CUTS.push([P(1), 'mosaic']);
  CUTS.push([P(2), 'flash']); [36, 38, 40, 42, 44].forEach(k => CUTS.push([bt(k), k === 36 || k === 44 ? 'glitch' : 'mosaic']));
  CUTS.push([P(3), 'glitch']); [50, 52, 56, 60].forEach(k => CUTS.push([bt(k), 'mosaic']));
  CUTS.push([P(4), 'mosaic']); CUTS.push([bt(76), 'none']);
  for (let k = 80; k < 96; k++) CUTS.push([bt(k), k < 88 ? (k % 2 ? 'glitch' : 'mosaic') : (k % 2 ? 'none' : 'glitch')]);
  CUTS.push([P(6), 'glitch']); CUTS.push([bt(104), 'mosaic']);
  for (let k = 112; k < 128; k++) CUTS.push([bt(k), k % 3 === 0 ? 'mosaic' : 'glitch']);
  CUTS.push([P(8), 'flash']);
})();
const HIGH = t => t >= P(2) && t < P(8) + 0.8;

function render(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  // beat shake
  let sx = 0, sy = 0;
  if (HIGH(t) && !(t >= P(1) && t < P(2))) {
    const d = ((t - B0) % BT), a = 16 * Math.exp(-d * 16);
    sx = (rnd(Math.floor(t * 60) * 1.3) - .5) * a; sy = (rnd(Math.floor(t * 60) * 2.7) - .5) * a;
  }
  ctx.save();
  if (sx || sy) { ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(1.025, 1.025); ctx.translate(-W / 2, -H / 2); }
  let sc = SCENES[0][1];
  for (const [s, f] of SCENES) if (t >= s) sc = f;
  sc(t);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // cut FX
  let last = null; for (const c of CUTS) if (t >= c[0]) last = c;
  if (last) {
    const d = t - last[0], seed = Math.floor(last[0] * 100);
    if (last[1] === 'mosaic' && d < 0.11) mosaic(lerp(40, 1, E.outCubic(d / 0.11)));
    if (last[1] === 'glitch' && d < 0.1) glitch(1 - d / 0.1, seed + Math.floor(d * 60));
    if (last[1] === 'flash' && d < 0.35) { flashOver('#FFFFFF', 0.95 * Math.exp(-d * 9)); if (d < 0.12) glitch(1 - d / 0.12, seed); }
  }
  // downbeat flash in high-energy parts
  if (HIGH(t)) { const d = (t - B0) % (BT * 4); flashOver(C.volt, 0.10 * Math.exp(-d * 18)); }
  // pixel grain + scanlines + vignette
  ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false; ctx.drawImage(SPR.grain[Math.floor(t * 30) % 6], 0, 0, W, H); ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.55; ctx.drawImage(SPR.scan, 0, 0); ctx.globalAlpha = 1;
  ctx.drawImage(SPR.vig, 0, 0);
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
  // warm CJK fallback
  font(ctx, 40); ctx.fillText('注目 관심 ध्यान انتباه ความสนใจ', -1000, -1000);
  await document.fonts.ready;
  window.READY = true;
}
window.render = render;
init();
