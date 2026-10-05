/**
 * Scene 7 — THE VISION (29–33s)
 * Big, bold: "This is the agents economy." Proof badges animate in:
 * Backed by Cradle · Built on Solana. Behind it, the agent-card motif
 * multiplies into a receding field — the economy.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { Background } from "../components/Background";
import { Particles } from "../components/Particles";
import { GlowPulse } from "../components/GlowPulse";
import { KineticText } from "../components/KineticText";
import { CLAMP, COLORS, SPRING_POP, glow } from "../theme";
import { display, mono } from "../lib/fonts";
import { useLayout } from "../lib/layout";

/* faint field of multiplying agent cards receding into the dark */
const CardField: React.FC<{ u: number }> = ({ u }) => {
  const frame = useCurrentFrame();
  const cells = [] as { x: number; y: number; d: number; tint: string; seed: number }[];
  const tints = [COLORS.violet, COLORS.emerald, COLORS.lime, COLORS.pink, COLORS.cyan];
  let k = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 7; c++) {
      cells.push({ x: 8 + c * 13.5, y: 16 + r * 20, d: r, tint: tints[(r + c) % tints.length], seed: k++ });
    }
  }
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {cells.map((cell) => {
        const appear = spring({ frame: frame - (90 + cell.seed * 1.4), fps: 60, config: SPRING_POP, from: 0, to: 1 });
        const depthOp = interpolate(cell.d, [0, 3], [0.22, 0.05]);
        const w = (70 - cell.d * 8) * u;
        return (
          <div
            key={cell.seed}
            style={{
              position: "absolute",
              left: `${cell.x}%`,
              top: `${cell.y}%`,
              width: w,
              height: w * 1.3,
              borderRadius: 10 * u,
              background: `linear-gradient(180deg, ${cell.tint}22, rgba(14,14,24,0.5))`,
              border: `1px solid ${cell.tint}44`,
              opacity: appear * depthOp,
              transform: `scale(${appear})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* tiny mark glyphs for proof badges */
const CradleMark: React.FC<{ s: number }> = ({ s }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <path d="M12 2l9 5v10l-9 5-9-5V7z" stroke={COLORS.violetSoft} strokeWidth="1.6" />
    <circle cx="12" cy="12" r="3.2" fill={COLORS.violetSoft} />
  </svg>
);
const SolanaMark: React.FC<{ s: number }> = ({ s }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    {[0, 6.5, 13].map((dy, i) => (
      <path key={i} d={`M5 ${5 + dy} h11 l-2.5 2.5 h-11 z`} fill={COLORS.emeraldSoft} transform={i === 1 ? "scale(-1,1) translate(-24,0)" : undefined} />
    ))}
  </svg>
);

const Badge: React.FC<{ start: number; mark: React.ReactNode; label: string; accent: string; u: number }> = ({ start, mark, label, accent, u }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - start, fps, config: SPRING_POP, from: 0, to: 1 });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14 * u,
        padding: `${16 * u}px ${28 * u}px`,
        borderRadius: 16 * u,
        background: "linear-gradient(180deg, rgba(28,27,39,0.92), rgba(14,14,24,0.92))",
        border: `1px solid ${accent}55`,
        boxShadow: `0 16px 40px rgba(0,0,0,0.5), ${glow(accent, 36 * u, "33")}`,
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [30 * u, 0])}px) scale(${interpolate(s, [0, 1], [0.85, 1])})`,
      }}
    >
      {mark}
      <span style={{ fontFamily: mono, fontSize: 22 * u, color: COLORS.white, letterSpacing: 0.5 }}>{label}</span>
    </div>
  );
};

export const Scene7Vision: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const op = interpolate(frame, [0, 10, 228, 240], [0, 1, 1, 0], CLAMP);
  const titleSize = (portrait ? 92 : 124) * u;

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: COLORS.bg }}>
      <Background intensity={0.9} />
      <CardField u={u} />
      <Particles count={34} color={COLORS.violetSoft} opacity={0.4} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 48 * u, padding: portrait ? "0 60px" : "0 160px" }}>
        <KineticText
          start={6}
          stagger={6}
          size={titleSize}
          align="center"
          maxWidth={portrait ? 900 : 1500}
          words={[
            { t: "This" },
            { t: "is" },
            { t: "the" },
            { t: "agents", grad: true },
            { t: "economy.", grad: true },
          ]}
          gradFrom={COLORS.violetSoft}
          gradTo={COLORS.emeraldSoft}
        />
        <div style={{ display: "flex", gap: 24 * u, flexWrap: "wrap", justifyContent: "center" }}>
          <Badge start={60} mark={<CradleMark s={28 * u} />} label="Backed by Cradle" accent={COLORS.violet} u={u} />
          <Badge start={74} mark={<SolanaMark s={28 * u} />} label="Built on Solana" accent={COLORS.emerald} u={u} />
        </div>
      </AbsoluteFill>

      <GlowPulse at={40} color={COLORS.violet} intensity={0.55} size={1500 * u} />
    </AbsoluteFill>
  );
};
