"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Three.js stage for the analytics share card. The card canvas becomes a
 * texture on a plane with a glossy specular that follows the pointer, a slow
 * light sweep, parallax depth (shadow plane + glow), and drifting dust. It
 * flips in on mount, re-flashes when the art changes, and `burst` fires a
 * particle shower.
 */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uLight;
  uniform float uTime;
  uniform float uFlash;
  varying vec2 vUv;
  void main(){
    vec4 c = texture2D(uMap, vUv);
    float d = distance(vUv, uLight);
    float spec = exp(-d*d*9.0) * 0.17;
    float sweep = pow(max(0.0, 1.0 - abs(fract(vUv.x*0.75 - vUv.y*0.4 - uTime*0.06) - 0.5)*7.0), 3.0) * 0.07;
    vec3 col = c.rgb + vec3(spec + sweep + uFlash) * c.a;
    gl_FragColor = vec4(col, c.a);
  }
`;
const DUST = 420;

export default function ShareCard3D({ canvas, burst = 0, className }: { canvas: HTMLCanvasElement | null; burst?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setCanvas: (c: HTMLCanvasElement) => void; burst: () => void } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false, raf = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 40);
    camera.position.z = 6.4;
    const rig = new THREE.Group();
    scene.add(rig);

    const W = 3.2, H = (W * 9) / 16;
    const uniforms = { uMap: { value: null as THREE.Texture | null }, uLight: { value: new THREE.Vector2(0.3, 0.8) }, uTime: { value: 0 }, uFlash: { value: 0 } };
    const cardMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(W, H), cardMat);
    rig.add(card);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.02, H * 1.02), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    shadow.position.set(0.05, -0.1, -0.12);
    rig.add(shadow);

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const g = glowCanvas.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xd7ff00 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.7, H * 2), glowMat);
    glow.position.z = -0.4;
    rig.add(glow);

    const dustGeo = new THREE.BufferGeometry();
    const base = new Float32Array(DUST * 3), pos = new Float32Array(DUST * 3), vel = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      base[i * 3] = (Math.random() - 0.5) * 7; base[i * 3 + 1] = (Math.random() - 0.5) * 4.2; base[i * 3 + 2] = -0.5 + Math.random() * 1.6;
      vel[i] = 0.05 + Math.random() * 0.18;
    }
    pos.set(base);
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dustMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.014, transparent: true, opacity: 0.45, depthWrite: false });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    let tex: THREE.CanvasTexture | null = null;
    const setCanvas = (c: HTMLCanvasElement) => {
      if (disposed) return;
      tex?.dispose();
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      uniforms.uMap.value = tex;
      uniforms.uFlash.value = 0.22;
    };
    let burstUntil = 0;
    api.current = { setCanvas, burst: () => { burstUntil = performance.now() + 1800; } };

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.z = camera.aspect < 1.6 ? 6.4 * (1.6 / Math.max(camera.aspect, 0.9)) * 0.92 : 6.4;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    const target = new THREE.Vector2(0, 0), tilt = new THREE.Vector2(0, 0);
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      target.set(THREE.MathUtils.clamp(nx, -1.2, 1.2), THREE.MathUtils.clamp(ny, -1.2, 1.2));
    };
    const onLeave = () => target.set(0, 0);
    window.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(el);

    const clock = new THREE.Clock();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const t = clock.getElapsedTime();
      const intro = reduced ? 1 : ease(Math.min(1, t / 1.25));
      uniforms.uTime.value = t;
      uniforms.uFlash.value *= 0.92;
      tilt.lerp(target, 0.08);
      rig.rotation.y = (1 - intro) * -1.1 + tilt.x * 0.3 + Math.sin(t * 0.5) * 0.04;
      rig.rotation.x = (1 - intro) * 0.35 - tilt.y * 0.2 + Math.cos(t * 0.4) * 0.025;
      rig.position.y = Math.sin(t * 0.8) * 0.04;
      rig.scale.setScalar(0.82 + 0.18 * intro);
      cardMat.opacity = intro;
      uniforms.uLight.value.set(0.5 + tilt.x * 0.45, 0.5 + tilt.y * 0.45);
      shadow.position.set(0.05 - tilt.x * 0.08, -0.1 - tilt.y * 0.06, -0.12);
      glowMat.opacity = 0.1 + intro * 0.04 + Math.sin(t * 0.9) * 0.015;
      const left = burstUntil - performance.now();
      const bursting = left > 0;
      for (let i = 0; i < DUST; i++) {
        const k = i * 3, speed = bursting ? vel[i] * 9 : vel[i];
        let y = pos[k + 1] + speed * 0.016;
        if (y > 2.2) y = -2.2;
        pos[k + 1] = y;
        pos[k] = base[k] + Math.sin(t * 0.4 + i) * 0.05 + (bursting ? Math.sin(i * 12.9) * 0.4 * (1 - left / 1800) : 0);
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.opacity = bursting ? 0.9 : 0.45;
      dustMat.size = bursting ? 0.03 : 0.014;
      dust.position.set(-tilt.x * 0.15, -tilt.y * 0.1, 0);
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      ro.disconnect(); io.disconnect();
      tex?.dispose(); glowTex.dispose();
      card.geometry.dispose(); cardMat.dispose(); shadow.geometry.dispose(); (shadow.material as THREE.Material).dispose();
      glow.geometry.dispose(); glowMat.dispose(); dustGeo.dispose(); dustMat.dispose();
      renderer.dispose(); renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => { if (canvas) api.current?.setCanvas(canvas); }, [canvas]);
  useEffect(() => { if (burst) api.current?.burst(); }, [burst]);

  return <div ref={host} aria-hidden className={className} />;
}
