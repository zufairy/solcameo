"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

const COLORS = ["#d7ff00", "#f4ffb0", "#ffffff", "#34d399", "#7C4DFF", "#00FFD1", "#fbbf24"];
const DURATION = 5.5;

/** Full-screen three.js confetti: two cannons from the bottom corners, then a soft rain. Plays once per `fire`. */
export default function LaunchConfetti({ fire }: { fire: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!fire || !el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene();
    let w = el.clientWidth, h = el.clientHeight;
    const camera = new THREE.OrthographicCamera(0, w, h, 0, -10, 10);
    const resize = () => { w = el.clientWidth; h = el.clientHeight; renderer.setSize(w, h, false); camera.right = w; camera.top = h; camera.updateProjectionMatrix(); };
    resize();
    window.addEventListener("resize", resize);

    const N = 420;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true }), N);
    scene.add(mesh);
    const p = Array.from({ length: N }, (_, i) => {
      const cannon = i < 280;
      const left = i % 2 === 0;
      const angle = cannon ? (left ? 1 : Math.PI - 1) + (Math.random() - 0.5) * 0.9 : -Math.PI / 2;
      const speed = cannon ? 700 + Math.random() * 900 : 40 + Math.random() * 90;
      return {
        x: cannon ? (left ? 20 : w - 20) : Math.random() * w,
        y: cannon ? 20 : h + 20 + Math.random() * h * 0.6,
        vx: Math.cos(angle) * speed * (cannon ? 1 : 0.2) + (cannon ? 0 : (Math.random() - 0.5) * 60),
        vy: Math.sin(angle) * speed * (cannon ? 1 : 1) * (cannon ? 1 : 0),
        delay: cannon ? Math.random() * 0.25 : 0.9 + Math.random() * 2.2,
        w: 6 + Math.random() * 7, h: 10 + Math.random() * 9,
        spin: Math.random() * 6, spinSpeed: 3 + Math.random() * 6, rot: Math.random() * 6.28, rotSpeed: (Math.random() - 0.5) * 6,
        sway: Math.random() * 6, drift: 20 + Math.random() * 50, cannon,
      };
    });
    const color = new THREE.Color();
    p.forEach((_, i) => mesh.setColorAt(i, color.set(COLORS[i % COLORS.length])));
    const dummy = new THREE.Object3D();
    const clock = new THREE.Clock();
    let raf = 0;
    const cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); renderer.dispose(); renderer.domElement.remove(); };
    const frame = () => {
      const t = clock.getElapsedTime();
      const fade = t > DURATION - 1.2 ? Math.max(0, (DURATION - t) / 1.2) : 1;
      p.forEach((q, i) => {
        const age = t - q.delay;
        if (age < 0) { dummy.scale.set(0, 0, 1); dummy.position.set(-50, -50, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); return; }
        let x: number, y: number;
        if (q.cannon) {
          // Ballistic burst with air drag, then it settles into a slow fall.
          const drag = Math.exp(-age * 1.6);
          x = q.x + q.vx * (1 - drag) / 1.6;
          y = q.y + q.vy * (1 - drag) / 1.6 - 150 * age * age * 0.5 - 40 * age;
        } else {
          x = q.x + q.vx * age * 0.2 + Math.sin(age * 1.4 + q.sway) * q.drift;
          y = q.y - (110 + q.w * 6) * age;
        }
        const flip = Math.cos(q.spin + age * q.spinSpeed);
        dummy.position.set(x, y, 0);
        dummy.rotation.set(0, 0, q.rot + age * q.rotSpeed);
        dummy.scale.set(q.w * fade, q.h * flip * fade, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
      if (t >= DURATION) { cleanup(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return cleanup;
  }, [fire]);
  return <div ref={host} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[200]" />;
}
