/**
 * Scene 8 — END CARD / CTA (33–35s)
 * The Vello logo assembles from the recurring agent-card motif.
 * "Launch yours in minutes." CTA chip: "Get founding access."
 * vello.ag · Built on Solana. Final glow.
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
import { ArrowRight } from "lucide-react";
import { Background } from "../components/Background";
import { Particles } from "../components/Particles";
import { GlowPulse, LightSweep } from "../components/GlowPulse";
import { CLAMP, COLORS, SPRING, SPRING_POP, glow } from "../theme";
import { display, serif, mono } from "../lib/fonts";
import { useLayout } from "../lib/layout";

/* small agent-card shards that fly in and condense into the logo */
const Shards: React.FC<{ u: number; until: number }> = ({ u, until }) => {
  const frame = useCurrentFrame();
  const seed = (i: number, s = 0) => {
    const x = Math.sin((i + 1) * 23.1 + s * 41.7) * 9999;
    return x - Math.floor(x);
  };
  const tints = [COLORS.violet, COLORS.emerald, COLORS.lime, COLORS.pink, COLORS.cyan];
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
      <div style={{ position: "relative" }}>
        {Array.from({ length: 22 }).map((_, i) => {
          const ang = seed(i, 1) * Math.PI * 2;
          const rad = 300 + seed(i, 2) * 360;
          const p = interpolate(frame, [0, until], [1, 0], { ...CLAMP, easing: (t) => 1 - Math.pow(1 - t, 3) });
          const x = Math.cos(ang) * rad * p * u;
          const y = Math.sin(ang) * rad * p * u;
          const o = interpolate(frame, [0, until * 0.4, until], [0, 0.8, 0], CLAMP);
          const w = (16 + seed(i, 3) * 14) * u;
          return (
            <div key={i} style={{ position: "absolute", left: x, top: y, width: w, height: w * 1.3, borderRadius: 4 * u, background: `${tints[i % tints.length]}55`, border: `1px solid ${tints[i % tints.length]}`, opacity: o, transform: `rotate(${seed(i, 4) * 40 - 20}deg)` }} />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Scene8End: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();
  const op = interpolate(frame, [0, 8, 168, 180], [0, 1, 1, 0], CLAMP);

  const logo = spring({ frame: frame - 18, fps, config: SPRING, from: 0, to: 1 });
  const ring = interpolate(frame, [18, 56], [0, 1], CLAMP);
  const tagO = interpolate(frame, [52, 70], [0, 1], CLAMP);
  const tagY = interpolate(frame, [52, 76], [24 * u, 0], { ...CLAMP, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const cta = spring({ frame: frame - 74, fps, config: SPRING_POP, from: 0, to: 1 });
  const footO = interpolate(frame, [92, 108], [0, 1], CLAMP);

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: COLORS.bg }}>
      <Background intensity={1} />
      <Particles count={40} color={COLORS.violetSoft} opacity={0.5} />
      <Shards u={u} until={48} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 26 * u, padding: "0 60px" }}>
        {/* Vello wordmark logo, assembling from the card shards */}
        <div style={{ position: "relative", transform: `scale(${logo})`, opacity: logo }}>
          <div style={{ position: "absolute", inset: `${-50 * u}px ${-30 * u}px`, borderRadius: "50%", background: `radial-gradient(circle, ${COLORS.violet}55, transparent 70%)`, opacity: ring }} />
          <Img
            src={staticFile("vello-wordmark-new.png")}
            style={{ width: 460 * u, height: "auto", position: "relative", filter: `drop-shadow(0 0 ${40 * u}px ${COLORS.violet}55)` }}
          />
        </div>

        {/* tagline */}
        <div style={{ textAlign: "center", opacity: tagO, transform: `translateY(${tagY}px)` }}>
          <span style={{ fontFamily: display, fontWeight: 700, fontSize: (portrait ? 56 : 64) * u, color: COLORS.white, letterSpacing: -1.5 * u }}>
            Launch yours{" "}
          </span>
          <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: (portrait ? 60 : 70) * u, color: COLORS.emeraldSoft }}>
            in minutes.
          </span>
        </div>

        {/* CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 * u, opacity: cta, transform: `scale(${interpolate(cta, [0, 1], [0.9, 1])})`, marginTop: 10 * u }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 * u, fontFamily: display, fontWeight: 700, fontSize: 30 * u, color: "#04241a", background: `linear-gradient(100deg, ${COLORS.lime}, ${COLORS.emeraldSoft})`, padding: `${18 * u}px ${38 * u}px`, borderRadius: 16 * u, boxShadow: glow(COLORS.lime, 44 * u, "77") }}>
            Get founding access <ArrowRight size={26 * u} strokeWidth={2.6} />
          </div>
        </div>

        {/* footer: domain + solana */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 * u, opacity: footO, marginTop: 14 * u }}>
          <span style={{ fontFamily: mono, fontSize: 24 * u, color: COLORS.white, letterSpacing: 1 }}>vello.ag</span>
          <span style={{ width: 5 * u, height: 5 * u, borderRadius: "50%", background: COLORS.faint }} />
          <span style={{ fontFamily: mono, fontSize: 20 * u, color: COLORS.sub }}>Built on Solana</span>
        </div>
      </AbsoluteFill>

      <GlowPulse at={18} color={COLORS.violet} intensity={0.6} size={1500 * u} />
      <GlowPulse at={150} color={COLORS.lime} intensity={0.4} size={1700 * u} duration={30} />
      <LightSweep start={40} dur={44} />
    </AbsoluteFill>
  );
};
