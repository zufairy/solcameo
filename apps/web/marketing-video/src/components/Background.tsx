/**
 * Background — the one neon world that lives under every scene.
 *
 * Two drifting radial light pools (violet + emerald) on near-black, a masked
 * perspective grid that scrolls, and an inner vignette for depth. Motion is
 * driven by @remotion/noise so resting frames never look dead/static.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { noise2D } from "@remotion/noise";
import { COLORS } from "../theme";

export const Background: React.FC<{
  /** 0..1 — how strongly the violet pool sits center (hero scenes = high). */
  intensity?: number;
  /** override pool tint (e.g. emerald-forward for the "earns" scene) */
  warm?: boolean;
}> = ({ intensity = 1, warm = false }) => {
  const frame = useCurrentFrame();

  // Slow wandering light pools
  const vx = 0.34 + 0.08 * noise2D("vx", frame / 240, 0);
  const vy = 0.34 + 0.06 * noise2D("vy", 0, frame / 260);
  const ex = 0.72 + 0.09 * noise2D("ex", frame / 250, 1);
  const ey = 0.68 + 0.07 * noise2D("ey", 2, frame / 280);
  const grid = (frame * 0.35) % 64;

  const violetPool = warm ? COLORS.emerald : COLORS.violet;
  const secondPool = warm ? COLORS.lime : COLORS.emerald;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 55% at ${vx * 100}% ${vy * 100}%, ${violetPool}38, transparent 62%)`,
          opacity: 0.55 + 0.45 * intensity,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(52% 52% at ${ex * 100}% ${ey * 100}%, ${secondPool}26, transparent 60%)`,
        }}
      />
      {/* scrolling grid, masked to fade at edges */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: `${grid}px ${grid * 0.6}px`,
          opacity: 0.5,
          WebkitMaskImage:
            "radial-gradient(circle at 50% 48%, black, transparent 80%)",
          maskImage:
            "radial-gradient(circle at 50% 48%, black, transparent 80%)",
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: "inset 0 0 360px 110px rgba(0,0,0,0.78)" }}
      />
    </AbsoluteFill>
  );
};
