"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

/** A quiet point-sphere with three episode dots orbiting it. Drifts with the cursor; static under reduced motion. */
export default function WelcomeOrb() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // No WebGL: the popup still reads fine without the orb.
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.z = 5.2;

    // Fibonacci sphere: even point spread, no clumping at the poles.
    const COUNT = 1400;
    const positions = new Float32Array(COUNT * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const t = golden * i;
      positions.set([Math.cos(t) * r * 1.35, y * 1.35, Math.sin(t) * r * 1.35], i * 3);
    }
    const sphereGeo = new THREE.BufferGeometry();
    sphereGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const sphereMat = new THREE.PointsMaterial({ color: 0xe8ebe6, size: 0.022, transparent: true, opacity: 0.55, depthWrite: false });
    const sphere = new THREE.Points(sphereGeo, sphereMat);
    scene.add(sphere);

    // Orbit ring with three dots: the episodes the agent plots on its own.
    const orbit = new THREE.Group();
    orbit.rotation.set(1.15, 0.2, 0.35);
    const ringGeo = new THREE.RingGeometry(2.0, 2.008, 160);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
    orbit.add(new THREE.Mesh(ringGeo, ringMat));
    const dotGeo = new THREE.SphereGeometry(0.055, 16, 16);
    const dotMats = [0xffffff, 0xffffff, 0xd7ff00].map((c) => new THREE.MeshBasicMaterial({ color: c }));
    const dots = dotMats.map((m) => {
      const d = new THREE.Mesh(dotGeo, m);
      orbit.add(d);
      return d;
    });
    scene.add(orbit);

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    const clock = new THREE.Clock();
    const frame = () => {
      const t = clock.getElapsedTime();
      sphere.rotation.y = t * 0.12 + pointer.x * 0.25;
      sphere.rotation.x = pointer.y * 0.18;
      dots.forEach((d, i) => {
        const a = t * 0.55 + (i * Math.PI * 2) / 3;
        d.position.set(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0);
      });
      renderer.render(scene, camera);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame();
    // Pause while the tab is hidden so the popup never burns battery in the background.
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      sphereGeo.dispose(); sphereMat.dispose(); ringGeo.dispose(); ringMat.dispose(); dotGeo.dispose();
      dotMats.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return <div ref={host} aria-hidden className="h-full w-full" />;
}
