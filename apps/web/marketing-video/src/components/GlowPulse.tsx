/**
 * GlowPulse — a radial bloom that fires on a beat and decays.
 *
 * Used to punch key moments (hook end, reveal, earn). Renders as a centered
 * (or positioned) screen-blended radial that scales up + fades.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { CLAMP, COLORS } from "../theme";

export const GlowPulse: React.FC<{
  at: number;
  color?: string;
  size?: number; // peak diameter in px
  x?: number; // 0..100 %
  y?: number; // 0..100 %
  intensity?: number; // peak opacity
  duration?: number;
}> = ({
  at,
  color = COLORS.violet,
  size = 1100,
  x = 50,
  y = 50,
  intensity = 0.7,
  duration = 26,
}) => {
  const frame = useCurrentFrame();
  const op = interpolate(
    frame,
    [at, at + 5, at + duration],
    [0, intensity, 0],
    CLAMP,
  );
  const scale = interpolate(frame, [at, at + duration], [0.4, 1.25], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  if (op <= 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen" }}>
      <div
        style={{
          position: "absolute",
          left: `${x}%`,
          top: `${y}%`,
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}, transparent 65%)`,
          opacity: op,
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Thin horizontal light sweep across an element/scene. */
export const LightSweep: React.FC<{ start?: number; dur?: number }> = ({
  start = 0,
  dur = 30,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + dur], [-25, 130], CLAMP);
  const o = interpolate(
    frame,
    [start, start + dur * 0.4, start + dur],
    [0, 0.5, 0],
    CLAMP,
  );
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(115deg, transparent ${p - 16}%, rgba(255,255,255,0.14) ${p}%, transparent ${p + 16}%)`,
        opacity: o,
        mixBlendMode: "screen",
        pointerEvents: "none",
      }}
    />
  );
};
