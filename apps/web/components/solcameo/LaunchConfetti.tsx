"use client";
import { useEffect, useRef } from "react";

const COLORS = ["#d7ff00", "#f4ffb0", "#ffffff", "#34d399", "#8b5cf6", "#22d3ee", "#fbbf24", "#fb7185"];
const DURATION = 6.2;
const GRAVITY = 900;

type Shape = "rect" | "circle" | "streamer" | "star" | "spark";
type Particle = {
  x: number; y: number; vx: number; vy: number; delay: number; life: number;
  w: number; h: number; rot: number; spin: number; flipSpeed: number; flipPhase: number;
  drag: number; wobble: number; wobbleSpeed: number; color: string; shape: Shape;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

function makeParticle(x: number, y: number, angle: number, speed: number, delay: number, shape: Shape, scale: number): Particle {
  const size = shape === "streamer" ? rand(5, 7) : shape === "spark" ? rand(2, 3.5) : rand(7, 13);
  return {
    x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, delay, life: rand(3.4, 5.2),
    w: size * scale, h: (shape === "streamer" ? rand(26, 46) : shape === "rect" ? rand(10, 18) : size) * scale,
    rot: rand(0, Math.PI * 2), spin: rand(-7, 7), flipSpeed: rand(4, 11), flipPhase: rand(0, Math.PI * 2),
    drag: shape === "spark" ? rand(1.4, 2.2) : rand(0.9, 1.7), wobble: rand(10, 36), wobbleSpeed: rand(2, 5),
    color: pick(COLORS), shape,
  };
}

function star(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  ctx.closePath();
}

/**
 * Full-screen celebration on a 2D canvas: a centre burst, two angled cannons, a delayed star and glitter volley,
 * then a soft ribbon rain. Pieces tumble in 3D, shimmer, drag to a slow fall and fade out. Plays once per `fire`.
 */
export default function LaunchConfetti({ fire }: { fire: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!fire || !canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const scale = Math.max(0.8, Math.min(1.25, w / 1280));
    const particles: Particle[] = [];
    const shapes: Shape[] = ["rect", "rect", "rect", "circle", "streamer", "star"];
    // Centre burst: a wide fan straight up from the lower middle.
    for (let i = 0; i < 170; i++) particles.push(makeParticle(w / 2, h * 0.62, -Math.PI / 2 + rand(-0.85, 0.85), rand(520, 1250) * scale, rand(0, 0.12), pick(shapes), scale));
    // Side cannons, angled inward.
    for (let i = 0; i < 110; i++) {
      const left = i % 2 === 0;
      particles.push(makeParticle(left ? -10 : w + 10, h * 0.85, (left ? -1 : -Math.PI + 1) + rand(-0.3, 0.3), rand(700, 1500) * scale, 0.18 + rand(0, 0.2), pick(shapes), scale));
    }
    // Second volley: stars and glitter from the middle once the first wave peaks.
    for (let i = 0; i < 70; i++) particles.push(makeParticle(w / 2, h * 0.5, rand(0, Math.PI * 2), rand(220, 780) * scale, 0.85 + rand(0, 0.15), i % 3 === 0 ? "star" : "spark", scale));
    // Slow ribbon rain from above.
    for (let i = 0; i < 90; i++) {
      const p = makeParticle(rand(0, w), -20 - rand(0, h * 0.4), Math.PI / 2, rand(30, 110), 1.2 + rand(0, 2.6), i % 2 ? "streamer" : "rect", scale);
      p.drag = 0.3; particles.push(p);
    }

    let raf = 0;
    const start = performance.now();
    let last = start;
    const cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); ctx.clearRect(0, 0, w, h); };
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of particles) {
        const age = t - p.delay;
        if (age < 0) { alive++; continue; }
        if (age > p.life || p.y > h + 60) continue;
        alive++;
        // Integrate with air drag so pieces burst out fast and then float down.
        const dragFactor = Math.exp(-p.drag * dt);
        p.vx *= dragFactor;
        p.vy = p.vy * dragFactor + GRAVITY * 0.55 * dt;
        p.x += p.vx * dt + Math.sin(age * p.wobbleSpeed + p.flipPhase) * p.wobble * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        const fade = Math.min(1, (p.life - age) / 0.9, age / 0.05);
        const flip = Math.cos(p.flipPhase + age * p.flipSpeed);
        const shimmer = 0.78 + 0.22 * Math.sin(age * 14 + p.flipPhase);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, fade) * shimmer;
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.scale(1, Math.abs(flip) * 0.8 + 0.2);
          ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill();
        } else if (p.shape === "star") {
          ctx.scale(Math.abs(flip) * 0.6 + 0.4, 1);
          star(ctx, p.w * 0.9); ctx.fill();
        } else if (p.shape === "spark") {
          ctx.shadowColor = p.color; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill();
        } else if (p.shape === "streamer") {
          // A curling ribbon: a thin quad bent by a sine so it reads as paper, not a block.
          ctx.beginPath();
          const len = p.h, wid = p.w * (0.35 + 0.65 * Math.abs(flip));
          for (let s = 0; s <= 8; s++) ctx.lineTo(Math.sin(age * 6 + s * 0.7 + p.flipPhase) * wid * 0.9 + wid / 2, (s / 8 - 0.5) * len);
          for (let s = 8; s >= 0; s--) ctx.lineTo(Math.sin(age * 6 + s * 0.7 + p.flipPhase) * wid * 0.9 - wid / 2, (s / 8 - 0.5) * len);
          ctx.closePath(); ctx.fill();
        } else {
          ctx.scale(1, flip);
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (t >= DURATION || alive === 0) { cleanup(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return cleanup;
  }, [fire]);
  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[300]" />;
}
