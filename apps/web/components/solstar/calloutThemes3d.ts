import * as THREE from "three";
import type { CalloutTheme } from "@/lib/solstar/callout";

/**
 * One small three.js scene per callout theme, drawn behind the card's text. Each is decorative (no market data) and built from
 * primitives, so there are no model files to load. Layout is in units of the card's HEIGHT so every size reads the same.
 */
export interface ThemeScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(width: number, height: number): void;
  update(time: number): void;
  dispose(): void;
}

type Built = { group: THREE.Group; update: (t: number, aspect: number) => void };
const FOV = 30, DIST = 10;
/** Visible height at z = 0 for the fixed camera: layout units are fractions of this. */
const VIEW_H = 2 * Math.tan((FOV * Math.PI) / 360) * DIST;
/** Where the animation sits across the card, as a share of its width from the centre: between the name and the big figure. */
const CX = 0.06;
const rand = (seed: number) => { const x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); };

function solana(accent: string): Built {
  const group = new THREE.Group();
  // The three slanted bars of the Solana mark, in its green to purple gradient, turning slowly.
  const mat = new THREE.ShaderMaterial({
    uniforms: { a: { value: new THREE.Color("#14f195") }, b: { value: new THREE.Color("#9945ff") } },
    vertexShader: "varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying float vY; uniform vec3 a; uniform vec3 b; void main(){ gl_FragColor = vec4(mix(b, a, clamp((vY + 1.0) / 2.0, 0.0, 1.0)), 0.92); }",
    transparent: true,
  });
  const bar = (dir: 1 | -1) => {
    const w = 2.4, h = 0.42, k = 0.5, s = new THREE.Shape();
    if (dir === 1) { s.moveTo(k, 0); s.lineTo(w + k, 0); s.lineTo(w, h); s.lineTo(0, h); } else { s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w + k, h); s.lineTo(k, h); }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false });
    g.translate(-(w + k) / 2, 0, -0.07);
    return new THREE.Mesh(g, mat);
  };
  const mark = new THREE.Group();
  ([[0.72, 1], [0, -1], [-0.72, 1]] as const).forEach(([y, d]) => { const m = bar(d); m.position.y = y - 0.21; mark.add(m); });
  group.add(mark);
  // A stream of "blocks" flowing past: tiny points drifting left to right, like transactions confirming.
  const count = 90, pos = new Float32Array(count * 3), seeds = Array.from({ length: count }, (_, i) => ({ x: rand(i + 1), y: rand(i + 7), s: 0.25 + rand(i + 13) * 0.7 }));
  const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: accent, size: 0.07, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(points);
  return {
    group,
    update(t, aspect) {
      const W = VIEW_H * aspect;
      mark.position.set(W * CX, Math.sin(t * 0.9) * 0.08 * VIEW_H, 0);
      mark.rotation.y = Math.sin(t * 0.55) * 0.5;
      mark.rotation.x = Math.sin(t * 0.4) * 0.12;
      mark.scale.setScalar(VIEW_H * 0.2);
      for (let i = 0; i < count; i++) {
        const sd = seeds[i];
        pos[i * 3] = ((sd.x + t * 0.04 * sd.s) % 1) * W - W / 2;
        pos[i * 3 + 1] = (sd.y - 0.5) * VIEW_H;
        pos[i * 3 + 2] = -0.5 - sd.s;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

function lambo(accent: string): Built {
  const group = new THREE.Group();
  const car = new THREE.Group();
  const body = new THREE.Shape();
  [[-2.05, 0.22], [2.05, 0.22], [2.12, 0.5], [1.2, 0.7], [0.3, 1.04], [-0.85, 1.02], [-1.7, 0.78], [-2.1, 0.56]].forEach(([x, y], i) => (i ? body.lineTo(x, y) : body.moveTo(x, y)));
  const bodyGeo = new THREE.ExtrudeGeometry(body, { depth: 1.1, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
  bodyGeo.translate(0, 0, -0.55);
  car.add(new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: accent, metalness: 0.55, roughness: 0.28 })));
  const glass = new THREE.Shape();
  [[-0.7, 0.72], [0.18, 0.72], [0.38, 1.02], [-0.7, 1.0]].forEach(([x, y], i) => (i ? glass.lineTo(x, y) : glass.moveTo(x, y)));
  const glassGeo = new THREE.ExtrudeGeometry(glass, { depth: 1.14, bevelEnabled: false }); glassGeo.translate(0, 0.01, -0.57);
  car.add(new THREE.Mesh(glassGeo, new THREE.MeshStandardMaterial({ color: "#0b1018", metalness: 0.8, roughness: 0.15 })));
  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 28);
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#14161a", metalness: 0.4, roughness: 0.6 });
  [[-1.2, 0.5], [1.2, 0.5], [-1.2, -0.5], [1.2, -0.5]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat); w.rotation.x = Math.PI / 2; w.position.set(x, 0.34, z); wheels.push(w); car.add(w);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12), new THREE.MeshStandardMaterial({ color: "#d4d8de", metalness: 0.9, roughness: 0.2 })); rim.rotation.x = Math.PI / 2; rim.position.copy(w.position); car.add(rim);
  });
  const lamp = (x: number, color: string) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), new THREE.MeshBasicMaterial({ color })); m.position.set(x, 0.52, 0); car.add(m); };
  lamp(2.1, "#fff6c2"); lamp(-2.08, "#ff3b3b");
  // Underglow beneath the car.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.7), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04; car.add(glow);
  group.add(car);
  group.add(new THREE.AmbientLight("#ffffff", 0.9));
  const key = new THREE.DirectionalLight("#ffffff", 2.2); key.position.set(3, 5, 6); group.add(key);
  // The road: dashes and speed streaks rushing past.
  const dashes: THREE.Mesh[] = [], streaks: THREE.Mesh[] = [];
  const dashMat = new THREE.MeshBasicMaterial({ color: "#f5f1d8", transparent: true, opacity: 0.55 });
  for (let i = 0; i < 12; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.16), dashMat); group.add(d); dashes.push(d); }
  const streakMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.4 + rand(i) * 1.8, 0.018, 0.02), streakMat); group.add(s); streaks.push(s); }
  return {
    group,
    update(t, aspect) {
      const W = VIEW_H * aspect;
      car.scale.setScalar(VIEW_H * 0.17);
      car.position.set(W * CX, -VIEW_H * 0.3 + Math.sin(t * 11) * 0.004 * VIEW_H, 0);
      car.rotation.y = -0.52; car.rotation.z = Math.sin(t * 1.3) * 0.012;
      wheels.forEach((w) => { w.rotation.y = -t * 18; });
      dashes.forEach((d, i) => { d.position.set((((i / dashes.length) - ((t * 0.5) % 1) + 2) % 1) * W * 1.3 - W * 0.65, -VIEW_H * 0.43, 1.15); d.scale.setScalar(VIEW_H * 0.14); });
      streaks.forEach((m, i) => { m.position.set((((i / streaks.length) + 1 - ((t * (0.8 + (i % 3) * 0.25)) % 1)) % 1) * W * 1.2 - W * 0.6, (rand(i + 3) - 0.5) * VIEW_H * 0.9, -1); });
    },
  };
}

function pepe(accent: string): Built {
  const group = new THREE.Group();
  const frog = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55, metalness: 0.05 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 28), skin); head.scale.set(1.3, 0.95, 1); frog.add(head);
  const lids: THREE.Mesh[] = [];
  [-0.62, 0.62].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.44, 24, 20), new THREE.MeshStandardMaterial({ color: "#fafaf5", roughness: 0.25 })); eye.position.set(x, 0.78, 0.45); frog.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 14), new THREE.MeshBasicMaterial({ color: "#101114" })); pupil.position.set(x * 1.04, 0.8, 0.84); frog.add(pupil);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 20), skin); lid.position.copy(eye.position); lid.scale.set(1, 0.04, 1); lid.position.y += 0.2; frog.add(lid); lids.push(lid);
  });
  // The wide, slightly smug smile and rosy cheeks.
  frog.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.95, -0.15, 0.82), new THREE.Vector3(0, -0.72, 1.02), new THREE.Vector3(0.95, -0.15, 0.82)), 32, 0.045, 8), new THREE.MeshBasicMaterial({ color: "#14301a" })));
  [-0.85, 0.85].forEach((x) => { const c = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: "#f59ab0", transparent: true, opacity: 0.55 })); c.position.set(x, -0.18, 0.86); c.scale.z = 0.4; frog.add(c); });
  group.add(frog);
  group.add(new THREE.AmbientLight("#ffffff", 1.1));
  const key = new THREE.DirectionalLight("#ffffff", 2); key.position.set(2, 4, 6); group.add(key);
  // Gold coins orbiting: the "to the moon" part of the joke.
  const coins: THREE.Mesh[] = [];
  const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20), coinMat = new THREE.MeshStandardMaterial({ color: "#fbbf24", metalness: 0.85, roughness: 0.22, emissive: "#6b4600", emissiveIntensity: 0.4 });
  for (let i = 0; i < 7; i++) { const c = new THREE.Mesh(coinGeo, coinMat); c.rotation.x = Math.PI / 2; group.add(c); coins.push(c); }
  return {
    group,
    update(t, aspect) {
      const W = VIEW_H * aspect;
      frog.scale.setScalar(VIEW_H * 0.17);
      frog.position.set(W * CX, Math.sin(t * 1.4) * 0.05 * VIEW_H, 0);
      frog.rotation.y = Math.sin(t * 0.7) * 0.4; frog.rotation.z = Math.sin(t * 0.9) * 0.05;
      const blink = (t % 3.4) > 3.25 ? 1 : 0.04;
      lids.forEach((l) => { l.scale.y = blink; });
      coins.forEach((c, i) => {
        const a = t * 0.8 + (i / coins.length) * Math.PI * 2;
        c.position.set(W * CX + Math.cos(a) * VIEW_H * 0.46, Math.sin(a * 1.3) * VIEW_H * 0.32, Math.sin(a) * 0.8);
        c.rotation.y = t * 3 + i; c.scale.setScalar(VIEW_H * 0.2);
      });
    },
  };
}

function bullrun(accent: string): Built {
  const group = new THREE.Group();
  const N = 26;
  type Candle = { body: THREE.Mesh; wick: THREE.Mesh; open: number; close: number; high: number; low: number };
  const up = new THREE.MeshBasicMaterial({ color: accent }), down = new THREE.MeshBasicMaterial({ color: "#fb7185" });
  const spawn = (serial: number, prev: number): Candle => {
    const open = prev, close = prev + (rand(serial + 5) - 0.36) * 0.26 + 0.03;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2), up), wick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), up);
    group.add(body, wick);
    return { body, wick, open, close, high: Math.max(open, close) + rand(serial + 9) * 0.14, low: Math.min(open, close) - rand(serial + 11) * 0.14 };
  };
  const candles: Candle[] = [];
  let level = -0.2, serial = 0;
  for (let i = 0; i < N + 2; i++) { const c = spawn(serial++, level); level = c.close; candles.push(c); }
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.4 }));
  group.add(line);
  let lastStep = 0;
  return {
    group,
    update(t, aspect) {
      const W = VIEW_H * aspect;
      const step = Math.floor(t / 0.9), frac = (t / 0.9) % 1;
      while (lastStep < step) {
        lastStep++;
        const old = candles.shift()!; group.remove(old.body, old.wick); old.body.geometry.dispose(); old.wick.geometry.dispose();
        candles.push(spawn(serial++, candles[candles.length - 1].close));
      }
      const mid = candles.reduce((m, c) => m + c.close, 0) / candles.length;
      const k = VIEW_H * 0.24 * 2.4, span = W * 0.3, gap = span / N, x0 = W * 0.2 - span;
      const pts: THREE.Vector3[] = [];
      candles.forEach((c, i) => {
        const x = x0 + (i - frac) * gap, mat = c.close >= c.open ? up : down;
        c.body.material = mat; c.wick.material = mat;
        const top = Math.max(c.open, c.close), bot = Math.min(c.open, c.close);
        c.body.scale.set(gap * 0.62, Math.max(0.01, (top - bot) * k), 1); c.body.position.set(x, ((top + bot) / 2 - mid) * k, 0);
        c.wick.scale.set(1, (c.high - c.low) * k, 1); c.wick.position.set(x, ((c.high + c.low) / 2 - mid) * k, 0);
        pts.push(new THREE.Vector3(x, (c.close - mid) * k, 0.1));
      });
      line.geometry.setFromPoints(pts);
    },
  };
}

function diamond(accent: string): Built {
  const group = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: accent, metalness: 0.35, roughness: 0.08, flatShading: true, transparent: true, opacity: 0.88 }));
  gem.scale.y = 1.35;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(gem.geometry), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.75 }));
  edges.scale.copy(gem.scale);
  const rig = new THREE.Group(); rig.add(gem, edges); group.add(rig);
  group.add(new THREE.AmbientLight("#ffffff", 0.7));
  const key = new THREE.DirectionalLight("#ffffff", 3); key.position.set(3, 5, 4); group.add(key);
  const rim = new THREE.PointLight(accent, 20, 12); rim.position.set(-3, -2, 3); group.add(rim);
  const sparks = Array.from({ length: 22 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9 }));
    group.add(m); return { m, a: rand(i + 2) * Math.PI * 2, r: 0.9 + rand(i + 5) * 0.9, y: (rand(i + 8) - 0.5) * 1.6, p: rand(i + 12) * 6 };
  });
  return {
    group,
    update(t, aspect) {
      const W = VIEW_H * aspect;
      rig.scale.setScalar(VIEW_H * 0.2);
      rig.position.set(W * CX, Math.sin(t * 1.1) * 0.04 * VIEW_H, 0);
      rig.rotation.y = t * 0.7; rig.rotation.z = Math.sin(t * 0.5) * 0.1;
      sparks.forEach((s) => {
        const a = s.a + t * 0.3;
        s.m.position.set(W * CX + Math.cos(a) * s.r * VIEW_H * 0.3, s.y * VIEW_H * 0.3, Math.sin(a) * 0.6);
        const tw = 0.5 + 0.5 * Math.sin(t * 3 + s.p); (s.m.material as THREE.MeshBasicMaterial).opacity = tw * tw; s.m.scale.setScalar(VIEW_H * 0.5 * (0.4 + tw));
        s.m.rotation.y = t * 2 + s.p;
      });
    },
  };
}

const BUILDERS: Record<CalloutTheme, (accent: string) => Built> = { solana, lambo, pepe, bullrun, diamond };

export function createThemeScene(theme: CalloutTheme, accent: string): ThemeScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 4, 0.1, 60);
  camera.position.set(0, 0, DIST);
  const built = BUILDERS[theme](accent);
  scene.add(built.group);
  let aspect = 4;
  return {
    scene, camera,
    resize(width, height) { aspect = Math.max(0.5, width / Math.max(1, height)); camera.aspect = aspect; camera.updateProjectionMatrix(); },
    update(time) { built.update(time, aspect); },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => x.dispose());
      });
    },
  };
}
