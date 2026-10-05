"use client";

import { useEffect, useRef } from "react";
import styles from "./node.module.css";

/* An engraved, slowly turning dotted globe. Land comes from the same Natural
   Earth topology the 1B Club uses (/1b-club/world-110m.json), rasterised once to
   a mask and sampled onto a Fibonacci sphere. Gold nodes pulse and exchange
   arcs. Pure 2D canvas — no WebGL, so it is light on phones. */

type Topology = { transform: { scale: number[]; translate: number[] }; arcs: number[][][]; objects: { land: { geometries: { type: string; arcs: number[][] | number[][][] }[] } } };
const NODES: { name: string; lat: number; lon: number }[] = [
  { name: "Kuala Lumpur", lat: 3.1, lon: 101.7 }, { name: "Sydney", lat: -33.9, lon: 151.2 }, { name: "Dubai", lat: 25.2, lon: 55.3 },
  { name: "London", lat: 51.5, lon: -0.1 }, { name: "Lagos", lat: 6.5, lon: 3.4 }, { name: "New York", lat: 40.7, lon: -74 },
  { name: "São Paulo", lat: -23.5, lon: -46.6 }, { name: "Manila", lat: 14.6, lon: 121 }, { name: "Mumbai", lat: 19.1, lon: 72.9 },
  { name: "Los Angeles", lat: 34.1, lon: -118.2 }, { name: "Berlin", lat: 52.5, lon: 13.4 }, { name: "Nairobi", lat: -1.3, lon: 36.8 },
];
const ARCS = [[0, 3], [3, 5], [5, 9], [0, 1], [2, 4], [6, 5], [7, 0], [8, 3], [10, 11], [9, 7]] as const;
const RAD = Math.PI / 180;

async function landMask(signal: AbortSignal): Promise<ImageData> {
  const t = (await (await fetch("/1b-club/world-110m.json", { signal })).json()) as Topology;
  const [sx, sy] = t.transform.scale, [tx, ty] = t.transform.translate;
  const arcs = t.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty] as [number, number]; }); });
  const W = 720, H = 360, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  const ring = (idx: number[]) => {
    const pts: [number, number][] = [];
    for (const i of idx) { const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse(); pts.push(...(pts.length ? a.slice(1) : a)); }
    return pts;
  };
  const draw = (rings: number[][][]) => {
    g.beginPath();
    for (const r of rings) ring(r as unknown as number[]).forEach(([lon, lat], i) => { const x = (lon + 180) * 2, y = (90 - lat) * 2; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.fill("evenodd");
  };
  for (const geo of t.objects.land.geometries) {
    if (geo.type === "Polygon") draw(geo.arcs as number[][][]);
    else if (geo.type === "MultiPolygon") for (const poly of geo.arcs as unknown as number[][][][]) draw(poly as number[][][]);
  }
  return g.getImageData(0, 0, W, H);
}

export default function NodeGlobe() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const abort = new AbortController();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: [number, number][] = [];
    let raf = 0, size = 0, visible = true, lon0 = 40;
    const t0 = performance.now();
    const resize = () => {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      size = r.width; canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.width * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const project = (lat: number, lon: number, alt = 1) => {
      const la = lat * RAD, lo = (lon - lon0) * RAD, tilt = 18 * RAD;
      const x = Math.cos(la) * Math.sin(lo), y0 = Math.sin(la), z0 = Math.cos(la) * Math.cos(lo);
      const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt), z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
      const R = size * 0.42 * alt;
      return { x: size / 2 + x * R, y: size / 2 - y * R, z };
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      const t = (now - t0) / 1000;
      if (!reduced) lon0 = 40 + t * 7;
      ctx.clearRect(0, 0, size, size);
      const R = size * 0.42, cx = size / 2;
      const body = ctx.createRadialGradient(cx - R * 0.35, cx - R * 0.4, R * 0.1, cx, cx, R);
      body.addColorStop(0, "rgba(58,92,160,.55)"); body.addColorStop(1, "rgba(8,16,40,.85)");
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cx, R, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(246,233,200,.28)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cx, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = "rgba(246,233,200,.09)";
      for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); let go = false; for (let lo = -180; lo <= 180; lo += 6) { const p = project(lat, lo); if (p.z > 0) { if (go) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); go = true; } else go = false; } ctx.stroke(); }
      for (const [lat, lon] of dots) { const p = project(lat, lon); if (p.z <= 0.02) continue; ctx.fillStyle = `rgba(246,233,200,${0.18 + p.z * 0.6})`; ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6); }
      ARCS.forEach(([a, b], i) => {
        const A = NODES[a], B = NODES[b], k = ((t * 0.18 + i * 0.37) % 1.4);
        const n = 40, hi = Math.min(n, Math.round(Math.max(0, Math.min(1, k)) * n)), lo = Math.max(0, Math.round((k - 0.4) * n));
        ctx.strokeStyle = "rgba(232,184,95,.75)"; ctx.lineWidth = 1.2; ctx.beginPath(); let go = false;
        const va = [Math.cos(A.lat * RAD) * Math.cos(A.lon * RAD), Math.cos(A.lat * RAD) * Math.sin(A.lon * RAD), Math.sin(A.lat * RAD)];
        const vb = [Math.cos(B.lat * RAD) * Math.cos(B.lon * RAD), Math.cos(B.lat * RAD) * Math.sin(B.lon * RAD), Math.sin(B.lat * RAD)];
        const om = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
        for (let s = lo; s <= hi; s++) {
          const f = s / n, w1 = Math.sin((1 - f) * om) / Math.sin(om), w2 = Math.sin(f * om) / Math.sin(om);
          const v = [w1 * va[0] + w2 * vb[0], w1 * va[1] + w2 * vb[1], w1 * va[2] + w2 * vb[2]];
          const p = project(Math.asin(v[2]) / RAD, Math.atan2(v[1], v[0]) / RAD, 1 + Math.sin(f * Math.PI) * 0.16);
          if (p.z > 0) { if (go) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); go = true; } else go = false;
        }
        ctx.stroke();
      });
      NODES.forEach((n, i) => {
        const p = project(n.lat, n.lon); if (p.z <= 0.05) return;
        const pulse = (t * 0.6 + i * 0.29) % 1;
        ctx.strokeStyle = `rgba(232,184,95,${(1 - pulse) * 0.7})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 3 + pulse * 16, 0, 7); ctx.stroke();
        ctx.fillStyle = "#f4d58d"; ctx.shadowColor = "#e8b85f"; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      });
    };
    resize();
    window.addEventListener("resize", resize);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);
    landMask(abort.signal).then((img) => {
      const out: [number, number][] = [], N = 12000, ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const lat = Math.asin(1 - (2 * (i + 0.5)) / N) / RAD, lon = ((((i * ga) / RAD) % 360) + 360) % 360 - 180;
        const x = Math.min(719, Math.floor((lon + 180) * 2)), y = Math.min(359, Math.floor((90 - lat) * 2));
        if (img.data[(y * 720 + x) * 4 + 3] > 40) out.push([lat, lon]);
      }
      dots = out;
    }).catch(() => {});
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); abort.abort(); io.disconnect(); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className={styles.globe} role="img" aria-label="A globe of Vello nodes connecting cities across the world" />;
}
