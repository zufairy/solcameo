/**
 * W5 — "ANATOMY OF AN AGENT" · blueprint schematic film (~28s).
 * Design: engineering blueprint — deep blue graph paper, self-drawing
 * schematic lines, mono annotations, component callouts, APPROVED stamp.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { display, mono } from "../lib/fonts";

const BLUE = "#0A1E3C", LINE = "#9FC4FF", VOLT = "#C6F222", WHITE = "#EAF2FF";
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Paper: React.FC = () => (
  <AbsoluteFill style={{ background: BLUE }}>
    <AbsoluteFill style={{ backgroundImage: `linear-gradient(${LINE}12 1px, transparent 1px), linear-gradient(90deg, ${LINE}12 1px, transparent 1px)`, backgroundSize: "44px 44px" }} />
    <AbsoluteFill style={{ backgroundImage: `linear-gradient(${LINE}20 1.5px, transparent 1.5px), linear-gradient(90deg, ${LINE}20 1.5px, transparent 1.5px)`, backgroundSize: "220px 220px" }} />
    <div style={{ position: "absolute", inset: 46, border: `2px solid ${LINE}55` }} />
    <div style={{ position: "absolute", right: 70, bottom: 66, fontFamily: mono, fontSize: 17, color: `${LINE}AA`, letterSpacing: 2, textAlign: "right", lineHeight: 1.9 }}>
      DWG NO. VLO-2026-001 · SHEET 1/1<br />PROJECT: AUTONOMOUS CREATOR · SCALE 1:1
    </div>
  </AbsoluteFill>
);

/* self-drawing rect callout with label */
const Callout: React.FC<{ at: number; x: number; y: number; w: number; h: number; n: string; title: string; sub: string; lx?: number }> =
  ({ at, x, y, w, h, n, title, sub, lx = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const peri = 2 * (w + h);
  const draw = interpolate(frame, [at, at + 26], [peri, 0], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 2.5) });
  const ls = spring({ frame: frame - at - 16, fps, config: { damping: 16, stiffness: 160 } });
  return (
    <>
      <svg style={{ position: "absolute", left: x - 4, top: y - 4 }} width={w + 8} height={h + 8}>
        <rect x="4" y="4" width={w} height={h} fill={`${VOLT}0d`} stroke={VOLT} strokeWidth="2.5" strokeDasharray={peri} strokeDashoffset={draw} />
        <circle cx="4" cy="4" r="5" fill={VOLT} />
      </svg>
      <div style={{ position: "absolute", left: x + lx, top: y + h + 16, opacity: ls, transform: `translateY(${(1 - ls) * 16}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: mono, fontSize: 20, color: BLUE, background: VOLT, padding: "3px 12px", fontWeight: 700 }}>{n}</span>
          <span style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: WHITE, letterSpacing: -0.5 }}>{title}</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 19, color: `${LINE}CC`, marginTop: 8, maxWidth: 430, lineHeight: 1.55 }}>{sub}</div>
      </div>
    </>
  );
};

export const W5Blueprint: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stampS = spring({ frame: frame - 640, fps, config: { damping: 11, stiffness: 240, mass: 0.8 } });
  const glyphS = spring({ frame: frame - 726, fps, config: { damping: 14, stiffness: 160 } });
  const headerO = interpolate(frame, [0, 12], [0, 1], CL);

  return (
    <AbsoluteFill>
      <Paper />
      {/* title block */}
      <div style={{ position: "absolute", left: 100, top: 92, opacity: headerO }}>
        <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 8, color: VOLT }}>FIG. 1 — BLUEPRINT</div>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 88, letterSpacing: -3, color: WHITE, marginTop: 8 }}>
          Anatomy of an <span style={{ color: VOLT }}>agent</span>.
        </div>
      </div>

      {/* central schematic: agent core */}
      {frame >= 60 && frame < 720 && (
        <>
          <svg style={{ position: "absolute", left: 760, top: 330 }} width="420" height="560">
            {/* head */}
            <circle cx="210" cy="120" r="86" fill="none" stroke={LINE} strokeWidth="2.5"
              strokeDasharray={540} strokeDashoffset={interpolate(frame, [60, 92], [540, 0], CL)} />
            {/* body */}
            <rect x="96" y="230" width="228" height="240" rx="26" fill="none" stroke={LINE} strokeWidth="2.5"
              strokeDasharray={940} strokeDashoffset={interpolate(frame, [84, 122], [940, 0], CL)} />
            {/* legs → rails */}
            <path d="M 140 470 L 140 545 M 280 470 L 280 545" stroke={LINE} strokeWidth="2.5"
              strokeDasharray={160} strokeDashoffset={interpolate(frame, [112, 136], [160, 0], CL)} />
            {/* core pulse */}
            <circle cx="210" cy="350" r={16 + Math.sin(frame / 8) * 3.5} fill={VOLT} opacity="0.95" />
            <circle cx="210" cy="350" r={34 + Math.sin(frame / 8) * 6} fill="none" stroke={VOLT} strokeWidth="1.5" opacity="0.5" />
            {/* face grid */}
            <path d="M 165 100 h 90 M 165 130 h 90 M 210 34 v 172" stroke={`${LINE}66`} strokeWidth="1.5"
              strokeDasharray={430} strokeDashoffset={interpolate(frame, [96, 126], [430, 0], CL)} />
          </svg>
          <Callout at={150} x={520} y={300} w={330} h={210} n="C1" title="Face" sub="consistent · licensed · unmistakably yours" lx={-40} />
          <Callout at={255} x={1090} y={300} w={330} h={210} n="C2" title="Memory" sub="learns hooks & audiences · compounds every post" />
          <Callout at={360} x={520} y={600} w={330} h={210} n="C3" title="Skills" sub="clipping · captions · trends · voice packs" lx={-40} />
          <Callout at={465} x={1090} y={600} w={330} h={210} n="C4" title="Rails" sub="bounties in → verified views → Solana out" />
          {/* assembly note */}
          {frame >= 570 && frame < 720 && (
            <div style={{ position: "absolute", left: 100, bottom: 150, fontFamily: mono, fontSize: 26, color: WHITE, letterSpacing: 2, opacity: interpolate(frame, [570, 584], [0, 1], CL) }}>
              ASSEMBLY TIME: <span style={{ color: VOLT, fontWeight: 700 }}>~4 MIN</span> · OUTPUT: <span style={{ color: VOLT, fontWeight: 700 }}>CONTENT THAT EARNS</span>
            </div>
          )}
          {/* APPROVED stamp */}
          {frame >= 640 && frame < 726 && (
            <div style={{
              position: "absolute", left: 640, top: 430, transform: `rotate(-14deg) scale(${2.2 - 1.2 * Math.min(stampS, 1)})`,
              opacity: Math.min(stampS * 1.3, 1),
              border: `7px solid ${VOLT}`, borderRadius: 18, padding: "18px 44px",
              fontFamily: display, fontWeight: 700, fontSize: 90, letterSpacing: 4, color: VOLT, textTransform: "uppercase",
              boxShadow: `0 0 60px ${VOLT}44, inset 0 0 40px ${VOLT}22`,
            }}>Approved</div>
          )}
        </>
      )}

      {/* CTA */}
      {frame >= 722 && (
        <AbsoluteFill>
          <Paper />
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 38 }}>
            <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 220, opacity: glyphS, transform: `scale(${0.85 + 0.15 * glyphS})`, filter: `drop-shadow(0 0 46px ${VOLT}77)` }} />
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 92, letterSpacing: -3, color: WHITE, opacity: glyphS }}>
              Approved for <span style={{ color: VOLT }}>deployment</span>.
            </div>
            <div style={{ fontFamily: mono, fontSize: 26, letterSpacing: 10, color: LINE, opacity: interpolate(frame, [756, 770], [0, 1], CL) }}>BUILD YOURS → VELLO.GG</div>
          </AbsoluteFill>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
