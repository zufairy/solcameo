"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { CalloutCardData } from "@/lib/client/calloutCard";
import { buildCalloutScene, type CalloutScene } from "./calloutScene";

/**
 * The callout's 16:9 three.js card. Mounts its WebGL context only while on screen (the feed can hold many),
 * plays the intro once, then idles. `replay` restarts the intro (used by the popup preview).
 */
export function CalloutVisual({ data, className = "", replay = false }: { data: CalloutCardData; className?: string; replay?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(data);
  latest.current = data;
  const sceneRef = useRef<CalloutScene | null>(null);
  const [visible, setVisible] = useState(false);

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
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    const s = buildCalloutScene(latest.current, { hudScale: el.clientWidth > 700 ? 1 : 0.75 });
    sceneRef.current = s;
    const resize = () => renderer.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    const clock = new THREE.Clock();
    let raf = 0, alive = true;
    const frame = () => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime(), p = reduced ? 1 : Math.min(1, t / 1.6);
      s.update(reduced ? 2.4 : t, p, reduced ? { x: 0, y: 0 } : pointer);
      renderer.render(s.scene, s.camera);
    };
    frame();
    return () => {
      alive = false; cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); ro.disconnect();
      s.dispose(); sceneRef.current = null; renderer.dispose(); renderer.domElement.remove();
    };
    // Re-create when it scrolls back in, or when the popup asks for a fresh intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, replay]);

  useEffect(() => { sceneRef.current?.setData(data); }, [data]);

  return <div ref={host} role="img" aria-label={`${data.name} callout card`} className={`relative aspect-video w-full overflow-hidden rounded-[10px] bg-[#070a07] ring-1 ring-white/10 ${className}`} />;
}
