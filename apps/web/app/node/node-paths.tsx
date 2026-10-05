"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./node-paths.module.css";

type Path = "clipping" | "influencer";

/** Two colonnades on a shared road. Loaded only when this section approaches view. */
function Crossroads({ path }: { path: Path }) {
  const host = useRef<HTMLDivElement>(null);
  const selected = useRef<Path>(path);
  useEffect(() => { selected.current = path; host.current?.dispatchEvent(new Event("pathchange")); }, [path]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, destroy = () => {};
    const start = async () => {
      const THREE = await import("three");
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" }); } catch { return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
      camera.position.set(0, 2.7, 13); camera.lookAt(0, .6, 0);
      scene.add(new THREE.AmbientLight(0xffe8bb, 2));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-4, 6, 6); scene.add(light);
      const stone = new THREE.MeshStandardMaterial({ color: 0xe8d7b0, roughness: .8 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xe6b85f, metalness: .65, roughness: .35 });
      const ink = new THREE.MeshStandardMaterial({ color: 0x20345c, roughness: .7 });
      const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
      const mesh = (group: InstanceType<typeof THREE.Object3D>, geo: import("three").BufferGeometry, material: InstanceType<typeof THREE.MeshStandardMaterial>, x: number, y: number, z = 0) => {
        geometries.push(geo); const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); group.add(m); return m;
      };
      const gates = [-2.65, 2.65].map((x, index) => {
        const gate = new THREE.Group(); gate.position.x = x; scene.add(gate);
        mesh(gate, new THREE.BoxGeometry(3.7, .16, 1.8), stone, 0, -1.42);
        mesh(gate, new THREE.BoxGeometry(3.25, .15, 1.45), stone, 0, -1.25);
        for (const cx of [-1.35, 1.35]) {
          mesh(gate, new THREE.CylinderGeometry(.19, .23, 2.6, 12), stone, cx, .1);
          for (const cy of [-1.12, 1.4]) mesh(gate, new THREE.BoxGeometry(.6, .18, .6), gold, cx, cy);
        }
        mesh(gate, new THREE.BoxGeometry(3.25, .22, .85), stone, 0, 1.62);
        const roof = mesh(gate, new THREE.ConeGeometry(1.8, .95, 4), stone, 0, 2.17); roof.rotation.y = Math.PI / 4; roof.scale.z = .4;
        const emblem = new THREE.Group(); gate.add(emblem);
        if (index === 0) {
          for (let i = 0; i < 3; i++) {
            const film = mesh(emblem, new THREE.BoxGeometry(.56, 1.05, .09), i === 1 ? gold : ink, (i - 1) * .65, .15, .2);
            film.rotation.z = (i - 1) * -.15;
            for (const fy of [-.3, 0, .3]) mesh(film, new THREE.BoxGeometry(.08, .09, .1), stone, -.18, fy, .04);
          }
        } else {
          mesh(emblem, new THREE.SphereGeometry(.35, 16, 12), gold, 0, .6, .2);
          mesh(emblem, new THREE.ConeGeometry(.62, .75, 20), gold, 0, -.12, .2);
          mesh(emblem, new THREE.TorusGeometry(.94, .025, 6, 48), gold, 0, .25, .2);
        }
        return { gate, emblem };
      });
      const resize = () => { renderer.setSize(el.clientWidth, el.clientHeight, false); camera.aspect = el.clientWidth / Math.max(1, el.clientHeight); camera.updateProjectionMatrix(); renderer.render(scene, camera); };
      const ro = new ResizeObserver(resize); ro.observe(el); resize(); el.dataset.ready = "true";
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      let raf = 0, last = 0, visible = false;
      const draw = (time: number) => {
        raf = 0;
        if (!visible || document.hidden || disposed) return;
        if (time - last >= 1000 / 24) {
          last = time;
          gates.forEach(({ gate, emblem }, i) => {
            const active = (selected.current === "clipping" ? 0 : 1) === i;
            gate.rotation.y = reduced.matches ? 0 : Math.sin(time * .00035) * .06;
            emblem.position.y = reduced.matches ? 0 : Math.sin(time * .001 + i) * .07;
            const scale = active ? 1.05 : .94; gate.scale.setScalar(scale);
          });
          renderer.render(scene, camera);
        }
        if (!reduced.matches) raf = requestAnimationFrame(draw);
      };
      const sync = () => { cancelAnimationFrame(raf); raf = 0; if (visible && !document.hidden) draw(performance.now()); };
      const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }); io.observe(el);
      el.addEventListener("pathchange", sync); document.addEventListener("visibilitychange", sync); reduced.addEventListener("change", sync);
      destroy = () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); el.removeEventListener("pathchange", sync); document.removeEventListener("visibilitychange", sync); reduced.removeEventListener("change", sync); geometries.forEach(g => g.dispose()); [stone, gold, ink].forEach(m => m.dispose()); renderer.dispose(); renderer.domElement.remove(); };
    };
    const loader = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { loader.disconnect(); void start().catch(() => {}); } }, { rootMargin: "250px" }); loader.observe(el);
    return () => { disposed = true; loader.disconnect(); destroy(); };
  }, []);
  return <div ref={host} className={styles.crossroads} aria-hidden="true"><div className={styles.fallback}><span>Ⅰ</span><i /><span>Ⅱ</span></div></div>;
}

export function NodePaths({ clippers, influencers }: { clippers: ReactNode; influencers: ReactNode }) {
  const [path, setPath] = useState<Path>("clipping");
  const tabs: { id: Path; numeral: string; title: string; subtitle: string }[] = [
    { id: "clipping", numeral: "I", title: "Agent Clippers", subtitle: "One niche. A channel worth following." },
    { id: "influencer", numeral: "II", title: "AI Influencers", subtitle: "One character. A world of its own." },
  ];
  return <div className={styles.chooser} data-reveal>
    <Crossroads path={path} />
    <div className={styles.tabs} role="tablist" aria-label="Choose your operator path">
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`path-tab-${tab.id}`} aria-controls={`path-panel-${tab.id}`} aria-selected={path === tab.id} tabIndex={path === tab.id ? 0 : -1} onClick={() => setPath(tab.id)} onKeyDown={(event) => {
        let next: Path | undefined;
        if (["ArrowRight", "ArrowLeft"].includes(event.key)) next = tabs[1 - index].id;
        if (event.key === "Home") next = tabs[0].id;
        if (event.key === "End") next = tabs[1].id;
        if (next) { event.preventDefault(); setPath(next); document.getElementById(`path-tab-${next}`)?.focus(); }
      }}><span>{tab.numeral}</span><div><b>{tab.title}</b><small>{tab.subtitle}</small></div><i aria-hidden="true">↗</i></button>)}
    </div>
    {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`path-panel-${tab.id}`} aria-labelledby={`path-tab-${tab.id}`} hidden={path !== tab.id} tabIndex={0} className={styles.panel}>{tab.id === "clipping" ? clippers : influencers}</div>)}
  </div>;
}
