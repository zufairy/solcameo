"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Three.js explainer for the referral loop. Four glass stations sit on a line: YOU share a link, a FRIEND signs in with it,
 * their VIDEO is paid for in USDC, and SOLCAMEO keeps its margin; your cut flows back to you in a lime arc underneath. Particle
 * density follows `rate` (your share of the margin) so a higher tier visibly sends more back. Labels are HTML (crisp, selectable)
 * placed by the same coordinates the scene uses, so they never drift. With reduced motion it draws one still frame.
 */

export const STATIONS = [
  { key: "you", x: -5.1, label: "You", note: "share your link", icon: "you", color: "#d7ff00" },
  { key: "friend", x: -1.7, label: "Friend", note: "signs in with it", icon: "friend", color: "#ffffff" },
  { key: "video", x: 1.7, label: "Video", note: "paid in USDC", icon: "video", color: "#7cc2ff" },
  { key: "solcameo", x: 5.1, label: "Solcameo", note: "keeps a 15% margin", icon: "coin", color: "#d7ff00" },
] as const;
/** World half-width of the view; the HTML labels use the same number to turn x into a percentage. */
export const VIEW_HALF_W = 6.6;

const VERT = /* glsl */ `
  attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
  uniform float uPx; varying vec3 vColor; varying float vAlpha;
  void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uPx; vColor = aColor; vAlpha = aAlpha; }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.08, r)); }
`;

type Path = (t: number, out: THREE.Vector3) => THREE.Vector3;
const bez = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3): Path => (t, o) => o.set((1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y, 0);

function stationTexture(kind: string, color: string) {
  const c = document.createElement("canvas"); c.width = c.height = 384;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 384, 384); grad.addColorStop(0, "rgba(255,255,255,0.20)"); grad.addColorStop(1, "rgba(255,255,255,0.04)");
  g.fillStyle = grad; g.beginPath(); g.roundRect(24, 24, 336, 336, 64); g.fill();
  g.lineWidth = 5; g.strokeStyle = color; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
  g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 2; g.beginPath(); g.roundRect(30, 30, 324, 324, 58); g.stroke();
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 14; g.lineCap = "round"; g.lineJoin = "round";
  const person = (cx: number, cy: number, s: number) => { g.beginPath(); g.arc(cx, cy - 34 * s, 30 * s, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(cx, cy + 62 * s, 62 * s, Math.PI, 0); g.stroke(); };
  if (kind === "you") person(192, 190, 1);
  if (kind === "friend") { g.globalAlpha = 0.55; person(142, 196, 0.8); g.globalAlpha = 1; person(236, 190, 0.95); }
  if (kind === "video") { g.beginPath(); g.roundRect(92, 120, 200, 144, 26); g.stroke(); g.beginPath(); g.moveTo(172, 158); g.lineTo(224, 192); g.lineTo(172, 226); g.closePath(); g.fill(); }
  if (kind === "coin") { g.beginPath(); g.arc(192, 192, 84, 0, Math.PI * 2); g.stroke(); g.font = "800 112px ui-sans-serif, system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 0; g.fillText("$", 192, 204); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function glowTexture(color: string) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!; const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, color); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.globalAlpha = 0.5; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function ReferralFlowScene({ rate = 0.5, className = "" }: { rate?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ rate });
  useEffect(() => { live.current = { rate }; });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-VIEW_HALF_W, VIEW_HALF_W, 3, -3, 0.1, 10);
    camera.position.z = 5;

    const pos = STATIONS.map((s) => new THREE.Vector3(s.x, 0.35, 0));
    const disposables: { dispose(): void }[] = [];
    const hubs: THREE.Mesh[] = [];
    STATIONS.forEach((s, i) => {
      const tex = stationTexture(s.icon, s.color), glow = glowTexture(s.color);
      disposables.push(tex, glow);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 2.05), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      plate.position.copy(pos[i]); halo.position.set(pos[i].x, pos[i].y, -0.1);
      scene.add(halo, plate); hubs.push(plate); disposables.push(plate.geometry, halo.geometry);
    });

    // Paths: link (you to friend), prompt (friend to video), payment (video to Solcameo), share (Solcameo back to you, underneath).
    const top = (a: number, b: number, lift: number) => bez(new THREE.Vector3(pos[a].x + 1.15, pos[a].y + 0.25, 0), new THREE.Vector3((pos[a].x + pos[b].x) / 2, pos[a].y + lift, 0), new THREE.Vector3(pos[b].x - 1.15, pos[b].y + 0.25, 0));
    const paths: Path[] = [
      top(0, 1, 1.5),
      (t, o) => o.set(pos[1].x + 1.15 + (pos[2].x - pos[1].x - 2.3) * t, pos[1].y, 0),
      (t, o) => o.set(pos[2].x + 1.15 + (pos[3].x - pos[2].x - 2.3) * t, pos[2].y, 0),
      bez(new THREE.Vector3(pos[3].x, pos[3].y - 1.15, 0), new THREE.Vector3(0, -3.9, 0), new THREE.Vector3(pos[0].x, pos[0].y - 1.15, 0)),
    ];
    const colors = [new THREE.Color("#d7ff00"), new THREE.Color("#ffffff"), new THREE.Color("#7cc2ff"), new THREE.Color("#d7ff00")];
    const GROUPS = [28, 26, 56, 64];
    const total = GROUPS.reduce((a, b) => a + b, 0);
    const shareStart = GROUPS.slice(0, 3).reduce((a, b) => a + b, 0);
    const group = new Uint8Array(total), phase = new Float32Array(total), speed = new Float32Array(total);
    let k = 0;
    GROUPS.forEach((n, gi) => { for (let i = 0; i < n; i++, k++) { group[k] = gi; phase[k] = i / n + Math.random() * 0.02; speed[k] = 0.085 + Math.random() * 0.03; } });
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(total * 3), aColor = new Float32Array(total * 3), aSize = new Float32Array(total), aAlpha = new Float32Array(total);
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3)); geo.setAttribute("aColor", new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1)); geo.setAttribute("aAlpha", new THREE.BufferAttribute(aAlpha, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms: { uPx: { value: 1 } } });
    const points = new THREE.Points(geo, mat); points.frustumCulled = false; scene.add(points);
    disposables.push(geo, mat);

    // Faint rails under the particles so the route reads even between pulses.
    const railMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 });
    paths.forEach((p) => { const pts: THREE.Vector3[] = []; for (let i = 0; i <= 48; i++) pts.push(p(i / 48, new THREE.Vector3())); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), railMat); scene.add(l); disposables.push(l.geometry); });
    disposables.push(railMat);

    const v = new THREE.Vector3();
    const fill = (time: number) => {
      const share = Math.max(0.3, Math.min(0.9, live.current.rate)) / 0.5; // density of the share arc follows the tier
      for (let i = 0; i < total; i++) {
        const gi = group[i];
        const t = (time * speed[i] + phase[i]) % 1;
        paths[gi](t, v);
        const hidden = gi === 3 && i - shareStart > GROUPS[3] * Math.min(1, share * 0.8);
        position[i * 3] = v.x; position[i * 3 + 1] = v.y + Math.sin((time + i) * 3) * 0.04; position[i * 3 + 2] = 0.2;
        const c = colors[gi]; aColor[i * 3] = c.r; aColor[i * 3 + 1] = c.g; aColor[i * 3 + 2] = c.b;
        aSize[i] = (gi === 2 ? 15 : gi === 3 ? 13 : 10) * (0.7 + 0.5 * Math.sin(t * Math.PI));
        aAlpha[i] = hidden ? 0 : Math.sin(t * Math.PI) * 0.95;
      }
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true; (geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true; (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
      hubs.forEach((h, i) => { const pulse = 1 + 0.03 * Math.sin(time * 2 + i * 1.3); h.scale.setScalar(pulse); });
    };

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      const halfH = VIEW_HALF_W * (h / w);
      camera.top = halfH; camera.bottom = -halfH; camera.updateProjectionMatrix();
      mat.uniforms.uPx.value = renderer.getPixelRatio() * Math.max(0.6, w / 900);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    let raf = 0, visible = true;
    const io = new IntersectionObserver((e) => { visible = !!e[0]?.isIntersecting; }, { threshold: 0.05 }); io.observe(el);
    const start = performance.now();
    const frame = (now: number) => { raf = requestAnimationFrame(frame); if (!visible || document.hidden) return; fill((now - start) / 1000); renderer.render(scene, camera); };
    if (reduced) { fill(3.2); renderer.render(scene, camera); } else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      disposables.forEach((d) => d.dispose()); renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className={`absolute inset-0 ${className}`} aria-hidden />;
}
