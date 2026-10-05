import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

await Promise.all([document.fonts.load('20px PX'), document.fonts.load('700 20px SG'), document.fonts.load('500 20px JB')]);
// ---------------- utils ----------------
const QS0 = new URLSearchParams(location.search); const W = +(QS0.get('w') ?? 1600), H = Math.round(W * 9 / 16);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
const sm = u => u * u * (3 - 2 * u);
const eio = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const eo = u => 1 - Math.pow(1 - u, 3);
const eback = u => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const eel = u => u === 0 ? 0 : u === 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - .75) * (2 * Math.PI) / 3) + 1;
const bump = (t, c, w) => Math.exp(-Math.pow((t - c) / w, 2));
function rnd(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const arc = (a, b, h, u) => V(lerp(a.x, b.x, u), lerp(a.y, b.y, u) + 4 * h * u * (1 - u), lerp(a.z, b.z, u));

// ---------------- timeline constants ----------------
const T = {
  wipe: 3.0, bootStart: 10.0, hopStart: 13.5, hopEnd: 16.5,
  slashes: [16.9, 18.9, 20.9, 22.7], flurry: 24.0, poof: 25.6,
  powerCap: 28.8, powerHook: 30.8, powerRef: 32.3,
  launch0: 34.6, launchStep: 0.45, night0: 37.6, night1: 39.6, day0: 43.2, day1: 45.4,
  coins0: 44.6, level: 50.2, end0: 54.2,
};
const NC = 12;
const cardBirth = i => i < 4 ? T.slashes[i] + 0.6 : T.flurry + 0.35 + (i - 4) * 0.16;
const cardSlot = i => V(2.0 + i * 0.62, 0, 0.9);
const cardLaunch = i => T.launch0 + i * T.launchStep;
const PORT = [V(3.2, 2.45, -3.2), V(5.8, 2.65, -3.6), V(8.4, 2.45, -3.2)];
const BOSS = V(10, 0, 0);
const CHEST = V(-0.1, 0, -0.9);
const NCOIN = 26;
const coinT = k => T.coins0 + k * 0.16;
const STREAM = 16; const streamT = k => 39.9 + k * 0.21;

// ---------------- renderer / scene ----------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
if (QS0.get('env') !== null) scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const fill = new THREE.DirectionalLight(0xdfe9ff, .9); fill.position.set(10, 6, 14); scene.add(fill);
scene.fog = new THREE.Fog(0xcfe9ff, 30, 70);
const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 200);

const QS = new URLSearchParams(location.search);
const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: +(QS.get('ms') ?? 4) });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.25, 0.4, 1.15);
if (QS.get('nobloom') === null) composer.addPass(bloom);
composer.addPass(new OutputPass());
if (QS0.get('smaa') !== null) composer.addPass(new SMAAPass(W, H));

// lights
const hemi = new THREE.HemisphereLight(0xcdeeff, 0x6f8f52, 1.3); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.position.set(-8, 16, 10); sun.castShadow = true;
sun.shadow.mapSize.set(+(QS.get('sm') ?? 2048), +(QS.get('sm') ?? 2048)); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
Object.assign(sun.shadow.camera, { left: -16, right: 18, top: 12, bottom: -12, near: 1, far: 60 });
sun.target.position.set(4, 0, 0); scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0xbfe8ff, 0.0); rim.position.set(6, 5, -8); scene.add(rim);

// materials
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .55, metalness: 0, ...o });
const P = (c, o = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: .28, clearcoat: 1, clearcoatRoughness: .15, ...o });
const LIME = 0xA3E635;
const glow = (c, i = 2) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: .4 });
const shadowAll = o => o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

// ---------------- sky ----------------
const skyU = { top: { value: new THREE.Color(0x6fc3ff) }, bot: { value: new THREE.Color(0xffe6c2) }, stars: { value: 0 }, sunDir: { value: V(-.5, .5, -1).normalize() }, sunAmt: { value: 1 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: `varying vec3 vp;void main(){vp=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform vec3 top,bot,sunDir;uniform float stars,sunAmt;varying vec3 vp;
  float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  void main(){float y=clamp(vp.y*2.2+.05,0.,1.);vec3 c=mix(bot,top,pow(y,.6));c=mix(c,vec3(1.,.86,.7),exp(-max(vp.y,0.)*14.)*.35*sunAmt);
  float s=max(dot(vp,sunDir),0.);c+=vec3(1.,.85,.6)*pow(s,24.)*.9*sunAmt+vec3(1.,.7,.4)*pow(s,4.)*.18*sunAmt;
  vec3 q=floor(vp*260.);float st=step(.9965,h(q))*stars*smoothstep(.0,.3,vp.y);c+=vec3(st);
  gl_FragColor=vec4(c,1.);
  #include <colorspace_fragment>
  }`
}));
scene.add(sky);
const moon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16), glow(0xfff3c4, 1.4)); moon.position.set(22, 24, -60); scene.add(moon);

// ---------------- world ----------------
const world = new THREE.Group(); scene.add(world);
const dirt = new THREE.Mesh(new RoundedBoxGeometry(36, 1.4, 12, 4, .45), M(0x8a5a3c, { roughness: .9 }));
dirt.position.set(4, -0.78, -1); world.add(dirt);
const grass = new THREE.Mesh(new RoundedBoxGeometry(36.4, .42, 12.4, 4, .2), M(0x8fd45a, { roughness: .8 }));
grass.position.set(4, -0.2, -1); world.add(grass);
grass.receiveShadow = true; dirt.receiveShadow = true;
// grass tiles pattern (checker slightly different tone) for game feel
{
  const g = new RoundedBoxGeometry(1.94, .06, 1.94, 2, .05);
  const inst = new THREE.InstancedMesh(g, M(0x9fe066, { roughness: .8 }), 400); let n = 0;
  const m4 = new THREE.Matrix4();
  for (let x = -13; x <= 21; x += 2) for (let z = -6; z <= 4; z += 2) { if (((x + z) / 2) % 2 === 0) continue; m4.makeTranslation(x, .01, z); inst.setMatrixAt(n++, m4); }
  inst.count = n; inst.receiveShadow = true; world.add(inst);
}
// hills & trees & clouds
const R0 = rnd(3);
[[-10, -16, 7, 0x7fcfb8], [2, -20, 10, 0xa99be8], [16, -17, 8, 0x86c9e8], [26, -14, 6, 0x9ad48a], [-20, -12, 6, 0xb3a4f0]].forEach(([x, z, r, c]) => {
  const h = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24), M(c, { roughness: .9 })); h.position.set(x, -r * .35, z); h.scale.y = .8; world.add(h);
});
const trees = [];
[[-7, -4.5], [-5.2, -5.6], [12.8, -5.2], [14.5, -4.1], [17, -5.6], [-9, -2], [19, -1.5], [-3.6, -6.2]].forEach(([x, z], i) => {
  const g = new THREE.Group();
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, 1.1, 12), M(0x8a5a3c)); tr.position.y = .55; g.add(tr);
  const c = [0x5fbf6a, 0x7ad36b, 0x4fb37e][i % 3];
  const cn = new THREE.Mesh(new THREE.SphereGeometry(.85, 32, 16), M(c, { roughness: .7 })); cn.position.y = 1.55; g.add(cn);
  const cn2 = new THREE.Mesh(new THREE.SphereGeometry(.55, 24, 12), M(c, { roughness: .7 })); cn2.position.set(.45, 1.95, .1); g.add(cn2);
  g.position.set(x, 0, z); const s = .8 + R0() * .5; g.scale.setScalar(s); shadowAll(g); world.add(g); trees.push(g);
});
const clouds = [];
for (let i = 0; i < 7; i++) {
  const g = new THREE.Group(); const r = rnd(20 + i);
  for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(.7 + r() * .6, 24, 12), M(0xffffff, { roughness: 1, emissive: 0xffffff, emissiveIntensity: .15 })); s.position.set(k * .8 - 1.6, r() * .5, r() * .4); g.add(s); }
  g.position.set(-14 + i * 6.5, 7 + r() * 3, -16 - r() * 6); g.userData.sp = .15 + r() * .15; world.add(g); clouds.push(g);
}
// flowers
{
  const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(.09, 10, 8), M(0xffffff, { roughness: .6 }), 90);
  const r = rnd(9), m4 = new THREE.Matrix4(), cols = [0xffd166, 0xff8fab, 0xffffff, 0xc3a6ff];
  for (let i = 0; i < 90; i++) { let x = -12 + r() * 32, z = -6 + r() * 10; if (z > -2.2 && z < 2.6 && x > -2 && x < 13) z = z < .2 ? -2.6 - r() * 2 : 2.8 + r(); m4.makeTranslation(x, .08, z); inst.setMatrixAt(i, m4); inst.setColorAt(i, new THREE.Color(cols[i % 4])); }
  world.add(inst);
}
// bolt shape
const boltShape = (() => { const s = new THREE.Shape(); const v = [[-.02, .36], [.17, .36], [.045, .06], [.19, .06], [-.11, -.36], [-.02, -.07], [-.17, -.07]]; s.moveTo(v[0][0], v[0][1]); v.slice(1).forEach(p => s.lineTo(p[0], p[1])); s.closePath(); return s; })();
const boltGeo = new THREE.ExtrudeGeometry(boltShape, { depth: .08, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 3 }); boltGeo.center();

// canvas texture helper
function ctex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function rr(x, X, Y, w, h, r) { x.beginPath(); x.roundRect(X, Y, w, h, r); }

// film strip road
{
  const strip = new THREE.Mesh(new RoundedBoxGeometry(14.5, .08, 1.7, 2, .03), P(0x1d2130, { roughness: .35 })); strip.position.set(4.6, .06, 0); strip.receiveShadow = true; world.add(strip);
  const holes = new THREE.InstancedMesh(new RoundedBoxGeometry(.2, .03, .14, 2, .03), M(0xf4f6f0), 120); const m4 = new THREE.Matrix4(); let n = 0;
  for (let x = -2.4; x < 11.8; x += .42) { for (const z of [-.7, .7]) { m4.makeTranslation(x, .11, z); holes.setMatrixAt(n++, m4); } }
  holes.count = n; world.add(holes);
  const r = rnd(5);
  for (let i = 0; i < 13; i++) {
    const hue = (i * 37) % 360;
    const tex = ctex(256, 180, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, `hsl(${hue},70%,62%)`); g.addColorStop(1, `hsl(${hue + 40},70%,45%)`); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(90, 80, 26, 0, 7); x.fill(); rr(x, 56, 108, 68, 80, 20); x.fill(); x.fillStyle = 'rgba(20,20,30,.8)'; rr(x, 160, 70, 22, 56, 11); x.fill(); x.fillRect(168, 120, 6, 40); });
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(.95, 1.05), new THREE.MeshStandardMaterial({ map: tex, roughness: .5 })); fr.rotation.x = -Math.PI / 2; fr.position.set(-2.0 + i * 1.08, .105, 0); fr.receiveShadow = true; world.add(fr);
  }
}

// house
const house = new THREE.Group();
{
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.9, 2.0, 4, .18), M(0xfff1dc)); body.position.y = .95; house.add(body);
  const roofG = new THREE.CylinderGeometry(.0, 1.95, 1.3, 4, 1); const roof = new THREE.Mesh(roofG, M(0xff7a59, { roughness: .5 })); roof.rotation.y = Math.PI / 4; roof.position.y = 2.5; roof.scale.set(1, 1, .82); house.add(roof);
  const door = new THREE.Mesh(new RoundedBoxGeometry(.6, 1.0, .1, 3, .08), M(0x7c4dff)); door.position.set(-.45, .5, 1.0); house.add(door);
  const win = new THREE.Mesh(new RoundedBoxGeometry(.7, .6, .08, 3, .06), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc94a, emissiveIntensity: .6 })); win.position.set(.5, 1.15, 1.0); house.add(win); house.userData.win = win;
  const frame = new THREE.Mesh(new RoundedBoxGeometry(.08, .64, .1, 2, .03), M(0xffffff)); frame.position.set(.5, 1.15, 1.03); house.add(frame);
  const chim = new THREE.Mesh(new RoundedBoxGeometry(.35, .7, .35, 2, .06), M(0xd9d2c5)); chim.position.set(.6, 2.7, -.2); house.add(chim);
  house.position.set(-2.4, 0, -3.6); house.rotation.y = .35; shadowAll(house); world.add(house);
}
const winLight = new THREE.PointLight(0xffc94a, 6, 5, 2); winLight.position.set(-1.6, 1.3, -2.2); scene.add(winLight);
const zzz = [];
for (let i = 0; i < 3; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex(128, 128, (x) => { x.font = '96px PX'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Z', 64, 70); }), transparent: true, depthWrite: false })); s.scale.setScalar(.5); scene.add(s); zzz.push(s); }

// chest
const chest = new THREE.Group();
const lid = new THREE.Group();
{
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.2, .7, .8, 3, .08), M(0xb8733a, { roughness: .5 })); base.position.y = .35; chest.add(base);
  const band = new THREE.Mesh(new RoundedBoxGeometry(1.24, .12, .84, 2, .04), P(0xffd166, { metalness: .8, roughness: .3 })); band.position.y = .5; chest.add(band);
  const lidm = new THREE.Mesh(new RoundedBoxGeometry(1.24, .32, .84, 3, .1), M(0xc9813f, { roughness: .5 })); lidm.position.set(0, .16, .42); lid.add(lidm);
  const lock = new THREE.Mesh(boltGeo, glow(LIME, 1.5)); lock.scale.setScalar(.5); lock.position.set(0, .12, .86); lid.add(lock);
  lid.position.set(0, .7, -.42); chest.add(lid);
  chest.position.copy(CHEST); chest.rotation.y = .3; shadowAll(chest); world.add(chest);
}
const chestLight = new THREE.PointLight(0xffd166, 0, 4, 2); chestLight.position.set(CHEST.x, 1.2, CHEST.z + .2); scene.add(chestLight);

// boss TV monster
const boss = new THREE.Group(); const bossRig = new THREE.Group(); boss.add(bossRig);
let bossScreenMat;
{
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.3, 2.5, 1.3, 5, .35), P(0x3a2f4f, { roughness: .45 })); body.position.y = 1.95; bossRig.add(body);
  const scr = ctex(640, 440, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2b1f47'); g.addColorStop(1, '#120e22'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ff9fb2'; x.beginPath(); x.arc(200, 190, 54, 0, 7); x.fill(); rr(x, 130, 250, 140, 140, 50); x.fill();
    x.fillStyle = '#9fd8ff'; x.beginPath(); x.arc(440, 190, 54, 0, 7); x.fill(); rr(x, 370, 250, 140, 140, 50); x.fill();
    x.fillStyle = '#222'; rr(x, 296, 200, 48, 110, 24); x.fill();
    x.fillStyle = 'rgba(255,255,255,.2)'; rr(x, 40, 400, 560, 12, 6); x.fill(); x.fillStyle = '#ff4d5e'; rr(x, 40, 400, 30, 12, 6); x.fill();
    x.font = '28px PX'; x.fillStyle = '#fff'; x.fillText('0:00 / 3:12:08', 40, 380);
    x.font = '26px PX'; x.fillStyle = '#ff4d5e'; x.fillText('● LIVE', 40, 60);
  });
  bossScreenMat = new THREE.MeshStandardMaterial({ map: scr, emissive: 0xffffff, emissiveMap: scr, emissiveIntensity: .9, roughness: .25 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.86), bossScreenMat); screen.position.set(0, 1.92, .66); bossRig.add(screen);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.14, .45, 6, 12), M(0x241c33)); leg.position.set(s * 1.05, .35, 0); bossRig.add(leg);
    const foot = new THREE.Mesh(new RoundedBoxGeometry(.5, .2, .6, 2, .08), M(0x241c33)); foot.position.set(s * 1.05, .1, .1); bossRig.add(foot);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1.0, 8), M(0x999999, { metalness: .8, roughness: .3 })); ant.position.set(s * .5, 3.6, 0); ant.rotation.z = -s * .5; bossRig.add(ant);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.1, 16, 8), glow(0xff4d5e, 2)); ball.position.set(s * .75, 4.05, 0); bossRig.add(ball);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.34, 32, 16), P(0xffffff)); eye.position.set(s * .62, 3.35, .45); bossRig.add(eye);
    const pup = new THREE.Mesh(new THREE.SphereGeometry(.15, 20, 10), M(0x111111, { roughness: .2 })); pup.position.set(s * .62 - .1, 3.33, .75); bossRig.add(pup);
    const brow = new THREE.Mesh(new RoundedBoxGeometry(.55, .12, .12, 2, .05), M(0x111111)); brow.position.set(s * .6, 3.72, .6); brow.rotation.z = s * .35; bossRig.add(brow);
  }
  boss.position.copy(BOSS); boss.rotation.y = -.35; shadowAll(boss); world.add(boss);
}
const puffs = [];
for (let i = 0; i < 14; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(.5, 20, 10), M(0xffffff, { roughness: 1, transparent: true, opacity: 1 })); p.visible = false; scene.add(p); puffs.push(p); }

// portals
const portals = [];
const PCOL = [[0xff4d8d, '#ff4d8d', 'TikTok'], [0xa855f7, '#a855f7', 'Reels'], [0xff3b30, '#ff3b30', 'Shorts']];
PORT.forEach((p, i) => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.95, .14, 20, 64), P(PCOL[i][0], { emissive: PCOL[i][0], emissiveIntensity: .7 })); g.add(ring);
  const sw = ctex(256, 256, (x, w, h) => { const cx = 128; for (let r = 128; r > 0; r -= 2) { const a = r / 128; x.fillStyle = `hsla(${[330, 275, 5][i] + (1 - a) * 60},90%,${40 + (1 - a) * 45}%,1)`; x.beginPath(); x.arc(cx, cx, r, 0, 7); x.fill(); } x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 6; for (let k = 0; k < 5; k++) { x.beginPath(); for (let a = 0; a < 5; a += .05) { const rr_ = a * 24; x.lineTo(cx + Math.cos(a + k * 1.256) * rr_, cx + Math.sin(a + k * 1.256) * rr_); } x.stroke(); } });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(.84, 48), new THREE.MeshBasicMaterial({ map: sw, transparent: true, opacity: .95 })); disc.position.z = -.01; g.add(disc);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .5), new THREE.MeshBasicMaterial({ transparent: true, map: ctex(512, 160, (x) => { x.fillStyle = PCOL[i][1]; rr(x, 30, 20, 452, 120, 60); x.fill(); x.font = '700 76px SG'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(PCOL[i][2], 256, 84); }) })); lab.position.y = 1.45; g.add(lab);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.07, .09, p.y - .95, 10), M(0xdddddd, { metalness: .6, roughness: .3 })); post.position.y = -(p.y - .95) / 2 - .95; g.add(post);
  const pl = { intensity: 0 };
  g.position.copy(p); g.userData = { disc, pl, ring }; shadowAll(g); g.traverse(m => { if (m === disc || m === lab) { m.castShadow = false; } });
  scene.add(g); portals.push(g);
});

// cards
const CAPS = ['WAIT FOR IT', 'HE SAID WHAT?', 'NOBODY SAYS THIS', 'THE $1 MISTAKE', 'WATCH TILL END', 'THIS CHANGED IT', 'HOT TAKE', 'STORY TIME', 'THE REAL REASON', 'DON’T SKIP', 'PLOT TWIST', 'NO WAY'];
function thumbTex(i) { const hue = (i * 47 + 200) % 360; return ctex(256, 456, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `hsl(${hue},75%,66%)`); g.addColorStop(1, `hsl(${hue + 50},70%,42%)`); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,.92)'; x.beginPath(); x.arc(128, 175, 52, 0, 7); x.fill(); rr(x, 58, 238, 140, 190, 60); x.fill(); x.fillStyle = 'rgba(0,0,0,.18)'; x.beginPath(); x.arc(112, 170, 7, 0, 7); x.arc(146, 170, 7, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(24, 20); x.lineTo(24, 48); x.lineTo(46, 34); x.fill(); }); }
function capTex(i) { return ctex(512, 110, (x, w, h) => { x.fillStyle = '#A3E635'; rr(x, 6, 6, 500, 98, 30); x.fill(); x.font = '700 52px SG'; x.fillStyle = '#0B0D0A'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(CAPS[i], 256, 58); }); }
const starShape = (() => { const s = new THREE.Shape(); for (let k = 0; k < 10; k++) { const r = k % 2 ? .1 : .24, a = k * Math.PI / 5 + Math.PI / 2; const f = k ? 'lineTo' : 'moveTo'; s[f](Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); return s; })();
const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: .06, bevelEnabled: true, bevelSize: .02, bevelThickness: .02, bevelSegments: 2 }); starGeo.center();
function makeCard(i, small = false) {
  const g = new THREE.Group(); const inner = new THREE.Group(); g.add(inner);
  const body = new THREE.Mesh(new RoundedBoxGeometry(.6, 1.06, .07, 3, .06), P(0xffffff)); body.position.y = .53; inner.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(.52, .94), new THREE.MeshStandardMaterial({ map: thumbTex(i), roughness: .4 })); face.position.set(0, .53, .037); inner.add(face);
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(.5, .107), new THREE.MeshBasicMaterial({ map: capTex(i % 12), transparent: true, toneMapped: false })); cap.position.set(0, .25, .045); inner.add(cap);
  const star = new THREE.Mesh(starGeo, glow(0xffd166, 1.2)); star.position.set(.2, 1.08, .06); star.scale.setScalar(.8); inner.add(star);
  const border = new THREE.Mesh(new RoundedBoxGeometry(.66, 1.12, .05, 3, .07), glow(LIME, 1.6)); border.position.set(0, .53, -.02); inner.add(border);
  g.userData = { inner, cap, star, border }; shadowAll(g); scene.add(g); return g;
}
const cards = []; for (let i = 0; i < NC; i++) cards.push(makeCard(i));
const stream = []; for (let i = 0; i < STREAM; i++) { const c = makeCard(i % 12); c.scale.setScalar(.55); stream.push(c); }

// coins
const coinGeo = new THREE.CylinderGeometry(.2, .2, .06, 32);
const coinMat = P(0xffc93c, { metalness: .9, roughness: .25, emissive: 0x9a6a00, emissiveIntensity: .35 });
const coins = []; for (let i = 0; i < NCOIN; i++) { const c = new THREE.Mesh(coinGeo, coinMat); c.rotation.x = Math.PI / 2; const b = new THREE.Mesh(boltGeo, glow(0xfff4c2, .6)); b.scale.setScalar(.45); b.rotation.x = -Math.PI / 2; b.position.y = .045; c.add(b); c.castShadow = true; scene.add(c); coins.push(c); }

// confetti
const NCF = 140; const confG = new THREE.PlaneGeometry(.09, .16);
const conf = new THREE.InstancedMesh(confG, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .5, emissive: 0x222222 }), NCF);
{ const r = rnd(77); const cols = [0xA3E635, 0xffd166, 0xff4d8d, 0x7c4dff, 0x4dd4ff, 0xffffff]; conf.userData.p = []; for (let i = 0; i < NCF; i++) { conf.setColorAt(i, new THREE.Color(cols[i % 6])); const a = r() * Math.PI * 2, el = .35 + r() * .9, sp = 4 + r() * 4.5; conf.userData.p.push({ v: V(Math.cos(a) * Math.cos(el) * sp * .8, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp * .6), rs: V(r() * 12 - 6, r() * 12 - 6, r() * 12 - 6), ph: r() * 6 }); } }
conf.frustumCulled = false; scene.add(conf);

// slash trail
const trail = new THREE.Mesh(new THREE.TorusGeometry(.95, .07, 12, 64, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color: 0xd9ff8a, transparent: true, opacity: 0, toneMapped: false })); scene.add(trail);
const sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.07), new THREE.MeshBasicMaterial({ color: 0xfff1a8, toneMapped: false }), 60); sparks.frustumCulled = false; scene.add(sparks);

// ---------------- ROBOT ----------------
const bot = new THREE.Group(); const flip = new THREE.Group(); const rig = new THREE.Group(); bot.add(flip); flip.add(rig); flip.position.y = .8; rig.position.y = -.8;
const white = P(0xf6f7f2, { roughness: .3 });
const torso = new THREE.Mesh(new RoundedBoxGeometry(.9, .75, .75, 5, .3), white); torso.position.y = .62; rig.add(torso);
const belly = new THREE.Mesh(new THREE.CircleGeometry(.15, 32), glow(LIME, 1.4)); belly.position.set(0, .62, .378); rig.add(belly);
const bb = new THREE.Mesh(boltGeo, M(0x0b0d0a)); bb.scale.setScalar(.45); bb.position.set(0, .62, .39); rig.add(bb);
const headG = new THREE.Group(); headG.position.y = .98; rig.add(headG);
const head = new THREE.Mesh(new RoundedBoxGeometry(1.2, .88, .96, 6, .36), white); head.position.y = .45; headG.add(head);
const faceS = new THREE.Mesh(new RoundedBoxGeometry(.96, .6, .08, 4, .22), P(0x0e1116, { roughness: .15 })); faceS.position.set(0, .45, .45); headG.add(faceS);
const eyeMat = glow(LIME, 2.2);
const eyes = [-1, 1].map(s => { const e = new THREE.Mesh(new THREE.CapsuleGeometry(.075, .14, 8, 16), eyeMat); e.position.set(s * .2, .48, .5); headG.add(e); return e; });
const smile = new THREE.Mesh(new THREE.TorusGeometry(.085, .02, 8, 24, Math.PI), eyeMat); smile.rotation.z = Math.PI; smile.position.set(0, .31, .5); headG.add(smile);
const cheekMat = glow(0xff7aa2, .8);
[-1, 1].forEach(s => { const c = new THREE.Mesh(new THREE.CircleGeometry(.06, 20), cheekMat); c.position.set(s * .33, .35, .495); headG.add(c); });
const antG = new THREE.Group(); antG.position.y = .9; headG.add(antG);
const stick = new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, .3, 10), M(0x9aa09a, { metalness: .7, roughness: .3 })); stick.position.y = .15; antG.add(stick);
const tipMat = glow(LIME, 2.5); const tip = new THREE.Mesh(boltGeo, tipMat); tip.scale.setScalar(.7); tip.position.y = .42; antG.add(tip);
const armG = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * .5, .8, 0); const a = new THREE.Mesh(new THREE.CapsuleGeometry(.1, .26, 6, 12), white); a.position.y = -.2; g.add(a); const h = new THREE.Mesh(new THREE.SphereGeometry(.13, 20, 12), M(0x2a2f26, { roughness: .4 })); h.position.y = -.42; g.add(h); rig.add(g); return g; });
[-1, 1].forEach(s => { const f = new THREE.Mesh(new RoundedBoxGeometry(.32, .18, .44, 3, .08), M(0x2a2f26, { roughness: .4 })); f.position.set(s * .22, .09, .04); rig.add(f); });
const eyeLight = { intensity: 0 };
shadowAll(bot); scene.add(bot);

// ---------------- camera path (critically damped spring over keys) ----------------
const CK = [
  [0, [2, 9.5, 20], [3, 1.5, 0]], [3.0, [2, 9.5, 20], [3, 1.5, 0]],
  [7.6, [-2.8, 3.2, 8.6], [-.6, 1.0, -1]], [9.6, [-1.1, 1.9, 4.7], [-1.0, 1.2, .4]],
  [12.6, [-.5, 2.0, 5.0], [-.6, 1.25, .3]], [15.2, [4.4, 2.6, 8.4], [6.8, 1.3, 0]],
  [22.5, [7.0, 2.7, 8.6], [8.0, 1.5, 0]], [25.8, [6.8, 3.4, 10.4], [7.8, 1.7, 0]],
  [27.8, [4.6, 2.6, 9.9], [4.6, 1.0, .9]], [33.4, [4.9, 2.7, 10.2], [4.9, 1.0, .9]],
  [35.6, [4.8, 4.2, 12.8], [5.4, 1.9, -1.8]], [42.6, [4.0, 4.6, 13.4], [4.3, 1.9, -1.8]],
  [45.0, [1.2, 2.7, 7.4], [.4, 1.0, -.8]], [49.0, [1.9, 2.5, 7.4], [1.3, 1.1, .2]],
  [51.6, [2.3, 2.3, 7.8], [2.2, 1.4, 1.2]], [54.6, [3.7, 1.75, 7.4], [3.55, 1.15, 1.8]], [60, [3.6, 1.7, 7.0], [3.45, 1.15, 1.8]],
];
function keyAt(t, idx) { let i = 0; while (i < CK.length - 2 && t > CK[i + 1][0]) i++; const a = CK[i], b = CK[i + 1]; const u = eio(seg(t, a[0], b[0])); return a[idx].map((v, k) => lerp(v, b[idx][k], u)); }
const CAMH = 240, camP = [], camT = [];
{ let p = keyAt(0, 1), q = keyAt(0, 2), vp = [0, 0, 0], vq = [0, 0, 0]; const w = 4.2, dt = 1 / CAMH;
  for (let n = 0; n <= 61 * CAMH; n++) { const t = n * dt; const kp = keyAt(t, 1), kq = keyAt(t, 2);
    for (let k = 0; k < 3; k++) { const ap = w * w * (kp[k] - p[k]) - 2 * w * vp[k]; vp[k] += ap * dt; p[k] += vp[k] * dt; const aq = w * w * (kq[k] - q[k]) - 2 * w * vq[k]; vq[k] += aq * dt; q[k] += vq[k] * dt; }
    camP.push([...p]); camT.push([...q]); } }
function camAt(t) { const f = t * CAMH, i = Math.floor(f), u = f - i; const a = camP[i], b = camP[i + 1] || a, c = camT[i], d = camT[i + 1] || c; return [a.map((v, k) => lerp(v, b[k], u)), c.map((v, k) => lerp(v, d[k], u))]; }

// ---------------- robot choreography ----------------
const BLINKS = [11.3, 14.1, 19.9, 27.2, 31.2, 36.9, 44.1, 48.3, 53.0, 56.3, 58.6];
function hopY(u, h) { return 4 * h * u * (1 - u); }
function botPose(t) {
  const P0 = V(-1, 0, .45);
  let pos = P0.clone(), rotY = 0, sq = 0, flipX = 0, armL = .12, armR = .12, headX = 0, headY = 0, headZ = 0, look = [0, 0], eyesOn = 1, happy = 0, tipOn = 1, spinT = 0;
  // powered down & boot
  if (t < T.bootStart + 1.5) {
    const up = eback(seg(t, 10.9, 11.4));
    headX = lerp(.42, 0, up); headZ = lerp(.12, 0, up);
    armL = armR = lerp(-.05, .12, up); sq = lerp(.08, 0, up);
    const fl = t < 10.4 ? 0 : t < 10.9 ? (Math.sin(t * 90) > 0 ? 1 : .15) * seg(t, 10.4, 10.9) + .1 : 1;
    eyesOn = fl; tipOn = t < 10 ? 0 : t < 10.35 ? (Math.sin(t * 70) > .2 ? 1 : 0) : 1;
  }
  if (t >= 11.6 && t < 13.2) look = [0, .02];
  // happy hop at 12.3
  { const u = seg(t, 12.3, 12.85); if (u > 0 && u < 1) pos.y = hopY(u, .45); sq += .22 * bump(t, 12.25, .07) + .2 * bump(t, 12.87, .06) - .12 * Math.sin(Math.PI * u) * (u > 0 && u < 1); armL += .9 * Math.sin(Math.PI * u); armR += .9 * Math.sin(Math.PI * u); happy = Math.max(happy, Math.sin(Math.PI * seg(t, 12.2, 13.2))); }
  // turn right
  rotY = lerp(0, Math.PI / 2, eio(seg(t, 13.1, 13.5)));
  // hops to x=6.4
  if (t >= T.hopStart) {
    const n = 6, dur = (T.hopEnd - T.hopStart) / n; const k = Math.min(n - 1, Math.floor((t - T.hopStart) / dur)); const u = t >= T.hopEnd ? 1 : ((t - T.hopStart) - k * dur) / dur;
    const x0 = lerp(-1, 6.4, k / n), x1 = lerp(-1, 6.4, (k + 1) / n);
    pos.x = lerp(x0, x1, eio(u)); pos.y = t < T.hopEnd ? hopY(u, .5) : 0; pos.z = lerp(.45, 0, seg(t, T.hopStart, T.hopEnd));
    if (t < T.hopEnd + .2) { sq += .2 * (bump(u, 0, .09) + bump(u, 1, .09)) - .12 * Math.sin(Math.PI * u); armL += .5 * Math.sin(Math.PI * u); armR += .5 * Math.sin(Math.PI * u); }
  }
  // slashes
  T.slashes.forEach((s, k) => {
    const tau = t - s; if (tau < 0 || tau > 1.5) return;
    const xa = 6.4 + (k ? .2 : 0), xb = 8.0, xc = 6.6;
    if (tau < .25) { sq += .25 * sm(tau / .25); armR += .5 * sm(tau / .25); }
    else if (tau < .7) { const u = (tau - .25) / .45; pos.x = lerp(xa, xb, eo(u)); pos.y = 1.7 * Math.sin(Math.PI * .5 * Math.min(1, u * 1.4)) ; sq -= .18 * (1 - u); armR = 2.6; armL = .8; spinT = sm(seg(tau, .38, .7)); }
    else if (tau < 1.1) { const u = (tau - .7) / .4; pos.x = lerp(xb, xc, sm(u)); pos.y = 1.7 * (1 - u * u); armR = lerp(2.6, .3, u); armL = .6; }
    else { pos.x = xc; sq += .25 * bump(tau, 1.12, .06); }
    rotY += spinT * Math.PI * 2;
  });
  if (t >= T.slashes[0] && t < T.flurry) { if (pos.x < 6.4) pos.x = Math.max(pos.x, 6.4); }
  if (t >= T.slashes[0] + 1.1 && t < T.flurry) { let busy = T.slashes.some(s => t - s > 0 && t - s < 1.1); if (!busy) pos.x = 6.6; }
  // flurry
  if (t >= T.flurry && t < 26.4) {
    const u1 = seg(t, T.flurry, T.flurry + .3), u2 = seg(t, 25.7, 26.1);
    pos.x = lerp(lerp(6.6, 7.6, eo(u1)), 7.2, u2); pos.y = lerp(2.2 * eo(u1), 0, u2 * u2);
    rotY = Math.PI / 2 + (t < 25.7 ? (t - T.flurry) * 32 : 0) + (t >= 25.7 ? 0 : 0);
    armR = 2.4; armL = 2.4; sq -= .1 * (1 - u2);
    if (t >= 26.1) { sq += .25 * bump(t, 26.12, .06); armR = armL = .2; }
  }
  if (t >= 26.1 && t < 27.0) { pos.x = 7.2; rotY = lerp(Math.PI / 2, 0, eio(seg(t, 26.3, 26.6))); const c = Math.sin(Math.PI * seg(t, 26.55, 27.0)); armL = armR = .2 + 2.4 * c; happy = c; }
  // hops left to x=1.2,z=1.6
  if (t >= 27.0 && t < 28.3) {
    const n = 3, u0 = seg(t, 27.1, 28.1), k = Math.min(n - 1, Math.floor(u0 * n)), u = u0 >= 1 ? 1 : u0 * n - k;
    pos.x = lerp(lerp(7.2, 1.2, k / n), lerp(7.2, 1.2, (k + 1) / n), eio(u)); pos.z = lerp(0, 1.6, u0); pos.y = u0 < 1 ? hopY(u, .55) : 0;
    rotY = u0 < 1 ? lerp(0, -Math.PI / 2, eio(seg(t, 27.0, 27.2))) : lerp(-Math.PI / 2, .35, eio(seg(t, 28.1, 28.35)));
    sq += .2 * (bump(u, 0, .09) + bump(u, 1, .09)) * (u0 < 1) - .1 * Math.sin(Math.PI * u) * (u0 < 1);
  }
  if (t >= 28.3) { pos.set(1.2, 0, 1.6); rotY = .35; }
  // wand / power-ups
  if (t >= 28.3 && t < 34.0) { const r = sm(seg(t, 28.4, 28.75)) * (1 - sm(seg(t, 33.4, 33.9))); armR = .12 + 2.5 * r + .15 * Math.sin(t * 9) * r; happy = .5 * r; look = [.05, .03]; headY = .25; }
  // launching & night stream
  if (t >= 34.0 && t < 43.3) {
    rotY = .55; headY = .35; look = [.05, .05];
    let sw = 0; for (let i = 0; i < NC; i++) { const d = t - (cardLaunch(i) - .15); if (d > 0 && d < .45) sw = Math.max(sw, Math.sin(Math.PI * d / .45)); }
    for (let k = 0; k < STREAM; k++) { const d = t - (streamT(k) - .1); if (d > 0 && d < .3) sw = Math.max(sw, .7 * Math.sin(Math.PI * d / .3)); }
    armR = .2 + 2.2 * sw; armL = .2 + .4 * sw; sq += .05 * sw; pos.y = 0;
  }
  // coins: bob & look at chest
  if (t >= 43.3 && t < 49.2) { rotY = lerp(.55, -.35, eio(seg(t, 43.3, 43.8))); look = [-.06, .02]; headY = -.2; happy = sm(seg(t, 45, 46)); const b = Math.max(0, Math.sin((t - 44.6) * 6)) * seg(t, 44.6, 45); pos.y = .12 * b; armL = armR = .2 + .8 * b; }
  // move to center & level complete
  if (t >= 49.2) {
    const u = seg(t, 49.2, 49.9); pos.x = lerp(1.2, 2.2, eio(u)); pos.z = lerp(1.6, 1.8, u); pos.y = u < 1 ? hopY(u, .4) : 0; rotY = lerp(-.35, 0, eio(u));
    const f = seg(t, 50.5, 51.5); if (f > 0 && f < 1) { pos.y = hopY(f, 2.0); flipX = -eio(seg(t, 50.65, 51.35)) * Math.PI * 2; armL = armR = 2.6; }
    sq += .28 * bump(t, 50.45, .07) + .3 * bump(t, 51.52, .06) - .15 * Math.sin(Math.PI * f) * (f > 0 && f < 1);
    if (t > 51.6 && t < 54.4) { const d = t - 51.6; pos.y = Math.abs(Math.sin(d * 5.2)) * .18; headZ = .15 * Math.sin(d * 5.2); armL = 1.6 + .8 * Math.sin(d * 10.4); armR = 1.6 - .8 * Math.sin(d * 10.4); happy = 1; sq += .06 * Math.cos(d * 10.4); }
  }
  // end card wave
  if (t >= 54.4) { const w = sm(seg(t, 54.9, 55.3)) * (1 - sm(seg(t, 58.4, 58.9))); armR = .12 + (2.5 + .35 * Math.sin((t - 54.9) * 11)) * w; headZ = -.08 * w + .04 * Math.sin(t * 1.3); happy = .8; look = [.02, .02]; }
  // blinks
  let blink = 0; BLINKS.forEach(b => blink = Math.max(blink, bump(t, b, .06)));
  return { pos, rotY, sq, flipX, armL, armR, headX, headY, headZ, look, eyesOn, blink, happy, tipOn };
}

// antenna secondary motion: spring driven by bot vertical accel & rotation, precomputed
const ANTH = 240; const antA = [];
{ let a = 0, v = 0, ax = 0, vx = 0, py = 0, vy = 0, pr = 0; const dt = 1 / ANTH;
  for (let n = 0; n <= 61 * ANTH; n++) { const t = n * dt; const p = botPose(t); const y = p.pos.y - p.sq * .6; const ny = (y - py) / dt; const accY = (ny - vy) / dt; vy = ny; py = y;
    const rv = (p.rotY - pr) / dt; pr = p.rotY;
    const force = -accY * .0025 + rv * .02; v += (-160 * a - 9 * v + force * 60) * dt; a += v * dt; a = clamp(a, -.9, .9);
    vx += (-120 * ax - 8 * vx + (-p.pos.x + (antA.length ? antA[antA.length - 1].px : p.pos.x)) * 400) * dt; ax += vx * dt; ax = clamp(ax, -.6, .6);
    antA.push({ a, ax, px: p.pos.x }); } }

// ---------------- DOM refs ----------------
const $ = id => document.getElementById(id);
const hud = $('hud'), bossBox = $('boss'), bossFill = $('bossfill'), bossTime = $('bosstime'), capEl = $('cap'), banner = $('banner'), title = $('title'), press = $('press'), flash = $('flash'), endEl = $('end'), popsEl = $('pops');
{ const wm = $('wmimg'); const draw = () => { const c = $('wm').getContext('2d'); c.drawImage(wm, 235, 40, 740, 210, 0, 0, 760, 216); }; if (wm.complete) draw(); else wm.onload = draw; }
// title stars
{ const r = rnd(4); for (let i = 0; i < 70; i++) { const s = document.createElement('div'); s.className = 'star'; s.style.left = (r() * 1920) + 'px'; s.style.top = (r() * 1080) + 'px'; s.dataset.ph = r() * 6; s.dataset.sp = .5 + r() * 2; title.appendChild(s); } }
const CAPTIONS = [
  [3.9, 8.7, 'Every creator has the same *final* *boss.*'],
  [9.7, 11.9, 'Meet *Vello.*', 'big'],
  [12.0, 13.9, 'your AI clipping agent.'],
  [14.2, 17.7, 'It watches the whole 3-hour episode…'],
  [17.9, 23.7, '…and cuts every moment that *hits.*'],
  [24.2, 27.3, '12 clips. *Zero* editing.'],
  [28.6, 33.9, 'Captions. Hooks. Reframes. *Automatic.*'],
  [34.5, 38.9, 'Posted to TikTok, Reels & Shorts.'],
  [39.4, 43.4, 'Every day. *Even* *while* *you* *sleep.*'],
  [44.3, 49.7, 'Payouts land in your wallet. *Settled* *on* *Solana.*'],
];
const capWords = {};
function setCaption(t) {
  let html = '', cls = '';
  for (const [s, e, txt, c] of CAPTIONS) {
    if (t < s - .01 || t > e + .01) continue; cls = c || '';
    const words = txt.split(' ');
    const out = sm(seg(t, e - .35, e));
    html = words.map((w, i) => { const em = w.startsWith('*'); const ww = w.replace(/\*/g, ''); const u = eback(seg(t, s + i * .06, s + i * .06 + .42)); const op = seg(t, s + i * .06, s + i * .06 + .2) * (1 - out); const y = (1 - u) * 60 + out * -30; const sc = .6 + .4 * u; return `<span class="w${em ? ' e' : ''}" style="opacity:${op};transform:translateY(${y}px) scale(${sc})">${ww}</span>`; }).join(' ');
  }
  capEl.className = cls; capEl.innerHTML = html;
}
function setBanner(t) {
  const s = T.level, e = 53.9; if (t < s || t > e) { banner.innerHTML = ''; return; }
  const txt = 'LEVEL COMPLETE'; const out = sm(seg(t, e - .4, e));
  banner.innerHTML = txt.split('').map((ch, i) => { const u = eel(seg(t, s + i * .045, s + i * .045 + .8)); const y = (1 - u) * -160 + Math.sin((t - s) * 6 + i * .5) * 6 * seg(t, s + 1.2, s + 1.6); return `<span class="l" style="opacity:${(u > 0 ? 1 : 0) * (1 - out)};transform:translateY(${y}px)">${ch === ' ' ? '&nbsp;' : ch}</span>`; }).join('');
}
function pad(n, k) { return String(Math.floor(n)).padStart(k, '0'); }
function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }
// views: sum of arrivals
const ARR = []; { const r = rnd(11); for (let i = 0; i < NC; i++) ARR.push([cardLaunch(i) + .9, 22000 + r() * 90000]); for (let k = 0; k < STREAM; k++) ARR.push([streamT(k) + .75, 14000 + r() * 60000]); }
const vproj = new THREE.Vector3();
function toScreen(p) { vproj.copy(p).project(camera); return [(vproj.x * .5 + .5) * 1920, (-vproj.y * .5 + .5) * 1080]; }

// ---------------- per-frame update ----------------
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), s4 = new THREE.Vector3();
function update(t) {
  // time of day
  const night = sm(seg(t, T.night0, T.night1)) * (1 - sm(seg(t, T.day0, T.day1)));
  const dawn = bump(t, 44.6, 1.2);
  const endM = sm(seg(t, T.end0, T.end0 + 1.3));
  const dayTop = new THREE.Color(0x3fa9ff), nightTop = new THREE.Color(0x0b1236), dawnTop = new THREE.Color(0x7aa8ff);
  const dayBot = new THREE.Color(0xcdeeff), nightBot = new THREE.Color(0x2a2358), dawnBot = new THREE.Color(0xffb38a);
  const endC = new THREE.Color(0x0B0D0A);
  skyU.top.value.copy(dayTop).lerp(nightTop, night).lerp(dawnTop, dawn * .5).lerp(endC, endM);
  skyU.bot.value.copy(dayBot).lerp(nightBot, night).lerp(dawnBot, dawn * .7).lerp(endC, endM);
  skyU.stars.value = night; skyU.sunAmt.value = (1 - night) * (1 - endM);
  moon.visible = night > .01; moon.material.emissiveIntensity = 1.4 * night;
  sun.intensity = lerp(2.6, .35, night) * (1 - endM * .75); sun.color.set(0xfff0d8).lerp(new THREE.Color(0x9db4ff), night).lerp(new THREE.Color(0xffc49a), dawn * .6);
  hemi.intensity = lerp(1.3, .45, night) * (1 - endM * .7); hemi.color.set(0xcdeeff).lerp(new THREE.Color(0x4a5ab0), night);
  scene.environmentIntensity = lerp(1.0, .35, night);
  scene.fog.color.set(0xcfe9ff).lerp(new THREE.Color(0x1a1f45), night).lerp(endC, endM);
  scene.fog.near = lerp(30, 6.2, endM); scene.fog.far = lerp(70, 11.5, endM);
  rim.intensity = 2.2 * endM + .6 * night;
  bloom.strength = .22 + .3 * night + .1 * endM;
  // clouds / trees sway
  clouds.forEach((c, i) => { c.position.x = -14 + i * 6.5 + t * c.userData.sp; });
  trees.forEach((g, i) => { g.rotation.z = .025 * Math.sin(t * 1.3 + i); });
  // house window & zzz
  const winOn = 1 - sm(seg(t, 39.7, 40.0)) * (1 - sm(seg(t, 45.4, 45.7)));
  house.userData.win.material.emissiveIntensity = .15 + 1.1 * winOn; winLight.intensity = (8 * night) * winOn; winLight.visible = night > .02 && winOn > .02;
  zzz.forEach((z, i) => { const ph = ((t - 40.2) / 1.8 + i / 3) % 1; const on = t > 40.2 && t < 44.0; z.visible = on && ph > 0; const hp = V(-1.6, 3.0, -2.6); z.position.set(hp.x + ph * .9 + Math.sin(ph * 6) * .15, hp.y + ph * 1.6, hp.z); z.scale.setScalar(.3 + ph * .5); z.material.opacity = Math.sin(Math.PI * ph) * seg(t, 40.2, 40.6) * (1 - seg(t, 43.5, 44)); });

  // BOSS
  let hp = 1, shake = 0;
  T.slashes.forEach((s, k) => { if (t > s + .6) hp -= .12; shake = Math.max(shake, bump(t, s + .72, .12)); });
  for (let i = 4; i < NC; i++) { if (t > cardBirth(i)) hp -= .52 / 8; shake = Math.max(shake, .6 * bump(t, cardBirth(i) + .05, .08)); }
  hp = clamp(hp, 0, 1);
  const breathe = Math.sin(t * 2.2) * .02;
  const poofU = seg(t, T.poof, T.poof + .45);
  bossRig.scale.set(1 - breathe * .5 + .25 * Math.sin(Math.PI * poofU), 1 + breathe - .35 * Math.sin(Math.PI * poofU), 1);
  boss.scale.setScalar(1 - eo(seg(t, T.poof + .25, T.poof + .5)));
  boss.visible = t < T.poof + .5;
  bossRig.position.x = Math.sin(t * 70) * .08 * shake; bossRig.rotation.z = Math.sin(t * 50) * .05 * shake;
  bossScreenMat.emissiveIntensity = .9 + 2.5 * shake;
  puffs.forEach((p, i) => { const r = rnd(100 + i); const u = seg(t, T.poof + .3, T.poof + 1.5); p.visible = u > 0 && u < 1; const a = r() * Math.PI * 2, el = r() * 1.2; p.position.set(BOSS.x + Math.cos(a) * 2.2 * eo(u), 1.2 + Math.sin(el) * 2.5 * eo(u) + r() * .8, BOSS.z + Math.sin(a) * 1.4 * eo(u)); p.scale.setScalar((.5 + r() * .8) * Math.sin(Math.PI * Math.min(1, u * 1.3)) + .01); p.material.opacity = 1 - u; });

  // CARDS
  let clipsN = 0;
  cards.forEach((c, i) => {
    const b = cardBirth(i), L = cardLaunch(i), ud = c.userData;
    c.visible = t >= b && t < L + .95;
    if (!c.visible) return; clipsN++;
    const from = i < 4 ? V(BOSS.x - .6, 1.9, BOSS.z + .7) : V(BOSS.x + (i % 3 - 1) * .8, 2.4, BOSS.z + .4);
    const slot = cardSlot(i);
    const fu = seg(t, b, b + .85);
    let p, ry = 0, sq = 0, s = 1;
    if (fu < 1) { p = arc(from, slot, 2.2 + (i % 3) * .5, eo(fu) * .15 + fu * .85); ry = (1 - fu) * Math.PI * 3; s = .3 + .7 * eo(Math.min(1, fu * 2)); }
    else { p = slot.clone(); const d = t - (b + .85); sq = .25 * Math.exp(-d * 7) * Math.cos(d * 26); p.y = Math.max(0, .35 * Math.exp(-d * 6) * Math.abs(Math.sin(d * 12)) * 0); }
    // idle wobble
    ry += .08 * Math.sin(t * 1.7 + i) * (fu >= 1);
    // power-ups
    const cu = eback(seg(t, T.powerCap + i * .15, T.powerCap + i * .15 + .35));
    ud.cap.scale.set(Math.max(.001, cu), Math.max(.001, cu), 1);
    const hu = eel(seg(t, T.powerHook + i * .13, T.powerHook + i * .13 + .7));
    ud.star.scale.setScalar(Math.max(.001, .8 * hu)); ud.star.rotation.z = t * 2 + i;
    const rf = seg(t, T.powerRef + i * .1, T.powerRef + i * .1 + .55);
    ry += eio(rf) * Math.PI * 2; ud.border.scale.setScalar(Math.max(.001, eback(rf)));
    if (rf > 0 && rf < 1) p.y += .35 * Math.sin(Math.PI * rf);
    // launch
    const lu = seg(t, L, L + .9);
    if (lu > 0) { const pr = PORT[i % 3]; const start = slot; p = arc(start, V(pr.x, pr.y - .5, pr.z + .05), 1.6, eio(lu)); ry = lu * Math.PI * 4; s = 1 - sm(seg(lu, .72, 1)); sq = -.15 * Math.sin(Math.PI * lu); }
    c.position.copy(p); c.rotation.y = ry; c.scale.setScalar(Math.max(.001, s)); ud.inner.scale.set(1 + sq * .5, 1 - sq, 1);
  });
  let streamActive = 0;
  stream.forEach((c, k) => { const st = streamT(k); const lu = seg(t, st, st + .75); c.visible = lu > 0 && lu < 1; if (!c.visible) return; streamActive++; const pr = PORT[k % 3]; const p = arc(V(1.5, 1.2, 1.7), V(pr.x, pr.y - .3, pr.z + .05), 1.3, eio(lu)); c.position.copy(p); c.rotation.y = lu * Math.PI * 3; c.scale.setScalar(.55 * (1 - sm(seg(lu, .7, 1))) + .001); c.userData.cap.scale.setScalar(1); c.userData.star.scale.setScalar(.8); c.userData.border.scale.setScalar(1); });
  // portals
  const pShow = eback(seg(t, 33.9, 34.5)) * (1 - eo(seg(t, 48.8, 49.4)));
  portals.forEach((g, i) => {
    let recv = 0; ARR.forEach(([ta], j) => { const pi = j < NC ? j % 3 : (j - NC) % 3; if (pi === i) recv = Math.max(recv, bump(t, ta, .12)); });
    const s = Math.max(.001, pShow * (1 + .18 * recv)); g.scale.setScalar(s); g.visible = pShow > .002; g.userData.disc.rotation.z = -t * 3;
    g.userData.pl.intensity = (4 + 10 * recv) * pShow * (.5 + night); g.userData.ring.material.emissiveIntensity = .7 + 2 * recv + .8 * night;
    // coin emission bump
  });
  // views
  let views = 0; ARR.forEach(([ta, v]) => { if (t > ta) views += v; else views += v * sm(seg(t, ta - .01, ta)); });
  // coins
  let wallet = 0;
  coins.forEach((c, k) => { const st = coinT(k); const u = seg(t, st, st + .95); c.visible = u > 0 && u < 1; if (u >= 1) wallet++; if (!c.visible) return; const pr = PORT[k % 3]; const p = arc(V(pr.x, pr.y, pr.z + .3), V(CHEST.x, .75, CHEST.z + .05), 2.2 + (k % 4) * .3, eio(u)); c.position.copy(p); c.rotation.set(Math.PI / 2 + u * 9, u * 7 + k, 0); c.scale.setScalar(1 - sm(seg(u, .85, 1)) + .001); });
  lid.rotation.x = -eback(seg(t, 44.0, 44.5)) * 1.9 * (1 - eio(seg(t, 49.0, 49.4)));
  chestLight.intensity = 8 * sm(seg(t, 44.3, 44.8)) * (1 - seg(t, 49.0, 49.5)) + 3 * bump(t, 49.2, .15);
  chestLight.visible = chestLight.intensity > .05;
  chest.scale.setScalar(1 + .06 * Math.max(...coins.map((_, k) => bump(t, coinT(k) + .95, .06))));
  // confetti
  { const t0 = 51.0, d = t - t0; conf.visible = d > 0 && d < 3.5; if (conf.visible) { const o = V(2.2, 2.2, 1.8); conf.userData.p.forEach((p, i) => { const drag = 1 - Math.exp(-d * 1.6); const x = o.x + p.v.x * drag / 1.6, y = o.y + p.v.y * drag / 1.6 - 2.2 * d * d * .5 + Math.sin(d * 4 + p.ph) * .1, z = o.z + p.v.z * drag / 1.6; e4.set(p.rs.x * d + p.ph, p.rs.y * d, p.rs.z * d); q4.setFromEuler(e4); s4.setScalar(1 - seg(d, 2.8, 3.5)); m4.compose(V(x, Math.max(y, .02), z), q4, s4); conf.setMatrixAt(i, m4); }); conf.instanceMatrix.needsUpdate = true; } }

  // ROBOT
  const P_ = botPose(t);
  bot.position.copy(P_.pos); bot.rotation.y = P_.rotY; flip.rotation.x = P_.flipX;
  rig.scale.set(1 + P_.sq * .45, 1 - P_.sq, 1 + P_.sq * .45);
  headG.rotation.set(P_.headX, P_.headY, P_.headZ);
  armG[0].rotation.z = -P_.armL; armG[1].rotation.z = P_.armR;
  const eb = Math.max(.08, 1 - P_.blink) * (P_.happy > .6 ? .55 : 1);
  eyes.forEach((e, i) => { e.scale.set(1, eb, 1); e.position.x = (i ? .2 : -.2) + P_.look[0]; e.position.y = .48 + P_.look[1]; });
  eyeMat.emissiveIntensity = 2.2 * P_.eyesOn; smile.scale.setScalar(.8 + .5 * P_.happy); smile.material = eyeMat;
  tipMat.emissiveIntensity = .2 + 2.6 * P_.tipOn; belly.material.emissiveIntensity = .2 + 1.2 * P_.tipOn;
  eyeLight.intensity = 1.5 * P_.eyesOn;
  const aa = antA[Math.min(antA.length - 1, Math.round(t * ANTH))]; antG.rotation.z = aa.a + (t < 10.9 ? .5 : 0); antG.rotation.x = aa.ax * .6;
  // slash trail + sparks
  let tr = 0, trRot = 0;
  T.slashes.forEach(s => { const tau = t - s; if (tau > .38 && tau < .85) { tr = Math.max(tr, Math.sin(Math.PI * seg(tau, .38, .85))); trRot = tau * 14; } });
  if (t > T.flurry + .2 && t < 25.8) { tr = .9; trRot = t * 30; }
  trail.material.opacity = tr; trail.visible = tr > .01; trail.position.set(P_.pos.x, P_.pos.y + .95, P_.pos.z); trail.rotation.set(Math.PI / 2 + .3, 0, trRot); trail.scale.setScalar(1 + .3 * tr);
  // sparks on hits
  { let n = 0; const hits = [...T.slashes.map(s => s + .6), ...Array.from({ length: 8 }, (_, k) => cardBirth(4 + k))];
    hits.forEach((h, hi) => { const d = t - h; if (d < 0 || d > .6) return; const r = rnd(500 + hi); for (let j = 0; j < 6 && n < 60; j++) { const a = r() * 6.28, el = r() * 2 - .5, sp = 3 + r() * 3; e4.set(d * 10, d * 7, 0); q4.setFromEuler(e4); s4.setScalar((1 - d / .6) * 1.2); m4.compose(V(BOSS.x - 1.2 + Math.cos(a) * sp * d, 2 + Math.sin(el) * sp * d - 4 * d * d, BOSS.z + .8 + Math.sin(a) * sp * d * .5), q4, s4); sparks.setMatrixAt(n++, m4); } });
    sparks.count = n; sparks.instanceMatrix.needsUpdate = true; }

  // CAMERA
  const [cp, ct] = camAt(t);
  let sh = 0; T.slashes.forEach(s => sh = Math.max(sh, bump(t, s + .62, .1))); sh = Math.max(sh, .8 * bump(t, T.poof + .35, .15), .5 * bump(t, 51.52, .08));
  camera.position.set(cp[0] + Math.sin(t * 61) * .06 * sh + Math.sin(t * .7) * .03, cp[1] + Math.sin(t * 53) * .05 * sh + Math.sin(t * .9) * .02, cp[2]);
  camera.lookAt(ct[0], ct[1], ct[2]);
  camera.fov = t < 3.2 ? 38 : 38; camera.updateProjectionMatrix();

  // HUD
  const hudOn = sm(seg(t, 3.6, 4.2)) * (1 - sm(seg(t, 53.9, 54.4)));
  hud.style.opacity = hudOn;
  const bossOn = sm(seg(t, 14.0, 14.5)) * (1 - sm(seg(t, 26.2, 26.7)));
  bossBox.style.opacity = bossOn; bossBox.style.transform = `translateX(-50%) translateY(${(1 - bossOn) * -30}px)`;
  const secs = Math.round(11528 * hp); bossTime.textContent = `${Math.floor(secs / 3600)}:${pad((secs % 3600) / 60, 2)}:${pad(secs % 60, 2)}`;
  bossFill.style.width = (hp * 100) + '%';
  let born = 0; for (let i = 0; i < NC; i++) if (t >= cardBirth(i)) born++;
  let streamed = 0; for (let k = 0; k < STREAM; k++) if (t >= streamT(k)) streamed++;
  $('clips').textContent = pad(born + streamed, 2);
  $('views').textContent = fmt(views).padStart(9, ' ');
  $('walletrow').style.opacity = sm(seg(t, 44.2, 44.6)); $('wallet').textContent = pad(wallet * 7, 3);
  // score pops
  let ph = '';
  cards.forEach((c, i) => { const b = cardBirth(i); const d = t - b; if (d > 0 && d < .9) { const [x, y] = toScreen(V(BOSS.x - .8, 3.2, BOSS.z)); ph += `<div class="pop" style="left:${x - 40 + (i % 3) * 30}px;top:${y - d * 90}px;opacity:${1 - seg(d, .6, .9)}">+1 CLIP</div>`; } });
  ARR.forEach(([ta, v], j) => { const d = t - ta; if (d > 0 && d < .9 && j % 2 === 0) { const pi = j < NC ? j % 3 : (j - NC) % 3; const [x, y] = toScreen(V(PORT[pi].x, PORT[pi].y + 1.9, PORT[pi].z)); ph += `<div class="pop" style="left:${x - 70}px;top:${y - d * 80}px;opacity:${1 - seg(d, .6, .9)};color:#fff">+${Math.round(v / 1000)}K VIEWS</div>`; } });
  popsEl.innerHTML = ph;
  setCaption(t); setBanner(t);
  // title & flash
  title.style.opacity = 1; const R = t < T.wipe ? 0 : Math.pow(seg(t, T.wipe, T.wipe + .8), 2) * 1300;
  title.style.webkitMaskImage = title.style.maskImage = t < T.wipe ? 'none' : `radial-gradient(circle at 50% 50%, transparent ${R}px, #000 ${R + 2}px)`;
  title.style.display = t > T.wipe + .85 ? 'none' : 'flex';
  press.style.opacity = t < 2.4 ? (Math.floor(t * 2.5) % 2 ? .25 : 1) : (Math.floor(t * 14) % 2 ? .2 : 1);
  title.querySelectorAll('.star').forEach(s => { s.style.opacity = .3 + .7 * Math.abs(Math.sin(t * s.dataset.sp + +s.dataset.ph)); });
  title.querySelector('.t1').style.transform = `translateY(${(1 - eback(seg(t, .1, .8))) * -300}px) scale(${1 + .04 * Math.sin(t * 3)})`;
  title.querySelector('.t2').style.opacity = seg(t, .6, .9);
  flash.style.opacity = .85 * bump(t, 2.95, .08) + .9 * bump(t, T.level, .06) * 0 + .35 * bump(t, T.poof + .35, .06);
  // end card
  endEl.style.opacity = sm(seg(t, 54.9, 55.6));
  endEl.querySelector('.wm').style.transform = `translateX(${(1 - eo(seg(t, 54.9, 55.7))) * 60}px)`;
  endEl.querySelector('.tag').style.transform = `translateY(${(1 - eo(seg(t, 55.5, 56.2))) * 40}px)`; endEl.querySelector('.tag').style.opacity = seg(t, 55.5, 56.0);
  endEl.querySelector('.url').style.opacity = seg(t, 56.3, 56.8);
  const cu = eback(seg(t, 57.0, 57.5)); endEl.querySelector('.cta').style.transform = `scale(${cu})`; endEl.querySelector('.cta').style.opacity = cu > 0 ? 1 : 0;
  $('vign').style.opacity = 1;
}

window.renderAt = t => { update(t); composer.render(); renderer.getContext().finish(); return true; };
window.info = () => { renderer.info.autoReset = false; renderer.info.reset(); composer.render(); return JSON.stringify({calls: renderer.info.render.calls, tris: renderer.info.render.triangles, progs: renderer.info.programs.length}); };
window.prof = (t, flags) => { update(t); if (flags.includes('noshadow')) renderer.shadowMap.enabled = false; if (flags.includes('noenv')) scene.environment = null; if (flags.includes('nopost')) { renderer.render(scene, camera); } else composer.render(); const g = renderer.getContext(); const px = new Uint8Array(4); g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,px); renderer.shadowMap.enabled = true; return 1; };
window.events = () => {
  const ev = [];
  ev.push(['start', 2.95]); ev.push(['wipe', T.wipe]);
  ev.push(['boot', 10.0]); ev.push(['eyes', 10.45]); ev.push(['blink', 11.3]); ev.push(['hop', 12.3]); ev.push(['land', 12.87]);
  for (let k = 0; k < 6; k++) { ev.push(['hop', T.hopStart + k * .5]); ev.push(['land', T.hopStart + (k + 1) * .5]); }
  T.slashes.forEach(s => { ev.push(['jump', s + .25]); ev.push(['slash', s + .45]); ev.push(['hit', s + .6]); ev.push(['land', s + 1.1]); });
  ev.push(['jump', T.flurry]); ev.push(['spin', T.flurry + .25]);
  for (let i = 4; i < NC; i++) ev.push(['hit', cardBirth(i)]);
  for (let i = 0; i < NC; i++) ev.push(['cardland', cardBirth(i) + .85]);
  ev.push(['poof', T.poof + .3]); ev.push(['land', 26.12]); ev.push(['cheer', 26.6]);
  for (let k = 0; k < 3; k++) { ev.push(['hop', 27.1 + k / 3]); }
  ev.push(['wand', 28.45]);
  for (let i = 0; i < NC; i++) { ev.push(['cap', T.powerCap + i * .15]); ev.push(['star', T.powerHook + i * .13]); ev.push(['reframe', T.powerRef + i * .1]); }
  ev.push(['portal', 34.0]);
  for (let i = 0; i < NC; i++) { ev.push(['launch', cardLaunch(i)]); ev.push(['arrive', cardLaunch(i) + .88]); }
  for (let k = 0; k < STREAM; k++) { ev.push(['launch_s', streamT(k)]); ev.push(['arrive_s', streamT(k) + .73]); }
  ev.push(['night', T.night0]); ev.push(['lightoff', 39.8]); ev.push(['dawn', T.day0]);
  ev.push(['chest', 44.0]); for (let k = 0; k < NCOIN; k++) ev.push(['coin', coinT(k) + .93]);
  ev.push(['chestclose', 49.1]); ev.push(['hop', 49.2]); ev.push(['level', T.level]); ev.push(['jumpbig', 50.45]); ev.push(['confetti', 51.0]); ev.push(['land', 51.52]);
  ev.push(['endcard', 54.9]); ev.push(['cta', 57.0]);
  CAPTIONS.forEach(c => ev.push(['caption', c[0]]));
  return ev;
};
window.ready = Promise.all([document.fonts.load('20px PX'), document.fonts.load('700 20px SG'), document.fonts.load('500 20px JB')]).then(() => true);
