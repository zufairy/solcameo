/**
 * promos/kit.tsx — shared vocabulary for the five 30s promo films.
 * Lime-Workshop / volt world: SW theme, plated tiles, mono labels,
 * one accent doing all the pointing.
 */
import React from "react";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { CLAMP, SPRING_POP } from "../theme";
import { SW, swTextGlow } from "../swarm/theme";
import { display, mono } from "../lib/fonts";
import { KineticText, Eyebrow } from "../components/KineticText";

export { SW, swTextGlow, CLAMP, SPRING_POP, display, mono };
export { KineticText, Eyebrow };

/* ── Plated tile (DESIGN.md "3D plated") ─────────────────────────────── */
export const Plate: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  glowColor?: string;
  radius?: number;
}> = ({ children, style, glowColor, radius = 26 }) => (
  <div
    style={{
      background: `linear-gradient(180deg, ${SW.cardHi} 0%, ${SW.card} 60%)`,
      border: `1.5px solid ${SW.border}`,
      borderRadius: radius,
      boxShadow: [
        "inset 0 1.5px 0 rgba(255,255,255,0.08)",
        "0 6px 0 rgba(0,0,0,0.55)",
        "0 22px 44px rgba(0,0,0,0.5)",
        glowColor ? `0 0 70px ${glowColor}22` : "",
      ]
        .filter(Boolean)
        .join(", "),
      ...style,
    }}
  >
    {children}
  </div>
);

/* ── Spring-in wrapper ────────────────────────────────────────────────── */
export const Pop: React.FC<{
  at: number;
  children: React.ReactNode;
  from?: number;
  y?: number;
  style?: React.CSSProperties;
}> = ({ at, children, from = 0.86, y = 34, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: SPRING_POP, from: 0, to: 1 });
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${(1 - s) * y}px) scale(${from + (1 - from) * s})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/* ── Volt progress hairline ───────────────────────────────────────────── */
export const VoltLine: React.FC<{
  at: number;
  width: number;
  duration?: number;
  thickness?: number;
  style?: React.CSSProperties;
}> = ({ at, width, duration = 30, thickness = 3, style }) => {
  const frame = useCurrentFrame();
  const w = interpolate(frame, [at, at + duration], [0, width], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  return (
    <div
      style={{
        width: w,
        height: thickness,
        background: `linear-gradient(90deg, ${SW.volt}, ${SW.voltSoft})`,
        boxShadow: `0 0 18px ${SW.volt}88`,
        borderRadius: thickness,
        ...style,
      }}
    />
  );
};

/* ── Mono chip / tag ──────────────────────────────────────────────────── */
export const Chip: React.FC<{
  children: React.ReactNode;
  color?: string;
  size?: number;
  filled?: boolean;
  style?: React.CSSProperties;
}> = ({ children, color = SW.volt, size = 21, filled = false, style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: size * 0.5,
      fontFamily: mono,
      fontSize: size,
      letterSpacing: size * 0.14,
      textTransform: "uppercase",
      color: filled ? "#0A0C08" : color,
      background: filled ? color : `${color}14`,
      border: `1.5px solid ${filled ? color : `${color}55`}`,
      borderRadius: 999,
      padding: `${size * 0.55}px ${size * 1.1}px`,
      ...style,
    }}
  >
    <span
      style={{
        width: size * 0.38,
        height: size * 0.38,
        borderRadius: 999,
        background: filled ? "#0A0C08" : color,
        boxShadow: filled ? "none" : `0 0 12px ${color}`,
      }}
    />
    {children}
  </div>
);

/* ── The shared brand outro (~6s): wordmark + CTA ─────────────────────── */
export const Outro: React.FC<{ at: number; cta?: string; sub?: string }> = ({
  at,
  cta = "Deploy your first agent — free for 30 days",
  sub = "vello · the AI influencer network",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 16, mass: 0.9 }, from: 0, to: 1 });
  const glow = interpolate(
    Math.sin((frame - at) / 14),
    [-1, 1],
    [0.5, 1],
  );
  if (frame < at - 5) return null;
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(ellipse 60% 50% at 50% 42%, ${SW.volt}10, transparent 70%), ${SW.bg}`,
        opacity: interpolate(frame, [at - 5, at + 8], [0, 1], CLAMP),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 44 }}>
        <div
          style={{
            opacity: s,
            transform: `scale(${0.9 + 0.1 * s})`,
            filter: `drop-shadow(0 0 ${40 * glow}px ${SW.volt}55)`,
          }}
        >
          <Img src={staticFile("brand/lo.png")} style={{ width: 560 }} />
        </div>
        <Pop at={at + 10}>
          <div
            style={{
              fontFamily: display,
              fontWeight: 700,
              fontSize: 46,
              color: SW.white,
              letterSpacing: -1,
              textAlign: "center",
            }}
          >
            {cta.split("free").length > 1 ? (
              <>
                {cta.split("free")[0]}
                <span style={{ color: SW.volt, textShadow: swTextGlow(SW.volt, 30) }}>free</span>
                {cta.split("free")[1]}
              </>
            ) : (
              cta
            )}
          </div>
        </Pop>
        <Pop at={at + 22}>
          <div
            style={{
              fontFamily: mono,
              fontSize: 22,
              letterSpacing: 8,
              textTransform: "uppercase",
              color: SW.sub,
            }}
          >
            {sub}
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
};

/* ── Film-grain + vignette finish ─────────────────────────────────────── */
export const Finish: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background:
        "radial-gradient(ellipse 110% 90% at 50% 50%, transparent 62%, rgba(0,0,0,0.5) 100%)",
    }}
  />
);
