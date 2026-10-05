"use client";

import { useEffect, useRef } from "react";

const SIZE = 32;
const ARMS = 3;
const TRAIL = 26;

/** Three light points tracing a breathing spiral, each leaving a fading trail. */
export function CreateSpiral() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const point = (t: number, arm: number) => {
      // Radius breathes in and out while the angle keeps turning: a spiral that never settles.
      const angle = t * 2.2 + (arm * Math.PI * 2) / ARMS;
      const radius = 7 + 6 * (0.5 + 0.5 * Math.sin(t * 1.1 + arm * 0.9));
      return [SIZE / 2 + Math.cos(angle) * radius, SIZE / 2 + Math.sin(angle) * radius] as const;
    };
    const draw = (now: number) => {
      const t = now / 1000;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalCompositeOperation = "lighter";
      for (let arm = 0; arm < ARMS; arm++) {
        for (let i = TRAIL; i >= 0; i--) {
          const [x, y] = point(t - i * 0.028, arm);
          const fade = 1 - i / TRAIL;
          ctx.beginPath();
          ctx.arc(x, y, 0.5 + fade * 1.3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(215, 255, 0, ${fade * fade * 0.9})`;
          ctx.fill();
        }
        const [hx, hy] = point(t, arm);
        const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 5);
        glow.addColorStop(0, "rgba(235, 255, 140, 0.95)");
        glow.addColorStop(1, "rgba(215, 255, 0, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(hx - 5, hy - 5, 10, 10);
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: SIZE, height: SIZE }}
      className="pointer-events-none absolute inset-0 m-auto hidden group-data-[collapsible=icon]:block"
    />
  );
}
