// ───────── three.js scenes v4: glass-stack intro, feed tunnel, agent globe ─────────
import * as THREE from 'three';
import { GLC, R, ENV as ENVG } from './gl.js';
import { E, clamp, lerp, rnd, img, mk } from './core.js';

const TEX = new Map();
function tex(url) { // texture from a preloaded image (collect pass registers the URL)
  const im = img(url); if (!im) return null;
  let t = TEX.get(url); if (!t) { t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.anisotropy = 4; TEX.set(url, t); }
  return t;
}
const seqUrl = (clip, i) => `seq/${clip}/${String(i).padStart(5, '0')}.jpg`;

// ═════ 1. INTRO — huge Vello logo behind, glass + urban plates stacking asymmetrically ═════
const S1 = new THREE.Scene();
const cam1 = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
const logoTexC = (() => { const c = mk(2048, 616), x = c.getContext('2d'); return c; })();
let logoPlane = null;
const URBAN = [['city', 30], ['aerial', 40], ['car', 20], ['head', 60], ['jet', 50], ['chart', 30], ['earth2', 60], ['creator2', 90], ['chrome', 40], ['bokeh', 30], ['runner', 80], ['edit', 30], ['aerial', 120], ['city', 90], ['head', 120], ['car', 80]];
export const INTRO_URLS = URBAN.map(([c, i]) => seqUrl(c, i));
const plates = []; // built lazily
const glassM = (r) => new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: r, transmission: 1, thickness: 1.2, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.5 });
function buildIntro(logoImg) {
  // opaque logo board (so glass transmission can refract it)
  const cvs = mk(3200, 1800), cx = cvs.getContext('2d'); cx.fillStyle = '#060606'; cx.fillRect(0, 0, 3200, 1800);
  const lw = 2600, lh = lw * logoImg.height / logoImg.width; cx.drawImage(logoImg, 300, 900 - lh / 2, lw, lh);
  const lt = new THREE.CanvasTexture(cvs); lt.colorSpace = THREE.SRGBColorSpace;
  logoPlane = new THREE.Mesh(new THREE.PlaneGeometry(26, 14.625), new THREE.MeshBasicMaterial({ map: lt, toneMapped: false }));
  logoPlane.position.set(0, 0, -7); S1.add(logoPlane);
  for (let i = 0; i < 16; i++) {
    const w = 1.2 + rnd(i * 3.1) * 3.2, h = w * (0.55 + rnd(i * 5.7) * 0.9);
    const isGlass = i % 2 === 0, frosted = i % 4 === 0;
    const g = new THREE.Group();
    if (isGlass) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), glassM(frosted ? 0.35 : 0.04)); g.add(m);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, 0.08)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })); g.add(edge);
    }
    const pm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pm); photo.visible = !isGlass; g.add(photo);
    g.userData = { photo, url: INTRO_URLS[i], isGlass, w, h, x: (rnd(i * 7.3) - 0.5) * 9.5, y: (rnd(i * 9.1) - 0.5) * 5, z: -4 + rnd(i * 2.9) * 5.5, rz: (rnd(i * 4.4) - 0.5) * 0.7, ry: (rnd(i * 6.6) - 0.5) * 0.9 };
    g.visible = false; S1.add(g); plates.push(g);
  }
  S1.add(new THREE.AmbientLight(0xffffff, 0.8)); S1.environment = ENVG;
}
// camera angles cut on every half-beat (reference: rapid cuts)
const ANG = [[0, 0, 10, 0], [-2.0, 0.6, 8.5, 0.05], [2.2, -0.5, 9, -0.04], [0.4, 1.1, 7.5, 0.08], [-1.0, -0.9, 11, -0.06], [2.6, 0.3, 8, 0.03], [-2.4, -0.3, 8.5, -0.09], [0, 0, 12, 0]];
export function renderIntro(u, beat, logoImg) {
  if (!logoPlane) { if (!logoImg) return null; buildIntro(logoImg); }
  const step = Math.floor(u / (beat / 2));
  plates.forEach((g, i) => {
    const d = g.userData, born = i * (beat / 2) * 0.5; // two plates per half-beat → stack builds fast
    const q = clamp((u - born) / 0.12);
    g.visible = q > 0;
    if (!g.visible) return;
    const t = tex(d.url); if (t && !d.photo.material.map) { d.photo.material.map = t; d.photo.material.needsUpdate = true; }
    const pop = E.outQuint(q);
    g.position.set(d.x + (1 - pop) * (rnd(i) - 0.5) * 4, d.y + (1 - pop) * 1.5, d.z + Math.sin(u * 0.7 + i) * 0.08);
    g.rotation.set(Math.sin(u * 0.5 + i) * 0.05, d.ry + (1 - pop) * 0.8, d.rz);
    g.scale.setScalar(lerp(1.25, 1, pop));
  });
  const a = ANG[step % ANG.length], drift = (u % (beat / 2)) / (beat / 2);
  cam1.position.set(a[0] + drift * 0.25, a[1] + drift * 0.1, a[2] - drift * 0.6);
  cam1.lookAt(a[0] * 0.15, a[1] * 0.15, -7); cam1.rotation.z += a[3];
  logoPlane.position.x = Math.sin(u * 0.4) * 0.3;
  R.toneMappingExposure = 1.0; R.setClearColor(0x050505, 1); R.render(S1, cam1);
  return GLC;
}

// ═════ 2. FEED TUNNEL — infinite tunnel of feed tiles, camera flying through ═════
const S2 = new THREE.Scene(); S2.fog = new THREE.Fog(0x000000, 6, 34);
const cam2 = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
const TUN = []; const TCLIPS = ['city', 'aerial', 'creator', 'creator2', 'head', 'jet', 'chart', 'runner', 'bokeh', 'earth', 'edit', 'tired', 'car', 'chrome2'];
export const TUNNEL_URLS = []; for (let i = 0; i < 28; i++) TUNNEL_URLS.push(seqUrl(TCLIPS[i % TCLIPS.length], 10 + (i * 37) % 100));
const N_AROUND = 10, N_DEPTH = 14, RAD = 3.2, GAP = 2.6;
function buildTunnel() {
  for (let d = 0; d < N_DEPTH; d++) for (let a = 0; a < N_AROUND; a++) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide, fog: true });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.95), m);
    const ang = a / N_AROUND * Math.PI * 2 + (d % 2) * Math.PI / N_AROUND;
    p.position.set(Math.cos(ang) * RAD, Math.sin(ang) * RAD, -d * GAP); p.lookAt(0, 0, -d * GAP); p.userData = { url: TUNNEL_URLS[(d * N_AROUND + a) % TUNNEL_URLS.length], d, a };
    S2.add(p); TUN.push(p);
  }
}
export function renderTunnel(u) {
  if (!TUN.length) buildTunnel();
  const speed = 9 + u * 6, travel = u * speed;
  TUN.forEach(p => {
    const t = tex(p.userData.url); if (t && !p.material.map) { p.material.map = t; p.material.needsUpdate = true; }
    let z = -p.userData.d * GAP + travel % GAP + Math.floor(travel / GAP) * 0; // recycle
    let zz = ((-p.userData.d * GAP + travel) % (N_DEPTH * GAP)); if (zz > 2) zz -= N_DEPTH * GAP;
    p.position.z = zz;
  });
  cam2.position.set(0, 0, 2); cam2.rotation.set(0, 0, u * 0.35);
  R.toneMappingExposure = 1.0; R.setClearColor(0x000000, 1); R.render(S2, cam2);
  return GLC;
}

// ═════ 3. AGENT GLOBE — point-cloud earth, agents firing arcs, video tiles riding out ═════
const S3 = new THREE.Scene();
const cam3 = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 200);
let globeG = null, arcs = [], tiles = [];
const v3 = (lon, lat, r = 1) => { const l = lon * Math.PI / 180, p = lat * Math.PI / 180; return new THREE.Vector3(Math.cos(p) * Math.sin(l) * r, Math.sin(p) * r, Math.cos(p) * Math.cos(l) * r); };
const AG = [[127, 37.5], [139.7, 35.7], [-46.6, -23.5], [55.3, 25.2], [72.9, 19.1], [-99.1, 19.4], [-74, 40.7], [106.8, -6.2], [3.4, 6.5], [2.35, 48.9], [29, 41], [121, 14.6], [13.4, 52.5], [100.5, 13.8], [36.8, -1.3], [101.7, 3.1], [110.4, 1.6], [-118, 34], [151, -33.8], [-0.1, 51.5], [77.2, 28.6], [-58.4, -34.6], [18.4, -33.9], [37.6, 55.7]];
export const GLOBE_URLS = []; for (let i = 0; i < 12; i++) GLOBE_URLS.push(seqUrl(TCLIPS[(i * 5) % TCLIPS.length], 20 + i * 7));
function buildGlobe() {
  globeG = new THREE.Group(); S3.add(globeG);
  const pts = window.GLOBE, pos = new Float32Array(pts.length * 3 * 2);
  let k = 0; pts.forEach(([lon, lat]) => { for (const j of [0, 1]) { const v = v3(lon + j * 0.9, lat + j * 0.6, 1.0); pos[k++] = v.x; pos[k++] = v.y; pos[k++] = v.z; } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  globeG.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.012, sizeAttenuation: true, transparent: true, opacity: 0.9 })));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.985, 64, 32), new THREE.MeshBasicMaterial({ color: 0x040404 })); globeG.add(core);
  const ring = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, side: THREE.BackSide })); globeG.add(ring);
  AG.forEach(([lon, lat], i) => {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), new THREE.MeshBasicMaterial({ color: i % 4 === 0 ? 0xc8ff00 : 0xffffff })); n.position.copy(v3(lon, lat, 1.005)); globeG.add(n);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide })); halo.position.copy(v3(lon, lat, 1.006)); halo.lookAt(0, 0, 0); globeG.add(halo); n.userData.halo = halo;
  });
  for (let i = 0; i < 40; i++) {
    const a = AG[i % AG.length], b = AG[(i * 7 + 3) % AG.length]; if (a === b) continue;
    const A = v3(a[0], a[1], 1.005), B = v3(b[0], b[1], 1.005), M = A.clone().add(B).multiplyScalar(0.5).normalize().multiplyScalar(1 + A.distanceTo(B) * 0.45);
    const curve = new THREE.QuadraticBezierCurve3(A, M, B), P = curve.getPoints(64);
    const geo = new THREE.BufferGeometry().setFromPoints(P);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: i % 5 === 0 ? 0xc8ff00 : 0xffffff, transparent: true, opacity: 0.75 }));
    line.userData = { curve, t0: i * 0.11 }; geo.setDrawRange(0, 0); globeG.add(line); arcs.push(line);
  }
  for (let i = 0; i < 12; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide, transparent: true });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.285), m); p.userData = { url: GLOBE_URLS[i], arc: arcs[(i * 3) % arcs.length] };
    globeG.add(p); tiles.push(p);
  }
}
// distinct camera set-ups, cut per beat
const GCAM = [[0, 0.2, 3.4, 0, 0], [1.6, 0.5, 1.7, 0.35, 0.3], [-1.4, -0.3, 1.9, -0.3, -0.1], [0, 2.6, 1.6, 0, 0.9], [2.2, -0.2, 2.2, 0.5, -0.2], [0, 0, 5.2, 0, 0], [-0.9, 0.9, 1.4, -0.4, 0.4], [0.4, -1.2, 2.0, 0.1, -0.5]];
export function renderGlobe(u, beat, k) {
  if (!globeG) buildGlobe();
  globeG.rotation.y = -1.0 + u * 0.32; globeG.rotation.x = 0.25;
  arcs.forEach(l => { const p = clamp((u - l.userData.t0) / 0.7); l.geometry.setDrawRange(0, Math.floor(E.outCubic(p) * 65)); l.material.opacity = 0.75 * (p > 0 ? 1 : 0); });
  tiles.forEach((p, i) => {
    const t = tex(p.userData.url); if (t && !p.material.map) { p.material.map = t; p.material.needsUpdate = true; }
    const a = p.userData.arc, f = clamp((u - a.userData.t0 - 0.3) / 1.4); p.visible = f > 0 && f < 1;
    if (!p.visible) return; const pt = a.userData.curve.getPoint(E.inOutCubic(f)); p.position.copy(pt).multiplyScalar(1.02); p.lookAt(pt.clone().multiplyScalar(3)); p.material.opacity = Math.sin(f * Math.PI);
  });
  const c = GCAM[k % GCAM.length], dr = (u % beat) / beat;
  cam3.position.set(c[0] * (1 - dr * 0.04), c[1], c[2] * (1 - dr * 0.06)); cam3.lookAt(c[3], c[4], 0);
  R.toneMappingExposure = 1.0; R.setClearColor(0x000000, 1); R.render(S3, cam3);
  return GLC;
}
