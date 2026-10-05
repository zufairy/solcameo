/**
 * KineticText — the headline workhorse.
 *
 * Reveals a line word-by-word with a staggered spring (snap up + fade + a
 * touch of blur clearing). Supports a gradient-filled run of words for the
 * brand-accent phrase. No linear fades — every word springs.
 */
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { CLAMP, COLORS, SPRING_POP, textGlow } from "../theme";
import { display, mono } from "../lib/fonts";

export type Word = { t: string; grad?: boolean; color?: string };

export const KineticText: React.FC<{
  words: Word[];
  /** frame (local) when the first word lands */
  start?: number;
  /** frames between each word */
  stagger?: number;
  size: number;
  weight?: number;
  lineHeight?: number;
  align?: "center" | "left";
  gradFrom?: string;
  gradTo?: string;
  maxWidth?: number;
  letterSpacing?: number;
  style?: React.CSSProperties;
}> = ({
  words,
  start = 0,
  stagger = 4,
  size,
  weight = 800,
  lineHeight = 1.02,
  align = "center",
  gradFrom = COLORS.violet,
  gradTo = COLORS.emeraldSoft,
  maxWidth,
  letterSpacing = -size * 0.025,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: `${size * 0.06}px ${size * 0.28}px`,
        justifyContent: align === "center" ? "center" : "flex-start",
        maxWidth,
        textAlign: align,
        fontFamily: display,
        fontWeight: weight,
        fontSize: size,
        lineHeight,
        letterSpacing,
        color: COLORS.white,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const t = frame - (start + i * stagger);
        const s = spring({ frame: t, fps, config: SPRING_POP, from: 0, to: 1 });
        const y = interpolate(s, [0, 1], [size * 0.5, 0]);
        const blur = interpolate(s, [0, 1], [10, 0], CLAMP);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: s,
              transform: `translateY(${y}px)`,
              filter: `blur(${blur}px)`,
              ...(w.grad
                ? {
                    background: `linear-gradient(100deg, ${gradFrom}, ${gradTo})`,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                    textShadow: "none",
                  }
                : {
                    color: w.color ?? COLORS.white,
                    textShadow: textGlow(w.color ?? "#000", size * 0.4),
                  }),
            }}
          >
            {w.t}
          </span>
        );
      })}
    </div>
  );
};

/** Small uppercase mono eyebrow label that tracks in. */
export const Eyebrow: React.FC<{
  children: React.ReactNode;
  start?: number;
  size?: number;
  color?: string;
}> = ({ children, start = 0, size = 22, color = COLORS.sub }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [start, start + 12], [0, 1], CLAMP);
  const ls = interpolate(frame, [start, start + 18], [size * 0.7, size * 0.45], CLAMP);
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: size,
        letterSpacing: ls,
        textTransform: "uppercase",
        color,
        opacity: o,
      }}
    >
      {children}
    </div>
  );
};
