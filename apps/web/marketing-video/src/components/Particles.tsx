/**
 * Particles — drifting light motes + optional burst on a beat.
 *
 * Deterministic (seeded by index, no Math.random) so renders are reproducible.
 * Two modes:
 *  - ambient drift (default): slow upward float, used as atmosphere.
 *  - burst: set `burstAt` to a frame; particles explode outward from center
 *    on that beat (key-moment delight).
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { CLAMP, COLORS } from "../theme";

const rand = (i: number, salt = 0) => {
  // cheap deterministic hash → 0..1
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const Particles: React.FC<{
  count?: number;
  color?: string;
  /** ambient drift opacity ceiling */
  opacity?: number;
  /** frame at which to fire an outward burst */
  burstAt?: number;
}> = ({ count = 40, color = COLORS.violetSoft, opacity = 0.5, burstAt }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => {
        const baseX = rand(i, 1) * 100;
        const baseY = rand(i, 2) * 100;
        const size = 1.5 + rand(i, 3) * 3.5;
        const speed = 0.4 + rand(i, 4) * 1.1;
        const twinkle =
          0.3 + 0.7 * Math.abs(Math.sin(frame / (20 + rand(i, 5) * 40) + i));

        // ambient upward drift, wrapping
        let x = baseX + Math.sin(frame / 90 + i) * 2.5;
        let y = (baseY - (frame * speed) / 12 + 200) % 100;
        let scale = 1;
        let glowAlpha = opacity * twinkle;

        if (burstAt !== undefined) {
          const angle = rand(i, 6) * Math.PI * 2;
          const dist = interpolate(
            frame,
            [burstAt, burstAt + 40],
            [0, 30 + rand(i, 7) * 45],
            { ...CLAMP, easing: (t) => 1 - Math.pow(1 - t, 3) },
          );
          x = 50 + Math.cos(angle) * dist;
          y = 50 + Math.sin(angle) * dist;
          const life = interpolate(
            frame,
            [burstAt, burstAt + 8, burstAt + 48],
            [0, 1, 0],
            CLAMP,
          );
          glowAlpha = life;
          scale = interpolate(frame, [burstAt, burstAt + 40], [1.6, 0.6], CLAMP);
        }

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              borderRadius: "50%",
              background: color,
              opacity: Math.max(0, glowAlpha),
              transform: `scale(${scale})`,
              boxShadow: `0 0 ${size * 3}px ${color}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
