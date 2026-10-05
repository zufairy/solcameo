import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

await Promise.all(['40px BG', '40px AN', '40px DF', '700 40px SG', '40px SG4'].map(f => document.fonts.load(f)));
const loadImg = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; });
const [LOGO, MARK] = await Promise.all([loadImg('logo.png'), loadImg('mark.png')]);

// ---------- utils ----------
const QS = new URLSearchParams(location.search);
const W = 1920, H = 1080;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
const sm = u => u * u * (3 - 2 * u);
const smr = u => u * u * u * (u * (u * 6 - 15) + 10);
const eo = u => 1 - Math.pow(1 - u, 3);
const eio = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const eback = u => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const bump = (t, c, w) => Math.exp(-Math.pow((t - c) / w, 2));
function rnd(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function ctex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function rr(x, X, Y, w, h, r) { x.beginPath(); x.roundRect(X, Y, w, h, r); }

// ---------- motion: speed profile -> z(t) ----------
const VK = [[0, 0], [5.0, 0], [7.0, 22], [15.0, 22], [16.4, 8], [19.4, 8], [21.4, 24], [35.6, 24], [40.0, 0], [61, 0]];
function vAt(t) { let i = 0; while (i < VK.length - 2 && t > VK[i + 1][0]) i++; const a = VK[i], b = VK[i + 1]; return lerp(a[1], b[1], sm(seg(t, a[0], b[0]))); }
const HZ = 240, ZT = [0];
for (let n = 1; n <= 61 * HZ; n++) { const t = n / HZ; ZT.push(ZT[n - 1] - vAt(t - .5 / HZ) / HZ); }
const zAt = t => { const f = clamp(t, 0, 61) * HZ, i = Math.floor(f), u = f - i; return lerp(ZT[i], ZT[Math.min(i + 1, ZT.length - 1)], u); };
const pxAt = t => -4.5 - 3 * sm(seg(t, 36.8, 39.6));
const STOPZ = zAt(41);
// agents
const AG = [{ x: -1.5, dz: 6, e: 17.9 }, { x: -7.5, dz: 6, e: 18.5 }, { x: -4.5, dz: 12, e: 19.1 }];
const GZ = zAt(17.9);
const GARAGE = V(-19, 0, GZ);

// ---------- renderer ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const FOG = new THREE.Color(0x4a1d4c);
scene.fog = new THREE.Fog(FOG, 45, 280);
const camera = new THREE.PerspectiveCamera(42, W / H, .2, 1200);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), .6, .45, .88); composer.addPass(bloom);
composer.addPass(new OutputPass());
if (QS.get('nosmaa') === null) composer.addPass(new SMAAPass(W, H));
const retro = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uPix: { value: 1 }, uBox: { value: 0 }, uGlitch: { value: 0 }, uRes: { value: new THREE.Vector2(W, H) }, uFlash: { value: 0 } },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uTime,uPix,uBox,uGlitch,uFlash;uniform vec2 uRes;varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  void main(){vec2 cc=vUv-.5;vec2 uv=.5+cc*(1.+.03*dot(cc,cc));
   if(uPix>1.01){vec2 px=uRes/uPix;uv=(floor(uv*px)+.5)/px;}
   float gl=uGlitch*step(.6,h(vec2(floor(vUv.y*40.),floor(uTime*30.))));uv.x+=gl*.02*(h(vec2(uTime,floor(vUv.y*40.)))-.5);
   float ca=.0014+.006*uGlitch;vec3 c;c.r=texture2D(tDiffuse,uv+cc*ca).r;c.g=texture2D(tDiffuse,uv).g;c.b=texture2D(tDiffuse,uv-cc*ca).b;
   if(uPix>1.01){c=floor(c*14.+.5)/14.;}
   float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,1.12);c+=vec3(.025,0.,.04)*(1.-l);
   c*=.95+.05*sin(vUv.y*uRes.y*2.094);
   c+=(h(vUv*uRes+fract(uTime*7.)*100.)-.5)*.045;
   c*=1.-.5*dot(cc,cc)*1.6;c+=uFlash;
   float b=uBox*.115;if(vUv.y<b||vUv.y>1.-b)c=vec3(0.);
   gl_FragColor=vec4(c,1.);}`
});
composer.addPass(retro);

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0x9a6ad8, 0x2a1830, 1.0); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffa066, 2.4); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -.0005; key.shadow.normalBias = .03;
Object.assign(key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 });
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x6fe8ff, 1.0); scene.add(rim, rim.target);

// ---------- sky ----------
const skyU = { uNight: { value: 0 }, uSunY: { value: .06 }, uT: { value: 0 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: `varying vec3 vp;void main(){vp=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform float uNight,uSunY,uT;varying vec3 vp;
  float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
  void main(){vec3 d=normalize(vp);float y=d.y;
   vec3 top=mix(vec3(.09,.03,.22),vec3(.02,.01,.07),uNight);
   vec3 mid=mix(vec3(.62,.13,.48),vec3(.2,.04,.26),uNight);
   vec3 hor=mix(vec3(1.05,.42,.22),vec3(.5,.14,.28),uNight);
   vec3 c=mix(mid,top,smoothstep(.02,.5,y));
   c=mix(hor,c,smoothstep(-.03,.2,y));
   if(y<-.03)c=mix(hor*.5,vec3(.12,.04,.12),smoothstep(-.03,-.3,y));
   float az=atan(d.x,-d.z);
   // clouds bands
   float cb=sin(y*90.+sin(az*6.)*2.)*.5+.5;c+=vec3(1.,.4,.5)*pow(cb,8.)*smoothstep(.03,.12,y)*smoothstep(.3,.12,y)*.12*(1.-uNight);
   vec2 sp=vec2(az,y-uSunY);float r=length(sp);float R=.17;
   float s=clamp(-sp.y/R,0.,1.);
   float cut=step(.08,s)*step(fract(sp.y*42.),s*.75);
   vec3 sc=mix(vec3(1.4,1.15,.35),vec3(1.5,.25,.75),clamp((uSunY+R-y)/(2.*R),0.,1.));
   float disk=smoothstep(R,R-.003,r)*(1.-cut);
   c=mix(c,sc*1.6,disk);
   c+=vec3(1.,.35,.55)*exp(-r*5.)*.35+vec3(1.,.5,.3)*exp(-r*18.)*.3;
   float st=step(.9975,h(floor(d*300.)))*smoothstep(.15,.5,y)*(.3+.7*uNight);c+=vec3(st);
   // grid glow line at horizon
   c+=vec3(1.,.3,.7)*exp(-abs(y+.005)*260.)*.5;
   gl_FragColor=vec4(c,1.);}`
}));
scene.add(sky);

// ---------- ground / road ----------
const ZMIN = -1250, ZMAX = 120, ZLEN = ZMAX - ZMIN, ZC = (ZMAX + ZMIN) / 2;
{
  const roadTex = ctex(512, 512, (x, w, h) => {
    x.fillStyle = '#1c1822'; x.fillRect(0, 0, w, h);
    const r = rnd(1); for (let i = 0; i < 9000; i++) { const g = 20 + r() * 30; x.fillStyle = `rgba(${g + 10},${g},${g + 16},.6)`; x.fillRect(r() * w, r() * h, 2, 2); }
    const X = v => (v + 9.5) / 19 * w;
    x.fillStyle = '#e8e2d0'; for (const v of [-9.2, 9.2]) x.fillRect(X(v) - 3, 0, 6, h);
    x.fillStyle = '#f1c33f'; for (const v of [-.15, .15]) x.fillRect(X(v) - 3, 0, 6, h);
    x.fillStyle = '#e8e2d0'; for (const v of [-6, -3, 4, 7]) x.fillRect(X(v) - 3, 0, 6, h * .45);
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping; roadTex.repeat.set(1, ZLEN / 19);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(19, ZLEN), new THREE.MeshStandardMaterial({ map: roadTex, roughness: .32, metalness: .35 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, ZC); road.receiveShadow = true; scene.add(road);
  const walkTex = ctex(256, 256, (x, w, h) => { x.fillStyle = '#8a6f86'; x.fillRect(0, 0, w, h); x.strokeStyle = '#6f5670'; x.lineWidth = 4; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.stroke(); } });
  walkTex.wrapS = walkTex.wrapT = THREE.RepeatWrapping; walkTex.repeat.set(1.2, ZLEN / 4);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(4, .25, ZLEN), new THREE.MeshStandardMaterial({ map: walkTex, roughness: .8 })); w.position.set(s * 11.5, .125, ZC); w.receiveShadow = true; scene.add(w);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(.25, .28, ZLEN), new THREE.MeshStandardMaterial({ color: 0xd9c7d3, roughness: .6 })); curb.position.set(s * 9.55, .14, ZC); scene.add(curb);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, ZLEN), new THREE.MeshStandardMaterial({ color: 0x241a2c, roughness: .9 })); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -.02, ZC); scene.add(ground);
}

// ---------- city generation ----------
const R = rnd(42);
const PASTEL = [0xf7a8c4, 0x9fe3e0, 0xf4d9a6, 0xc9b7f0, 0xffc8a0, 0xa8d8f7, 0xe9e2ee, 0xf2b5e6];
const NEON = [0xff3fa8, 0x3ff0ff, 0xb45cff, 0xc6ff5a, 0xff8a3d, 0xff5f7a];
const reserved = [[-1, GZ - 13, GZ + 13], [-1, STOPZ - 16, STOPZ + 14]];
const isRes = (side, z0, z1) => reserved.some(([s, a, b]) => s === side && z1 < b && z0 > a - 0);
const blds = [], signs = [], lamps = [], palms = [], refl = [], cross = [];
for (let z0 = 90; z0 > ZMIN + 60; z0 -= 62) {
  cross.push(z0 - 56);
  for (const side of [-1, 1]) {
    let z = z0;
    while (z > z0 - 52) {
      const w = Math.min(7 + R() * 11, z - (z0 - 52)); if (w < 4) break;
      const zc = z - w / 2;
      if (!isRes(side, z - w, z)) {
        const d = 12 + R() * 12, h = 7 + Math.pow(R(), 2.2) * 50;
        const col = PASTEL[Math.floor(R() * PASTEL.length)];
        const xc = side * (13.6 + d / 2);
        blds.push({ x: xc, z: zc, w, d, h, col });
        if (R() < .75) { const nc = NEON[Math.floor(R() * NEON.length)]; const vertical = R() < .55; const sh = vertical ? 3 + R() * 7 : .45; const sw = vertical ? .45 : w * .7; const y = vertical ? 4 + sh / 2 + R() * 3 : 3.2 + R() * 1.5;
          signs.push({ x: side * 13.45, y, z: zc + (vertical ? (R() - .5) * w * .6 : 0), sx: .3, sy: sh, sz: sw, col: nc }); refl.push({ x: side * 8.4, z: zc + 5, col: nc, s: 1 }); }
        if (R() < .35) { const nc = NEON[Math.floor(R() * NEON.length)]; signs.push({ x: side * 13.45, y: h - .6, z: zc, sx: .3, sy: .35, sz: w * .95, col: nc }); }
      }
      z -= w + .6;
    }
  }
}
for (let z = 100; z > ZMIN + 40; z -= 17) for (const s of [-1, 1]) { if (cross.some(c => Math.abs(c - z) < 6)) continue; palms.push({ x: s * (11.3 + R() * .8), z: z + R() * 3, s: .8 + R() * .45, ry: R() * 6, tilt: (R() - .5) * .18 }); }
for (let z = 95; z > ZMIN + 40; z -= 34) for (const s of [-1, 1]) { lamps.push({ x: s * 9.95, z, s }); refl.push({ x: s * 7.9, z: z + 4.5, col: 0xffc98a, s: .8 }); }

// building shader material (procedural windows, instanced)
const bldU = { uFog: { value: FOG }, uLit: { value: .5 }, uKey: { value: V(.1, .35, -1).normalize() }, uKeyC: { value: new THREE.Color(0xffa066) }, uNight: { value: 0 } };
const bldMat = new THREE.ShaderMaterial({
  uniforms: bldU,
  vertexShader: `varying vec3 vW,vN,vC;varying float vLy,vH;
  void main(){vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.);vW=wp.xyz;vN=normalize(mat3(modelMatrix*instanceMatrix)*normal);
  #ifdef USE_INSTANCING_COLOR
  vC=instanceColor;
  #else
  vC=vec3(1.);
  #endif
  vLy=position.y+.5;vH=length(instanceMatrix[1].xyz);gl_Position=projectionMatrix*viewMatrix*wp;}`,
  fragmentShader: `uniform vec3 uFog,uKey,uKeyC;uniform float uLit,uNight;varying vec3 vW,vN,vC;varying float vLy,vH;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){vec3 n=normalize(vN);
   float dif=max(dot(n,uKey),0.);
   vec3 amb=mix(vec3(.26,.15,.36),vec3(.12,.07,.2),uNight);
   vec3 base=vC*vC;
   vec3 col=base*(amb+uKeyC*dif*.9*(1.-.6*uNight)+vec3(.35,.25,.5)*max(n.y,0.)*.5);
   col*=.55+.45*smoothstep(0.,.5,vLy);
   float top=(1.-vLy)*vH;
   if(abs(n.y)<.5){
    vec2 q=abs(n.x)>.5?vec2(vW.z,vW.y):vec2(vW.x,vW.y);
    vec2 cell=floor(q/vec2(1.7,2.6));vec2 f=fract(q/vec2(1.7,2.6));
    float win=step(.22,f.x)*step(f.x,.78)*step(.25,f.y)*step(f.y,.72)*step(3.,vW.y)*step(1.2,top);
    float r=h(cell+floor(vW.x*.01)*7.+floor(vW.z*.02));
    float lit=step(1.-uLit,r);
    vec3 wc=r>.85?vec3(.5,.95,1.2):(r>.75?vec3(1.3,.55,.95):vec3(1.25,.85,.45));
    col=mix(col,mix(vec3(.04,.03,.08),wc*.95,lit),win*.9);
    // art deco bands
    col=mix(col,base*.7,step(fract(vW.y/3.1),.07)*step(3.,vW.y)*(1.-win));
    // shop fronts
    float shop=step(vW.y,2.6)*step(.6,vW.y);
    col=mix(col,mix(vec3(1.1,.7,.45),vec3(.55,.8,1.1),h(floor(q*.1)))*.75,shop*.7);
    // roof neon trim
    float tc=h(floor(vW.xz*.05));
    vec3 nc=tc>.66?vec3(2.,.4,1.3):(tc>.33?vec3(.4,1.8,2.):vec3(1.5,.6,2.));
    col=mix(col,nc,step(top,.35)*step(.5,tc*1.6));
   } else col=base*.35+vec3(.04,.02,.06);
   float dist=length(vW-cameraPosition);
   float fg=smoothstep(45.,280.,dist);col=mix(col,uFog,fg);
   gl_FragColor=vec4(col,1.);}`
});
{
  const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, .5, 0);
  const g2 = new THREE.BoxGeometry(1, 1, 1);
  const im = new THREE.InstancedMesh(g2, bldMat, blds.length); const m = new THREE.Matrix4();
  blds.forEach((b, i) => { m.compose(V(b.x, b.h / 2, b.z), new THREE.Quaternion(), V(b.d, b.h, b.w)); im.setMatrixAt(i, m); im.setColorAt(i, new THREE.Color(b.col)); });
  im.frustumCulled = false; scene.add(im);
  // setbacks/tops on tall ones
  const tall = blds.filter(b => b.h > 30);
  const im2 = new THREE.InstancedMesh(g2, bldMat, tall.length);
  tall.forEach((b, i) => { const hh = 4 + b.h * .15; m.compose(V(b.x, b.h + hh / 2, b.z), new THREE.Quaternion(), V(b.d * .6, hh, b.w * .6)); im2.setMatrixAt(i, m); im2.setColorAt(i, new THREE.Color(b.col)); });
  im2.frustumCulled = false; scene.add(im2);
  // neon signs
  const sm_ = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) });
  const ims = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), sm_, signs.length);
  signs.forEach((s, i) => { m.compose(V(s.x, s.y, s.z), new THREE.Quaternion(), V(s.sx, s.sy, s.sz)); ims.setMatrixAt(i, m); ims.setColorAt(i, new THREE.Color(s.col)); });
  ims.frustumCulled = false; scene.add(ims);
  // road reflections
  const rtex = ctex(64, 256, (x, w, h) => { const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.2, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, h); const g2 = x.createLinearGradient(0, 0, w, 0); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = g2; x.fillRect(0, 0, w, h); });
  const rmat = new THREE.MeshBasicMaterial({ map: rtex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(.38, .38, .38) });
  const imr = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 11), rmat, refl.length);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  refl.forEach((r, i) => { m.compose(V(r.x, .02, r.z), q, V(r.s, r.s, 1)); imr.setMatrixAt(i, m); imr.setColorAt(i, new THREE.Color(r.col)); });
  imr.frustumCulled = false; imr.renderOrder = 2; scene.add(imr);
  // cross streets + crosswalks
  const cm = new THREE.MeshStandardMaterial({ color: 0x1c1822, roughness: .35, metalness: .3 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: .6 });
  const imc = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cm, cross.length * 2);
  const imw = new THREE.InstancedMesh(new THREE.PlaneGeometry(.7, 3.2), stripe, cross.length * 26);
  let n = 0, k = 0;
  cross.forEach(z => { for (const s of [-1, 1]) { m.compose(V(s * 40, .26, z), q, V(60, 8, 1)); imc.setMatrixAt(n++, m); }
    for (const zz of [z + 5.3, z - 5.3]) for (let i = 0; i < 13; i++) { m.compose(V(-8.4 + i * 1.4, .015, zz), q, V(1, 1, 1)); imw.setMatrixAt(k++, m); } });
  imw.count = k; scene.add(imc, imw);
  imc.receiveShadow = imw.receiveShadow = true;
  // palms
  const trunkG = new THREE.CylinderGeometry(.16, .3, 8, 8, 4); trunkG.translate(0, 4, 0);
  const fronds = [];
  for (let i = 0; i < 9; i++) { const p = new THREE.PlaneGeometry(.9, 4.6, 1, 10); const pa = p.attributes.position; for (let j = 0; j < pa.count; j++) { const x = pa.getX(j), y = pa.getY(j) + 2.3; const s = y / 4.6; pa.setXYZ(j, x * (1 - s * .75) * (1 + .3 * Math.sin(s * 3)), 8 + 1.1 * s - 2.6 * s * s, y * .95); } p.rotateY(i / 9 * Math.PI * 2 + (i % 2) * .2); fronds.push(p); }
  const frondG = mergeGeometries(fronds); frondG.computeVertexNormals();
  const tm = new THREE.MeshStandardMaterial({ color: 0x3b2a2e, roughness: .9 });
  const fm = new THREE.MeshStandardMaterial({ color: 0x1d3b2c, roughness: .8, side: THREE.DoubleSide });
  const imt = new THREE.InstancedMesh(trunkG, tm, palms.length), imf = new THREE.InstancedMesh(frondG, fm, palms.length);
  palms.forEach((p, i) => { m.compose(V(p.x, .2, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(p.tilt, p.ry, p.tilt * .5)), V(p.s, p.s, p.s)); imt.setMatrixAt(i, m); imf.setMatrixAt(i, m); });
  imt.castShadow = imf.castShadow = true; imt.frustumCulled = imf.frustumCulled = false; scene.add(imt, imf);
  // lamps
  const poleG = mergeGeometries([new THREE.CylinderGeometry(.09, .13, 7.4, 8).translate(0, 3.7, 0), new THREE.BoxGeometry(1.8, .12, .12).translate(-.9, 7.3, 0)]);
  const lampG = new THREE.BoxGeometry(.9, .18, .4).translate(-1.7, 7.18, 0);
  const imp = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: .5, metalness: .6 }), lamps.length);
  const iml = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 1.2) }), lamps.length);
  lamps.forEach((l, i) => { m.compose(V(l.x, .25, l.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, l.s > 0 ? 0 : Math.PI, 0)), V(1, 1, 1)); imp.setMatrixAt(i, m); iml.setMatrixAt(i, m); });
  imp.frustumCulled = iml.frustumCulled = false; scene.add(imp, iml);
  // distant skyline silhouette
  const sk = ctex(2048, 256, (x, w, h) => { const r = rnd(8); x.clearRect(0, 0, w, h); for (let i = 0; i < 160; i++) { const bw = 10 + r() * 40, bh = 30 + Math.pow(r(), 2) * 200, bx = r() * w; x.fillStyle = `rgba(${60 + r() * 30},${20 + r() * 20},${70 + r() * 30},1)`; x.fillRect(bx, h - bh, bw, bh); x.fillStyle = 'rgba(255,190,120,.7)'; for (let k = 0; k < bh / 8; k++) if (r() < .25) x.fillRect(bx + 3 + r() * (bw - 6), h - bh + k * 8, 2, 2); } });
  const skl = new THREE.Mesh(new THREE.PlaneGeometry(900, 110), new THREE.MeshBasicMaterial({ map: sk, transparent: true, fog: false, color: 0xb57aa8 }));
  skl.position.set(0, 42, ZMIN - 20); scene.add(skl); scene.userData.skyline = skl;
}

// ---------- cars ----------
function carParts(bodyColor, agentNo) {
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const prof = [[-2.3, .32], [2.2, .32], [2.34, .48], [2.27, .6], [1.0, .84], [-1.45, .95], [-2.25, .93], [-2.36, .64]];
  const s = new THREE.Shape(); prof.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]));
  const bg = new THREE.ExtrudeGeometry(s, { depth: 1.8, bevelEnabled: true, bevelThickness: .09, bevelSize: .08, bevelSegments: 3, curveSegments: 4 }); bg.translate(0, 0, -.9); bg.rotateY(Math.PI / 2);
  const paint = new THREE.MeshPhysicalMaterial({ color: bodyColor, roughness: .3, metalness: .35, clearcoat: 1, clearcoatRoughness: .08 });
  body.add(new THREE.Mesh(bg, paint));
  const cs = new THREE.Shape(); [[-1.42, .93], [.98, .82], [.3, 1.22], [-.95, 1.24]].forEach((p, i) => i ? cs.lineTo(p[0], p[1]) : cs.moveTo(p[0], p[1]));
  const cg = new THREE.ExtrudeGeometry(cs, { depth: 1.5, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 2 }); cg.translate(0, 0, -.75); cg.rotateY(Math.PI / 2);
  body.add(new THREE.Mesh(cg, new THREE.MeshPhysicalMaterial({ color: 0x0c0a16, roughness: .08, metalness: .8, clearcoat: 1 })));
  // side strakes
  const strake = new THREE.MeshStandardMaterial({ color: 0x151219, roughness: .6 });
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(.04, .05, 1.1), strake); b.position.set(sx * .99, .5 + k * .09, .6); body.add(b); }
  const hl = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.9, 2.6) });
  for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(.5, .1, .05), hl); b.position.set(sx * .6, .5, -2.36); body.add(b); }
  const tl = new THREE.Mesh(new THREE.BoxGeometry(1.7, .12, .05), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, .25, .35) })); tl.position.set(0, .72, 2.4); body.add(tl);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.8, .08, .05), strake); grille.position.set(0, .63, 2.39); body.add(grille);
  // wheels
  const wheels = [];
  const tyre = new THREE.MeshStandardMaterial({ color: 0x111014, roughness: .8 }), rim_ = new THREE.MeshStandardMaterial({ color: 0xd8d8e0, roughness: .25, metalness: .9 });
  for (const [x, z] of [[-.96, -1.45], [.96, -1.45], [-.96, 1.45], [.96, 1.45]]) { const w = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .3, 20).rotateZ(Math.PI / 2), tyre); const r = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .32, 10).rotateZ(Math.PI / 2), rim_); w.add(t, r); w.position.set(x, .36, z); g.add(w); wheels.push(w); }
  // decals
  if (agentNo) {
    const mk = new THREE.CanvasTexture(MARK); mk.colorSpace = THREE.SRGBColorSpace;
    const dm = new THREE.MeshBasicMaterial({ map: ctex(256, 256, (x) => { x.fillStyle = '#0b0d0a'; x.beginPath(); x.arc(128, 128, 120, 0, 7); x.fill(); x.drawImage(MARK, 40, 40, 176, 176); }), transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CircleGeometry(.3, 32), dm); p.position.set(sx * 1.0, .6, -.2); p.rotation.y = sx * Math.PI / 2; body.add(p); }
    const hood = new THREE.Mesh(new THREE.PlaneGeometry(.75, .75), new THREE.MeshBasicMaterial({ map: mk, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 })); hood.position.set(0, .78, -1.55); hood.rotation.x = -(Math.PI / 2 + .19); body.add(hood);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .7), new THREE.MeshBasicMaterial({ transparent: true, map: ctex(256, 160, (x) => { x.font = '120px AN'; x.fillStyle = '#c6ff5a'; x.strokeStyle = '#000'; x.lineWidth = 14; x.textAlign = 'center'; x.textBaseline = 'middle'; x.strokeText('0' + agentNo, 128, 86); x.fillText('0' + agentNo, 128, 86); }) }));
    roof.position.set(0, 1.3, .35); roof.rotation.x = -Math.PI / 2; body.add(roof);
  } else {
    const st = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const sx of [-.28, .28]) { const b = new THREE.Mesh(new THREE.BoxGeometry(.14, .02, 1.3), st); b.position.set(sx, .79, -1.55); b.rotation.x = .19; body.add(b); }
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  // underglow + headlight pool
  const ug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.2), new THREE.MeshBasicMaterial({ map: ctex(128, 128, (x) => { const r = x.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = r; x.fillRect(0, 0, 128, 128); }), color: agentNo ? 0xa3e635 : 0xff3fa8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ug.rotation.x = -Math.PI / 2; ug.position.y = .03; g.add(ug);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 11), new THREE.MeshBasicMaterial({ map: ctex(128, 256, (x, w, h) => { const gr = x.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,240,220,.55)'); gr.addColorStop(1, 'rgba(255,240,220,0)'); x.fillStyle = gr; x.beginPath(); x.moveTo(w * .35, h); x.lineTo(w * .65, h); x.lineTo(w, 0); x.lineTo(0, 0); x.fill(); }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, .025, -7.6); g.add(pool);
  g.userData = { wheels, body, ug };
  scene.add(g); return g;
}
const player = carParts(0xff3fa8, 0);
const agents = AG.map((a, i) => carParts(0xa3e635, i + 1));
const TRAF = []; { const r = rnd(5); const cols = [0x2fd0ff, 0xf2f2f2, 0xff8a3d, 0x8f5bff, 0xffd23f, 0xe0303a, 0x30e0a0]; for (let i = 0; i < 7; i++) { const c = carParts(cols[i], 0); c.userData.lane = [2.5, 5.5, 8.5][i % 3]; c.userData.z0 = -i * 42 - r() * 20; c.userData.sp = 18 + r() * 8; TRAF.push(c); } }

// ---------- set pieces ----------
function board(w, h, draw, emissive = 1.3) { const tex = ctex(w, h, draw); return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(emissive, emissive, emissive) }); }
function billboard(x, z, rot, mat, sw = 14, sh = 7, y = 7) {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(sw + .6, sh + .6, .4), new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: .5, metalness: .5 })); g.add(frame);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat); p.position.z = .21; g.add(p);
  for (const px of [-sw / 3, sw / 3]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(.2, .25, y, 8), frame.material); pole.position.set(px, -y / 2 - sh / 2 + .2, -.3); g.add(pole); }
  const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.2, 1.8) }); for (const px of [-sw / 3, 0, sw / 3]) { const l = new THREE.Mesh(new THREE.BoxGeometry(.6, .15, .5), lm); l.position.set(px, sh / 2 + .5, .6); g.add(l); }
  g.position.set(x, y + sh / 2, z); g.rotation.y = rot; scene.add(g); return g;
}
function adDraw(title, rate, sub, c1, c2) {
  return (x, w, h) => { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, c1); g.addColorStop(1, c2); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,.28)'; for (let i = 0; i < 12; i++) x.fillRect(0, h * .62 + i * 14, w, 5);
    x.font = '96px BG'; x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 12; x.lineJoin = 'round'; x.strokeText(title, 40, 130); x.fillText(title, 40, 130);
    x.font = '150px AN'; x.fillStyle = '#c6ff5a'; x.strokeText(rate, 40, 300); x.fillText(rate, 40, 300);
    x.font = '44px AN'; x.fillStyle = '#fff'; x.lineWidth = 8; x.strokeText(sub, 44, 380); x.fillText(sub, 44, 380);
    x.fillStyle = 'rgba(0,0,0,.6)'; rr(x, w - 330, h - 110, 300, 80, 16); x.fill(); x.drawImage(LOGO, w - 318, h - 102, 213, 64); x.font = '26px AN'; x.fillStyle = '#fff'; x.fillText('CAMPAIGN', w - 118, h - 60); };
}
const BB = [
  billboard(15, zAt(8.9), -.6, board(1024, 512, adDraw('PODCAST CLIPS', '$3.00 / 1K VIEWS', 'CLIP IT. POST IT. GET PAID.', '#ff3fa8', '#5b1ab8'))),
  billboard(-15, zAt(10.6), .6, board(1024, 512, adDraw('APP LAUNCH', '$2.50 / 1K VIEWS', 'SHORT-FORM CAMPAIGN - OPEN NOW', '#12c2e9', '#6a1b9a'))),
  billboard(15, zAt(12.4), -.6, board(1024, 512, adDraw('MUSIC DROP', '$4.00 / 1K VIEWS', 'TOP CLIPPERS WANTED', '#ff8a3d', '#c2185b'))),
];
// clip screens (mission 3)
function clipDraw(i) { const hues = [320, 190, 40]; return (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `hsl(${hues[i]},80%,60%)`); g.addColorStop(1, `hsl(${hues[i] + 40},70%,30%)`); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(w / 2, h * .38, 70, 0, 7); x.fill(); rr(x, w / 2 - 110, h * .38 + 90, 220, 260, 90); x.fill(); x.fillStyle = '#c6ff5a'; rr(x, 30, h * .72, w - 60, 90, 20); x.fill(); x.font = '58px AN'; x.fillStyle = '#0b0d0a'; x.textAlign = 'center'; x.fillText(['HE SAID WHAT?!', 'WATCH TILL END', 'NOBODY SAYS THIS'][i], w / 2, h * .72 + 66); x.font = '44px AN'; x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 8; const v = ['1.2M VIEWS', '846K VIEWS', '2.1M VIEWS'][i]; x.strokeText(v, w / 2, h - 60); x.fillText(v, w / 2, h - 60); x.textAlign = 'left'; x.font = '40px AN'; x.fillStyle = '#ff4d5e'; x.fillText('● LIVE', 30, 64); }; }
billboard(-15.5, zAt(31.6), .55, board(432, 768, clipDraw(0), 1.25), 6, 10.6, 5);
billboard(15.5, zAt(33.2), -.55, board(432, 768, clipDraw(1), 1.25), 6, 10.6, 5);
billboard(-15.5, zAt(34.6), .55, board(432, 768, clipDraw(2), 1.25), 6, 10.6, 5);
// giant logo billboard on rooftop
{ const lb = billboard(16, zAt(23.5) - 30, -.35, board(1600, 480, (x, w, h) => { x.fillStyle = '#0b0d0a'; x.fillRect(0, 0, w, h); x.strokeStyle = '#c6ff5a'; x.lineWidth = 16; x.strokeRect(12, 12, w - 24, h - 24); x.drawImage(LOGO, 160, 60, 1280, 384); }, 1.6), 30, 9, 26); }

// campaign marker
const marker = new THREE.Group();
{ const cyl = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 40, 1, true), new THREE.MeshBasicMaterial({ map: ctex(8, 256, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,210,63,0)'); g.addColorStop(1, 'rgba(255,210,63,.75)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }), transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
  cyl.position.y = 2; marker.add(cyl);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.3, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.3, .6), side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = .04; marker.add(ring);
  const ic = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, map: ctex(256, 256, (x) => { x.font = '220px AN'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.strokeStyle = '#000'; x.lineWidth = 18; x.strokeText('$', 128, 138); x.fillStyle = '#ffd23f'; x.fillText('$', 128, 138); }) }));
  ic.position.y = 5.2; marker.add(ic); marker.userData = { cyl, ring, ic };
  marker.position.set(-4.5, 0, zAt(13.6)); scene.add(marker); }

// garage
const garage = new THREE.Group(); let door;
{ const m1 = new THREE.MeshStandardMaterial({ color: 0x3b3346, roughness: .7 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 22), m1); back.position.set(-6, 4.5, 0); garage.add(back);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(.2, 5, 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(.5, .9, .25) })); inner.position.set(-.2, 2.5, 0);
  // opening: carve by building frame pieces around a door at x=0 face
  const fr = new THREE.MeshStandardMaterial({ color: 0x241e2e, roughness: .5, metalness: .4 });
  const topB = new THREE.Mesh(new THREE.BoxGeometry(.6, 4, 22), fr); topB.position.set(.2, 7, 0); garage.add(topB);
  for (const s of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(.6, 5, 6.5), fr); side.position.set(.2, 2.5, s * 7.75); garage.add(side); }
  back.scale.set(1, 1, 1); back.position.x = -6.3;
  const hole = new THREE.Mesh(new THREE.BoxGeometry(11.5, 5, 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(.22, .5, .1) })); hole.position.set(-6, 2.5, 0); garage.add(hole);
  const glowW = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(.55, 1.2, .25), side: THREE.DoubleSide })); glowW.position.set(-11.5, 2.5, 0); glowW.rotation.y = Math.PI / 2; garage.add(glowW);
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshBasicMaterial({ map: ctex(128, 128, (x) => { const r = x.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(198,255,90,.7)'); r.addColorStop(1, 'rgba(198,255,90,0)'); x.fillStyle = r; x.fillRect(0, 0, 128, 128); }), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); floorGlow.rotation.x = -Math.PI / 2; floorGlow.position.set(2, .05, 0); garage.add(floorGlow); garage.userData.floorGlow = floorGlow;
  door = new THREE.Mesh(new THREE.BoxGeometry(.25, 5, 9), new THREE.MeshStandardMaterial({ color: 0x8c8ea0, roughness: .4, metalness: .7, map: ctex(64, 256, (x, w, h) => { x.fillStyle = '#9a9cae'; x.fillRect(0, 0, w, h); x.fillStyle = '#6d6f80'; for (let i = 0; i < 16; i++) x.fillRect(0, i * 16, w, 3); }) })); door.position.set(.35, 2.5, 0); garage.add(door);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.2), board(1400, 320, (x, w, h) => { x.fillStyle = '#0b0d0a'; x.fillRect(0, 0, w, h); x.strokeStyle = '#c6ff5a'; x.lineWidth = 12; x.strokeRect(8, 8, w - 16, h - 16); x.drawImage(LOGO, 60, 50, 733, 220); x.font = '150px AN'; x.fillStyle = '#c6ff5a'; x.fillText('AGENTS', 860, 225); }, 1.7));
  sign.position.set(.6, 7, 0); sign.rotation.y = Math.PI / 2; garage.add(sign);
  const roofN = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, 22), new THREE.MeshBasicMaterial({ color: new THREE.Color(.8, 2.2, .4) })); roofN.position.set(.4, 9, 0); garage.add(roofN);
  garage.position.set(-13.2, 0, GZ); garage.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); scene.add(garage); }

// pickups (film reels)
const reelProto = (() => { const g = new THREE.Group(); const lime = new THREE.MeshStandardMaterial({ color: 0xc6ff5a, emissive: 0x7fcc10, emissiveIntensity: 1.6, roughness: .3, metalness: .4 });
  const d = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, .22, 32).rotateX(Math.PI / 2), lime); g.add(d);
  const dark = new THREE.MeshBasicMaterial({ color: 0x14101c });
  for (let i = 0; i < 5; i++) { const h = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .26, 16).rotateX(Math.PI / 2), dark); const a = i / 5 * Math.PI * 2; h.position.set(Math.cos(a) * .45, Math.sin(a) * .45, 0); g.add(h); }
  const c = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .3, 12).rotateX(Math.PI / 2), dark); g.add(c);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex(128, 128, (x) => { const r = x.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(198,255,90,.8)'); r.addColorStop(1, 'rgba(198,255,90,0)'); x.fillStyle = r; x.fillRect(0, 0, 128, 128); }), blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(3.2); g.add(glow);
  return g; })();
const PK = [];
const pkPlan = [[-1, 20.8], [-1, 22.2], [-1, 23.6], [0, 21.3], [0, 22.9], [0, 24.2], [1, 21.0], [1, 22.5], [1, 24.0], [2, 21.8], [2, 23.3]];
pkPlan.forEach(([c, tc]) => { const off = c < 0 ? { x: -4.5, dz: 0 } : AG[c]; const g = reelProto.clone(); g.position.set(off.x, 1.4, zAt(tc) + off.dz); scene.add(g); PK.push({ g, tc, c }); });

// gates
const GATES = [[26.8, 'TikTok', ['#25F4EE', '#FE2C55'], 0x25f4ee], [28.3, 'Reels', ['#F58529', '#DD2A7B'], 0xdd2a7b], [29.8, 'Shorts', ['#FF0000', '#ff5f5f'], 0xff2020]].map(([tg, name, cs, nc]) => {
  const g = new THREE.Group(); const fm = new THREE.MeshStandardMaterial({ color: 0x1d1826, roughness: .4, metalness: .6 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), fm); p.position.set(s * 10.4, 4.5, 0); g.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 2.4, 1.2), fm); beam.position.y = 9.6; g.add(beam);
  const neonM = new THREE.MeshBasicMaterial({ color: new THREE.Color(nc).multiplyScalar(2.4) });
  for (const [x, y, sx, sy] of [[-11.1, 4.5, .18, 9], [11.1, 4.5, .18, 9], [0, 10.9, 22.4, .18], [0, 8.3, 22.4, .18]]) { const n = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 1.3), neonM); n.position.set(x, y, 0); g.add(n); }
  const draw = (x, w, h) => { const gr = x.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, cs[0]); gr.addColorStop(1, cs[1]); x.fillStyle = '#0b0d0a'; x.fillRect(0, 0, w, h); x.font = '170px AN'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = gr; x.fillText(name.toUpperCase(), w / 2, h / 2 + 8); };
  const sm1 = board(1024, 200, draw, 1.5);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), sm1); front.position.set(0, 9.6, .62); g.add(front);
  const topP = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), sm1); topP.rotation.x = -Math.PI / 2; topP.position.set(0, 10.82, 0); g.add(topP);
  g.position.set(0, 0, zAt(tg) - 2.4); scene.add(g); return { g, tg, neonM, nc };
});

// payout plaza
const coin = new THREE.Group();
{ const b = new THREE.Group(); const wall = new THREE.MeshStandardMaterial({ color: 0xf2d6e8, roughness: .6 });
  const main = new THREE.Mesh(new THREE.BoxGeometry(16, 24, 26), wall); main.position.set(-8, 12, 0); b.add(main);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(9, 10, 12), wall); tower.position.set(-9, 29, 0); b.add(tower);
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(.2, 5, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(.75, .55, .4) })); lobby.position.set(.05, 2.8, 0); b.add(lobby);
  const sol = [[0x9945ff, -9], [0x5f8bff, -6.3], [0x19fb9b, 6.3], [0x14f195, 9]];
  sol.forEach(([c, z]) => { const s = new THREE.Mesh(new THREE.BoxGeometry(.35, 22, .8), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2) })); s.position.set(.1, 12, z); b.add(s); });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), board(1280, 400, (x, w, h) => { x.fillStyle = '#0b0d0a'; x.fillRect(0, 0, w, h); const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#9945FF'); g.addColorStop(1, '#14F195'); x.strokeStyle = g; x.lineWidth = 16; x.strokeRect(10, 10, w - 20, h - 20); x.font = '250px BG'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = g; x.fillText('PAYOUT', w / 2, h / 2 + 14); }, 1.7));
  sign.position.set(.2, 16.5, 0); sign.rotation.y = Math.PI / 2; b.add(sign);
  const cm = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: .9, roughness: .25, emissive: 0x8a5a00, emissiveIntensity: .8 });
  const cd = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, .5, 48).rotateX(Math.PI / 2), cm); coin.add(cd);
  const face = new THREE.MeshBasicMaterial({ map: ctex(256, 256, (x) => { x.fillStyle = '#0b0d0a'; x.beginPath(); x.arc(128, 128, 118, 0, 7); x.fill(); x.drawImage(MARK, 44, 44, 168, 168); }), transparent: true });
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), face); f.position.z = s * .27; if (s < 0) f.rotation.y = Math.PI; coin.add(f); }
  coin.position.set(-9, 39, 0); b.add(coin);
  b.position.set(-14.2, 0, STOPZ - 4); b.traverse(o => { if (o.isMesh) o.castShadow = false; }); scene.add(b); }
// cash rain
const NCASH = 220;
const cash = new THREE.InstancedMesh(new THREE.PlaneGeometry(.75, .36), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .6, map: ctex(256, 128, (x, w, h) => { x.fillStyle = '#6fbf5a'; x.fillRect(0, 0, w, h); x.strokeStyle = '#2f6b2a'; x.lineWidth = 8; x.strokeRect(8, 8, w - 16, h - 16); x.fillStyle = '#2f6b2a'; x.beginPath(); x.arc(w / 2, h / 2, 34, 0, 7); x.fill(); x.font = '64px AN'; x.fillStyle = '#c6ff5a'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', w / 2, h / 2 + 3); x.font = '30px AN'; x.fillStyle = '#2f6b2a'; x.fillText('100', 40, 36); x.fillText('100', w - 40, h - 30); }), emissive: 0x2a5a20, emissiveIntensity: .5 }), NCASH);
cash.frustumCulled = false; scene.add(cash);
const cashP = []; { const r = rnd(33); for (let i = 0; i < NCASH; i++) cashP.push({ x: -10 + r() * 14, z: STOPZ - 10 + r() * 24, t0: 42.3 + r() * 6.5, fall: 2.2 + r() * 1.6, ph: r() * 6, rs: .6 + r() * 1.4 }); }

// ---------- camera shots ----------
const P = t => V(pxAt(t), 0, zAt(t));
const SHOTS = [
  [0, t => [V(0, 58 - t * 6, 70 - t * 9), V(0, 12 - t * 1.5, -180)]],
  [4.3, t => [V(5.5, 1.4, -8.5), V(-4.5, .9, 0)]],
  [6.4, t => { const p = P(t); return [p.clone().add(V(0, 3.1, 10)), p.clone().add(V(0, 1.3, -12))]; }],
  [9.4, t => { const p = P(t); return [p.clone().add(V(-6.2, 1.3, 4)), p.clone().add(V(1, 1.4, -6))]; }],
  [11.9, t => { const p = P(t); return [p.clone().add(V(3.5, 5.5, 14)), p.clone().add(V(0, 0, -14))]; }],
  [14.9, t => [V(GARAGE.x + 22, 3.2, GZ + 17), V(GARAGE.x + 3, 2.4, GZ - 1)]],
  [19.8, t => { const p = P(t); return [p.clone().add(V(-1, 6.5, 19)), p.clone().add(V(0, 1, -8))]; }],
  [22.4, t => { const p = P(t); return [p.clone().add(V(11.8, 2.4, -13)), p.clone().add(V(-1, 1.2, 5))]; }],
  [25.0, t => { const p = P(t); return [p.clone().add(V(4.5, 88, 2)), p.clone().add(V(4.5, 0, 1.9))]; }],
  [30.7, t => { const p = P(t); return [p.clone().add(V(1.5, 2.4, 9.5)), p.clone().add(V(0, 1.5, -20))]; }],
  [33.8, t => { const p = P(t); return [p.clone().add(V(8, 15, 16)), p.clone().add(V(-2, 1, -8))]; }],
  [37.3, t => [V(6, 3.4, STOPZ - 15), V(-5, 3.2, STOPZ + 6)]],
  [41.4, t => [V(5.5, 3.2, STOPZ + 14 - (t - 41.4) * .6), V(-11, 10.5, STOPZ - 5)]],
  [46.8, t => { const a = (t - 46.8) * .42 + .6, p = P(t); return [p.clone().add(V(Math.cos(a) * 14 + 3, 4.6 + Math.sin(t) * .2, Math.sin(a) * 14 + 4)), p.clone().add(V(0, 1.4, 2))]; }],
  [52.0, t => { const u = t - 52; return [V(-4, 5 + u * 3.6, STOPZ + 20 + u * 1.5), V(-3, 9 + u * 3.1, STOPZ - 120)]; }],
];
const BLEND = [0, .01, 1.3, 1.0, 1.0, 1.2, 1.3, .9, 1.4, 1.2, 1.1, 1.2, 1.1, 1.3, 1.6];
function camAt(t) {
  let i = 0; while (i < SHOTS.length - 1 && t >= SHOTS[i + 1][0]) i++;
  const [pa, ta] = SHOTS[i][1](t); const b = BLEND[i];
  if (i > 0 && t < SHOTS[i][0] + b) { const u = smr(seg(t, SHOTS[i][0], SHOTS[i][0] + b)); const [pb, tb] = SHOTS[i - 1][1](t); return [pb.lerp(pa, u), tb.lerp(ta, u), i]; }
  return [pa, ta, i];
}
function upAt(t) { const u = sm(seg(t, 25.0, 26.4)) * (1 - sm(seg(t, 30.7, 31.9))); return V(0, 1 - u, -u).normalize(); }

// ---------- HUD refs ----------
const $ = id => document.getElementById(id);
const radar = $('radar').getContext('2d');
const MISSIONS = [[6.1, 8.6, 'MISSION 1', 'JOIN A CAMPAIGN'], [15.0, 17.3, 'MISSION 2', 'LAUNCH YOUR AGENTS'], [25.4, 27.6, 'MISSION 3', 'POST EVERYWHERE'], [37.3, 39.6, 'MISSION 4', 'GET PAID']];
const SUBS = [
  [8.7, 11.8, 'Brands pay clippers for every <i>1,000 views</i>.'],
  [11.9, 14.8, 'Drive into the <i>campaign marker</i> to join one.'],
  [17.4, 20.6, 'Launch your <b>Vello agents</b>. Your AI clipping crew.'],
  [20.7, 24.9, 'They watch the long videos and cut the <b>best moments</b>.'],
  [27.7, 30.6, 'Every clip gets posted to <u>TikTok</u>, <u>Reels</u> & <u>Shorts</u>.'],
  [30.8, 36.9, 'Every day. On autopilot. Watch the <i>views</i> stack up.'],
  [39.7, 42.2, 'The campaign counts your <i>verified views</i>.'],
  [42.3, 46.6, 'Your payout lands in <b>your wallet</b>. Settled on Solana.'],
];
const STAR_T = [26.8, 28.3, 29.8, 32.0, 33.6];
const VIEW_ADD = [120, 160, 150, 200, 200];
const vproj = new THREE.Vector3();
const toScreen = p => { vproj.copy(p).project(camera); return [(vproj.x * .5 + .5) * 1920, (-vproj.y * .5 + .5) * 1080, vproj.z]; };
const pad = (n, k) => String(Math.floor(n)).padStart(k, '0');

// ---------- update ----------
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), s4 = new THREE.Vector3();
function placeCar(c, pos, heading, speed, t, dist) {
  c.position.copy(pos); c.rotation.y = heading;
  c.userData.wheels.forEach(w => w.rotation.x = -dist / .36);
  const b = c.userData.body; b.position.y = .02 * Math.sin(t * 13 + pos.x) * clamp(speed / 10) + .015;
  b.rotation.x = -.012 * clamp(speed / 20);
}
function update(t) {
  const pz = zAt(t), p = P(t), sp = vAt(t);
  // environment
  const night = sm(seg(t, 20, 50)) * .75;
  skyU.uNight.value = night; skyU.uSunY.value = lerp(.075, .012, seg(t, 0, 60)); skyU.uT.value = t;
  bldU.uNight.value = night; bldU.uLit.value = lerp(.28, .5, seg(t, 5, 45));
  scene.fog.color.copy(FOG).lerp(new THREE.Color(0x2a1236), night * .8); bldU.uFog.value = scene.fog.color;
  hemi.intensity = lerp(1.0, .6, night); key.intensity = lerp(2.4, 1.1, night); key.color.set(0xffa066).lerp(new THREE.Color(0xff6aa8), night);
  key.position.set(p.x + 6, 18, p.z - 30); key.target.position.copy(p);
  rim.position.set(p.x - 8, 10, p.z + 25); rim.target.position.copy(p);
  // player
  placeCar(player, p, 0, sp, t, -pz);
  player.rotation.y = -.25 * (pxAt(t + .05) - pxAt(t - .05)) * 10 * .1;
  player.userData.body.rotation.z = .05 * Math.sin(Math.PI * seg(t, 4.95, 5.4)) * (t < 5.6);
  // agents
  AG.forEach((a, i) => { const c = agents[i]; const u = seg(t, a.e, a.e + 2.3); c.visible = t > a.e - .1;
    if (!c.visible) return;
    const formP = V(a.x, 0, pz + a.dz);
    let pos, head = 0;
    if (u < 1) { const e = eio(u); const P0 = V(GARAGE.x + 1, 0, GZ), P1 = V(-6, 0, GZ), P2 = V(a.x, 0, GZ - 7); const P3 = formP;
      const b = (A, B, C, D, s) => A.clone().multiplyScalar((1 - s) ** 3).add(B.clone().multiplyScalar(3 * (1 - s) ** 2 * s)).add(C.clone().multiplyScalar(3 * (1 - s) * s * s)).add(D.clone().multiplyScalar(s ** 3));
      pos = b(P0, P1, P2, P3, e); const pn = b(P0, P1, P2, P3, Math.min(1, e + .01)); head = Math.atan2(-(pn.x - pos.x), -(pn.z - pos.z)); if (pn.distanceTo(pos) < 1e-4) head = 0;
    } else pos = formP;
    placeCar(c, pos, head, sp + 6 * (u < 1), t, -pos.z + i * 3 + pos.x);
    c.userData.ug.material.opacity = .8 + .2 * Math.sin(t * 6 + i); });
  // traffic
  TRAF.forEach((c, i) => { const ud = c.userData; let z = ud.z0 + ud.sp * t; const rel = ((z - pz) % 290 + 290) % 290 - 250; c.position.set(ud.lane, 0, pz + rel); c.rotation.y = Math.PI; c.userData.wheels.forEach(w => w.rotation.x = z / .36); });
  // marker
  { const hit = seg(t, 13.6, 14.1); marker.visible = t < 14.1; marker.userData.ic.rotation.y = t * 2.5; marker.userData.ic.position.y = 5.2 + Math.sin(t * 3) * .25; marker.scale.set(1 + hit * 1.5, 1 - hit, 1 + hit * 1.5); }
  // garage door & glow
  door.position.y = 2.5 + 5 * eo(seg(t, 16.9, 17.8)); garage.userData.floorGlow.material.opacity = sm(seg(t, 17.0, 17.6));
  // pickups
  PK.forEach(k => { const d = t - k.tc; k.g.visible = d < .25; k.g.rotation.y = t * 3 + k.tc; k.g.position.y = 1.4 + Math.sin(t * 4 + k.tc) * .15 + (d > 0 ? d * 8 : 0); k.g.scale.setScalar(d > 0 ? 1 + d * 4 : 1); });
  // gates flash
  GATES.forEach(G => { const f = Math.max(bump(t, G.tg, .12), bump(t, G.tg + .3, .12) * .7); G.neonM.color.set(G.nc).multiplyScalar(2.4 + 5 * f); });
  coin.rotation.y = t * 1.3;
  // cash
  { let n = 0; cashP.forEach(c => { const d = t - c.t0; if (d < 0) return; const u = Math.min(1, d / c.fall); const y = lerp(16, .05, u); const land = u >= 1; e4.set(land ? -Math.PI / 2 : Math.sin(d * 5 * c.rs + c.ph) * 1.5, d * c.rs * 2 * (land ? 0 : 1) + c.ph, land ? 0 : Math.cos(d * 4 + c.ph)); q4.setFromEuler(e4); s4.setScalar(1); m4.compose(V(c.x + Math.sin(d * 2 + c.ph) * .6 * (1 - u), y, c.z), q4, s4); cash.setMatrixAt(n++, m4); }); cash.count = n; cash.instanceMatrix.needsUpdate = true; }
  // camera
  const [cp, ct, si] = camAt(t);
  const shake = .06 * bump(t, 13.6, .12) + .03 * bump(t, 5.0, .2);
  camera.position.copy(cp).add(V(Math.sin(t * 57) * shake, Math.sin(t * 43) * shake, 0));
  camera.up.copy(upAt(t)); camera.lookAt(ct);
  camera.fov = 42 + 6 * clamp(sp / 24) * (si === 2 || si === 9 ? 1 : 0) + 8 * sm(seg(t, 25, 26)) * (1 - sm(seg(t, 30.7, 31.5))) * 0; camera.updateProjectionMatrix();
  sky.position.copy(camera.position); scene.userData.skyline.position.x = camera.position.x * .9;
  // retro
  retro.uniforms.uTime.value = t;
  retro.uniforms.uPix.value = 1 + 4 * sm(seg(t, 25.6, 26.4)) * (1 - sm(seg(t, 30.2, 30.9)));
  retro.uniforms.uBox.value = Math.max(1 - sm(seg(t, 4.6, 5.6)), sm(seg(t, 14.9, 15.6)) * (1 - sm(seg(t, 19.6, 20.4))), sm(seg(t, 51.8, 52.8)));
  retro.uniforms.uGlitch.value = bump(t, 4.35, .08) + bump(t, 25.0, .1) + bump(t, 30.7, .08) + .6 * bump(t, 13.65, .06) + bump(t, 51.9, .1);
  retro.uniforms.uFlash.value = .35 * bump(t, 13.62, .05) + .25 * bump(t, 47.0, .06);
  bloom.strength = .6 + .2 * night;

  // ---- DOM ----
  $('fade').style.opacity = 1 - sm(seg(t, 0, .7));
  const T0 = $('title'); T0.style.opacity = sm(seg(t, .3, 1.0)) * (1 - sm(seg(t, 4.1, 4.5)));
  T0.querySelector('.logo').style.transform = `translateX(${(1 - eo(seg(t, .4, 1.3))) * -120}px)`;
  const cityOn = seg(t, 1.2, 1.9); T0.querySelector('.city').style.opacity = (cityOn > 0 && cityOn < 1) ? (Math.sin(t * 80) > 0 ? 1 : .15) : cityOn;
  $('barf').style.width = (eio(seg(t, 1.5, 4.0)) * 100) + '%';
  $('loadtxt').textContent = t < 4.0 ? 'LOADING: HOW TO MAKE MONEY WITH VELLO' : 'READY';
  const hudOn = sm(seg(t, 5.4, 6.0)) * (1 - sm(seg(t, 51.6, 52.2)));
  $('hud').style.opacity = hudOn;
  $('radio').style.opacity = seg(t, 5.0, 5.2) * (1 - seg(t, 8.0, 8.4));
  // clock
  const mins = 19 * 60 + 45 + Math.floor(t * 3.2); $('clock').textContent = `${pad((mins / 60) % 24, 2)}:${pad(mins % 60, 2)}`;
  // money
  const money = 2490 * sm(seg(t, 43.9, 45.9)); $('money').textContent = '$' + pad(money, 8);
  $('money').style.transform = `scale(${1 + .12 * Math.sin(t * 30) * (t > 43.9 && t < 45.9)})`; $('money').style.transformOrigin = 'right center';
  // stars
  const stars = $('stars').querySelectorAll('.s'); const flash = t > 33.6 && t < 37 ? (Math.floor(t * 6) % 2) : 1;
  stars.forEach((s, i) => { const on = t > STAR_T[i]; s.classList.toggle('on', on && flash === 1); s.style.transform = `scale(${1 + .6 * bump(t, STAR_T[i] + .1, .12)})`; });
  let clips = 0; PK.forEach(k => { if (t > k.tc) clips += 12; }); $('clips').textContent = 'CLIPS ' + pad(clips, 3);
  $('clips').style.opacity = seg(t, 20.5, 20.8);
  // radar
  { const R_ = radar; R_.save(); R_.clearRect(0, 0, 300, 300); R_.fillStyle = '#26332a'; R_.fillRect(0, 0, 300, 300); const sc = 1.3;
    R_.fillStyle = '#6d7d71'; R_.fillRect(150 - 9.5 * sc + 4.5 * sc, 0, 19 * sc, 300);
    cross.forEach(z => { const y = 150 + (z - pz) * sc; if (y > -20 && y < 320) R_.fillRect(0, y - 5, 300, 10); });
    R_.fillStyle = '#3c4a40'; blds.forEach(b => { const y = 150 + (b.z - pz) * sc, x = 150 + (b.x + 4.5) * sc; if (y > -40 && y < 340) R_.fillRect(x - b.d * sc / 2, y - b.w * sc / 2, b.d * sc, b.w * sc); });
    const obj = t < 13.6 ? V(-4.5, 0, zAt(13.6)) : t < 20 ? V(GARAGE.x, 0, GZ) : t < 30 ? V(0, 0, zAt(29.8)) : V(-14, 0, STOPZ - 4);
    let ox = (obj.x + 4.5) * sc, oy = (obj.z - pz) * sc; const L = Math.hypot(ox, oy); if (L > 128) { ox *= 128 / L; oy *= 128 / L; }
    R_.fillStyle = '#ffd23f'; R_.strokeStyle = '#000'; R_.lineWidth = 3; R_.beginPath(); R_.arc(150 + ox, 150 + oy, 9, 0, 7); R_.fill(); R_.stroke();
    AG.forEach((a, i) => { if (!agents[i].visible) return; const q = agents[i].position; R_.fillStyle = '#c6ff5a'; R_.beginPath(); R_.arc(150 + (q.x + 4.5) * sc - (p.x + 4.5) * sc * 0, 150 + (q.z - pz) * sc, 7, 0, 7); R_.fill(); R_.stroke(); });
    R_.fillStyle = '#fff'; R_.beginPath(); R_.moveTo(150 + (p.x + 4.5) * sc, 136); R_.lineTo(160 + (p.x + 4.5) * sc, 160); R_.lineTo(140 + (p.x + 4.5) * sc, 160); R_.closePath(); R_.fill(); R_.stroke();
    R_.font = '26px AN'; R_.fillStyle = '#fff'; R_.textAlign = 'center'; R_.lineWidth = 5; R_.strokeText('N', 150, 32); R_.fillText('N', 150, 32);
    R_.restore(); }
  // mission titles
  let mt = ''; let mo = 0;
  MISSIONS.forEach(([s, e, a, b]) => { if (t >= s && t <= e) { mo = sm(seg(t, s, s + .3)) * (1 - sm(seg(t, e - .35, e))); const sc = 1 + .25 * (1 - eback(seg(t, s, s + .5))); mt = `<small>${a}</small>${b}`; $('mtitle').style.transform = `scale(${sc})`; } });
  $('mtitle').innerHTML = mt; $('mtitle').style.opacity = mo;
  // subtitles typewriter
  let st = '';
  SUBS.forEach(([s, e, h]) => { if (t >= s && t <= e) { const plain = h.replace(/<[^>]+>/g, ''); const n = Math.floor(seg(t, s, s + plain.length * .022) * plain.length); let out = '', cnt = 0, inTag = false; for (const ch of h) { if (ch === '<') inTag = true; if (inTag) { out += ch; if (ch === '>') inTag = false; continue; } if (cnt < n) out += ch; cnt++; } st = `<span style="opacity:${1 - sm(seg(t, e - .25, e))}">${out}</span>`; } });
  $('mtext').innerHTML = st; $('mtext').style.right = (t > 42.1 && t < 47 ? 620 : 260) + 'px'; $('mtext').style.left = (t > 42.1 && t < 47 ? 420 : 260) + 'px';
  // pops
  let ph = '';
  const pop = (tp, dur, pos, txt, cls) => { const d = t - tp; if (d < 0 || d > dur) return; const [x, y, z] = toScreen(pos); if (z > 1) return; const u = eback(seg(d, 0, .35)); ph += `<div class="pop ${cls}" style="left:${x}px;top:${y - d * 70}px;transform:translate(-50%,-50%) scale(${u});opacity:${1 - seg(d, dur - .3, dur)}">${txt}</div>`; };
  pop(13.65, 1.6, V(-4.5, 4.5, zAt(13.6)), 'CAMPAIGN JOINED', 'y');
  pop(14.2, 1.3, V(-4.5, 3.2, zAt(14.2)), '$3.00 / 1K VIEWS', '');
  PK.forEach(k => { const pos = k.c < 0 ? V(-4.5, 2.6, zAt(k.tc)) : V(AG[k.c].x, 2.6, zAt(k.tc) + AG[k.c].dz); pop(k.tc, .9, pos, '+12 CLIPS', 'l'); });
  STAR_T.forEach((ts, i) => { const pos = i < 3 ? V(0, 12.5, zAt(GATES[i].tg) - 2.4) : P(ts).add(V(0, 3.5, 0)); pop(ts, 1.2, pos, `+${VIEW_ADD[i]}K VIEWS`, 'w'); });
  for (let k = 0; k < 6; k++) pop(44.0 + k * .3, .9, V(-4 - k * .6, 2.2 + k * .3, STOPZ + 1 - k * .3), '+$' + [415, 415, 415, 415, 415, 415][k], '');
  $('pops').innerHTML = ph;
  // phone
  const ph_ = $('phone'); const pu = eo(seg(t, 42.2, 42.75)) * (1 - sm(seg(t, 46.4, 46.9))); ph_.style.bottom = lerp(-760, 90, pu) + 'px'; ph_.style.transform = `rotate(${(1 - pu) * 8}deg)`;
  $('m1').style.opacity = seg(t, 42.9, 43.1); $('m2').style.opacity = seg(t, 43.8, 44.0); $('m2').style.transform = `scale(${eback(seg(t, 43.8, 44.2)) || .01})`; $('m3').style.opacity = seg(t, 45.0, 45.2);
  // mission passed
  const pp = $('passed'); const po = sm(seg(t, 47.0, 47.2)) * (1 - sm(seg(t, 51.3, 51.7))); pp.style.opacity = po; pp.style.transform = `scale(${1 + .3 * (1 - eback(seg(t, 47.0, 47.5)))})`;
  // end
  const E = $('end'); E.style.opacity = sm(seg(t, 52.4, 53.0));
  E.querySelector('.logo').style.transform = `scale(${.7 + .3 * eback(seg(t, 52.4, 53.2))})`;
  E.querySelector('.tag').style.opacity = seg(t, 53.4, 53.8); E.querySelector('.tag').style.transform = `translateY(${(1 - eo(seg(t, 53.4, 54))) * 30}px)`;
  E.querySelector('.url').style.opacity = seg(t, 54.4, 54.8);
  const cu = eback(seg(t, 55.2, 55.7)); E.querySelector('.cta').style.transform = `translateX(-50%) scale(${Math.max(.001, cu)})`;
  $('disc').style.opacity = seg(t, 53.8, 54.4) + (t > 42.3 && t < 51.7 ? .8 * seg(t, 42.3, 42.8) * (1 - seg(t, 51.2, 51.7)) : 0);
}
window.renderAt = t => { update(t); composer.render(); renderer.getContext().finish(); return true; };
window.events = () => {
  const ev = [['title', .35], ['citybuzz', 1.2], ['ready', 4.0], ['glitch', 4.35], ['engine', 4.95], ['radio', 5.0]];
  MISSIONS.forEach(m => ev.push(['mission', m[0]]));
  ev.push(['checkpoint', 13.6]); ev.push(['door', 16.9]);
  AG.forEach(a => ev.push(['agentrev', a.e]));
  PK.forEach(k => ev.push(['pickup', k.tc]));
  GATES.forEach(G => { ev.push(['gate', G.tg]); });
  STAR_T.forEach(s => ev.push(['star', s]));
  ev.push(['whoosh', 25.0], ['whoosh', 30.7], ['whoosh', 33.8], ['brake', 37.9], ['phone', 42.2], ['msg', 42.9], ['cash', 43.8], ['msg', 45.0], ['cashrain', 42.3]);
  for (let k = 0; k < 6; k++) ev.push(['coin', 44.0 + k * .3]);
  ev.push(['passed', 47.0], ['endlogo', 52.4], ['cta', 55.2]);
  SUBS.forEach(s => ev.push(['sub', s[0]]));
  return ev;
};
window.ready = Promise.resolve(true);
