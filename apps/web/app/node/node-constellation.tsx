"use client";

import { useEffect, useRef } from "react";
import styles from "./node.module.css";

/* The hero's living network (three.js): a drifting constellation of nodes that link up when they
   come close, with small pulses of light travelling along the links, and a slow parallax that
   follows the pointer. Nodes are gold on deep navy, so the hero reads as "a network that never
   sleeps" without competing with the headline. Pauses off-screen; one still frame for reduced motion. */
export default function NodeConstellation() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, cleanup = () => {};
    void (async () => {
      const THREE = await import("three");
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); } catch { return; }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const small = window.innerWidth < 760;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1 : 1.75));
      renderer.setClearColor(0x000000, 0);
      el.appendChild(renderer.domElement);
      renderer.domElement.className = styles.constellationCanvas;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
      camera.position.set(0, 0, 10);
      const world = new THREE.Group();
      scene.add(world);

      const N = small ? 56 : 110, LINK = small ? 3.2 : 3.3, MAX_LINKS = N * 5;
      const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), base = new Float32Array(N * 3);
      const rand = (a: number, b: number) => a + Math.random() * (b - a);
      for (let i = 0; i < N; i++) {
        base[i * 3] = rand(-11, 11); base[i * 3 + 1] = rand(-5.6, 5.6); base[i * 3 + 2] = rand(-7, 3);
        vel[i * 3] = rand(0.15, 0.5) * (Math.random() < 0.5 ? -1 : 1); vel[i * 3 + 1] = rand(0.15, 0.5) * (Math.random() < 0.5 ? -1 : 1); vel[i * 3 + 2] = rand(0, Math.PI * 2);
        pos.set([base[i * 3], base[i * 3 + 1], base[i * 3 + 2]], i * 3);
      }

      // soft round sprite for the nodes
      const sprite = document.createElement("canvas"); sprite.width = sprite.height = 64;
      const g = sprite.getContext("2d")!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,244,214,1)"); grad.addColorStop(0.22, "rgba(246,221,156,.95)"); grad.addColorStop(0.5, "rgba(230,184,95,.28)"); grad.addColorStop(1, "rgba(230,184,95,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(sprite);

      const sizes = new Float32Array(N);
      for (let i = 0; i < N; i++) sizes[i] = i % 9 === 0 ? 0.55 : rand(0.16, 0.3);
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pMat = new THREE.PointsMaterial({ map: tex, size: 0.34, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
      const points = new THREE.Points(pGeo, pMat);
      world.add(points);

      const lPos = new Float32Array(MAX_LINKS * 6), lAlpha = new Float32Array(MAX_LINKS * 2);
      const lGeo = new THREE.BufferGeometry();
      lGeo.setAttribute("position", new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage));
      lGeo.setAttribute("aAlpha", new THREE.BufferAttribute(lAlpha, 1).setUsage(THREE.DynamicDrawUsage));
      lGeo.setDrawRange(0, 0);
      // links fade with distance: a tiny shader so each vertex carries its own alpha
      const lineMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        vertexShader: "attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "varying float vA; void main(){ gl_FragColor = vec4(0.96, 0.78, 0.4, vA); }",
      });
      const lines = new THREE.LineSegments(lGeo, lineMat);
      world.add(lines);

      // light pulses riding the links
      const P = small ? 7 : 14, pulses = Array.from({ length: P }, () => ({ a: 0, b: 1, t: Math.random(), speed: rand(0.25, 0.6) }));
      const puPos = new Float32Array(P * 3);
      const puGeo = new THREE.BufferGeometry(); puGeo.setAttribute("position", new THREE.BufferAttribute(puPos, 3).setUsage(THREE.DynamicDrawUsage));
      const puMat = new THREE.PointsMaterial({ map: tex, size: 0.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff1c9 });
      world.add(new THREE.Points(puGeo, puMat));

      let linkPairs: [number, number][] = [];
      const update = (t: number) => {
        for (let i = 0; i < N; i++) {
          const k = i * 3;
          pos[k] = base[k] + Math.sin(t * 0.18 * vel[k] + vel[k + 2]) * 0.9;
          pos[k + 1] = base[k + 1] + Math.cos(t * 0.15 * vel[k + 1] + vel[k + 2]) * 0.7;
          pos[k + 2] = base[k + 2] + Math.sin(t * 0.1 + vel[k + 2]) * 0.6;
        }
        pGeo.attributes.position.needsUpdate = true;
        let n = 0; linkPairs = [];
        for (let i = 0; i < N && n < MAX_LINKS; i++) for (let j = i + 1; j < N && n < MAX_LINKS; j++) {
          const dx = pos[i * 3] - pos[j * 3], dy = pos[i * 3 + 1] - pos[j * 3 + 1], dz = pos[i * 3 + 2] - pos[j * 3 + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > LINK) continue;
          const f = (1 - d / LINK) ** 1.1 * 0.8;
          lPos.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], n * 6);
          lAlpha[n * 2] = f; lAlpha[n * 2 + 1] = f;
          linkPairs.push([i, j]); n++;
        }
        lGeo.setDrawRange(0, n * 2);
        lGeo.attributes.position.needsUpdate = true; lGeo.attributes.aAlpha.needsUpdate = true;
      };
      const movePulses = (dt: number) => {
        pulses.forEach((p, i) => {
          p.t += dt * p.speed;
          if (p.t >= 1 || !linkPairs.length) { p.t = 0; const pair = linkPairs[Math.floor(Math.random() * linkPairs.length)]; if (pair) { p.a = pair[0]; p.b = pair[1]; } }
          const a = p.a * 3, b = p.b * 3, e = p.t;
          puPos.set([pos[a] + (pos[b] - pos[a]) * e, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * e, pos[a + 2] + (pos[b + 2] - pos[a + 2]) * e], i * 3);
        });
        puGeo.attributes.position.needsUpdate = true;
      };

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize); ro.observe(el);

      const mouse = { x: 0, y: 0 }, smooth = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => { mouse.x = (e.clientX / window.innerWidth - 0.5) * 2; mouse.y = (e.clientY / window.innerHeight - 0.5) * 2; };
      window.addEventListener("pointermove", onMove, { passive: true });

      let raf = 0, visible = true, last = performance.now(), time = 6;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (!visible || document.hidden) { last = now; return; }
        const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
        smooth.x += (mouse.x - smooth.x) * 0.04; smooth.y += (mouse.y - smooth.y) * 0.04;
        world.rotation.y = smooth.x * 0.16 + Math.sin(time * 0.05) * 0.06;
        world.rotation.x = smooth.y * 0.08;
        update(time); movePulses(dt);
        renderer.render(scene, camera);
      };
      update(time); movePulses(0); renderer.render(scene, camera);
      el.dataset.ready = "true";
      if (!reduced) raf = requestAnimationFrame(frame);
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }); io.observe(el);

      cleanup = () => {
        cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); window.removeEventListener("pointermove", onMove);
        pGeo.dispose(); lGeo.dispose(); puGeo.dispose(); pMat.dispose(); puMat.dispose(); tex.dispose(); lineMat.dispose();
        renderer.dispose(); renderer.domElement.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, []);
  return <div ref={host} className={styles.constellation} aria-hidden="true" />;
}
