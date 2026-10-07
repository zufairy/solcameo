"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { CalloutTheme } from "@/lib/solstar/callout";
import { createThemeScene } from "./calloutThemes3d";

/**
 * The theme's three.js animation, behind the card. The WebGL context exists only while the card is on screen (a feed can hold many),
 * runs at 30 frames a second, and draws one still frame for people who prefer reduced motion. If WebGL is unavailable it renders
 * nothing, and the card's CSS gradient stays as the background.
 */
export function CalloutThemeCanvas({ theme, accent, className = "" }: { theme: CalloutTheme; accent: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !visible) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); } catch { return; }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    const s = createThemeScene(theme, accent);
    const resize = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); s.resize(w, h); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let raf = 0, alive = true, last = -Infinity;
    const frame = () => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime();
      if (document.hidden || t - last < 1 / 30) return;
      last = t;
      s.update(reduced ? 2.4 : t);
      renderer.render(s.scene, s.camera);
      if (reduced) { alive = false; cancelAnimationFrame(raf); }
    };
    frame();
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      s.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [visible, theme, accent]);

  return <div ref={host} aria-hidden className={`pointer-events-none absolute inset-0 ${className}`} />;
}
