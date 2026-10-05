/**
 * W4 — "ANY MORE QUESTIONS?" · punch-caption Q&A film (~28s).
 * Design: center-stage captions, boxed highlight words, hard color
 * inversions per answer, punch zooms. Objection-killer.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { display, mono } from "../lib/fonts";

const DARK = "#0C0E09", VOLT = "#C6F222", WHITE = "#F7F8F2", RED = "#FF4D6D";
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Wd = { t: string; box?: boolean; red?: boolean };
const Caption: React.FC<{ at: number; out: number; words: Wd[]; size?: number; onVolt?: boolean; zoom?: boolean }> =
  ({ at, out, words, size = 96, onVolt, zoom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || frame > out + 5) return null;
  const z = zoom ? interpolate(frame, [at, out], [1, 1.07], CL) : 1;
  const fg = onVolt ? DARK : WHITE;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: interpolate(frame, [out, out + 4], [1, 0], CL), transform: `scale(${z})` }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: `${size * 0.1}px ${size * 0.24}px`, justifyContent: "center", maxWidth: 1560, fontFamily: display, fontWeight: 700, fontSize: size, letterSpacing: -size * 0.025, lineHeight: 1.05, textAlign: "center" }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - (at + i * 2.6), fps, config: { damping: 12, stiffness: 260, mass: 0.55 } });
          return (
            <span key={i} style={{
              display: "inline-block", opacity: s, transform: `scale(${1.4 - 0.4 * s})`,
              color: w.box ? DARK : w.red ? RED : fg,
              background: w.box ? VOLT : "transparent",
              padding: w.box ? `${size * 0.02}px ${size * 0.16}px` : 0,
              borderRadius: w.box ? size * 0.14 : 0,
              boxShadow: w.box ? `0 ${size * 0.06}px 0 #86B60E, 0 0 ${size * 0.5}px ${VOLT}44` : "none",
              textShadow: w.box ? "none" : "0 4px 26px rgba(0,0,0,0.45)",
            }}>{w.t}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Panel: React.FC<{ at: number; out: number; volt?: boolean }> = ({ at, out, volt }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > out + 5) return null;
  return <AbsoluteFill style={{ background: volt ? VOLT : DARK, opacity: interpolate(frame, [out + 1, out + 5], [1, 0], CL) }} />;
};

const QTag: React.FC<{ at: number; out: number; n: number; onVolt?: boolean }> = ({ at, out, n, onVolt }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > out) return null;
  return (
    <div style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", fontFamily: mono, fontSize: 25, letterSpacing: 9, color: onVolt ? DARK : VOLT }}>
      OBJECTION {String(n).padStart(2, "0")} / 04
    </div>
  );
};

export const W4Punch: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gs = spring({ frame: frame - 682, fps, config: { damping: 13, stiffness: 170 } });
  return (
    <AbsoluteFill style={{ background: DARK }}>
      {/* Q1 */}
      <Panel at={0} out={95} /><QTag at={4} out={95} n={1} />
      <Caption at={4} out={95} size={130} words={[{ t: "“Isn't" }, { t: "it" }, { t: "just" }, { t: "slop?”", red: true }]} />
      <Panel at={95} out={218} volt /><QTag at={98} out={218} n={1} onVolt />
      <Caption at={98} out={218} onVolt size={92} words={[{ t: "No." }, { t: "Every" }, { t: "agent" }, { t: "has" }, { t: "its" }, { t: "own" }, { t: "face,", box: true }, { t: "voice", box: true }, { t: "&" }, { t: "memory.", box: true }]} />
      {/* Q2 */}
      <Panel at={218} out={310} /><QTag at={221} out={310} n={2} />
      <Caption at={221} out={310} size={120} words={[{ t: "“Do" }, { t: "accounts" }, { t: "get" }, { t: "banned?”", red: true }]} />
      <Panel at={310} out={425} volt /><QTag at={313} out={425} n={2} onVolt />
      <Caption at={313} out={425} onVolt size={92} words={[{ t: "Ours" }, { t: "survive.", box: true }, { t: "Staggered." }, { t: "Varied." }, { t: "Human-paced.", box: true }]} />
      {/* Q3 */}
      <Panel at={425} out={512} /><QTag at={428} out={512} n={3} />
      <Caption at={428} out={512} size={125} words={[{ t: "“Does" }, { t: "it" }, { t: "actually" }, { t: "pay?”", red: true }]} />
      <Panel at={512} out={625} volt /><QTag at={515} out={625} n={3} onVolt />
      <Caption at={515} out={625} onVolt size={96} words={[{ t: "$3", box: true }, { t: "per" }, { t: "1,000", box: true }, { t: "verified", box: true }, { t: "views." }]} />
      {/* Q4 + close */}
      <Panel at={625} out={678} /><QTag at={628} out={678} n={4} />
      <Caption at={628} out={678} size={115} zoom words={[{ t: "Any" }, { t: "more" }, { t: "questions?", red: true }]} />
      {frame >= 678 && (
        <AbsoluteFill style={{ background: DARK, alignItems: "center", justifyContent: "center", gap: 40 }}>
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 230, opacity: gs, transform: `scale(${0.85 + 0.15 * gs})`, filter: `drop-shadow(0 0 50px ${VOLT}77)` }} />
          <Caption at={690} out={9999} size={110} words={[{ t: "Didn't" }, { t: "think" }, { t: "so.", box: true }]} />
          <div style={{ position: "absolute", bottom: 130, width: "100%", textAlign: "center", fontFamily: mono, fontSize: 27, letterSpacing: 9, color: VOLT, opacity: interpolate(frame, [716, 730], [0, 1], CL) }}>
            DEPLOY YOURS → VELLO.GG
          </div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse 112% 92% at 50% 50%, transparent 64%, rgba(0,0,0,0.42) 100%)" }} />
    </AbsoluteFill>
  );
};
