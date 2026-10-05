"use client";

import { useEffect, useRef } from "react";
import styles from "./node.module.css";

/* A living, hand-painted sky in WebGL (three.js).
   - a domain-warped fbm shader paints drifting clouds with brush-stroke grain
     and a warm golden-hour glow along the horizon;
   - the pointer nudges the camera for depth.
   It sits above the CSS sky fallback and fades in once the first frame lands.
   Reduced-motion users get one still frame; no WebGL leaves the CSS sky. */

const SKY_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform int uOct;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { if (i >= uOct) break; v += a * n(p); p = m * p; a *= 0.5; } return v; }
void main(){
  vec2 uv = vUv; float y = uv.y; float asp = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(asp, 1.0) * 2.3 + uMouse * 0.08;
  float t = uTime * 0.04;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 1.1 * q + vec2(1.7, 9.2) + 0.6 * t), fbm(p + 1.1 * q + vec2(8.3, 2.8) - 0.5 * t));
  float f = fbm(p * 1.05 + 1.35 * r);
  vec2 d = normalize(r - 0.5 + 1e-3);
  float stroke = n(vec2(dot(p, d) * 2.0, dot(p, vec2(-d.y, d.x)) * 30.0));
  f = (f - 0.5) * 2.1 + 0.5 + (stroke - 0.5) * 0.12 + (y - 0.5) * -0.12;
  vec3 top = vec3(0.09, 0.22, 0.50), mid = vec3(0.34, 0.56, 0.84), low = vec3(0.99, 0.80, 0.55);
  vec3 sky = mix(mid, top, smoothstep(0.4, 1.0, y));
  sky = mix(sky, low, smoothstep(0.5, 0.0, y) * 0.92);
  float c = smoothstep(0.46, 0.66, f);
  float lit = smoothstep(0.55, 0.95, f + (y - 0.5) * 0.3);
  vec3 cloud = mix(vec3(0.58, 0.69, 0.90), mix(vec3(1.0, 0.82, 0.58), vec3(1.0, 0.97, 0.9), lit), lit);
  cloud = mix(cloud, vec3(1.0, 0.72, 0.42), smoothstep(0.55, 0.0, y) * 0.55);
  vec3 col = mix(sky, cloud, c * 0.92);
  col = mix(col, floor(col * 14.0 + 0.5) / 14.0, 0.35);
  col += (h(uv * uRes * 0.5) - 0.5) * 0.035;
  col *= 1.0 - 0.38 * pow(length(uv - 0.5) * 1.25, 2.2);
  gl_FragColor = vec4(col, 1.0);
}`;
export default function NodeSky() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, cleanup = () => {};
    void (async () => {
      const THREE = await import("three");
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" }); } catch { return; }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const small = window.innerWidth < 760;
      renderer.autoClear = false;
      el.appendChild(renderer.domElement);
      renderer.domElement.className = styles.skyCanvas;

      const bgScene = new THREE.Scene(), bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthTest: false, depthWrite: false,
        uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 14 }, uMouse: { value: new THREE.Vector2() }, uOct: { value: small ? 3 : 5 } } });
      bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat));

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 0.8 : 1.25));
        renderer.setSize(w, h, false);
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        skyMat.uniforms.uRes.value.copy(size);
      };
      resize();
      const ro = new ResizeObserver(resize); ro.observe(el);

      const mouse = new THREE.Vector2(), smooth = new THREE.Vector2();
      const onMove = (e: PointerEvent) => { mouse.set((e.clientX / window.innerWidth - 0.5) * 2, -(e.clientY / window.innerHeight - 0.5) * 2); };
      window.addEventListener("pointermove", onMove, { passive: true });

      let raf = 0, visible = true, last = performance.now(), time = 14;
      const draw = () => {
        smooth.lerp(mouse, 0.04);
        skyMat.uniforms.uMouse.value.copy(smooth);
        skyMat.uniforms.uTime.value = time;
        renderer.clear(); renderer.render(bgScene, bgCam);
      };
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible) { last = now; return; }
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        time += dt; draw();
      };
      draw();
      el.dataset.ready = "true";
      if (!reduced) raf = requestAnimationFrame(loop);
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }); io.observe(el);

      cleanup = () => {
        cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); window.removeEventListener("pointermove", onMove);
        skyMat.dispose(); renderer.dispose(); renderer.domElement.remove();
      };
    })();
    return () => { disposed = true; cleanup(); };
  }, []);
  return <div ref={host} className={styles.skyGl} aria-hidden="true" />;
}
