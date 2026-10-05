"use client";

import { useEffect, useRef } from "react";
import velloLogo from "@/assets/lo.png";

/* Real-3D rank medal for the campaign "Top clippers" podium: an extruded,
   bevelled hexagon in physically-based gold / silver / bronze, lit by a studio
   environment for real metal reflections. Front = the Vello mark cut from the
   live logo (assets/lo.png) as a polished emblem on a satin plate; back = the
   rank numeral. Three.js is lazy-loaded, the loop only runs while the medal
   is on screen and the tab is visible, and everything is disposed on unmount. */

const TONES = {
  1: { base: "#d9ad48", plate: "#c99a3c", emblem: "#fff0bf", glow: "rgba(234,196,94,0.38)" },
  2: { base: "#c3cad4", plate: "#aab2be", emblem: "#ffffff", glow: "rgba(190,205,225,0.32)" },
  3: { base: "#b8703f", plate: "#a45f33", emblem: "#ffd2b0", glow: "rgba(214,132,84,0.32)" },
} as const;

/** Tall pointy-top hexagon, 2 units high. */
function hexPoints(scale: number): [number, number][] {
  const pts: [number, number][] = [[0, 56], [42, 32], [42, -32], [0, -56], [-42, -32], [-42, 32]];
  return pts.map(([x, y]) => [(x / 56) * scale, (y / 56) * scale]);
}

/** White-on-black luminance mask, usable as an alphaMap. */
function maskCanvas(draw: (ctx: CanvasRenderingContext2D, size: number) => void): HTMLCanvasElement {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  draw(ctx, size);
  return c;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** The Vello mark (left ~23.5% of the lockup) as a white silhouette. */
async function markMask(): Promise<HTMLCanvasElement> {
  const img = await loadImage(velloLogo.src);
  const sw = Math.round(img.naturalWidth * 0.235);
  const sh = img.naturalHeight;
  const sil = document.createElement("canvas");
  sil.width = sw;
  sil.height = sh;
  const s = sil.getContext("2d")!;
  s.drawImage(img, 0, 0, sw, sh, 0, 0, sw, sh);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = "#fff";
  s.fillRect(0, 0, sw, sh);
  return maskCanvas((ctx, size) => {
    const box = size * 0.62;
    const k = Math.min(box / sw, box / sh);
    const w = sw * k, h = sh * k;
    ctx.drawImage(sil, (size - w) / 2, (size - h) / 2, w, h);
  });
}

function rankMask(rank: number): HTMLCanvasElement {
  return maskCanvas((ctx, size) => {
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${size * 0.46}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(String(rank), size / 2, size * 0.47);
    ctx.font = `600 ${size * 0.075}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText("V E L L O", size / 2, size * 0.76);
  });
}

export function RankMedal3D({ rank }: { rank: 1 | 2 | 3 }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tone = TONES[rank];

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let raf = 0;
    let onScreen = true;
    let cleanup: (() => void) | undefined;

    (async () => {
      const T = await import("three");
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      const mark = await markMask().catch(() => null);
      if (disposed) return;

      const width = host.clientWidth || 150;
      const height = host.clientHeight || 176;
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      host.appendChild(renderer.domElement);

      const scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
      const key = new T.DirectionalLight(0xffffff, 1.6);
      key.position.set(2.5, 3, 4);
      scene.add(key);

      const camera = new T.PerspectiveCamera(30, width / height, 0.1, 50);
      camera.position.set(0, 0, 6.2);

      const disposables: { dispose(): void }[] = [renderer, pmrem, envTex];
      const track = <X extends { dispose(): void }>(x: X) => { disposables.push(x); return x; };

      const shape = (scale: number) => new T.Shape(hexPoints(scale).map(([x, y]) => new T.Vector2(x, y)));
      const medal = new T.Group();

      // Base slab — polished bevelled edge.
      const baseGeo = track(new T.ExtrudeGeometry(shape(1), { depth: 0.14, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6, curveSegments: 1 }));
      baseGeo.center();
      const baseMat = track(new T.MeshPhysicalMaterial({ color: tone.base, metalness: 1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
      medal.add(new T.Mesh(baseGeo, baseMat));

      // Satin face plates, front and back, sitting proud of the base.
      const plateGeo = track(new T.ExtrudeGeometry(shape(0.8), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.025, bevelSegments: 3, curveSegments: 1 }));
      plateGeo.center();
      const plateMat = track(new T.MeshPhysicalMaterial({ color: tone.plate, metalness: 1, roughness: 0.42 }));
      const faceZ = 0.07 + 0.06 + 0.02;
      const front = new T.Mesh(plateGeo, plateMat);
      front.position.z = faceZ;
      const back = new T.Mesh(plateGeo, plateMat);
      back.position.z = -faceZ;
      medal.add(front, back);

      // Emblems — polished, masked from the live logo / rank numeral.
      const emblemGeo = track(new T.PlaneGeometry(1.25, 1.25));
      const emblem = (canvas: HTMLCanvasElement, z: number, flip: boolean) => {
        const tex = track(new T.CanvasTexture(canvas));
        const mat = track(new T.MeshPhysicalMaterial({ color: tone.emblem, metalness: 1, roughness: 0.08, alphaMap: tex, transparent: true, alphaTest: 0.5 }));
        const m = new T.Mesh(emblemGeo, mat);
        m.position.z = z;
        if (flip) m.rotation.y = Math.PI;
        medal.add(m);
      };
      const lift = faceZ + 0.045;
      if (mark) emblem(mark, lift, false);
      emblem(rankMask(rank), -lift, true);

      scene.add(medal);

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let pointerX = 0, pointerY = 0, tiltX = 0, tiltY = 0;
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        pointerX = (e.clientX - r.left) / r.width - 0.5;
        pointerY = (e.clientY - r.top) / r.height - 0.5;
      };
      const onLeave = () => { pointerX = 0; pointerY = 0; };
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);

      const start = performance.now() - rank * 900; // stagger the three medals
      const frame = (now: number) => {
        raf = 0;
        const t = (now - start) / 1000;
        tiltX += (pointerY * 0.5 - tiltX) * 0.08;
        tiltY += (pointerX * 0.9 - tiltY) * 0.08;
        medal.rotation.y = (reduce ? 0.45 : t * 0.9) + tiltY;
        medal.rotation.x = (reduce ? 0 : Math.sin(t * 0.8) * 0.1) + tiltX;
        medal.position.y = reduce ? 0 : Math.sin(t * 1.4) * 0.05;
        renderer.render(scene, camera);
        if (!reduce && onScreen && document.visibilityState === "visible") raf = requestAnimationFrame(frame);
      };
      const kick = () => { if (!raf && onScreen && document.visibilityState === "visible") raf = requestAnimationFrame(frame); };

      const io = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; kick(); });
      io.observe(host);
      document.addEventListener("visibilitychange", kick);
      renderer.render(scene, camera);
      kick();

      cleanup = () => {
        cancelAnimationFrame(raf);
        io.disconnect();
        document.removeEventListener("visibilitychange", kick);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerleave", onLeave);
        for (const d of disposables) d.dispose();
        renderer.domElement.remove();
      };
      if (disposed) cleanup();
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [rank, tone]);

  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl" style={{ background: tone.glow }} />
      <div ref={hostRef} className="relative h-[176px] w-[150px]" role="img" aria-label={`Rank ${rank} medal`} />
      <div aria-hidden className="mx-auto -mt-3 h-2 w-16 rounded-[50%] bg-black/60 blur-md" />
    </div>
  );
}
