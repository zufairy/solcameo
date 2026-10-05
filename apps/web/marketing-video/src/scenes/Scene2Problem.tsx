/**
 * Scene 2 — THE PROBLEM (3–7s)
 * An illustrated, slightly desaturated world: a tired creator hunched at a
 * desk, a clock spinning unnaturally fast, and an endless treadmill of content
 * cards streaming past. Text flashes:
 * "Making content is a full-time job." / "You already have one."
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";
import { Background } from "../components/Background";
import { CLAMP, COLORS, SPRING_POP } from "../theme";
import { display, mono } from "../lib/fonts";
import { useLayout } from "../lib/layout";

/* fast-spinning clock — the "no hours left" beat */
const Clock: React.FC<{ size: number }> = ({ size }) => {
  const frame = useCurrentFrame();
  const min = (frame * 14) % 360;
  const hr = (frame * 3) % 360;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="44" fill="rgba(14,14,24,0.7)" stroke={COLORS.amber} strokeWidth="3" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={COLORS.amber} strokeWidth="3" opacity="0.4" style={{ filter: `blur(${size * 0.02}px)` }} />
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x="49" y="8" width="2" height="7" rx="1" fill={COLORS.faint} transform={`rotate(${i * 30} 50 50)`} />
      ))}
      <rect x="48.5" y="26" width="3" height="26" rx="1.5" fill={COLORS.white} transform={`rotate(${hr} 50 50)`} />
      <rect x="49" y="16" width="2" height="36" rx="1" fill={COLORS.amber} transform={`rotate(${min} 50 50)`} />
      <circle cx="50" cy="50" r="3" fill={COLORS.amber} />
    </svg>
  );
};

/* hunched creator at a glowing desk */
const Creator: React.FC<{ w: number }> = ({ w }) => {
  const frame = useCurrentFrame();
  const slump = 2 + Math.sin(frame / 30) * 1.2; // weary sway
  return (
    <svg width={w} height={w * 0.8} viewBox="0 0 200 160">
      {/* desk */}
      <rect x="20" y="120" width="160" height="8" rx="3" fill={COLORS.border} />
      {/* monitor glow */}
      <rect x="112" y="58" width="70" height="48" rx="6" fill="rgba(139,92,246,0.18)" stroke={COLORS.violet} strokeWidth="2" />
      <circle cx="147" cy="82" r="9" fill="none" stroke={COLORS.violetSoft} strokeWidth="2" />
      <path d="M144 78l7 4-7 4z" fill={COLORS.violetSoft} />
      <rect x="143" y="106" width="8" height="14" fill={COLORS.border} />
      <rect x="128" y="120" width="38" height="4" rx="2" fill={COLORS.borderHi} />
      {/* figure (hunched, head down) */}
      <g transform={`translate(${slump} 0)`}>
        <ellipse cx="62" cy="120" rx="34" ry="6" fill="rgba(0,0,0,0.4)" />
        {/* torso */}
        <path d="M48 120 C44 92 50 82 64 80 C80 82 86 96 84 120 Z" fill={COLORS.cardHi} stroke={COLORS.borderHi} strokeWidth="2" />
        {/* arm to desk */}
        <path d="M82 96 C98 100 108 108 116 114" stroke={COLORS.cardHi} strokeWidth="9" fill="none" strokeLinecap="round" />
        {/* head, drooped */}
        <circle cx="60" cy="70" r="15" fill={COLORS.sub} />
        <path d="M48 66 C50 56 70 56 72 66 C72 60 66 55 60 55 C54 55 48 60 48 66Z" fill={COLORS.faint} />
        {/* zzz */}
        <text x="84" y="58" fontFamily="monospace" fontSize="11" fill={COLORS.faint} opacity={0.5 + 0.5 * Math.sin(frame / 18)}>z</text>
      </g>
    </svg>
  );
};

/* endless treadmill of content cards scrolling past */
const Treadmill: React.FC<{ width: number; y: number }> = ({ width, y }) => {
  const frame = useCurrentFrame();
  const cardW = 110;
  const gap = 26;
  const span = cardW + gap;
  const n = Math.ceil(width / span) + 3;
  const tints = [COLORS.violet, COLORS.pink, COLORS.cyan, COLORS.lime, COLORS.amber];
  const scroll = (frame * 7) % span;
  return (
    <div style={{ position: "absolute", top: y, left: 0, width, height: 120 }}>
      {Array.from({ length: n }).map((_, i) => {
        const x = i * span - scroll - span;
        const tint = tints[i % tints.length];
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: 6,
              width: cardW,
              height: 76,
              borderRadius: 12,
              background: "linear-gradient(180deg, rgba(28,27,39,0.9), rgba(14,14,24,0.9))",
              border: `1px solid ${COLORS.border}`,
              boxShadow: `0 8px 20px rgba(0,0,0,0.4)`,
              display: "flex",
              flexDirection: "column",
              padding: 9,
              gap: 6,
              opacity: 0.85,
            }}
          >
            <div style={{ width: 26, height: 26, borderRadius: 7, background: `${tint}33`, border: `1px solid ${tint}66` }} />
            <div style={{ width: "80%", height: 6, borderRadius: 3, background: COLORS.border }} />
            <div style={{ width: "55%", height: 6, borderRadius: 3, background: COLORS.border }} />
          </div>
        );
      })}
      {/* belt line */}
      <div style={{ position: "absolute", bottom: 0, left: 0, width, height: 2, background: `linear-gradient(90deg, transparent, ${COLORS.borderHi}, transparent)` }} />
    </div>
  );
};

export const Scene2Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, width } = useLayout();

  const op = interpolate(frame, [0, 10, 228, 240], [0, 1, 1, 0], CLAMP);

  // two-line flashing headline
  const l1 = spring({ frame: frame - 20, fps, config: SPRING_POP, from: 0, to: 1 });
  const l2 = spring({ frame: frame - 92, fps, config: SPRING_POP, from: 0, to: 1 });
  // subtle red flashes punctuating the stress
  const flash = (at: number) => interpolate(frame, [at, at + 3, at + 12], [0, 0.18, 0], CLAMP);

  const big = (portrait ? 64 : 76) * u;

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: COLORS.bg }}>
      <Background intensity={0.4} />
      {/* desaturating tired wash */}
      <AbsoluteFill style={{ background: "rgba(10,10,16,0.5)", mixBlendMode: "multiply" }} />

      {/* illustrated vignette */}
      <AbsoluteFill
        style={{
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: portrait ? 40 * u : 90 * u,
          paddingTop: portrait ? 120 * u : 0,
        }}
      >
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: -90 * u, left: "50%", transform: "translateX(-50%)" }}>
            <Clock size={120 * u} />
          </div>
          <Creator w={300 * u} />
        </div>
      </AbsoluteFill>

      {/* endless treadmill across lower third */}
      <Treadmill width={width} y={portrait ? 1380 * u : 800 * u} />

      {/* headline */}
      <AbsoluteFill
        style={{
          justifyContent: portrait ? "flex-start" : "flex-end",
          alignItems: "center",
          padding: portrait ? "180px 60px 0" : "0 0 150px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: display,
              fontWeight: 700,
              fontSize: big,
              color: COLORS.sub,
              opacity: l1,
              transform: `translateY(${interpolate(l1, [0, 1], [24, 0])}px)`,
              letterSpacing: -big * 0.02,
            }}
          >
            Making content is a full-time job.
          </div>
          <div
            style={{
              fontFamily: display,
              fontWeight: 800,
              fontSize: big * 1.05,
              color: COLORS.white,
              marginTop: 10 * u,
              opacity: l2,
              transform: `translateY(${interpolate(l2, [0, 1], [24, 0])}px)`,
              letterSpacing: -big * 0.025,
              textShadow: `0 0 ${big * 0.5}px ${COLORS.amber}33`,
            }}
          >
            You already have one.
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ background: COLORS.amber, opacity: flash(60) + flash(150), mixBlendMode: "overlay" }} />
    </AbsoluteFill>
  );
};
