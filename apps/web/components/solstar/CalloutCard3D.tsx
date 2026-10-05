"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CARD_H, CARD_W, drawCalloutCard, loadCardImage, type CalloutCardData } from "@/lib/client/calloutCard";

/** Live 3D preview of the callout card: tilts with the cursor, bursts with confetti once posted. */
export default function CalloutCard3D({ data, burst }: { data: CalloutCardData; burst: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const redraw = useRef<() => void>(() => {});
  const fire = useRef<() => void>(() => {});
  useEffect(() => { dataRef.current = data; redraw.current(); }, [data]);
  useEffect(() => { if (burst) fire.current(); }, [burst]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.z = 7.2;
    const dispose: { dispose: () => void }[] = [];

    const canvas = document.createElement("canvas"); canvas.width = CARD_W; canvas.height = CARD_H;
    const ctx = canvas.getContext("2d")!;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; dispose.push(tex);
    let img: HTMLImageElement | null = null, loadedFor = "";
    const draw = () => { drawCalloutCard(ctx, dataRef.current, img); tex.needsUpdate = true; };
    redraw.current = () => {
      const url = dataRef.current.imageUrl ?? "";
      if (url !== loadedFor) { loadedFor = url; void loadCardImage(url).then(i => { if (loadedFor === url) { img = i; draw(); } }); }
      draw();
    };
    redraw.current();

    const cw = 4.4, ch = cw * CARD_H / CARD_W;
    const card = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(cw + 0.5, ch + 0.5), new THREE.MeshBasicMaterial({ color: 0xd7ff00, transparent: true, opacity: 0.1, side: THREE.DoubleSide }));
    halo.position.z = -0.04;
    card.add(halo, face); scene.add(card);
    dispose.push(face.geometry, face.material as THREE.Material, halo.geometry, halo.material as THREE.Material);

    const rings = [3.3, 2.7].map((r, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 120), new THREE.MeshBasicMaterial({ color: 0xd7ff00, transparent: true, opacity: 0.35 - i * 0.12 }));
      m.position.z = -0.8; m.rotation.x = 1.2; scene.add(m); dispose.push(m.geometry, m.material as THREE.Material); return m;
    });
    const N = 160, base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { base[i * 3] = (Math.random() - 0.5) * 9; base[i * 3 + 1] = (Math.random() - 0.5) * 5; base[i * 3 + 2] = -Math.random() * 3 - 0.5; }
    const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(base, 3)), new THREE.PointsMaterial({ color: 0xd7ff00, size: 0.03, transparent: true, opacity: 0.6, depthWrite: false }));
    scene.add(dust); dispose.push(dust.geometry, dust.material as THREE.Material);

    // confetti burst
    const M = 220, cp = new Float32Array(M * 3), vel = new Float32Array(M * 3);
    const conf = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(cp, 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0, depthWrite: false, vertexColors: false }));
    scene.add(conf); dispose.push(conf.geometry, conf.material as THREE.Material);
    let burstAt = -1;
    fire.current = () => {
      for (let i = 0; i < M; i++) {
        cp[i * 3] = cp[i * 3 + 1] = cp[i * 3 + 2] = 0;
        const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 3.2;
        vel[i * 3] = Math.cos(a) * s; vel[i * 3 + 1] = Math.sin(a) * s + 1; vel[i * 3 + 2] = (Math.random() - 0.3) * 2;
      }
      (conf.material as THREE.PointsMaterial).color.set(Math.random() > 0.5 ? 0xd7ff00 : 0xffffff);
      burstAt = clock.getElapsedTime();
    };

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => { const r = el.getBoundingClientRect(); mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 2; };
    el.addEventListener("pointermove", onMove);
    const onLeave = () => { mouse.tx = 0; mouse.ty = 0; };
    el.addEventListener("pointerleave", onLeave);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.z = Math.max(7.2, 4.4 / (w / h) * 1.55); camera.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    const clock = new THREE.Clock();
    let raf = 0, last = 0, introDone = reduced;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime(), dt = Math.min(0.05, t - last); last = t;
      mouse.x += (mouse.tx - mouse.x) * 0.08; mouse.y += (mouse.ty - mouse.y) * 0.08;
      const intro = introDone ? 1 : Math.min(1, t / 0.9);
      if (intro >= 1) introDone = true;
      const e = 1 - Math.pow(1 - intro, 3);
      let spin = 0;
      if (burstAt >= 0 && !reduced) { const k = Math.min(1, (t - burstAt) / 1.1); spin = (1 - Math.pow(1 - k, 3)) * Math.PI * 2; }
      card.rotation.y = mouse.x * 0.35 + spin + (1 - e) * -1.1;
      card.rotation.x = -mouse.y * 0.22 + (reduced ? 0 : Math.sin(t * 0.8) * 0.03);
      card.position.y = (reduced ? 0 : Math.sin(t * 1.1) * 0.06) - (1 - e) * 0.8;
      card.scale.setScalar(0.85 + 0.15 * e);
      rings.forEach((r, i) => { r.rotation.z += dt * (0.25 + i * 0.2) * (reduced ? 0 : 1); r.rotation.x = 1.2 + mouse.y * 0.2; });
      dust.rotation.y = t * 0.03;
      if (burstAt >= 0 && !reduced) {
        const age = t - burstAt, mat = conf.material as THREE.PointsMaterial;
        mat.opacity = Math.max(0, 1 - age / 1.8);
        for (let i = 0; i < M; i++) { cp[i * 3] += vel[i * 3] * dt; cp[i * 3 + 1] += vel[i * 3 + 1] * dt; cp[i * 3 + 2] += vel[i * 3 + 2] * dt; vel[i * 3 + 1] -= 3.2 * dt; }
        conf.geometry.attributes.position.needsUpdate = true;
        if (age > 2) burstAt = -1;
      }
      renderer.render(scene, camera);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave);
      dispose.forEach(d => d.dispose()); renderer.dispose(); renderer.domElement.remove();
      redraw.current = () => {}; fire.current = () => {};
    };
  }, []);
  return <div ref={host} className="relative h-[250px] w-full overflow-hidden rounded-[6px] border border-white/10 bg-[radial-gradient(ellipse_at_center,rgba(215,255,0,0.08),transparent_70%)]" aria-label="Callout card preview" />;
}
