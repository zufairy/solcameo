"use client";

import { useEffect, useRef } from "react";

/* Real-3D "accepted platforms" row for the campaign chips strip: small glass
   plates, one shared WebGL context (not one canvas per icon — that's what
   made RankMedal3D fine at 3 medals but would tank a 7-icon row), each with a
   satin plate and the platform's own glyph cut as a polished emblem. Same
   discipline as rank-medal-3d.tsx: three.js lazy-loaded, loop only runs on
   screen + visible tab, everything disposed on unmount. */

// Path data lifted straight from components/cofounder/social-icons.tsx (24x24
// viewBox) — drawn into a canvas mask via Path2D instead of rasterizing the
// React SVG components, so this stays a pure-canvas pipeline with no DOM diff.
const GLYPHS: Record<string, { d: string; color: string }> = {
  tiktok: { d: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z", color: "#25F4EE" },
  instagram: { d: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z", color: "#E4405F" },
  youtube: { d: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z", color: "#FF0000" },
  x: { d: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z", color: "#E7E9EA" },
  facebook: { d: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z", color: "#1877F2" },
  threads: { d: "M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 013.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Z", color: "#F5F5F5" },
  linkedin: { d: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z", color: "#0A66C2" },
};

/** Icon drawn in its own brand color on a genuinely transparent canvas (real
 *  alpha channel, not a luminance mask) — used as both `map` and `emissiveMap`
 *  so the glyph is unambiguously visible under any lighting, independent of
 *  how any given renderer/material combo happens to sample alphaMap. */
function glyphTexture(d: string, color: string): HTMLCanvasElement {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.save();
  ctx.scale(size / 24, size / 24);
  ctx.fill(new Path2D(d));
  ctx.restore();
  return c;
}

export function SocialBadges3D({ platforms }: { platforms: string[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ids = platforms.filter((p) => GLYPHS[p]);
  const idsKey = ids.join(",");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || ids.length === 0) return;
    let disposed = false;
    let raf = 0;
    let onScreen = true;
    let cleanup: (() => void) | undefined;

    (async () => {
      const T = await import("three");
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      if (disposed) return;

      const BADGE = 52; // a touch bigger than the old flat chip — small icon detail needs the room
      const width = Math.max(1, ids.length * BADGE);
      const height = BADGE;
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      host.appendChild(renderer.domElement);

      const scene = new T.Scene();
      const pmrem = new T.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.045).texture;
      scene.environment = envTex;
      const key = new T.DirectionalLight(0xffffff, 1.5);
      key.position.set(2, 3, 4);
      scene.add(key);

      const camera = new T.OrthographicCamera(-ids.length, ids.length, 1, -1, 0.1, 20);
      camera.position.set(0, 0, 6);

      const disposables: { dispose(): void }[] = [renderer, pmrem, envTex];
      const track = <X extends { dispose(): void }>(x: X) => { disposables.push(x); return x; };

      // Rounded-square outline, corner radius 0.22 of the half-side.
      const shape = (() => {
        const half = 0.78, r = 0.22;
        const sh = new T.Shape();
        sh.moveTo(-half + r, -half);
        sh.lineTo(half - r, -half);
        sh.quadraticCurveTo(half, -half, half, -half + r);
        sh.lineTo(half, half - r);
        sh.quadraticCurveTo(half, half, half - r, half);
        sh.lineTo(-half + r, half);
        sh.quadraticCurveTo(-half, half, -half, half - r);
        sh.lineTo(-half, -half + r);
        sh.quadraticCurveTo(-half, -half, -half + r, -half);
        return sh;
      })();
      const plateGeo = track(new T.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5, curveSegments: 4 }));
      plateGeo.center();
      const emblemGeo = track(new T.PlaneGeometry(1.02, 1.02));

      const badges = ids.map((id, i) => {
        const { d, color } = GLYPHS[id];
        const group = new T.Group();
        // Neutral graphite plate — a brand-tinted sheen here made the emblem's
        // color nearly match its backdrop, so the glyph silhouette disappeared
        // into a flat colored square. Keep the plate hue-neutral; only the
        // emblem carries the brand color, so the mask actually reads as an icon.
        const plateMat = track(new T.MeshPhysicalMaterial({ color: "#1c1c1e", metalness: 0.4, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
        group.add(new T.Mesh(plateGeo, plateMat));
        const tex = track(new T.CanvasTexture(glyphTexture(d, color)));
        tex.colorSpace = T.SRGBColorSpace;
        // At a 44–56px on-screen size, mipmapped minification averages the
        // icons' thin strokes into invisibility. Linear filtering with no
        // mipmaps keeps the glyph crisp at this size.
        tex.generateMipmaps = false;
        tex.minFilter = T.LinearFilter;
        tex.magFilter = T.LinearFilter;
        // Real per-pixel alpha (not a luminance alphaMap) drives transparency
        // here, and the same texture lights up as emissive so the glyph pops
        // regardless of how the scene's environment/key light happens to hit
        // this particular badge.
        const emblemMat = track(new T.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, toneMapped: false }));
        const emblem = new T.Mesh(emblemGeo, emblemMat);
        // The extruded+bevelled plate is `depth:0.22` plus `bevelThickness:0.05`
        // on each end, then `.center()`-ed — so its real front face sits at
        // z≈+0.16, not at the extrude depth's half (0.11). z=0.15 put the
        // emblem BEHIND that face, where the opaque plate depth-occluded it
        // entirely — the actual cause of the icon never showing, independent
        // of every material/texture theory tried before this.
        emblem.position.z = 0.2;
        group.add(emblem);
        group.position.x = (i - (ids.length - 1) / 2) * 2.05;
        scene.add(group);
        return group;
      });

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

      const start = performance.now();
      const frame = (now: number) => {
        raf = 0;
        const t = (now - start) / 1000;
        tiltX += (pointerY * 0.4 - tiltX) * 0.08;
        tiltY += (pointerX * 0.6 - tiltY) * 0.08;
        badges.forEach((g, i) => {
          const phase = t * 0.7 + i * 0.6;
          g.rotation.y = (reduce ? 0.35 : Math.sin(phase) * 0.5) + tiltY;
          g.rotation.x = (reduce ? 0 : Math.cos(phase * 0.8) * 0.12) + tiltX;
          g.position.y = reduce ? 0 : Math.sin(phase * 1.1) * 0.06;
        });
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
  }, [idsKey]);

  if (ids.length === 0) return null;
  return <div ref={hostRef} className="h-[52px]" style={{ width: ids.length * 52 }} role="img" aria-label="Accepted platforms" />;
}
