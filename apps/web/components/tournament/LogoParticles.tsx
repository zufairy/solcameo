"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Three.js hero: the Solcameo star mark rebuilt out of ~12k particles.
 * They scatter in, snap into the logo's silhouette (colours sampled from the
 * PNG), then breathe with a slow wave and push away from the cursor.
 * Rendering pauses off-screen / on hidden tabs; reduced-motion gets one still frame.
 */
const VERT = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aColor;
  attribute float aSeed;
  uniform float uTime;
  uniform float uForm;
  uniform vec2 uMouse;
  uniform float uPx;
  varying vec3 vColor;
  varying float vAlpha;
  float ease(float t){ return t*t*(3.0-2.0*t); }
  void main(){
    float f = ease(clamp(uForm*1.25 - aSeed*0.25, 0.0, 1.0));
    vec3 p = mix(aStart, position, f);
    float breathe = sin(uTime*1.2 + position.x*2.2 + position.y*1.6 + aSeed*6.28);
    p.z += breathe * 0.07 * f;
    p.xy += normalize(position.xy + 0.0001) * breathe * 0.012 * f;
    vec2 d = p.xy - uMouse;
    float m = smoothstep(0.55, 0.0, length(d));
    p.xy += normalize(d + 0.0001) * m * 0.32;
    p.z += m * 0.35;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.6 + aSeed * 1.6 + m * 2.0) * uPx * (3.2 / -mv.z);
    vColor = aColor * (0.85 + 0.25 * breathe) + m * 0.25;
    vAlpha = 0.35 + 0.65 * f;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.15, r));
  }
`;

const GRID = 150;

async function sampleLogo(src: string): Promise<{ pos: Float32Array; col: Float32Array; n: number } | null> {
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch { return null; }
  const cv = document.createElement("canvas");
  cv.width = cv.height = GRID;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, GRID, GRID);
  const data = ctx.getImageData(0, 0, GRID, GRID).data;
  const pos: number[] = [];
  const col: number[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = (y * GRID + x) * 4;
      if (data[i + 3] < 140) continue;
      // jitter inside the cell so the grid doesn't read as a lattice
      const jx = (Math.random() - 0.5) * 0.9, jy = (Math.random() - 0.5) * 0.9;
      pos.push(((x + jx) / GRID - 0.5) * 2, -((y + jy) / GRID - 0.5) * 2, (Math.random() - 0.5) * 0.06);
      col.push(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    }
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col), n: pos.length / 3 };
}

export default function LogoParticles({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    const decorations: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    let logoTexture: THREE.Texture | null = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
    catch { return; }
    renderer.setClearColor(0x000000, 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.z = 4.2;
    const group = new THREE.Group();
    scene.add(group);
    const loader = new THREE.TextureLoader();
    logoTexture = loader.load("/brand/solcameo-mark.png", () => { if (!disposed) { el.dataset.ready = "true"; if (reduced) draw(); } });
    logoTexture.colorSpace = THREE.SRGBColorSpace;
    const logoGeometry = new THREE.PlaneGeometry(2.25, 2.25);
    const logoMaterial = new THREE.MeshBasicMaterial({ map: logoTexture, transparent: true, depthWrite: false });
    const logo = new THREE.Mesh(logoGeometry, logoMaterial);
    logo.position.z = 0.06;
    group.add(logo);
    decorations.push({ geometry: logoGeometry, material: logoMaterial });

    // Fine, tilted orbital paths make the logo read as a floating object.
    const orbits: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const geometry = new THREE.TorusGeometry(1.55 + i * 0.16, 0.004, 6, 150);
      const material = new THREE.MeshBasicMaterial({ color: i === 1 ? 0xd7ff00 : 0xa3e635, transparent: true, opacity: 0.14 + i * 0.035, depthWrite: false });
      const orbit = new THREE.Mesh(geometry, material);
      orbit.rotation.set(0.75 + i * 0.42, i * 0.65, i * 0.4);
      scene.add(orbit); orbits.push(orbit); decorations.push({ geometry, material });
    }

    const uniforms = {
      uTime: { value: 0 },
      uForm: { value: reduced ? 1 : 0 },
      uMouse: { value: new THREE.Vector2(9, 9) },
      uPx: { value: dpr },
    };
    let mat: THREE.ShaderMaterial | null = null;
    let geo: THREE.BufferGeometry | null = null;

    // Orbiting sparks — a loose ring that gives the mark a sense of motion.
    const ringN = 260;
    const ringGeo = new THREE.BufferGeometry();
    const ringPos = new Float32Array(ringN * 3);
    const ringSeed = new Float32Array(ringN);
    for (let i = 0; i < ringN; i++) { ringSeed[i] = Math.random(); }
    ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
    const ringMat = new THREE.PointsMaterial({ color: 0xd7ff00, size: 0.012, transparent: true, opacity: 0.55, depthWrite: false });
    const ring = new THREE.Points(ringGeo, ringMat);
    group.add(ring);
    const updateRing = (t: number) => {
      for (let i = 0; i < ringN; i++) {
        const a = (i / ringN) * Math.PI * 2 + t * 0.12 * (0.6 + ringSeed[i] * 0.8);
        const r = 1.55 + Math.sin(t * 0.7 + i) * 0.04 + ringSeed[i] * 0.22;
        ringPos[i * 3] = Math.cos(a) * r;
        ringPos[i * 3 + 1] = Math.sin(a) * r * 0.62;
        ringPos[i * 3 + 2] = Math.sin(a * 2 + t * 0.4) * 0.25;
      }
      ringGeo.attributes.position.needsUpdate = true;
    };
    updateRing(0);

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep the whole mark in frame on narrow hosts
      camera.position.z = camera.aspect < 1 ? 4.2 / Math.max(camera.aspect, 0.55) : 4.2;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const mouse = new THREE.Vector2(9, 9);
    const target = new THREE.Vector2(9, 9);
    const tilt = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      if (nx < -1.1 || nx > 1.1 || ny < -1.1 || ny > 1.1) { target.set(9, 9); return; }
      ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
      if (ray.ray.intersectPlane(plane, hit)) target.set(hit.x / 0.9, hit.y / 0.9);
      tilt.set(nx, ny);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(el);

    const clock = new THREE.Clock();
    const draw = () => {
      const t = clock.getElapsedTime();
      uniforms.uTime.value = t;
      if (!reduced) uniforms.uForm.value = Math.min(1, t / 2.6);
      mouse.lerp(target, 0.12);
      uniforms.uMouse.value.copy(mouse);
      group.rotation.y += ((tilt.x * 0.35 + Math.sin(t * 0.35) * 0.18) - group.rotation.y) * 0.05;
      group.rotation.x += ((-tilt.y * 0.2) - group.rotation.x) * 0.05;
      logo.position.y = reduced ? 0 : Math.sin(t * 0.7) * 0.055;
      logoMaterial.opacity = reduced ? 1 : Math.min(1, t / 1.5);
      orbits.forEach((orbit, i) => { if (!reduced) orbit.rotation.z = t * (0.07 + i * 0.025) + i; });
      updateRing(t);
      renderer.render(scene, camera);
    };
    const loop = () => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      if (visible && !document.hidden) draw();
    };

    sampleLogo("/brand/solcameo-mark.png").then((s) => {
      if (disposed || !s) return;
      geo = new THREE.BufferGeometry();
      const start = new Float32Array(s.n * 3);
      const seed = new Float32Array(s.n);
      for (let i = 0; i < s.n; i++) {
        const a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 2.4;
        start[i * 3] = Math.cos(a) * r; start[i * 3 + 1] = Math.sin(a) * r * 0.7; start[i * 3 + 2] = (Math.random() - 0.5) * 3;
        seed[i] = Math.random();
      }
      geo.setAttribute("position", new THREE.BufferAttribute(s.pos, 3));
      geo.setAttribute("aStart", new THREE.BufferAttribute(start, 3));
      geo.setAttribute("aColor", new THREE.BufferAttribute(s.col, 3));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.scale.setScalar(0.9);
      group.add(pts);
      clock.start();
      if (reduced) draw(); else loop();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      ro.disconnect();
      io.disconnect();
      geo?.dispose(); mat?.dispose(); ringGeo.dispose(); ringMat.dispose();
      logoTexture?.dispose();
      decorations.forEach(({ geometry, material }) => { geometry.dispose(); material.dispose(); });
      delete el.dataset.ready;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div aria-hidden className={`${className ?? "relative"} overflow-hidden`}>
    <div className="pointer-events-none absolute inset-[18%] rounded-full bg-lime-300/10 blur-3xl" />
    <div ref={host} className="group absolute inset-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- local fallback for unavailable WebGL */}
      <img src="/brand/solcameo-mark.png" alt="" className="pointer-events-none absolute left-1/2 top-1/2 w-[55%] -translate-x-1/2 -translate-y-1/2 object-contain transition-opacity duration-700 group-data-[ready=true]:opacity-0" />
    </div>
  </div>;
}
