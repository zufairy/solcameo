"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Preview = { id: string; title: string; src: string; poster?: string };

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// Rounded-rect mask with a tight radius, cover-fit video sampling, a thin lit edge and a dim for the back cards.
const FRAG = `
uniform sampler2D map;
uniform float uOpacity;
uniform float uDim;
uniform float uHasVideo;
uniform float uVideoAspect;
varying vec2 vUv;
const float ASPECT = 0.5625;
float roundedBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(ASPECT, 1.0);
  float d = roundedBox(p, vec2(ASPECT * 0.5, 0.5), 0.018);
  float alpha = 1.0 - smoothstep(-0.002, 0.002, d);
  vec2 uv = vUv;
  if (uVideoAspect > ASPECT) uv.x = (vUv.x - 0.5) * ASPECT / uVideoAspect + 0.5;
  else uv.y = (vUv.y - 0.5) * uVideoAspect / ASPECT + 0.5;
  vec3 video = texture2D(map, uv).rgb;
  vec3 placeholder = mix(vec3(0.07, 0.075, 0.085), vec3(0.14, 0.15, 0.17), vUv.y);
  vec3 color = mix(placeholder, video, uHasVideo);
  float shade = mix(0.78, 1.0, vUv.y);
  color *= shade * (1.0 - uDim);
  float edge = smoothstep(-0.006, -0.001, d) * (1.0 - smoothstep(-0.001, 0.002, d));
  color += edge * 0.22;
  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;

type Card = { x: number; rz: number; ry: number; z: number; scale: number; dim: number; spread: number };
const CARDS: Card[] = [
  { x: -0.82, rz: 0.1, ry: 0.28, z: -0.3, scale: 0.88, dim: 0.34, spread: -0.5 },
  { x: 0.82, rz: -0.1, ry: -0.28, z: -0.3, scale: 0.88, dim: 0.34, spread: 0.5 },
  { x: 0, rz: 0, ry: 0, z: 0.25, scale: 1, dim: 0, spread: 0 },
];

/**
 * Three video cards stacked in real 3D with three.js: each Explore clip is a video texture on a rounded plane,
 * the stack tilts toward the pointer, floats gently and spreads on hover. Falls back to `fallback` without WebGL.
 */
export function VideoStack({ videos, reduced, fallback }: { videos: Preview[]; reduced: boolean; fallback: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const sources = videos.map((v) => v.src).join("|");

  useEffect(() => {
    const el = host.current;
    if (!el || !videos.length) return;
    let disposed = false;
    let cleanup = () => {};
    void import("three").then((THREE) => {
      if (disposed || !host.current) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" }); } catch { setFailed(true); return; }
      // Video frames are already display-encoded; pass them straight through.
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      camera.position.set(0, 0, 5.2);
      const stack = new THREE.Group();
      scene.add(stack);

      const geometry = new THREE.PlaneGeometry(1, 1.7778);
      const items = CARDS.map((card, i) => {
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.muted = true; video.loop = true; video.playsInline = true; video.preload = "auto";
        video.src = videos[i % videos.length].src;
        const texture = new THREE.VideoTexture(video);
        texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
        const material = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FRAG, transparent: true,
          uniforms: { map: { value: texture }, uOpacity: { value: 0 }, uDim: { value: card.dim }, uHasVideo: { value: 0 }, uVideoAspect: { value: 0.5625 } },
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(card.x, -0.5, card.z);
        mesh.scale.setScalar(card.scale * 0.9);
        stack.add(mesh);
        const ready = () => {
          material.uniforms.uHasVideo.value = 1;
          if (video.videoWidth && video.videoHeight) material.uniforms.uVideoAspect.value = video.videoWidth / video.videoHeight;
        };
        video.addEventListener("loadeddata", ready);
        if (!reduced) void video.play().catch(() => undefined);
        return { card, mesh, material, texture, video, ready };
      });

      let hover = false;
      const pointer = { x: 0, y: 0 };
      const tilt = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      };
      const onEnter = () => { hover = true; };
      const onLeave = () => { hover = false; pointer.x = 0; pointer.y = 0; };
      el.addEventListener("pointermove", onMove); el.addEventListener("pointerenter", onEnter); el.addEventListener("pointerleave", onLeave);

      const resize = () => {
        const w = el.clientWidth || 1, h = el.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // Pull the camera back on narrow containers so the whole stack stays in frame.
        camera.position.z = Math.max(5.2, 5.2 * (2.7 / (w / h)) / 1.9);
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(el);

      const start = performance.now();
      let raf = 0;
      const frame = (now: number) => {
        const t = (now - start) / 1000;
        tilt.x += (pointer.y * 0.18 - tilt.x) * 0.08;
        tilt.y += (pointer.x * 0.35 - tilt.y) * 0.08;
        stack.rotation.x = reduced ? 0 : tilt.x;
        stack.rotation.y = reduced ? 0 : tilt.y;
        items.forEach((item, i) => {
          const enter = Math.min(1, Math.max(0, (t - 0.08 * (2 - Math.abs(i - 2))) / 0.8));
          const eased = 1 - Math.pow(1 - enter, 3);
          const targetX = item.card.x + (hover ? item.card.spread : 0);
          item.mesh.position.x += (targetX - item.mesh.position.x) * 0.12;
          const bob = reduced ? 0 : Math.sin(t * 1.2 + i * 1.6) * 0.035;
          item.mesh.position.y = bob - (1 - eased) * 0.5;
          item.mesh.rotation.z = item.card.rz * eased * (hover ? 1.35 : 1);
          item.mesh.rotation.y = item.card.ry * eased;
          item.mesh.scale.setScalar(item.card.scale * (0.9 + 0.1 * eased));
          item.material.uniforms.uOpacity.value = eased;
          // Only upload a frame once the video has one.
          if (item.video.readyState >= 2) item.texture.needsUpdate = true;
        });
        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      cleanup = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerenter", onEnter); el.removeEventListener("pointerleave", onLeave);
        items.forEach((item) => {
          item.video.removeEventListener("loadeddata", item.ready);
          item.video.pause(); item.video.removeAttribute("src"); item.video.load();
          item.texture.dispose(); item.material.dispose();
        });
        geometry.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => setFailed(true));
    return () => { disposed = true; cleanup(); };
    // `sources` stands in for the videos array so a re-render with the same clips doesn't rebuild the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, reduced]);

  if (failed) return <>{fallback}</>;
  return (
    <div
      ref={host}
      role="img"
      aria-label="Three example videos from Explore"
      className="relative mx-auto h-[270px] w-full max-w-[460px]"
    >
      {!videos.length && <div aria-hidden className="absolute inset-0 grid place-items-center"><div className="h-40 w-24 animate-pulse rounded-[3px] bg-white/[0.05]" /></div>}
    </div>
  );
}
