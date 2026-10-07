"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export type TickerEvent = { id: string; kind: "buy" | "sell" | "earn" | "missed"; title: string; detail: string; at: number };

const COLORS: Record<TickerEvent["kind"], { a: string; b: string; ink: string }> = {
  buy: { a: "#0f3d2e", b: "#14f195", ink: "#baffe0" },
  sell: { a: "#3d1420", b: "#fb7185", ink: "#ffd0d8" },
  earn: { a: "#3d3108", b: "#facc15", ink: "#fff3b8" },
  missed: { a: "#241a2e", b: "#a78bfa", ink: "#e4daff" },
};
const LABEL: Record<TickerEvent["kind"], string> = { buy: "BUY", sell: "SELL", earn: "EARNED", missed: "MISSED" };

const CHIP_W = 3.1, CHIP_H = 0.78, SPEED = 0.55, GAP = 0.35;
/** Camera distance: close enough that the chips read at a glance on a normal page width. */
const DIST = 7.2;

/** One chip's artwork: a rounded plate in the event's colour with the kind, the headline and the detail. */
function chipTexture(e: TickerEvent) {
  const c = document.createElement("canvas"); c.width = 620; c.height = 156;
  const g = c.getContext("2d")!;
  const col = COLORS[e.kind];
  const grad = g.createLinearGradient(0, 0, 620, 156); grad.addColorStop(0, col.a); grad.addColorStop(1, "#0b0c0e");
  g.fillStyle = grad; g.beginPath(); g.roundRect(2, 2, 616, 152, 10); g.fill();
  g.strokeStyle = col.b; g.globalAlpha = 0.7; g.lineWidth = 3; g.stroke(); g.globalAlpha = 1;
  g.fillStyle = col.b; g.beginPath(); g.roundRect(22, 28, 108, 36, 6); g.fill();
  g.fillStyle = "#06120c"; g.font = "700 22px ui-monospace, Menlo, monospace"; g.textBaseline = "middle"; g.fillText(LABEL[e.kind], 36, 47);
  g.fillStyle = col.ink; g.font = "700 38px ui-sans-serif, system-ui, sans-serif"; g.fillText(e.title.slice(0, 22), 22, 104);
  g.fillStyle = "rgba(255,255,255,0.62)"; g.font = "500 22px ui-monospace, Menlo, monospace"; g.textAlign = "right"; g.fillText(e.detail.slice(0, 20), 598, 47);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

type Chip = { id: string; mesh: THREE.Mesh; born: number; fresh: boolean };

/**
 * A three.js band of live events sliding past on a curve, with a spinning SOLCAMEO coin at its head. New on-chain trades and
 * referral earnings drop in with a pulse. There are no invented events: when none have been seen yet it says so.
 */
export function ReferralTicker({ events, className = "" }: { events: TickerEvent[]; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const feed = useRef<TickerEvent[]>(events);
  const [visible, setVisible] = useState(false);
  useEffect(() => { feed.current = events; }, [events]);

  useEffect(() => {
    const el = host.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !visible) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); } catch { return; }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 4, 0.1, 80); camera.position.set(0, 0.15, DIST);
    let aspect = 4;
    const viewH = () => 2 * Math.tan((32 * Math.PI) / 360) * DIST;
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); aspect = w / h; camera.aspect = aspect; camera.updateProjectionMatrix(); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    // Stars drifting behind the band.
    const N = 140, sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { sp[i * 3] = (Math.random() - 0.5) * 30; sp[i * 3 + 1] = (Math.random() - 0.5) * 6; sp[i * 3 + 2] = -3 - Math.random() * 6; }
    const starGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#d7ff00", size: 0.05, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(stars);
    // A glowing rail under the chips.
    const rail = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.03), new THREE.MeshBasicMaterial({ color: "#d7ff00", transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    rail.position.set(0, -0.62, -0.2); scene.add(rail);
    // The coin at the head of the band.
    const markTex = new THREE.TextureLoader().load("/brand/solcameo-mark.png"); markTex.colorSpace = THREE.SRGBColorSpace;
    const coin = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 40), new THREE.MeshStandardMaterial({ color: "#facc15", metalness: 0.9, roughness: 0.25, emissive: "#5a3b00", emissiveIntensity: 0.5 }));
    rim.rotation.x = Math.PI / 2; coin.add(rim);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), new THREE.MeshBasicMaterial({ map: markTex, transparent: true }));
    face.position.z = 0.075; coin.add(face);
    const back = face.clone(); back.position.z = -0.075; back.rotation.y = Math.PI; coin.add(back);
    scene.add(coin);
    scene.add(new THREE.AmbientLight("#ffffff", 1.1)); const key = new THREE.DirectionalLight("#ffffff", 2); key.position.set(2, 3, 6); scene.add(key);
    // Pulse rings that fire when a new event lands.
    const rings: { mesh: THREE.Mesh; born: number }[] = [];
    const ringGeo = new THREE.RingGeometry(0.5, 0.54, 48);

    const chips: Chip[] = [];
    const seen = new Set<string>();
    const place = (x: number, chip: THREE.Mesh) => { chip.position.set(x, 0, -Math.min(2.4, (x * x) * 0.022)); chip.rotation.y = -x * 0.035; };
    const spawn = (e: TickerEvent, x: number, fresh: boolean, t: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CHIP_W, CHIP_H), new THREE.MeshBasicMaterial({ map: chipTexture(e), transparent: true }));
      place(x, mesh); scene.add(mesh); chips.push({ id: e.id, mesh, born: t, fresh });
    };
    const clock = new THREE.Clock();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, alive = true, last = -Infinity;
    const frame = () => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime();
      if (document.hidden || t - last < 1 / 40) return;
      const dt = Math.min(0.1, t - last > 1 ? 0.025 : t - last); last = t;
      const W = viewH() * aspect;
      const edge = W / 2 + CHIP_W;
      // New events enter at the right edge; the first batch fills the band so it never opens empty.
      const incoming = feed.current.filter((e) => !seen.has(e.id)).sort((a, b) => a.at - b.at);
      const firstLoad = seen.size === 0;
      incoming.forEach((e, i) => {
        seen.add(e.id);
        const lastX = chips.length ? Math.max(...chips.map((c) => c.mesh.position.x)) : -W / 2;
        const x = firstLoad ? -W / 2 + 2.9 + i * (CHIP_W + GAP) + CHIP_W / 2 : Math.max(edge, lastX + CHIP_W + GAP);
        spawn(e, x, !firstLoad, t);
        if (!firstLoad) { const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: COLORS[e.kind].b, transparent: true, opacity: 0.9, depthWrite: false })); ring.position.set(W / 2 - 0.5, 0, 0.1); scene.add(ring); rings.push({ mesh: ring, born: t }); }
      });
      const move = reduced ? 0 : SPEED * dt;
      chips.forEach((c) => {
        const x = c.mesh.position.x - move; place(x, c.mesh);
        const age = t - c.born, pop = c.fresh ? Math.min(1, age / 0.5) : 1;
        c.mesh.scale.setScalar(c.fresh ? 0.6 + 0.4 * (1 - (1 - pop) ** 3) + Math.max(0, 0.18 * (1 - age / 1.2)) : 1);
        (c.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, Math.max(0, (x + W / 2 - 1.0) / 1.4)) * (c.fresh ? Math.min(1, age * 3) : 1);
      });
      // Chips that slid off the left wrap round to the right so a quiet period still shows the latest events.
      const rightMost = chips.length ? Math.max(...chips.map((c) => c.mesh.position.x)) : 0;
      chips.forEach((c) => { if (c.mesh.position.x < -W / 2 - CHIP_W) c.mesh.position.x = Math.max(edge, rightMost + CHIP_W + GAP); });
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i], a = t - r.born;
        r.mesh.scale.setScalar(1 + a * 5); (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - a * 1.4);
        if (a > 0.7) { scene.remove(r.mesh); (r.mesh.material as THREE.Material).dispose(); rings.splice(i, 1); }
      }
      coin.position.set(-W / 2 + 1.5, 0, 0.4); coin.rotation.y = reduced ? 0.5 : t * 1.6; coin.rotation.x = Math.sin(t * 0.8) * 0.12;
      for (let i = 0; i < N; i++) { sp[i * 3] -= dt * 0.25 * (1 + (i % 3) * 0.5); if (sp[i * 3] < -15) sp[i * 3] = 15; }
      starGeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };
    frame();
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []; mats.forEach((x) => { (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose(); }); });
      ringGeo.dispose(); markTex.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [visible]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div ref={host} role="img" aria-label="Live SOLCAMEO trades and referral earnings" className="absolute inset-0" />
      {events.length === 0 && <p className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[11px] uppercase tracking-[0.2em] text-white/45">Waiting for the next on-chain trade…</p>}
    </div>
  );
}
