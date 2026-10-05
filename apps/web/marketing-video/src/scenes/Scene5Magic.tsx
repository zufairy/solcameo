/**
 * Scene 5 — THE MAGIC (18–24s)
 * "Even with your laptop off." The laptop lid closes; the agent keeps glowing
 * in a cloud above it, firing out content cards while view counters tick up.
 * Night / sleep mood.
 */
import React from "react";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { noise2D } from "@remotion/noise";
import { Eye } from "lucide-react";
import { Background } from "../components/Background";
import { Particles } from "../components/Particles";
import { CountUp } from "../components/CountUp";
import { CLAMP, COLORS, SPRING, glow } from "../theme";
import { display, mono } from "../lib/fonts";
import { useLayout } from "../lib/layout";

/* laptop showing the live Vello site, then folding shut */
const Laptop: React.FC<{ u: number }> = ({ u }) => {
  const frame = useCurrentFrame();
  // open (screen up, site visible) then fold closed between f46–104
  const lid = interpolate(frame, [46, 104], [-6, -90], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  // site stays lit while open, dims to black as the lid passes ~45°
  const siteOn = interpolate(frame, [60, 96], [1, 0], CLAMP);
  return (
    <div style={{ perspective: 1500 * u, width: 460 * u }}>
      {/* lid */}
      <div
        style={{
          width: 420 * u,
          height: 260 * u,
          margin: "0 auto",
          transformOrigin: "bottom center",
          transform: `rotateX(${lid}deg)`,
          transformStyle: "preserve-3d",
          borderRadius: `${14 * u}px ${14 * u}px 0 0`,
          background: "linear-gradient(180deg, #1a1a26, #0e0e18)",
          border: `2px solid ${COLORS.borderHi}`,
          borderBottom: "none",
          position: "relative",
          overflow: "hidden",
          boxShadow: `0 0 ${50 * u}px ${COLORS.violet}${siteOn > 0.3 ? "44" : "00"}`,
        }}
      >
        {/* the live website on the screen */}
        <div style={{ position: "absolute", inset: 11 * u, borderRadius: 7 * u, overflow: "hidden", backfaceVisibility: "hidden" }}>
          <Img
            src={staticFile("website.png")}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
          />
          {/* screen sheen + dim-on-close */}
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, rgba(255,255,255,0.10), transparent 45%)` }} />
          <div style={{ position: "absolute", inset: 0, background: "#04040a", opacity: 1 - siteOn }} />
        </div>
      </div>
      {/* base */}
      <div
        style={{
          width: 460 * u,
          height: 26 * u,
          margin: "0 auto",
          borderRadius: `${6 * u}px ${6 * u}px ${12 * u}px ${12 * u}px`,
          background: "linear-gradient(180deg, #20202e, #14141c)",
          border: `2px solid ${COLORS.borderHi}`,
          boxShadow: `0 ${20 * u}px ${50 * u}px rgba(0,0,0,0.6)`,
        }}
      />
    </div>
  );
};

/* the agent, glowing in a cloud, never sleeping */
const CloudAgent: React.FC<{ u: number }> = ({ u }) => {
  const frame = useCurrentFrame();
  const float = noise2D("cloud", frame / 60, 0) * 10 * u;
  const pulse = 0.85 + 0.15 * Math.sin(frame / 14);
  const appear = spring({ frame: frame - 40, fps: 60, config: SPRING, from: 0, to: 1 });
  const d = 150 * u;
  return (
    <div style={{ transform: `translateY(${float}px) scale(${appear})`, opacity: appear, position: "relative" }}>
      {/* cloud glow */}
      <div style={{ position: "absolute", inset: -60 * u, borderRadius: "50%", background: `radial-gradient(circle, ${COLORS.violet}55, transparent 70%)`, opacity: pulse }} />
      <div
        style={{
          width: d,
          height: d,
          borderRadius: "50%",
          overflow: "hidden",
          border: `2px solid ${COLORS.violet}`,
          boxShadow: glow(COLORS.violet, 60 * u, "88"),
          position: "relative",
        }}
      >
        <Img src={staticFile("gen/agent-influencer.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 22%" }} />
      </div>
    </div>
  );
};

/* content cards fired out of the cloud, view counters ticking */
const FiringCard: React.FC<{ launch: number; angle: number; tint: string; views: number; u: number; originX: number; originY: number }> = ({ launch, angle, tint, views, u, originX, originY }) => {
  const frame = useCurrentFrame();
  const t = frame - launch;
  if (t < 0) return null;
  const dist = interpolate(t, [0, 70], [0, 540 * u], { ...CLAMP, easing: (e) => 1 - Math.pow(1 - e, 3) });
  const x = originX + Math.cos(angle) * dist;
  const y = originY + Math.sin(angle) * dist;
  const o = interpolate(t, [0, 8, 55, 75], [0, 1, 1, 0], CLAMP);
  const s = interpolate(t, [0, 12], [0.5, 1], CLAMP);
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${s})`, opacity: o }}>
      <div style={{ width: 150 * u, borderRadius: 14 * u, background: "linear-gradient(180deg, rgba(28,27,39,0.96), rgba(14,14,24,0.96))", border: `1px solid ${tint}66`, padding: 12 * u, boxShadow: `0 16px 36px rgba(0,0,0,0.5), ${glow(tint, 26 * u, "55")}` }}>
        <div style={{ height: 78 * u, borderRadius: 9 * u, background: `linear-gradient(160deg, ${tint}40, ${COLORS.bg2})`, border: `1px solid ${tint}44`, marginBottom: 10 * u, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 0, height: 0, borderTop: `${9 * u}px solid transparent`, borderBottom: `${9 * u}px solid transparent`, borderLeft: `${14 * u}px solid ${tint}`, marginLeft: 3 * u }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 * u, fontFamily: mono, fontSize: 14 * u, color: COLORS.sub }}>
          <Eye size={14 * u} color={tint} />
          <CountUp value={views} start={launch + 8} duration={50} suffix=" views" style={{ color: COLORS.white }} />
        </div>
      </div>
    </div>
  );
};

export const Scene5Magic: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const { u, portrait } = useLayout();
  const op = interpolate(frame, [0, 10, 348, 360], [0, 1, 1, 0], CLAMP);

  // cloud origin (where cards launch from) — above the laptop
  const ox = width / 2;
  const oy = portrait ? height * 0.42 : height * 0.4;

  const fires = [
    { launch: 90, angle: -2.5, tint: COLORS.violet, views: 128000 },
    { launch: 120, angle: -0.6, tint: COLORS.cyan, views: 84200 },
    { launch: 150, angle: -2.0, tint: COLORS.lime, views: 256000 },
    { launch: 184, angle: -1.1, tint: COLORS.pink, views: 41700 },
    { launch: 214, angle: -2.7, tint: COLORS.emerald, views: 312000 },
    { launch: 246, angle: -0.3, tint: COLORS.amber, views: 73400 },
  ];

  const titleO = interpolate(frame, [200, 224], [0, 1], CLAMP);
  const titleY = interpolate(frame, [200, 230], [26 * u, 0], { ...CLAMP, easing: (t) => 1 - Math.pow(1 - t, 3) });

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: "#070710" }}>
      {/* night world: darker, cooler */}
      <Background intensity={0.6} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(4,4,12,0.55), rgba(4,4,12,0.2))" }} />
      {/* stars */}
      <Particles count={50} color="#cdd3ff" opacity={0.5} />
      {/* moon */}
      <div style={{ position: "absolute", top: 90 * u, right: 130 * u, width: 70 * u, height: 70 * u, borderRadius: "50%", background: "radial-gradient(circle at 38% 38%, #f3f0ff, #a9a4cf)", boxShadow: `0 0 ${70 * u}px #b9b4ff66` }} />

      {/* firing content cards */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {fires.map((f, i) => (
          <FiringCard key={i} {...f} u={u} originX={ox} originY={oy} />
        ))}
      </AbsoluteFill>

      {/* cloud agent above laptop */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: portrait ? height * 0.3 : height * 0.27 }}>
        <CloudAgent u={u} />
      </AbsoluteFill>

      {/* laptop near the bottom */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: portrait ? 360 * u : 120 * u }}>
        <Laptop u={u} />
      </AbsoluteFill>

      {/* headline */}
      <AbsoluteFill style={{ justifyContent: portrait ? "flex-start" : "center", alignItems: "center", paddingTop: portrait ? 150 * u : 0, paddingLeft: portrait ? 0 : 0 }}>
        <div style={{ position: "absolute", top: portrait ? 120 * u : height * 0.12, textAlign: "center", opacity: titleO, transform: `translateY(${titleY}px)`, width: "100%" }}>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: (portrait ? 70 : 88) * u, color: COLORS.white, letterSpacing: -2 * u, textShadow: glow(COLORS.violet, 50 * u, "44") }}>
            Even with your{" "}
            <span style={{ background: `linear-gradient(100deg, ${COLORS.violetSoft}, ${COLORS.cyan})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              laptop off.
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
