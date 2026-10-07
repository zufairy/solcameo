"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Three.js explainer for one coin's whole life, driven by `stage`:
 *   0 launch    a fixed supply appears on a Meteora bonding curve
 *   1 trade     buyers push the price up the curve (the glowing ball is the live average curve fill)
 *   2 fee       every trade passes the fee hub
 *   3 creators  the creator's share streams out to the creator
 *   4 graduate  at the threshold the coin moves to a Meteora DAMM v2 pool with locked liquidity
 *   5 burn      supply that leaves circulation rises away in red
 * Whatever the stage is, that part of the scene brightens and the rest recedes. `progress` (0..1) places the ball.
 */
const LIME = 0xd7ff00, VIOLET = 0xa78bfa, SKY = 0x38bdf8, RED = 0xfb7185, GREEN = 0x34d399;
const curveAt = (t: number, out: THREE.Vector3) => out.set(-5.2 + 6.4 * t, -2 + 3.6 * Math.pow(t, 2.2), Math.sin(t * Math.PI) * 0.3);
const GATE = new THREE.Vector3(1.2, 1.6, 0), POOL = new THREE.Vector3(4.1, 0.2, 0), HUB_T = 0.55;

export function LifecycleScene({ stage, progress, activity = 0.6, className = "" }: { stage: number; progress: number; activity?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ stage, progress, activity });
  useEffect(() => { live.current = { stage, progress, activity }; });

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
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100), root = new THREE.Group();
    scene.add(root);

    const mat = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const fade = (m: THREE.Mesh, to: number, k: number) => { const mm = m.material as THREE.MeshBasicMaterial; mm.opacity += (to - mm.opacity) * k; };

    // Curve
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) pts.push(curveAt(i / 64, new THREE.Vector3()));
    const curve = new THREE.CatmullRomCurve3(pts);
    const curveCore = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.04, 8), mat(LIME));
    const curveGlow = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.18, 8), mat(LIME, 0.08));
    root.add(curveCore, curveGlow);
    const grid = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 });
    for (let i = 0; i <= 8; i++) root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5.2 + i * 0.8, -2, -0.4), new THREE.Vector3(-5.2 + i * 0.8, 2.1, -0.4)]), grid));
    for (let i = 0; i <= 4; i++) root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5.2, -2 + i, -0.4), new THREE.Vector3(1.2, -2 + i, -0.4)]), grid));

    // Launch pad (curve start), fee hub (mid curve), graduation gate, DAMM pool, creator orb
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 48), mat(0xffffff));
    pad.position.copy(curveAt(0, new THREE.Vector3())); pad.rotation.x = 1.2; root.add(pad);
    const hubPos = curveAt(HUB_T, new THREE.Vector3());
    const hubA = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 8, 64), mat(0xffffff)), hubB = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.016, 8, 64), mat(SKY));
    hubA.position.copy(hubPos); hubB.position.copy(hubPos); root.add(hubA, hubB);
    const gate = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.035, 8, 64), mat(GREEN)); gate.position.copy(GATE); gate.rotation.y = 1.15; root.add(gate);
    const poolA = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 80), mat(VIOLET)), poolB = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.022, 8, 64), mat(VIOLET, 0.6));
    poolA.position.copy(POOL); poolB.position.copy(POOL); poolA.rotation.x = poolB.rotation.x = 1.15; root.add(poolA, poolB);
    const creatorPos = new THREE.Vector3(hubPos.x + 1.4, -2.2, 0.2);
    const creator = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 20), mat(LIME)), creatorHalo = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 20), mat(LIME, 0.12));
    creator.position.copy(creatorPos); creatorHalo.position.copy(creatorPos); root.add(creator, creatorHalo);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), mat(0xffffff)), ballHalo = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), mat(LIME, 0.25));
    root.add(ball, ballHalo);

    // Particles: 5 kinds. buy climbs the curve; fee drops hub -> creator; graduate hops gate -> pool; orbit circles the pool; burn rises from the pool.
    const N = 520, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
    const kind = new Uint8Array(N), ph = new Float32Array(N), sp = new Float32Array(N), sd = new Float32Array(N);
    for (let i = 0; i < N; i++) { kind[i] = i % 5; ph[i] = Math.random(); sp[i] = 0.07 + Math.random() * 0.08; sd[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1)); geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const points = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } },
      vertexShader: "attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uPx; varying vec3 vC; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx * (9.0 / -mv.z); vC = aColor; vA = aAlpha; }",
      fragmentShader: "varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.05, r)); }",
    }));
    points.frustumCulled = false; root.add(points);
    const colors = [new THREE.Color(LIME), new THREE.Color(SKY), new THREE.Color(GREEN), new THREE.Color(VIOLET), new THREE.Color(RED)];
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
    // Which stage owns which particle kind, so the live stage's flow is the bright one.
    const OWNER = [1, 2, 4, 4, 5];

    let visible = true, raf = 0, last = performance.now(), clock = 0, ballT = 0;
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const dist = 7.6 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      camera.position.set(0, 0, Math.max(11, dist)); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
      (points.material as THREE.ShaderMaterial).uniforms.uPx.value = renderer.getPixelRatio() * Math.max(h, 240) / 400;
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 }); io.observe(el);

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
      const { stage: s, progress: p, activity: act } = live.current, rate = 0.5 + act;
      const k = 1 - Math.pow(0.002, dt); // frame-rate independent easing
      const on = (n: number) => (s === n ? 1 : 0.28);
      // Element emphasis follows the stage.
      fade(pad, on(0), k); fade(curveCore, s === 1 || s === 0 ? 1 : 0.55, k); fade(curveGlow, s === 1 ? 0.2 : 0.06, k);
      fade(hubA, on(2), k); fade(hubB, on(2), k); fade(creator, on(3), k); fade(creatorHalo, s === 3 ? 0.28 : 0.06, k);
      fade(gate, on(4), k); fade(poolA, s >= 4 ? 1 : 0.22, k); fade(poolB, s >= 4 ? 0.7 : 0.15, k);
      hubA.rotation.x += dt * 0.8; hubA.rotation.y += dt * 0.5; hubB.rotation.y -= dt * 1.2; hubB.rotation.z += dt * 0.6;
      poolA.rotation.z += dt * 0.35; poolB.rotation.z -= dt * 0.55; gate.rotation.z += dt * 0.4;
      // The ball sits at the live curve fill, easing so updates glide.
      ballT += (Math.max(0.03, Math.min(1, p)) - ballT) * Math.min(1, dt * 2);
      curveAt(ballT, tmp); ball.position.copy(tmp); ballHalo.position.copy(tmp);
      const pulse = 1 + Math.sin(clock * 3) * 0.12; ballHalo.scale.setScalar(pulse * (s === 1 ? 1.35 : 1));

      for (let i = 0; i < N; i++) {
        ph[i] += sp[i] * rate * dt; if (ph[i] >= 1) ph[i] -= 1;
        const u = ph[i], kd = kind[i], strong = OWNER[kd] === s;
        let sz = 0.9, a = 0.18;
        if (kd === 0) { curveAt(u * Math.max(ballT, 0.05), tmp); tmp.y += Math.sin(u * 40 + sd[i] * 6) * 0.05; a = (strong ? 0.9 : 0.25) * Math.sin(Math.PI * u); }
        else if (kd === 1) { curveAt(HUB_T, tmp2); tmp.copy(tmp2); tmp.x += (creatorPos.x - tmp2.x) * u; tmp.y += (creatorPos.y - tmp2.y) * u * u; tmp.z += Math.sin(u * 6 + sd[i] * 6) * 0.08; a = (strong || s === 3 ? 0.95 : 0.2) * Math.sin(Math.PI * u); sz = 0.8; }
        else if (kd === 2) { tmp.set(GATE.x + (POOL.x - GATE.x) * u, GATE.y + (POOL.y - GATE.y) * u + Math.sin(u * Math.PI) * 0.5, 0); a = (s === 4 ? 0.95 : 0.15) * Math.sin(Math.PI * u); }
        else if (kd === 3) { const ang = u * Math.PI * 2 + sd[i] * 6, r = 0.7 + (sd[i] * 0.4); tmp.set(POOL.x + Math.cos(ang) * r, POOL.y + Math.sin(ang) * r * 0.45, Math.sin(ang) * 0.3); a = s >= 4 ? 0.8 : 0.1; sz = 0.7; }
        else { tmp.set(POOL.x + (sd[i] - 0.5) * 1.2, POOL.y + 0.2 + u * 2.6, (sd[i] - 0.5) * 0.4); a = (s === 5 ? 0.95 : 0.1) * (1 - u); sz = 0.9 * (1 - u * 0.5); }
        pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z;
        const c = colors[kd]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        size[i] = sz * (strong ? 1.5 : 1); alpha[i] = a;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.aColor.needsUpdate = true; geo.attributes.aSize.needsUpdate = true; geo.attributes.aAlpha.needsUpdate = true;
      root.rotation.y = reduced ? 0 : Math.sin(clock * 0.25) * 0.1; root.rotation.x = reduced ? 0 : Math.sin(clock * 0.2) * 0.03;
      renderer.render(scene, camera);
    };
    const frame = (now: number) => { raf = requestAnimationFrame(frame); if (!visible || document.hidden) { last = now; return; } step(now); };
    if (reduced) { step(performance.now() + 16); } else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      root.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach((x) => x.dispose()); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={className} aria-hidden />;
}
