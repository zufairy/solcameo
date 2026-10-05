/**
 * rk.tsx — "MELTDOWN" brainrot kit · 2026-07-03 batch 2.
 * Giant slammed type, punch zooms, screen shake, flash cuts, RGB split.
 * 16:9 1920x1080 · 30fps · deliberately NOT Daybreak.
 */
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate, random,
} from "remotion";
import { display, mono, geist } from "../../../lib/fonts";

export { display, mono, geist };

export const R = {
  ink: "#0D0F0A",
  paper: "#F7F6F1",
  lime: "#A3E635",
  limeDark: "#65A30D",
  white: "#FFFFFF",
  red: "#FF3B30",
} as const;

export const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* screen shake offset (decaying) after a slam at frame `at` */
export const useShake = (at: number, power = 14, decay = 12) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > decay * 2) return { x: 0, y: 0 };
  const damp = Math.max(0, 1 - t / (decay * 2));
  return {
    x: (random(`sx${at}-${frame}`) - 0.5) * 2 * power * damp,
    y: (random(`sy${at}-${frame}`) - 0.5) * 2 * power * damp,
  };
};

/* hard pop-in: overshoot scale, no fade-in slowness */
export const Slam: React.FC<{
  at: number; children: React.ReactNode; out?: number; rotate?: number; style?: React.CSSProperties;
}> = ({ at, children, out, rotate = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || (out !== undefined && frame > out)) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 320, mass: 0.6 } });
  return (
    <div style={{ transform: `scale(${0.6 + 0.4 * s}) rotate(${rotate}deg)`, opacity: Math.min(1, s * 2), ...style }}>
      {children}
    </div>
  );
};

/* giant uppercase display line with per-word color + slight RGB split */
export const Mega: React.FC<{
  words: { t: string; c?: string }[]; size: number; color?: string; split?: boolean;
  align?: "center" | "left"; lineHeight?: number; maxWidth?: number;
}> = ({ words, size, color = R.white, split = true, align = "center", lineHeight = 0.96, maxWidth }) => (
  <div style={{ position: "relative", maxWidth }}>
    {split && (
      <div aria-hidden style={{
        position: "absolute", inset: 0, display: "flex", flexWrap: "wrap",
        gap: `0px ${size * 0.22}px`, justifyContent: align === "center" ? "center" : "flex-start",
        fontFamily: display, fontWeight: 700, fontSize: size, lineHeight, letterSpacing: -size * 0.03,
        textTransform: "uppercase", color: R.red, opacity: 0.5,
        transform: "translate(4px, 2px)", mixBlendMode: "screen" as const, pointerEvents: "none",
      }}>
        {words.map((w, i) => <span key={i}>{w.t}</span>)}
      </div>
    )}
    <div style={{
      display: "flex", flexWrap: "wrap", gap: `0px ${size * 0.22}px`,
      justifyContent: align === "center" ? "center" : "flex-start",
      fontFamily: display, fontWeight: 700, fontSize: size, lineHeight, letterSpacing: -size * 0.03,
      textTransform: "uppercase", color,
    }}>
      {words.map((w, i) => <span key={i} style={{ color: w.c ?? color }}>{w.t}</span>)}
    </div>
  </div>
);

/* full-bleed Veo clip with punch-zoom keyframes */
export const Punch: React.FC<{
  src: string; from: number; to: number; startFrom?: number;
  zooms?: number[]; baseScale?: number; crop?: "center" | "left" | "right";
}> = ({ src, from, to, startFrom = 0, zooms = [], baseScale = 1.05, crop = "center" }) => {
  const frame = useCurrentFrame();
  const sh = useShake(zooms.find((zf) => frame >= zf && frame - zf < 20) ?? -100, 10);
  if (frame < from - 2 || frame > to + 2) return null;
  let z = baseScale;
  for (const zf of zooms) {
    if (frame >= zf) {
      const t = Math.min(1, (frame - zf) / 5);
      z += 0.16 * t; // hard punch in 5 frames
      const rel = frame - zf;
      if (rel > 20) z -= Math.min(0.16, ((rel - 20) / 30) * 0.16); // ease back
    }
  }
  const ox = crop === "left" ? "-8%" : crop === "right" ? "8%" : "0%";
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: R.ink }}>
      <OffthreadVideo muted src={staticFile(src)} startFrom={startFrom} style={{
        width: "100%", height: "100%", objectFit: "cover",
        transform: `translate(calc(${ox} + ${sh.x}px), ${sh.y}px) scale(${z})`,
      }} />
    </AbsoluteFill>
  );
};

/* Ken Burns still image with punch zooms (fallback when no Veo clip) */
export const KBurns: React.FC<{
  src: string; from: number; to: number; zooms?: number[]; baseScale?: number; pan?: number;
}> = ({ src, from, to, zooms = [], baseScale = 1.1, pan = -40 }) => {
  const frame = useCurrentFrame();
  const sh = useShake(zooms.find((zf) => frame >= zf && frame - zf < 20) ?? -100, 10);
  if (frame < from - 2 || frame > to + 2) return null;
  const t = (frame - from) / Math.max(1, to - from);
  let z = baseScale + t * 0.12;
  for (const zf of zooms) {
    if (frame >= zf) {
      const tt = Math.min(1, (frame - zf) / 5);
      z += 0.14 * tt;
      const rel = frame - zf;
      if (rel > 20) z -= Math.min(0.14, ((rel - 20) / 30) * 0.14);
    }
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: R.ink }}>
      <Img src={staticFile(src)} style={{
        width: "100%", height: "100%", objectFit: "cover",
        transform: `translate(${pan * t + sh.x}px, ${sh.y}px) scale(${z})`,
      }} />
    </AbsoluteFill>
  );
};

/* bottom meme caption over footage */
export const Cap: React.FC<{ at: number; out: number; words: { t: string; c?: string }[]; size?: number; y?: number }> =
  ({ at, out, words, size = 66, y = 860 }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    if (frame < at || frame > out) return null;
    const s = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 300, mass: 0.6 } });
    return (
      <div style={{
        position: "absolute", left: 0, right: 0, top: y, display: "flex", justifyContent: "center",
        transform: `scale(${0.8 + 0.2 * s})`, opacity: Math.min(1, s * 2),
      }}>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.24}px`, justifyContent: "center", maxWidth: 1560,
          fontFamily: display, fontWeight: 700, fontSize: size, textTransform: "uppercase",
          color: R.white, letterSpacing: -size * 0.02, lineHeight: 1,
          textShadow: "0 4px 0 #000, 0 0 30px rgba(0,0,0,0.9), -3px 3px 0 #000, 3px 3px 0 #000, 3px -3px 0 #000, -3px -3px 0 #000",
          textAlign: "center",
        }}>
          {words.map((w, i) => <span key={i} style={{ color: w.c ?? R.white }}>{w.t}</span>)}
        </div>
      </div>
    );
  };

/* flash-cut background: alternates ink/lime for N frames */
export const Flash: React.FC<{ at: number; dur?: number }> = ({ at, dur = 6 }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > at + dur) return null;
  return <AbsoluteFill style={{ background: (frame - at) % 2 === 0 ? R.lime : R.white, opacity: 0.9 }} />;
};

/* big tilted stat card */
export const Stat: React.FC<{
  at: number; out?: number; big: React.ReactNode; sub: string; rotate?: number; dark?: boolean; style?: React.CSSProperties;
}> = ({ at, out, big, sub, rotate = -2, dark = false, style }) => (
  <Slam at={at} out={out} rotate={rotate} style={style}>
    <div style={{
      background: dark ? R.ink : R.lime, color: dark ? R.lime : R.ink,
      border: `6px solid ${R.ink}`, borderRadius: 28, padding: "34px 46px",
      boxShadow: `14px 14px 0 ${dark ? R.lime : R.ink}`,
    }}>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 110, letterSpacing: -4, lineHeight: 0.95, textTransform: "uppercase" }}>{big}</div>
      <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 3, marginTop: 12, textTransform: "uppercase", opacity: 0.85 }}>{sub}</div>
    </div>
  </Slam>
);

/* counting number */
export const N: React.FC<{ at: number; to: number; dur?: number; prefix?: string; suffix?: string }> =
  ({ at, to, dur = 30, prefix = "", suffix = "" }) => {
    const frame = useCurrentFrame();
    const v = Math.round(interpolate(frame, [at, at + dur], [0, to], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 3) }));
    return <>{prefix}{v.toLocaleString()}{suffix}</>;
  };

/* shared end card */
export const EndCard: React.FC<{ at: number; line: { t: string; c?: string }[] }> = ({ at, line }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const g = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 220, mass: 0.7 } });
  const wob = frame > at + 20 ? Math.sin((frame - at - 20) / 9) * 0.02 : 0;
  return (
    <AbsoluteFill style={{ background: R.ink, alignItems: "center", justifyContent: "center", gap: 40 }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse 60% 50% at 50% 40%, ${R.lime}22, transparent 70%)`,
      }} />
      <div style={{
        width: 170, height: 170, borderRadius: 42, overflow: "hidden",
        transform: `scale(${g + wob}) rotate(${(1 - g) * -14}deg)`,
        boxShadow: `0 0 90px ${R.lime}66, 12px 12px 0 ${R.lime}`,
      }}>
        <Img src={staticFile("brand/vello-glyph.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <Slam at={at + 8}><Mega size={92} words={line} /></Slam>
      <Slam at={at + 20}>
        <div style={{
          fontFamily: display, fontWeight: 700, fontSize: 44, color: R.ink, textTransform: "uppercase",
          background: R.lime, borderRadius: 999, padding: "20px 52px", border: `5px solid ${R.ink}`,
          boxShadow: `10px 10px 0 ${R.limeDark}`,
        }}>
          Launch an influencer → vello.gg
        </div>
      </Slam>
      <Slam at={at + 32}>
        <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 6, color: R.lime, textTransform: "uppercase" }}>
          free month · no card · agent pays its own rent
        </div>
      </Slam>
    </AbsoluteFill>
  );
};

/* grain + vignette */
export const Dirt: React.FC = () => (
  <AbsoluteFill style={{
    pointerEvents: "none",
    background: "radial-gradient(ellipse 120% 100% at 50% 50%, transparent 60%, rgba(0,0,0,0.42) 100%)",
  }} />
);

export const BR_FPS = 30;
export const BR_FRAMES = 900;
