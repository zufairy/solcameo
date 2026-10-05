"use client";

import { useEffect, useRef } from "react";
import type * as Three from "three";
import { GLOBE_HUBS, isLand, loadLandMask } from "@/lib/client/landMask";

export interface ArriveEvent { name: string; code: string }

const VERT = /* glsl */ `
attribute float aSeed;
attribute float aLand;
uniform float uTime;
uniform float uSize;
uniform float uScale;
varying float vGlow;
varying float vFacing;
varying float vLand;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelViewMatrix) * position);
  vFacing = n.z;
  vLand = aLand;
  vSeed = aSeed;
  float band = sin(position.y * 5.0 - uTime * 1.7);
  float glow = pow(max(band, 0.0), 10.0);
  float flick = step(0.987, fract(sin(aSeed * 91.7 + floor(uTime * 9.0) * 13.1) * 43758.5453));
  vGlow = max(glow, flick);
  float s = aLand > 0.5 ? 1.0 : 0.55;
  gl_PointSize = max(1.0, uSize * (1.0 + vGlow * 0.7) * s * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying float vGlow;
varying float vFacing;
varying float vLand;
varying float vSeed;
void main() {
  vec3 land = mix(vec3(0.40, 0.60, 0.15), vec3(0.76, 0.95, 0.38), fract(vSeed * 7.0));
  vec3 sea = vec3(0.10, 0.17, 0.10);
  vec3 base = vLand > 0.5 ? land : sea;
  vec3 col = mix(base, vec3(0.93, 1.0, 0.78), vGlow);
  float a = (vLand > 0.5 ? 0.96 : 0.55) * (0.16 + 0.84 * smoothstep(-0.25, 0.35, vFacing));
  gl_FragColor = vec4(col, a);
}`;

/**
 * Pixelated, fast-paced 3D globe: the world as square lime pixels with a scanning
 * band, pulsing hubs, and payout packets racing along arcs from the brand to agents
 * around the world. Rendered at 1/3 resolution and scaled with `image-rendering:
 * pixelated` so every point is a crisp chunky pixel. Pauses off-screen / hidden tab.
 */
export default function GlobalScene({ onArrive }: { onArrive?: (e: ArriveEvent) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const arrive = useRef(onArrive);
  useEffect(() => { arrive.current = onArrive; }, [onArrive]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void Promise.all([import("three"), loadLandMask().catch(() => null)]).then(([T, mask]: [typeof Three, ImageData | null]) => {
      if (disposed || !host.current) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let renderer: Three.WebGLRenderer;
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" }); } catch { return; }
      const PIX = 3; // css pixels per rendered pixel
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      const canvas = renderer.domElement;
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;image-rendering:pixelated";
      el.appendChild(canvas);

      const scene = new T.Scene();
      const FOV = 34;
      const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 50);
      camera.position.set(0, 0, 5.4);
      const pivot = new T.Group();
      pivot.rotation.set(0.32, 0, -0.18);
      scene.add(pivot);
      const globe = new T.Group();
      pivot.add(globe);

      const toVec = (lat: number, lon: number, r = 1) => {
        const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
        return new T.Vector3(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r);
      };

      // ── Pixel world ──
      const N = 36000, golden = Math.PI * (3 - Math.sqrt(5));
      const pos: number[] = [], seed: number[] = [], isL: number[] = [];
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
        const x = Math.sin(th) * r, z = Math.cos(th) * r;
        const lat = (Math.asin(y) * 180) / Math.PI, lon = (Math.atan2(x, z) * 180) / Math.PI;
        const land = mask ? isLand(mask, lat, lon) : Math.sin(lat * 0.2) * Math.cos(lon * 0.13) > 0.1;
        if (!land && i % 4 !== 0) continue;
        pos.push(x, y, z); seed.push(Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1); isL.push(land ? 1 : 0);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute("aSeed", new T.Float32BufferAttribute(seed, 1));
      geo.setAttribute("aLand", new T.Float32BufferAttribute(isL, 1));
      const uniforms = { uTime: { value: 0 }, uSize: { value: 0.0125 }, uScale: { value: 300 } };
      const mat = new T.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
      globe.add(new T.Points(geo, mat));

      // ── Hubs ──
      const hubMat = new T.MeshBasicMaterial({ color: 0xc6f26a });
      const originMat = new T.MeshBasicMaterial({ color: 0xffffff });
      const hubs = GLOBE_HUBS.map((h, i) => {
        const n = toVec(h.lat, h.lon, 1).normalize();
        const box = new T.Mesh(new T.BoxGeometry(i === 0 ? 0.05 : 0.032, i === 0 ? 0.05 : 0.032, i === 0 ? 0.05 : 0.032), i === 0 ? originMat : hubMat);
        box.position.copy(n.clone().multiplyScalar(1.01));
        box.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n);
        globe.add(box);
        const ringGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(-1, -1, 0), new T.Vector3(1, -1, 0), new T.Vector3(1, 1, 0), new T.Vector3(-1, 1, 0)]);
        const ring = new T.LineLoop(ringGeo, new T.LineBasicMaterial({ color: 0xc6f26a, transparent: true, opacity: 0.8 }));
        ring.position.copy(box.position); ring.quaternion.copy(box.quaternion);
        globe.add(ring);
        return { box, ring, phase: (i * 0.37) % 1, flash: 0 };
      });

      // ── Arcs + packets ──
      type Arc = { p0: Three.Vector3; c: Three.Vector3; p2: Three.Vector3 };
      const arcs: Arc[] = [];
      const lineMat = new T.LineBasicMaterial({ color: 0xc6e685, transparent: true, opacity: 0.2 });
      const bez = (a: Arc, t: number, out: Three.Vector3) => {
        const u = 1 - t;
        return out.set(0, 0, 0).addScaledVector(a.p0, u * u).addScaledVector(a.c, 2 * u * t).addScaledVector(a.p2, t * t);
      };
      for (let i = 1; i < GLOBE_HUBS.length; i++) {
        const p0 = toVec(GLOBE_HUBS[0].lat, GLOBE_HUBS[0].lon, 1.01), p2 = toVec(GLOBE_HUBS[i].lat, GLOBE_HUBS[i].lon, 1.01);
        const c = p0.clone().add(p2).normalize().multiplyScalar(1 + 0.42 * p0.distanceTo(p2));
        const arc = { p0, c, p2 };
        arcs.push(arc);
        const pts: Three.Vector3[] = [];
        for (let k = 0; k <= 40; k++) pts.push(bez(arc, k / 40, new T.Vector3()));
        globe.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), lineMat));
      }
      const packetGeo = new T.BoxGeometry(0.03, 0.03, 0.03);
      const packetMat = new T.MeshBasicMaterial({ color: 0xf1ffd0 });
      const packets = Array.from({ length: 12 }, () => {
        const m = new T.Mesh(packetGeo, packetMat);
        m.visible = false; globe.add(m);
        return { m, arc: -1, t: 0, dur: 1.4 };
      });

      // ── Layout / loop ──
      let w = 1, h = 1;
      const resize = () => {
        w = el.clientWidth || 1; h = el.clientHeight || 1;
        const pw = Math.max(2, Math.round(w / PIX)), ph = Math.max(2, Math.round(h / PIX));
        renderer.setSize(pw, ph, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        uniforms.uScale.value = ph / (2 * Math.tan((FOV * Math.PI) / 360));
        const vh = 2 * Math.tan((FOV * Math.PI) / 360) * camera.position.z, vw = vh * camera.aspect;
        const s = Math.min(vh * 0.34, vw * 0.34);
        pivot.scale.setScalar(s);
        const wide = camera.aspect > 1.15;
        pivot.position.set(wide ? vw * 0.2 : 0, wide ? 0 : -vh * 0.06, 0);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);

      let tx = 0, ty = 0;
      const onMove = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth - 0.5) * 0.35; ty = (e.clientY / window.innerHeight - 0.5) * 0.25; };
      window.addEventListener("pointermove", onMove, { passive: true });

      let visible = true;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
      io.observe(el);
      const onVis = () => { last = performance.now(); };
      document.addEventListener("visibilitychange", onVis);

      let last = performance.now(), elapsed = 0;
      let raf = 0, spawnIn = 0.2;
      const tmp = new T.Vector3();
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (!visible || document.hidden) return;
        const nowMs = performance.now();
        const dt = Math.min((nowMs - last) / 1000, 0.05);
        last = nowMs; elapsed += dt;
        const t = elapsed;
        uniforms.uTime.value = t;
        if (!reduced) globe.rotation.y += dt * 0.3;
        pivot.rotation.x += (0.32 + ty - pivot.rotation.x) * 0.05;
        pivot.rotation.z += (-0.18 + tx * 0.4 - pivot.rotation.z) * 0.05;

        for (const hub of hubs) {
          hub.flash = Math.max(0, hub.flash - dt * 2.2);
          const k = (t * 0.9 + hub.phase) % 1;
          const sc = 0.03 + k * 0.09 + hub.flash * 0.05;
          hub.ring.scale.setScalar(sc);
          (hub.ring.material as Three.LineBasicMaterial).opacity = (1 - k) * 0.7 + hub.flash * 0.3;
          hub.box.scale.setScalar(1 + hub.flash * 1.2);
        }

        if (!reduced) {
          spawnIn -= dt;
          if (spawnIn <= 0) {
            spawnIn = 0.35 + Math.random() * 0.25;
            const free = packets.find((p) => p.arc < 0);
            if (free) { free.arc = Math.floor(Math.random() * arcs.length); free.t = 0; free.dur = 1.1 + Math.random() * 0.7; free.m.visible = true; }
          }
          for (const p of packets) {
            if (p.arc < 0) continue;
            p.t += dt / p.dur;
            if (p.t >= 1) {
              const hub = hubs[p.arc + 1];
              hub.flash = 1;
              const meta = GLOBE_HUBS[p.arc + 1];
              arrive.current?.({ name: meta.name, code: meta.code });
              p.arc = -1; p.m.visible = false; continue;
            }
            p.m.position.copy(bez(arcs[p.arc], p.t, tmp));
            p.m.scale.setScalar(0.8 + Math.sin(p.t * Math.PI) * 0.8);
          }
        }
        renderer.render(scene, camera);
      };
      frame();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect(); io.disconnect();
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("visibilitychange", onVis);
        scene.traverse((o) => {
          const m = o as Three.Mesh;
          m.geometry?.dispose?.();
          const mm = m.material as Three.Material | Three.Material[] | undefined;
          if (Array.isArray(mm)) mm.forEach((x) => x.dispose()); else mm?.dispose?.();
        });
        renderer.dispose();
        canvas.remove();
      };
    });

    return () => { disposed = true; cleanup?.(); };
  }, []);

  return <div ref={host} className="pointer-events-none absolute inset-0" aria-hidden />;
}
