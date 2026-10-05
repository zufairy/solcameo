import { W, H, X, C, mk, rnd, setCollect, VCACHE, clamp, K } from './core.js';
import * as core from './core.js';
import { SHOTS } from './shots.js';
import { glReady } from './gl.js';

const GR = []; for (let k = 0; k < 6; k++) { const g = mk(640, 360), x = g.getContext('2d'), d = x.createImageData(640, 360); for (let i = 0; i < d.data.length; i += 4) { const v = rnd(i * 0.31 + k * 777) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 20; } x.putImageData(d, 0, 0); GR.push(g); }
const VIG = mk(W, H); { const x = VIG.getContext('2d'), g = x.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.1); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
const cv = X.canvas, TMP = mk(W, H), TX = TMP.getContext('2d');
function trackGlitch(a, seed) {
  TX.clearRect(0, 0, W, H); TX.drawImage(cv, 0, 0);
  X.save(); X.globalCompositeOperation = 'lighter'; X.globalAlpha = 0.35 * a;
  X.filter = 'sepia(1) hue-rotate(-50deg) saturate(5)'; X.drawImage(TMP, -14 * a, 0);
  X.filter = 'sepia(1) hue-rotate(150deg) saturate(5)'; X.drawImage(TMP, 14 * a, 0);
  X.restore(); X.filter = 'none';
  for (let s = 0; s < 9; s++) { const y = rnd(seed * 3 + s) * H, h = 8 + rnd(seed + s * 5) * 70, dx = (rnd(seed * 7 + s) - .5) * 180 * a; X.drawImage(TMP, 0, y, W, h, dx, y, W, h); }
}
function inner(t) {
  X.setTransform(1, 0, 0, 1, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.fillStyle = '#000'; X.fillRect(0, 0, W, H);
  let i = 0; for (let k = 0; k < SHOTS.length; k++) if (t >= SHOTS[k][0]) i = k;
  X.save(); SHOTS[i][1](t - SHOTS[i][0], t); X.restore();
  if (core.COLLECT) return;
  // digital tracking glitch on every cut + occasional tracking band (whole film)
  const d = t - SHOTS[i][0];
  if (i > 0 && d < 0.09) trackGlitch(1 - d / 0.09, Math.floor(t * 50));
  const tb = (t * 0.37) % 1; if (tb < 0.06) { const y = (tb / 0.06) * H; X.drawImage(cv, 0, y, W, 26, (rnd(Math.floor(t * 50)) - .5) * 40, y, W, 26); X.fillStyle = 'rgba(255,255,255,0.05)'; X.fillRect(0, y, W, 3); }
  // inverted flash frames on the beat (reference style) — sparse in the breakdown, dense after the drop
  for (let k = 0; k < 88; k++) {
    const bt = K(k); if (t < bt || t >= bt + 0.06) continue;
    const cut = [8, 12, 16, 20, 22, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 62, 66, 70, 74, 76, 80].includes(k);
    const want = cut || (k < 32 ? k % 4 === 2 : (k >= 62 && k < 76 ? k % 2 === 1 : k % 2 === 0));
    if (want && !(k >= 76 && k < 80 && !cut)) { X.save(); X.globalCompositeOperation = 'difference'; X.fillStyle = '#fff'; X.fillRect(0, 0, W, H); X.restore(); }
  }
  X.globalAlpha = 1; X.drawImage(GR[Math.floor(t * 25) % 6], 0, 0, W, H); X.drawImage(VIG, 0, 0);
}
function load(u) { return new Promise(r => { const i = new Image(); i.onload = () => { VCACHE.set(u, i); r(); }; i.onerror = () => r(); i.src = u; }); }
window.render = async t => {
  setCollect(new Set()); inner(t); const need = [...core.COLLECT]; setCollect(null);
  await Promise.all(need.filter(u => !VCACHE.has(u)).map(load));
  if (VCACHE.size > 300) { const keep = new Set(need); for (const k of [...VCACHE.keys()]) { if (VCACHE.size <= 200) break; if (!keep.has(k) && !k.startsWith('assets') && !k.startsWith('thumbs')) VCACHE.delete(k); } }
  inner(t);
};
(async () => {
  const f = new FontFace('InterV', 'url(fonts/inter-latin-wght-normal.woff2)', { weight: '100 900' }); await f.load(); document.fonts.add(f);
  await document.fonts.ready;
  while (!glReady()) await new Promise(r => setTimeout(r, 50));
  window.READY = true;
})();
