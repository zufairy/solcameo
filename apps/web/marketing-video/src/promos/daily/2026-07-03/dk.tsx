/**
 * dk.tsx — Daybreak Pro shared kit for the 2026-07-03 daily batch.
 * Light bone-paper world, ink type, one lime accent, buttery springs.
 * Derived from V6Explainer (the reference film).
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate, Easing,
} from "remotion";
import { display, mono, geist, serif } from "../../../lib/fonts";

export { display, mono, geist, serif };

/* ── DAYBREAK palette ── */
export const D = {
  paper: "#F7F6F1",
  paper2: "#EFEEE6",
  sky: "#BFE3F5",
  skyDeep: "#8EC9E8",
  ink: "#20261C",
  sub: "#6B7263",
  faint: "#9AA091",
  lime: "#65A30D",
  limeBright: "#A3E635",
  card: "#FFFFFF",
  line: "rgba(32,38,28,0.12)",
  dark: "#161B12",
} as const;

export const EASE = Easing.bezier(0.32, 0.72, 0, 1);
export const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const useIn = (at: number, damping = 26, mass = 1) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping, mass, stiffness: 120 } });
};

export const Rise: React.FC<{ at: number; children: React.ReactNode; y?: number; style?: React.CSSProperties }> =
  ({ at, children, y = 40, style }) => {
    const s = useIn(at);
    return <div style={{ opacity: s, transform: `translateY(${(1 - s) * y}px)`, ...style }}>{children}</div>;
  };

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; dark?: boolean }> =
  ({ children, style, dark }) => (
    <div style={{
      background: dark ? D.dark : D.card,
      borderRadius: 24,
      border: `1.5px solid ${dark ? "rgba(255,255,255,0.09)" : D.line}`,
      boxShadow: dark ? "0 24px 48px rgba(22,27,18,0.35)" : "0 18px 40px rgba(32,38,28,0.10), 0 2px 6px rgba(32,38,28,0.05)",
      ...style,
    }}>{children}</div>
  );

export const Tag: React.FC<{ children: React.ReactNode; color?: string; light?: boolean }> =
  ({ children, color = D.lime, light }) => (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      fontFamily: mono, fontSize: 19, letterSpacing: 3.5, textTransform: "uppercase",
      color: light ? "#fff" : color,
      background: light ? "rgba(255,255,255,0.14)" : `${color}14`,
      border: `1.5px solid ${light ? "rgba(255,255,255,0.35)" : `${color}44`}`,
      borderRadius: 999, padding: "10px 20px", backdropFilter: "blur(6px)",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: light ? "#fff" : color }} />
      {children}
    </div>
  );

/* word-by-word blur-in headline */
export type LWord = { t: string; c?: string; serif?: boolean };
export const Line: React.FC<{
  words: LWord[]; at: number; size: number; color?: string; stagger?: number;
  weight?: number; align?: "center" | "left"; maxWidth?: number;
}> = ({ words, at, size, color = D.ink, stagger = 4, weight = 600, align = "center", maxWidth }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: `${size * 0.08}px ${size * 0.26}px`,
      justifyContent: align === "center" ? "center" : "flex-start", maxWidth,
      fontFamily: display, fontSize: size, fontWeight: weight,
      letterSpacing: -size * 0.028, lineHeight: 1.04, color,
    }}>
      {words.map((w, i) => {
        const s = spring({ frame: frame - (at + i * stagger), fps, config: { damping: 24, stiffness: 130, mass: 0.9 } });
        return (
          <span key={i} style={{
            display: "inline-block", opacity: s,
            transform: `translateY(${(1 - s) * size * 0.45}px)`,
            filter: `blur(${(1 - s) * 6}px)`,
            color: w.c ?? color,
            fontFamily: w.serif ? serif : display,
            fontStyle: w.serif ? "italic" : "normal",
            fontWeight: w.serif ? 500 : weight,
          }}>{w.t}</span>
        );
      })}
    </div>
  );
};

/* crossfading section */
export const Sect: React.FC<{ from: number; to: number; children: React.ReactNode; bg?: string }> =
  ({ from, to, children, bg }) => {
    const frame = useCurrentFrame();
    if (frame < from - 14 || frame > to + 14) return null;
    const o = interpolate(frame, [from - 12, from + 6, to - 6, to + 12], [0, 1, 1, 0], CL);
    return <AbsoluteFill style={{ opacity: o, background: bg }}>{children}</AbsoluteFill>;
  };

/* counting number */
export const Count: React.FC<{
  at: number; to: number; dur?: number; prefix?: string; suffix?: string; style?: React.CSSProperties;
}> = ({ at, to, dur = 70, prefix = "", suffix = "", style }) => {
  const frame = useCurrentFrame();
  const v = Math.floor(interpolate(frame, [at, at + dur], [0, to], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 3) }));
  return <span style={style}>{prefix}{v.toLocaleString()}{suffix}</span>;
};

/* shared outro — CORRECT glyph is brand/vello-glyph.png */
export const DayOutro: React.FC<{ at: number; headline?: LWord[] }> = ({ at, headline }) => {
  const frame = useCurrentFrame();
  const g = useIn(at + 4, 18);
  const words = headline ?? [{ t: "Create.", serif: true }, { t: "Post.", serif: true }, { t: "Earn.", c: D.lime, serif: true }];
  return (
    <Sect from={at} to={at + 210} bg={D.paper}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 42 }}>
        <div style={{
          width: 180, height: 180, borderRadius: 44, overflow: "hidden",
          transform: `scale(${g + (frame > at + 24 ? Math.sin((frame - at - 24) / 30) * 0.015 : 0)}) rotate(${(1 - g) * -10}deg)`,
          opacity: g,
          boxShadow: `0 30px 70px rgba(32,38,28,0.25), 0 0 90px ${D.limeBright}55`,
        }}>
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <Line at={at + 14} size={72} maxWidth={1500} words={words} />
        <Rise at={at + 38}>
          <div style={{
            fontFamily: display, fontWeight: 700, fontSize: 42, color: "#0A0C08",
            background: D.limeBright, borderRadius: 999, padding: "22px 54px",
            boxShadow: `0 10px 0 ${D.lime}, 0 30px 60px rgba(101,163,13,0.35)`,
          }}>
            Launch an influencer → vello.gg
          </div>
        </Rise>
        <Rise at={at + 58}>
          <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: 6, color: D.faint, textTransform: "uppercase" }}>
            vello · the AI influencer network
          </div>
        </Rise>
      </AbsoluteFill>
    </Sect>
  );
};

/* film vignette */
export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse 115% 95% at 50% 50%, transparent 70%, rgba(32,38,28,0.10) 100%)" }} />
);

export const DAILY_FPS = 30;
export const DAILY_FRAMES = 900; // 30s
