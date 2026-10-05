"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Floating frosted-glass cards plus a lime particle field. Pure three.js, paused offscreen. */
export default function HeroScene({ images, onReady }: { images: string[]; onReady: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
    catch { return; } // fallback card stays visible
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x09090a, 7, 16);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 0, 9);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const disposables: { dispose: () => void }[] = [];
    const W = 2.1, H = 3.1;
    const layout = [
      { x: 0, y: 0, z: 0.6, r: 0, s: 1.12 },
      { x: -2.5, y: -0.45, z: -1.2, r: 0.22, s: 0.92 },
      { x: 2.5, y: 0.5, z: -1.2, r: -0.22, s: 0.92 },
      { x: -4.4, y: 0.7, z: -3.4, r: 0.35, s: 0.8 },
      { x: 4.4, y: -0.7, z: -3.4, r: -0.35, s: 0.8 },
    ];
    const cards = layout.map((l, i) => {
      const g = new THREE.Group();
      const geo = new THREE.PlaneGeometry(W, H);
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.14, H + 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 }));
      frame.position.z = -0.01;
      const mat = new THREE.MeshBasicMaterial({ color: 0x1a1d10, transparent: true, opacity: 0.96 });
      const mesh = new THREE.Mesh(geo, mat);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xd7ff00, transparent: true, opacity: i === 0 ? 0.55 : 0.2 }));
      g.add(frame, mesh, edge);
      g.position.set(l.x, l.y, l.z);
      g.rotation.z = l.r * 0.5;
      g.rotation.y = -l.x * 0.07;
      g.scale.setScalar(l.s);
      scene.add(g);
      disposables.push(geo, frame.geometry, mat, frame.material as THREE.Material, edge.geometry, edge.material as THREE.Material);
      const src = images[i % Math.max(images.length, 1)];
      if (src) loader.load(src, t => {
        t.colorSpace = THREE.SRGBColorSpace;
        const ia = t.image.width / t.image.height, pa = W / H;
        if (ia > pa) { t.repeat.x = pa / ia; t.offset.x = (1 - t.repeat.x) / 2; } else { t.repeat.y = ia / pa; t.offset.y = (1 - t.repeat.y) / 2; }
        mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; disposables.push(t);
        if (i === 0) onReady();
      });
      return { g, l, phase: i * 1.3 };
    });
    const N = 420;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = (Math.random() - 0.5) * 9; pos[i * 3 + 2] = -Math.random() * 8; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.PointsMaterial({ color: 0xd7ff00, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false });
    const points = new THREE.Points(pg, pm); scene.add(points); disposables.push(pg, pm);
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => { const r = el.getBoundingClientRect(); mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 2; };
    window.addEventListener("pointermove", onMove);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.z = w / h < 0.9 ? 12 : 9; camera.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    let visible = true, raf = 0;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }); io.observe(el);
    const clock = new THREE.Clock();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const t = reduced ? 0 : clock.getElapsedTime();
      mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
      cards.forEach(({ g, l, phase }, i) => {
        g.position.y = l.y + Math.sin(t * 0.7 + phase) * 0.13;
        g.rotation.y = -l.x * 0.07 + mouse.x * (0.18 - i * 0.015);
        g.rotation.x = -mouse.y * 0.1;
        g.position.x = l.x + mouse.x * (0.18 + (i === 0 ? 0.1 : 0.3));
      });
      points.rotation.y = t * 0.02; points.position.y = Math.sin(t * 0.2) * 0.15;
      renderer.render(scene, camera);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener("pointermove", onMove);
      disposables.forEach(d => d.dispose()); renderer.dispose(); renderer.domElement.remove();
    };
  }, [images, onReady]);
  return <div ref={host} className="absolute inset-0" aria-hidden="true" />;
}
