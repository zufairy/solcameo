"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { GLOBE_HUBS, isLand, loadLandMask } from "@/lib/client/landMask";
import styles from "./node-menu-banner.module.css";

/** Tiny HD pixel globe: lime land squares, orbiting pulse nodes. DPR-aware 2D canvas
 *  (no WebGL, so it is free to mount in the header). Pauses off-screen. */
function MiniGlobe({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let disposed = false, raf = 0, visible = true, last = 0;
    let dots: [number, number, number][] = []; // lat, lon (rad), seed
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let size = 0, dpr = 1;
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(3, window.devicePixelRatio || 1);
      size = r.width;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    void loadLandMask().then((mask) => {
      if (disposed) return;
      const out: [number, number, number][] = [];
      const N = 2600, golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
        const lat = Math.asin(y), lon = Math.atan2(Math.sin(th) * r, Math.cos(th) * r);
        if (isLand(mask, (lat * 180) / Math.PI, (lon * 180) / Math.PI)) out.push([lat, lon, (i * 0.618) % 1]);
      }
      dots = out;
    }).catch(() => undefined);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden || now - last < 33) return; // ~30fps
      last = now;
      const t = now / 1000;
      const s = size * dpr, cx = s / 2, R = s * 0.46;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // soft inner glow disc
      const g = ctx.createRadialGradient(cx, cx, R * 0.2, cx, cx, R);
      g.addColorStop(0, "rgba(198,242,106,0.16)"); g.addColorStop(1, "rgba(198,242,106,0.02)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cx, R, 0, Math.PI * 2); ctx.fill();
      const rot = reduced ? 1.4 : t * 0.55, tilt = 0.38;
      const px = Math.max(1, Math.round(s * 0.012));
      const project = (lat: number, lon: number) => {
        const l = lon + rot, cl = Math.cos(lat);
        const x = cl * Math.sin(l), y0 = Math.sin(lat), z0 = cl * Math.cos(l);
        const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt), z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
        return { x: cx + x * R, y: cx - y * R, z };
      };
      for (const [lat, lon, seed] of dots) {
        const p = project(lat, lon);
        if (p.z < -0.05) continue;
        const a = 0.25 + 0.75 * Math.min(1, (p.z + 0.1) / 0.8);
        ctx.fillStyle = `rgba(${seed > 0.5 ? "198,242,106" : "150,205,70"},${a.toFixed(2)})`;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), px, px);
      }
      // hubs pulse
      GLOBE_HUBS.forEach((h, i) => {
        const p = project((h.lat * Math.PI) / 180, (h.lon * Math.PI) / 180);
        if (p.z < 0.05) return;
        const k = (t * 1.1 + i * 0.29) % 1;
        const r = px * (1.5 + k * 4);
        ctx.strokeStyle = `rgba(241,255,208,${(1 - k) * 0.8})`;
        ctx.lineWidth = Math.max(1, px * 0.5);
        ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
        ctx.fillStyle = "#f1ffd0";
        ctx.fillRect(Math.round(p.x - px), Math.round(p.y - px), px * 2, px * 2);
      });
    };
    raf = requestAnimationFrame(draw);
    return () => { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}

/** "Become a Node" invitation for the landing navigation: dark glass, a slowly circling
 *  lime light on the border, and a live pixel globe. */
export function NodeMenuBanner({ compact = false, onClick }: { compact?: boolean; onClick?: () => void }) {
  return (
    <Link href="/node" onClick={onClick} className={`${styles.banner} ${compact ? styles.compact : styles.full}`}>
      <span className={styles.border} aria-hidden />
      <span className={styles.surface} aria-hidden />
      <MiniGlobe className={styles.globe} />
      <span className={styles.copy}>
        {!compact && <span className={styles.eyebrow}><i /> Join the network</span>}
        <span className={styles.title}>Become a Node</span>
        {!compact && <span className={styles.sub}>Run agents worldwide and get rewarded.</span>}
      </span>
      <span className={styles.arrow} aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square"><path d="M4 12 12 4M5.5 4H12v6.5" /></svg>
      </span>
    </Link>
  );
}

export function NodeMenuDivider() {
  return <span className={styles.divider} aria-hidden="true"><span /><i /><span /></span>;
}
