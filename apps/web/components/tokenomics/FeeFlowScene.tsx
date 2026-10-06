"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { SplitKey } from "@/lib/tokenomics/liveMath";
import { FLOW_NODES } from "./flowNodes";

/**
 * Three.js explainer: buyers push SOL up a bonding curve, every trade pays a small fee, and that fee fans out
 * into four streams (creator, content budget, platform, Meteora). Stream thickness and the size of each
 * destination follow the real split; the particle rate follows `activity` (0..1).
 * Labels are HTML pinned to the 3D destinations so they stay crisp and selectable.
 */

const VERT = /* glsl */ `
  attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
  uniform float uPx; varying vec3 vColor; varying float vAlpha;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPx * (9.0 / -mv.z);
    vColor = aColor; vAlpha = aAlpha;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main(){
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.05, r));
  }
`;

const COUNT = 720;
const HUB = new THREE.Vector3(0.6, 0.9, 0);
const curvePoint = (t: number, out: THREE.Vector3) => out.set(-5.6 + 6.2 * t, -2.3 + (HUB.y + 2.3) * Math.pow(t, 2.3), Math.sin(t * Math.PI) * 0.35);

export function FeeFlowScene({ shares, activity = 0.6, highlight, className = "", onLabels }: {
  shares: Record<SplitKey, number>; activity?: number; highlight?: SplitKey | null; className?: string;
  /** Receives each node's projected position (0..1 of the canvas) every few frames, for HTML labels. */
  onLabels?: (pos: Record<SplitKey, { x: number; y: number }>) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ shares, activity, highlight, onLabels });
  useEffect(() => { live.current = { shares, activity, highlight, onLabels }; });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const root = new THREE.Group();
    scene.add(root);

    // Destinations stacked on the right.
    const dest = FLOW_NODES.map((_, i) => new THREE.Vector3(3.7, 2.55 - i * 1.7, 0));
    const colors = FLOW_NODES.map(n => new THREE.Color(n.color));

    // The bonding curve itself: a glowing tube plus a faint grid behind it.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) pts.push(curvePoint(i / 64, new THREE.Vector3()));
    const curve = new THREE.CatmullRomCurve3(pts);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.035, 8), new THREE.MeshBasicMaterial({ color: 0xd7ff00 })));
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.16, 8), new THREE.MeshBasicMaterial({ color: 0xd7ff00, transparent: true, opacity: 0.08, depthWrite: false })));
    const gridMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
    for (let i = 0; i <= 8; i++) root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5.6 + i * 0.775, -2.3, -0.4), new THREE.Vector3(-5.6 + i * 0.775, 1.1, -0.4)]), gridMat));
    for (let i = 0; i <= 4; i++) { const y = -2.3 + i * 0.85; root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5.6, y, -0.4), new THREE.Vector3(0.6, y, -0.4)]), gridMat)); }

    // Fee hub: two counter-rotating rings where the fee is taken.
    const hub = new THREE.Group(); hub.position.copy(HUB); root.add(hub);
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.014, 8, 64), new THREE.MeshBasicMaterial({ color: 0xd7ff00 }));
    hub.add(ringA, ringB, new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff })));

    // Branch curves from hub to each destination (cubic Béziers).
    const branches = dest.map(d => new THREE.CubicBezierCurve3(HUB.clone(), new THREE.Vector3(1.8, HUB.y, 0.2), new THREE.Vector3(2.5, d.y, -0.2), d.clone()));
    const lines = branches.map((b, i) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(b, 60, 0.012, 6), new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0.35 }));
      root.add(m); return m;
    });

    // Destination orbs with a soft halo each.
    const orbs = dest.map((d, i) => {
      const g = new THREE.Group(); g.position.copy(d);
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), new THREE.MeshBasicMaterial({ color: colors[i], transparent: true }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0.14, depthWrite: false }));
      g.add(core, halo); root.add(g); return { g, core, halo };
    });

    // Particles: each owns a stream (0..3) and a phase u in [0,1): first half rides the curve, second half the branch.
    const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), size = new Float32Array(COUNT), alpha = new Float32Array(COUNT);
    const stream = new Uint8Array(COUNT), phase = new Float32Array(COUNT), speed = new Float32Array(COUNT), seed = new Float32Array(COUNT);
    const assign = (i: number) => {
      const s = live.current.shares, total = FLOW_NODES.reduce((a, n) => a + s[n.key], 0) || 1;
      let r = Math.random() * total, k = 0;
      for (; k < 3; k++) { r -= s[FLOW_NODES[k].key]; if (r <= 0) break; }
      stream[i] = k;
    };
    for (let i = 0; i < COUNT; i++) { assign(i); phase[i] = Math.random(); speed[i] = 0.06 + Math.random() * 0.07; seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } } });
    const points = new THREE.Points(geo, mat); points.frustumCulled = false; root.add(points);

    const v = new THREE.Vector3(), target = new THREE.Vector3(), tmp = new THREE.Color();
    const white = new THREE.Color(0xffffff);
    const arrivals = [0, 0, 0, 0];
    let clock = 0, visible = true, raf = 0, last = performance.now(), labelTick = 0;

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Fit the 14-unit-wide stage whatever the aspect ratio.
      const dist = 7.4 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      camera.position.set(0, 0, Math.max(11, dist));
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      mat.uniforms.uPx.value = renderer.getPixelRatio() * Math.max(h, 240) / 400;
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) { last = now; return; }
      step(now);
    };
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
      const { shares: s, activity: act, highlight: hi } = live.current;
      const total = FLOW_NODES.reduce((a, n) => a + s[n.key], 0) || 1;
      const rate = 0.45 + act * 1.1;

      for (let i = 0; i < COUNT; i++) {
        phase[i] += speed[i] * rate * dt;
        if (phase[i] >= 1) { phase[i] -= 1; arrivals[stream[i]] += 1; assign(i); }
        const u = phase[i], k = stream[i], on = hi == null || FLOW_NODES[k].key === hi;
        let sz = 1, a = 1;
        tmp.copy(colors[k]);
        if (u < 0.5) { // buyers climbing the curve, white until they reach the hub
          const t = u / 0.5;
          curvePoint(t, v); v.x += Math.sin(seed[i] * 40 + clock) * 0.05; v.y += Math.cos(seed[i] * 31 + clock) * 0.05;
          tmp.copy(white).lerp(colors[k], t > 0.85 ? (t - 0.85) / 0.15 : 0); a = 0.35 + 0.5 * t; sz = 0.7 + t * 0.4;
        } else { // the fee fanning out to its owner
          const t = (u - 0.5) / 0.5, e = t * t * (3 - 2 * t);
          branches[k].getPoint(e, v); v.z += Math.sin(seed[i] * 20 + clock * 2) * 0.08; a = 0.95; sz = 1.3 - t * 0.3;
        }
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        size[i] = sz * (0.9 + seed[i] * 0.7); alpha[i] = on ? a : a * 0.12;
      }
      for (const name of ["position", "aColor", "aSize", "aAlpha"]) (geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;

      ringA.rotation.x = clock * 0.9; ringA.rotation.y = clock * 0.5; ringB.rotation.y = -clock * 1.1; ringB.rotation.z = clock * 0.6;
      FLOW_NODES.forEach((n, i) => {
        const share = s[n.key] / total, r = 0.2 + Math.sqrt(share) * 0.62, pulse = Math.min(1, arrivals[i] * 0.02);
        arrivals[i] *= 0.9;
        const on = hi == null || hi === n.key;
        orbs[i].g.scale.lerp(target.set(r, r, r).multiplyScalar((on ? 1 : 0.7) * (1 + pulse * 0.25)), 0.12);
        orbs[i].halo.scale.setScalar(1.9 + Math.sin(clock * 2 + i) * 0.12 + pulse * 0.4);
        (orbs[i].core.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.35;
        (lines[i].material as THREE.MeshBasicMaterial).opacity = (on ? 0.25 : 0.06) + Math.min(0.5, share * 1.2);
      });
      root.rotation.y = Math.sin(clock * 0.25) * 0.12; root.rotation.x = Math.cos(clock * 0.2) * 0.04;
      renderer.render(scene, camera);

      if (live.current.onLabels && ++labelTick % 3 === 0) {
        root.updateMatrixWorld();
        const out = {} as Record<SplitKey, { x: number; y: number }>;
        FLOW_NODES.forEach((n, i) => { const p = orbs[i].g.getWorldPosition(new THREE.Vector3()).project(camera); out[n.key] = { x: (p.x + 1) / 2, y: (1 - p.y) / 2 }; });
        live.current.onLabels(out);
      }
    };

    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.02 });
    io.observe(el);
    if (reduced) { clock = 2; last = performance.now() - 1500; step(performance.now()); step(performance.now() + 16); visible = false; }
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach(x => x.dispose()); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={`relative ${className}`} aria-hidden="true" />;
}
