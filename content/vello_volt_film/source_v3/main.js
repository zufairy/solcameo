import { W, H, X, C, mk, rnd, setCollect, VCACHE, clamp } from './core.js';
import * as core from './core.js';
import { SHOTS } from './shots.js';
import { glReady } from './gl.js';

const GR = []; for (let k = 0; k < 6; k++) { const g = mk(640, 360), x = g.getContext('2d'), d = x.createImageData(640, 360); for (let i = 0; i < d.data.length; i += 4) { const v = rnd(i * 0.31 + k * 777) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 20; } x.putImageData(d, 0, 0); GR.push(g); }
const VIG = mk(W, H); { const x = VIG.getContext('2d'), g = x.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.1); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
function inner(t) {
  X.setTransform(1, 0, 0, 1, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.fillStyle = '#000'; X.fillRect(0, 0, W, H);
  let i = 0; for (let k = 0; k < SHOTS.length; k++) if (t >= SHOTS[k][0]) i = k;
  X.save(); SHOTS[i][1](t - SHOTS[i][0], t); X.restore();
  if (core.COLLECT) return;
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
