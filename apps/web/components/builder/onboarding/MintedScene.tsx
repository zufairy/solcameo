"use client";

import { useEffect, useRef } from "react";
import type * as Three from "three";

/**
 * Full-bleed WebGL backdrop for the "agent minted" screen: a one-shot particle
 * burst from the centre, shockwave rings, and a slow orbiting ring set that keeps
 * the moment alive behind the DOM card. Transparent canvas (sits on the cream
 * page), normal blending so it reads on a light background. Everything is
 * disposed on unmount; reduced-motion gets a calm static ring + fewer particles.
 */
export default function MintedScene() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    let cleanup: (() => void) | undefined;

    void import("three").then((T: typeof Three) => {
      if (disposed || !host.current) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      let renderer: Three.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        return; // no WebGL — the DOM layer still celebrates on its own
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      el.appendChild(renderer.domElement);
      renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 11);

      const LIME = new T.Color("#A3E635");
      const INK = new T.Color("#141413");
      const AMBER = new T.Color("#F59E0B");
      const WHITE = new T.Color("#ffffff");

      // ── Particle burst ────────────────────────────────────────────────────
      const COUNT = reduced ? 140 : 900;
      const pos = new Float32Array(COUNT * 3);
      const vel = new Float32Array(COUNT * 3);
      const col = new Float32Array(COUNT * 3);
      const palette = [LIME, LIME, LIME, INK, AMBER, WHITE];
      for (let i = 0; i < COUNT; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const speed = 2.2 + Math.random() * 5.5;
        vel[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
        vel[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed * 0.8;
        vel[i * 3 + 2] = Math.cos(phi) * speed * 0.6;
        const c = palette[Math.floor(Math.random() * palette.length)];
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const burstGeo = new T.BufferGeometry();
      burstGeo.setAttribute("position", new T.BufferAttribute(pos, 3));
      burstGeo.setAttribute("color", new T.BufferAttribute(col, 3));
      const burstMat = new T.PointsMaterial({ size: 0.085, vertexColors: true, transparent: true, opacity: 1, depthWrite: false });
      const burst = new T.Points(burstGeo, burstMat);
      scene.add(burst);

      // ── Shockwave rings ──────────────────────────────────────────────────
      const rings: { mesh: Three.Mesh; delay: number }[] = [];
      for (let i = 0; i < 3; i++) {
        const mesh = new T.Mesh(
          new T.RingGeometry(0.96, 1, 96),
          new T.MeshBasicMaterial({ color: i === 1 ? INK : LIME, transparent: true, opacity: 0, side: T.DoubleSide }),
        );
        scene.add(mesh);
        rings.push({ mesh, delay: i * 0.22 });
      }

      // ── Orbit rings (persist) ────────────────────────────────────────────
      const orbit = new T.Group();
      const mkOrbit = (radius: number, tube: number, color: Three.Color, tiltX: number, tiltY: number) => {
        const m = new T.Mesh(
          new T.TorusGeometry(radius, tube, 12, 160),
          new T.MeshBasicMaterial({ color, transparent: true, opacity: 0 }),
        );
        m.rotation.set(tiltX, tiltY, 0);
        orbit.add(m);
        return m;
      };
      const o1 = mkOrbit(3.5, 0.012, INK, 1.25, 0.2);
      const o2 = mkOrbit(4.1, 0.02, LIME, 0.5, 0.9);
      const o3 = mkOrbit(4.8, 0.01, INK, 1.7, -0.6);
      // Satellites riding o2 / o1 so the rings read as orbits, not just lines.
      const sat = (color: Three.Color, size: number) => {
        const m = new T.Mesh(new T.IcosahedronGeometry(size, 1), new T.MeshBasicMaterial({ color }));
        orbit.add(m);
        return m;
      };
      const s1 = sat(LIME, 0.11);
      const s2 = sat(INK, 0.08);
      scene.add(orbit);

      const resize = () => {
        const w = el.clientWidth || 1;
        const h = el.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);

      let pointerX = 0;
      let pointerY = 0;
      const onMove = (e: PointerEvent) => {
        pointerX = (e.clientX / window.innerWidth - 0.5) * 2;
        pointerY = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      const clock = new T.Clock();
      const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
      let running = true;
      const onVisibility = () => { running = !document.hidden; if (running) clock.getDelta(); };
      document.addEventListener("visibilitychange", onVisibility);

      const tick = () => {
        raf = requestAnimationFrame(tick);
        if (!running) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime;

        // burst: ballistic motion with drag + a touch of gravity, fades by ~3.2s
        const drag = Math.pow(0.18, dt);
        const attr = burstGeo.getAttribute("position") as Three.BufferAttribute;
        for (let i = 0; i < COUNT; i++) {
          vel[i * 3] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 0.9 * dt; vel[i * 3 + 2] *= drag;
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        }
        attr.needsUpdate = true;
        burstMat.opacity = Math.max(0, 1 - Math.max(0, t - 1.4) / 2);
        burst.visible = burstMat.opacity > 0.01;

        for (const r of rings) {
          const p = (t - r.delay) / 1.8;
          if (p < 0 || p > 1) { (r.mesh.material as Three.MeshBasicMaterial).opacity = 0; continue; }
          const s = 0.4 + easeOut(p) * 9;
          r.mesh.scale.set(s, s, 1);
          (r.mesh.material as Three.MeshBasicMaterial).opacity = (1 - p) * 0.55;
        }

        // orbit rings ease in after the burst, then idle-spin
        const fade = reduced ? 0.5 : Math.min(1, Math.max(0, (t - 0.5) / 1.2));
        (o1.material as Three.MeshBasicMaterial).opacity = fade * 0.35;
        (o2.material as Three.MeshBasicMaterial).opacity = fade * 0.9;
        (o3.material as Three.MeshBasicMaterial).opacity = fade * 0.22;
        if (!reduced) {
          orbit.rotation.y = t * 0.18 + pointerX * 0.25;
          orbit.rotation.x = Math.sin(t * 0.35) * 0.12 + pointerY * 0.15;
          o1.rotation.z = t * 0.12;
          o3.rotation.z = -t * 0.09;
          const a = t * 0.9;
          s1.position.set(Math.cos(a) * 4.1, 0, Math.sin(a) * 4.1).applyEuler(o2.rotation);
          const b = -t * 0.6 + 2;
          s2.position.set(Math.cos(b) * 3.5, 0, Math.sin(b) * 3.5).applyEuler(o1.rotation);
          s1.scale.setScalar(fade); s2.scale.setScalar(fade);
        } else {
          s1.visible = false; s2.visible = false;
        }

        renderer.render(scene, camera);
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("visibilitychange", onVisibility);
        scene.traverse((obj) => {
          const mesh = obj as Three.Mesh;
          mesh.geometry?.dispose?.();
          const m = mesh.material as Three.Material | Three.Material[] | undefined;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose?.();
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, []);

  return <div ref={host} className="pointer-events-none absolute inset-0" aria-hidden />;
}
