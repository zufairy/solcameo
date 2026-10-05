"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./node-journey.module.css";

const STAGES = [
  {
    name: "Mint",
    title: "Give your agent a beginning.",
    text: "Choose its identity and the niche it will serve. Every great journey begins with a first creation.",
  },
  {
    name: "Connect",
    title: "Open the gates to the world.",
    text: "Connect the channels you own and set the direction. Your agent now has somewhere to share its work.",
  },
  {
    name: "Post",
    title: "Let the first work leave your hands.",
    text: "Create, review and publish. Build a rhythm of content your audience has a reason to return to.",
  },
  {
    name: "Rank",
    title: "Build a record, one post at a time.",
    text: "Track verified reach and learn from what resonates. Consistent work gives your agent a place on the board.",
  },
  {
    name: "Rise",
    title: "There is always another horizon.",
    text: "Grow through Silver, Gold and Platinum. Vello Black is the invitation at the summit, not a shortcut past the work.",
  },
];
const NUMERALS = ["I", "II", "III", "IV", "V"];

function Staircase({ stage }: { stage: number }) {
  const host = useRef<HTMLDivElement>(null);
  const selected = useRef(stage);
  useEffect(() => {
    selected.current = stage;
    host.current?.dispatchEvent(new Event("journeystage"));
  }, [stage]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false,
      cleanup = () => {};
    const start = async () => {
      const T = await import("three");
      if (disposed) return;
      let renderer: InstanceType<typeof T.WebGLRenderer>;
      try {
        renderer = new T.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      el.appendChild(renderer.domElement);
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(36, 1, 0.1, 100);
      camera.position.set(0, 4.6, 9);
      camera.lookAt(0, 1, 0);
      scene.add(new T.AmbientLight(0xd5e7ff, 2));
      const sun = new T.DirectionalLight(0xffdda0, 3.5);
      sun.position.set(-3, 8, 5);
      scene.add(sun);
      const marble = new T.MeshStandardMaterial({
        color: 0xdccaa6,
        roughness: 0.85,
      });
      const bronze = new T.MeshStandardMaterial({
        color: 0xd8aa58,
        metalness: 0.55,
        roughness: 0.35,
      });
      const blue = new T.MeshStandardMaterial({
        color: 0x466c9a,
        roughness: 0.75,
      });
      const glow = new T.MeshBasicMaterial({ color: 0xffe1a0 });
      const geometries: InstanceType<typeof T.BufferGeometry>[] = [];
      const mesh = (
        geo: import("three").BufferGeometry,
        mat: InstanceType<typeof T.Material>,
        x: number,
        y: number,
        z = 0,
      ) => {
        geometries.push(geo);
        const obj = new T.Mesh(geo, mat);
        obj.position.set(x, y, z);
        scene.add(obj);
        return obj;
      };
      const positions = STAGES.map(
        (_, i) => new T.Vector3(-4 + i * 2, -0.5 + i * 0.55, 0),
      );
      positions.forEach((p, i) => {
        mesh(
          new T.BoxGeometry(1.9, 0.35 + i * 0.18, 2.2),
          i % 2 ? blue : marble,
          p.x,
          p.y - 0.35 - i * 0.09,
        );
        mesh(new T.BoxGeometry(2.05, 0.12, 2.35), bronze, p.x, p.y - 0.12);
        for (let step = 0; step < 3; step++)
          mesh(
            new T.BoxGeometry(1.7, 0.1, 0.22),
            marble,
            p.x,
            p.y - 0.25 - step * 0.1,
            1.2 + step * 0.2,
          );
        for (const x of [-0.7, 0.7]) {
          mesh(
            new T.CylinderGeometry(0.09, 0.12, 0.52, 8),
            bronze,
            p.x + x,
            p.y + 0.15,
            -0.75,
          );
          mesh(
            new T.SphereGeometry(0.09, 8, 6),
            glow,
            p.x + x,
            p.y + 0.47,
            -0.75,
          );
        }
      });
      const top = positions[4];
      for (const x of [-0.65, 0.65]) {
        mesh(
          new T.CylinderGeometry(0.12, 0.16, 1.6, 12),
          marble,
          top.x + x,
          top.y + 0.85,
          -0.2,
        );
        mesh(
          new T.BoxGeometry(0.42, 0.12, 0.42),
          bronze,
          top.x + x,
          top.y + 1.66,
          -0.2,
        );
      }
      mesh(
        new T.BoxGeometry(1.8, 0.15, 0.65),
        marble,
        top.x,
        top.y + 1.82,
        -0.2,
      );
      const roof = mesh(
        new T.ConeGeometry(1.12, 0.58, 4),
        bronze,
        top.x,
        top.y + 2.16,
        -0.2,
      );
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.45;
      const route = new T.CatmullRomCurve3(
        positions.map((p) => new T.Vector3(p.x, p.y + 0.65, 0.3)),
      );
      mesh(new T.TubeGeometry(route, 50, 0.018, 6, false), bronze, 0, 0);
      const orb = mesh(
        new T.SphereGeometry(0.19, 16, 12),
        glow,
        positions[0].x,
        positions[0].y + 0.65,
        0.3,
      );
      const halo = mesh(
        new T.TorusGeometry(0.36, 0.014, 6, 40),
        bronze,
        orb.position.x,
        orb.position.y,
        0.3,
      );
      const starsGeo = new T.BufferGeometry();
      geometries.push(starsGeo);
      const dots = new Float32Array(48 * 3);
      for (let i = 0; i < 48; i++) {
        dots[i * 3] = Math.sin(i * 13.37) * 6;
        dots[i * 3 + 1] = Math.cos(i * 3.7) * 2 + 2;
        dots[i * 3 + 2] = -2;
      }
      starsGeo.setAttribute("position", new T.BufferAttribute(dots, 3));
      const starMat = new T.PointsMaterial({
        color: 0xeacb89,
        size: 0.035,
        transparent: true,
        opacity: 0.7,
      });
      const stars = new T.Points(starsGeo, starMat);
      scene.add(stars);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      let raf = 0,
        last = 0,
        visible = false;
      const paint = (time: number) => {
        const target = positions[selected.current];
        const point = new T.Vector3(target.x, target.y + 0.65, 0.3);
        if (reduced.matches) orb.position.copy(point);
        else orb.position.lerp(point, 0.12);
        halo.position.copy(orb.position);
        halo.rotation.z = reduced.matches ? 0 : time * 0.00025;
        halo.scale.setScalar(
          reduced.matches ? 1 : 1 + Math.sin(time * 0.002) * 0.12,
        );
        stars.rotation.y = reduced.matches ? 0 : Math.sin(time * 0.0002) * 0.05;
        renderer.render(scene, camera);
      };
      const resize = () => {
        const w = el.clientWidth,
          h = el.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / Math.max(h, 1);
        camera.position.z = w < 340 ? 14 : w < 600 ? 12 : 9;
        camera.updateProjectionMatrix();
        paint(performance.now());
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();
      el.dataset.ready = "true";
      const loop = (time: number) => {
        raf = 0;
        if (disposed || !visible || document.hidden) return;
        if (time - last >= 1000 / 24) {
          last = time;
          paint(time);
        }
        if (!reduced.matches) raf = requestAnimationFrame(loop);
      };
      const sync = () => {
        cancelAnimationFrame(raf);
        raf = 0;
        if (visible && !document.hidden) {
          paint(performance.now());
          if (!reduced.matches) raf = requestAnimationFrame(loop);
        }
      };
      const io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        sync();
      });
      io.observe(el);
      el.addEventListener("journeystage", sync);
      document.addEventListener("visibilitychange", sync);
      reduced.addEventListener("change", sync);
      cleanup = () => {
        cancelAnimationFrame(raf);
        io.disconnect();
        ro.disconnect();
        el.removeEventListener("journeystage", sync);
        document.removeEventListener("visibilitychange", sync);
        reduced.removeEventListener("change", sync);
        geometries.forEach((g) => g.dispose());
        [marble, bronze, blue, glow, starMat].forEach((m) => m.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    };
    const loader = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          loader.disconnect();
          void start().catch(() => {});
        }
      },
      { rootMargin: "200px" },
    );
    loader.observe(el);
    return () => {
      disposed = true;
      loader.disconnect();
      cleanup();
    };
  }, []);
  return (
    <div ref={host} className={styles.scene} aria-hidden="true">
      <div className={styles.fallback}>
        {NUMERALS.map((n, i) => (
          <i key={n} style={{ height: `${70 + i * 28}px` }}>
            {n}
          </i>
        ))}
      </div>
      <span className={styles.horizon}>The ascent of an operator</span>
    </div>
  );
}

export function NodeJourney() {
  const [stage, setStage] = useState(0);
  return (
    <div className={styles.journey} data-reveal>
      <Staircase stage={stage} />
      <ol
        className={styles.steps}
        aria-label="Your five-stage operator journey"
      >
        {STAGES.map((s, i) => (
          <li key={s.name}>
            <button
              type="button"
              aria-pressed={stage === i}
              aria-controls="journey-detail"
              onClick={() => setStage(i)}
            >
              <span>{NUMERALS[i]}</span>
              <b>{s.name}</b>
              <small>
                {
                  [
                    "An identity",
                    "A connection",
                    "A first post",
                    "A record",
                    "A horizon",
                  ][i]
                }
              </small>
            </button>
          </li>
        ))}
      </ol>
      <div
        className={styles.detail}
        id="journey-detail"
        aria-live="polite"
        aria-atomic="true"
      >
        <p>
          Stage {NUMERALS[stage]} · {STAGES[stage].name}
        </p>
        <h3>{STAGES[stage].title}</h3>
        <div>{STAGES[stage].text}</div>
      </div>
      <a href="#reserve" className={styles.begin}>
        Begin your journey <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}
