"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Three.js loop for the SOLCAMEO revenue cycle: six nodes on a tilted ring with particles circulating
 * through them. The active step glows and grows; the ring slowly turns so the loop reads as a loop.
 * `onLabels` reports each node's screen position (0..1) so HTML labels can sit on the 3D nodes.
 */
const VERT = /* glsl */ `
  attribute float aSize; attribute float aAlpha; uniform float uPx; varying float vAlpha;
  void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx * (9.0 / -mv.z); vAlpha = aAlpha; }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor; varying float vAlpha;
  void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(uColor, vAlpha * smoothstep(0.5, 0.05, r)); }
`;

const N = 6, COUNT = 360, R = 3.1;
const ringPoint = (a: number, out: THREE.Vector3) => out.set(Math.cos(a) * R, Math.sin(a * 2) * 0.28, Math.sin(a) * R * 0.62);

export function CycleScene({ active, className = "", onLabels }: { active: number; className?: string; onLabels?: (pos: { x: number; y: number; front: number }[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ active, onLabels });
  useEffect(() => { live.current = { active, onLabels }; });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    const root = new THREE.Group(); root.rotation.x = 0.5; scene.add(root);

    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) ringPts.push(ringPoint((i / 120) * Math.PI * 2, new THREE.Vector3()));
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })));
    root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts, true), 200, 0.02, 6, true), new THREE.MeshBasicMaterial({ color: 0xd7ff00, transparent: true, opacity: 0.55 })));

    const nodes = Array.from({ length: N }, (_, i) => {
      const g = new THREE.Group(); g.position.copy(ringPoint((i / N) * Math.PI * 2, new THREE.Vector3()));
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), new THREE.MeshBasicMaterial({ color: 0xd7ff00, transparent: true, opacity: 0.12, depthWrite: false }));
      g.add(core, halo); root.add(g); return { g, core, halo };
    });
    // The burn node (step 5) is red: that is where supply leaves for good.
    (nodes[4].halo.material as THREE.MeshBasicMaterial).color.set(0xfb7185);

    const pos = new Float32Array(COUNT * 3), size = new Float32Array(COUNT), alpha = new Float32Array(COUNT), phase = new Float32Array(COUNT), speed = new Float32Array(COUNT), off = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) { phase[i] = Math.random(); speed[i] = 0.035 + Math.random() * 0.03; off[i * 2] = (Math.random() - 0.5) * 0.3; off[i * 2 + 1] = (Math.random() - 0.5) * 0.3; size[i] = 0.6 + Math.random() * 0.9; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 }, uColor: { value: new THREE.Color(0xd7ff00) } } });
    const points = new THREE.Points(geo, mat); points.frustumCulled = false; root.add(points);

    const v = new THREE.Vector3(), target = new THREE.Vector3();
    let clock = 0, visible = true, raf = 0, last = performance.now(), tick = 0;

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const dist = 4.6 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      camera.position.set(0, 0.6, Math.max(11, dist)); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
      mat.uniforms.uPx.value = renderer.getPixelRatio() * Math.max(h, 240) / 400;
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
      const act = live.current.active;
      for (let i = 0; i < COUNT; i++) {
        phase[i] = (phase[i] + speed[i] * dt) % 1;
        ringPoint(phase[i] * Math.PI * 2, v); v.x += off[i * 2]; v.y += off[i * 2 + 1] * 0.6; v.z += off[i * 2] * 0.4;
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        // brighten particles close to the active node
        const d = Math.abs(((phase[i] - act / N + 1.5) % 1) - 0.5);
        alpha[i] = 0.3 + Math.max(0, 0.7 - d * 5);
      }
      for (const name of ["position", "aAlpha"]) (geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
      nodes.forEach((n, i) => {
        const on = i === act, s = on ? 0.3 : 0.17;
        n.g.scale.lerp(target.set(s, s, s), 0.14);
        n.halo.scale.setScalar(1.9 + (on ? 0.5 + Math.sin(clock * 3) * 0.15 : 0));
        (n.halo.material as THREE.MeshBasicMaterial).opacity = on ? 0.3 : 0.1;
        (n.core.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.55;
      });
      root.rotation.y = clock * 0.12;
      renderer.render(scene, camera);
      if (live.current.onLabels && ++tick % 3 === 0) {
        root.updateMatrixWorld();
        live.current.onLabels(nodes.map(n => { const w = n.g.getWorldPosition(new THREE.Vector3()), p = w.clone().project(camera); return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, front: THREE.MathUtils.clamp((w.z + 4) / 8, 0.3, 1) }; }));
      }
    };
    const frame = (now: number) => { raf = requestAnimationFrame(frame); if (!visible || document.hidden) { last = now; return; } step(now); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.02 });
    io.observe(el);
    if (reduced) { last = performance.now() - 1200; step(performance.now()); visible = false; } else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach(x => x.dispose()); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={`relative ${className}`} aria-hidden="true" />;
}
