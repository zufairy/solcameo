// ───────── three.js: chrome Vello mark + agent pass cards ─────────
import * as THREE from 'three';
import { E, clamp, lerp, mk, rrect, font, rnd } from './core.js';

const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
R.setSize(1920, 1080, false); R.setPixelRatio(1);
R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.35; R.outputColorSpace = THREE.SRGBColorSpace;
export const GLC = R.domElement;

// studio environment: black room with white strip softboxes → crisp chrome reflections
function studio() {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x000000);
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const add = (w, h, x, y, z, ry, rx = 0, k = 1) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k) })); p.position.set(x, y, z); p.rotation.set(rx, ry, 0); p.lookAt(0, 0, 0); s.add(p); };
  add(2.2, 16, -5, 0, 4, 0, 0, 9); add(1.6, 16, 6, 0, 2, 0, 0, 6); add(16, 1.4, 0, 7, 1, 0, 0, 7);
  add(1.2, 12, 0, 0, -7, 0, 0, 4); add(12, 1.0, 0, -6, 3, 0, 0, 2.5); add(5, 5, 4, 3, 7, 0, 0, 5); add(4, 4, -4, -2, 7, 0, 0, 3); add(9, 3, 1, 1.5, 10, 0, 0, 3.5); { const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.1, 1.1) })); wall.position.set(0, 0, 14); wall.lookAt(0, 0, 0); s.add(wall); } add(2.5, 9, -2.5, 0, 9, 0, 0, 5);
  const g = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.BackSide })); s.add(g);
  return s;
}
const pm = new THREE.PMREMGenerator(R);
const ENV = pm.fromScene(studio(), 0.02).texture;

// ── chrome mark ──
const S1 = new THREE.Scene(); S1.environment = ENV;
const cam1 = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 100); cam1.position.set(0, 0, 7.2);
const markG = new THREE.Group();
const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03 });
for (const poly of window.MARK) {
  const sh = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x * 3, y * 3)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.05, bevelSegments: 8, curveSegments: 12 });
  geo.translate(0, 0, -0.21); markG.add(new THREE.Mesh(geo, chrome));
}
S1.add(markG);
// reflective floor
const floorM = new THREE.MeshPhysicalMaterial({ color: 0x030303, metalness: 0.9, roughness: 0.25 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorM); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.7;
const keyL = new THREE.SpotLight(0xffffff, 8, 30, 0.5, 0.8); keyL.position.set(2, 6, 4); S1.add(keyL);

export function renderMark(u, o = {}) {
  const p = E.outQuint(clamp(u / 1.4));
  markG.rotation.set(lerp(0.5, 0.12, p) + Math.sin(u * 1.3) * 0.03, lerp(-2.4, 0.35, p) + u * 0.08, lerp(-0.2, 0.02, p));
  markG.position.set(0, Math.sin(u * 1.6) * 0.05, 0);
  const s = o.scale || 1; markG.scale.setScalar(lerp(0.75, 1, p) * s);
  cam1.position.set(Math.sin(u * 0.3) * 0.3, 0.15, lerp(8.5, 7.0, p));
  cam1.lookAt(0, 0, 0);
  R.toneMappingExposure = 1.35; R.setClearColor(0x000000, 0); R.render(S1, cam1);
  return GLC;
}

// ── agent pass cards ──
const MARKIMG = new Image(); MARKIMG.src = 'assets/vello-mark-lime.png';
function tintMark(col, w) { const c = mk(w, w), x = c.getContext('2d'); x.drawImage(MARKIMG, 0, 0, w, w); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, w, w); return c; }
const CW = 1012, CH = 638;
function cardTex(kind, data) {
  const c = mk(CW, CH), x = c.getContext('2d');
  rrect(x, 0, 0, CW, CH, 46); x.clip();
  let ink = '#0b0b0b';
  if (kind === 'white') { x.fillStyle = '#EEEEEC'; x.fillRect(0, 0, CW, CH); }
  else if (kind === 'holo') { const g = x.createLinearGradient(0, 0, CW, CH); g.addColorStop(0, '#F3D3FF'); g.addColorStop(0.35, '#C7B8FF'); g.addColorStop(0.65, '#B9F5FF'); g.addColorStop(1, '#C9FFE2'); x.fillStyle = g; x.fillRect(0, 0, CW, CH); }
  else if (kind === 'black') { x.fillStyle = '#121212'; x.fillRect(0, 0, CW, CH); x.strokeStyle = 'rgba(255,255,255,0.035)'; for (let i = -CH; i < CW; i += 7) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + CH, CH); x.stroke(); } ink = '#F2F2F2'; }
  else if (kind === 'gold') { const g = x.createLinearGradient(0, 0, CW, CH); g.addColorStop(0, '#B8902F'); g.addColorStop(0.45, '#F1D58C'); g.addColorStop(1, '#A87F2A'); x.fillStyle = g; x.fillRect(0, 0, CW, CH); for (let i = 0; i < CH; i += 2) { x.fillStyle = `rgba(255,255,255,${rnd(i) * 0.06})`; x.fillRect(0, i, CW, 1); } }
  else if (kind === 'volt') { x.fillStyle = '#C8FF00'; x.fillRect(0, 0, CW, CH); }
  // sheen
  const sg = x.createLinearGradient(0, 0, CW, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.10)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = sg; x.fillRect(0, 0, CW, CH);
  x.drawImage(tintMark(ink, 92), 52, 46, 92, 92);
  x.fillStyle = ink; font(x, 26, 600); x.textAlign = 'right'; x.textBaseline = 'middle'; x.globalAlpha = 0.7; x.fillText('AGENT PASS', CW - 54, 90); x.globalAlpha = 1;
  font(x, 150, 600); x.textAlign = 'left'; x.fillText(data.big, 50, 300);
  font(x, 28, 500); x.globalAlpha = 0.65; x.fillText(data.sub, 56, 395); x.globalAlpha = 1;
  x.fillStyle = ink; x.globalAlpha = 0.18; x.fillRect(52, 452, CW - 104, 2); x.globalAlpha = 1;
  data.cols.forEach(([a, b], i) => { const xx = 56 + i * 310; font(x, 22, 500); x.globalAlpha = 0.6; x.fillText(a, xx, 500); x.globalAlpha = 1; font(x, 32, 600); x.fillText(b, xx, 548); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const S2 = new THREE.Scene(); S2.environment = ENV;
S2.add(new THREE.AmbientLight(0xffffff, 0.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(-3, 4, 5); S2.add(dl);
const cam2 = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
const CARDDATA = [
  ['white', { big: '$22,405', sub: 'earned this season · verified', cols: [['agent', '#0412'], ['market', 'Seoul · KR'], ['views', '4.21M']] }],
  ['holo', { big: '$22,405', sub: 'earned this season · verified', cols: [['agent', '#0449'], ['market', 'Tokyo · JP'], ['views', '3.38M']] }],
  ['black', { big: '$22,405', sub: 'earned this season · verified', cols: [['agent', '#0486'], ['market', 'São Paulo'], ['views', '2.87M']] }],
  ['gold', { big: '$22,405', sub: 'earned this season · verified', cols: [['agent', '#0523'], ['market', 'Dubai · AE'], ['views', '2.31M']] }],
  ['volt', { big: '$22,405', sub: 'earned this season · verified', cols: [['agent', '#0560'], ['market', 'Lagos · NG'], ['views', '1.96M']] }],
  ['white', { big: '48,213', sub: 'views in the last hour', cols: [['agent', '#0412'], ['edits', '145'], ['payout', 'x402 · USDC']] }],
];
let cards = null;
function buildCards() {
  cards = CARDDATA.map(([k, d]) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: cardTex(k, d), transparent: true, alphaTest: 0.5, side: THREE.FrontSide, toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.586, 1), mat); g.add(face);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.586, 1), new THREE.MeshBasicMaterial({ map: mat.map, transparent: true, alphaTest: 0.5, color: 0x222222 })); back.position.z = -0.012; g.add(back);
    S2.add(g); g.visible = false; return g;
  });
}
const L = (a, b, p) => a + (b - a) * p;
export function renderCard(u) { // single tilted card ("48,213") — like the 79,367 beat
  if (!cards) buildCards(); cards.forEach(c => c.visible = false);
  const c = cards[5]; c.visible = true; const p = E.outQuint(clamp(u / 0.9));
  c.position.set(L(0.6, 0.1, p), L(-0.25, 0, p), 0); c.rotation.set(L(-0.9, -0.35, p), L(0.9, -0.42, p), L(0.5, 0.22, p) + u * 0.04);
  cam2.position.set(0, 0, 2.6); cam2.lookAt(0, 0, 0);
  R.toneMappingExposure = 0.95; R.setClearColor(0x000000, 0); R.render(S2, cam2); return GLC;
}
export function renderStack(u, out = 0) { // five passes fanning in, then whip out
  if (!cards) buildCards(); cards.forEach(c => c.visible = false);
  const slots = [[-1.25, 0.42, -0.6], [0.0, 0.5, -0.9], [1.25, 0.42, -0.6], [-0.62, -0.32, 0], [0.62, -0.32, 0.15]];
  for (let i = 0; i < 5; i++) {
    const c = cards[i]; c.visible = true; const q = E.outQuint(clamp((u - i * 0.12) / 0.9));
    const [x, y, z] = slots[i];
    c.position.set(L(x + 2.8, x, q) + out * (6 + i * 0.6), L(y - 1.4, y, q), L(z - 2, z, q));
    c.rotation.set(L(-0.9, -0.18, q) + Math.sin(u * 0.9 + i) * 0.03, L(-1.1, 0.12 - x * 0.08, q) - out * 0.8, L(0.4, 0.05, q));
  }
  cam2.position.set(Math.sin(u * 0.25) * 0.25, 0.15, L(5.2, 4.3, E.outCubic(clamp(u / 2.5)))); cam2.lookAt(0, 0.05, -0.3);
  R.toneMappingExposure = 0.95; R.setClearColor(0x000000, 0); R.render(S2, cam2); return GLC;
}
export function glReady() { return MARKIMG.complete; }
