/**
 * W3 — "OWN THE DREAM" · Y2K chrome-neon night film (~26s).
 * Design: violet night, starfield, chrome-gradient display type,
 * glow horizon, aspirational pacing with hard beats.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate, random } from "remotion";
import { display, mono, serif } from "../lib/fonts";

const NIGHT = "#0B0716", VIO = "#8B5CF6", VOLT = "#C6F222", CH1 = "#F4F6FF", CH2 = "#8FA0C6";
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Stars: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      {Array.from({ length: 90 }, (_, i) => {
        const x = random(`sx${i}`) * 1920, y = random(`sy${i}`) * 900;
        const tw = 0.35 + Math.abs(Math.sin(frame / 17 + i * 2)) * 0.65;
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: 2.5, height: 2.5, borderRadius: 2, background: "#fff", opacity: tw * 0.8 }} />;
      })}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 100% 42% at 50% 108%, ${VIO}55, transparent 62%), radial-gradient(ellipse 62% 26% at 50% 104%, ${VOLT}30, transparent 65%)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 878, height: 2, background: `linear-gradient(90deg, transparent, ${VOLT}AA, transparent)`, boxShadow: `0 0 30px ${VOLT}` }} />
    </AbsoluteFill>
  );
};

const Chrome: React.FC<{ at: number; out: number; lines: string[]; size?: number; serifLine?: number }> = ({ at, out, lines, size = 150, serifLine = -1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at - 2 || frame > out + 8) return null;
  const o = interpolate(frame, [out, out + 7], [1, 0], CL);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 6, opacity: o, paddingBottom: 120 }}>
      {lines.map((l, i) => {
        const s = spring({ frame: frame - (at + i * 7), fps, config: { damping: 16, stiffness: 130 } });
        const isSerif = i === serifLine;
        return (
          <div key={i} style={{
            fontFamily: isSerif ? serif : display, fontStyle: isSerif ? "italic" : "normal",
            fontWeight: isSerif ? 500 : 700, fontSize: isSerif ? size * 0.92 : size, letterSpacing: isSerif ? 0 : -size * 0.03,
            lineHeight: 1.02, textTransform: isSerif ? "none" : "uppercase",
            background: `linear-gradient(178deg, ${CH1} 12%, ${CH2} 46%, #4E5B7E 50%, ${CH1} 56%, ${CH2} 92%)`,
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            opacity: s, transform: `translateY(${(1 - s) * 60}px) scale(${0.92 + s * 0.08})`,
            filter: `drop-shadow(0 6px 40px ${VIO}55) drop-shadow(0 0 26px rgba(255,255,255,0.18))`,
          }}>{l}</div>
        );
      })}
    </AbsoluteFill>
  );
};

export const W3Chrome: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gs = spring({ frame: frame - 615, fps, config: { damping: 13, stiffness: 160 } });
  return (
    <AbsoluteFill style={{ background: NIGHT }}>
      <Stars />
      <div style={{ position: "absolute", top: 76, width: "100%", textAlign: "center", fontFamily: mono, fontSize: 21, letterSpacing: 12, color: `${CH2}AA`, textTransform: "uppercase" }}>
        a late-night film by vello
      </div>
      <Chrome at={4} out={130} size={140} lines={["You dreamed of", "being a creator."]} />
      <Chrome at={135} out={255} size={120} serifLine={1} lines={["THE FACE. THE FAME.", "the pay-day."]} />
      <Chrome at={260} out={395} size={125} lines={["Now you don't", "have to BE one —"]} />
      <Chrome at={400} out={520} size={160} serifLine={1} lines={["YOU CAN", "own one."]} />
      <Chrome at={525} out={608} size={104} lines={["Never burns out.", "Never logs off.", "Never misses."]} />
      {frame >= 612 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 38, paddingBottom: 60 }}>
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 250, opacity: gs, transform: `scale(${0.8 + 0.2 * gs}) rotate(${(1 - gs) * -12}deg)`, filter: `drop-shadow(0 0 ${55 + Math.sin(frame / 8) * 20}px ${VOLT}88)` }} />
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 110, letterSpacing: -4, color: "#fff", opacity: gs, textShadow: `0 0 70px ${VIO}` }}>
            Own the <span style={{ color: VOLT, textShadow: `0 0 60px ${VOLT}99` }}>dream</span>.
          </div>
          <div style={{ fontFamily: mono, fontSize: 26, letterSpacing: 9, color: CH2, opacity: interpolate(frame, [648, 663], [0, 1], CL) }}>VELLO.GG</div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse 115% 95% at 50% 50%, transparent 66%, rgba(0,0,0,0.5) 100%)" }} />
    </AbsoluteFill>
  );
};
