/**
 * SwarmBackground — the volt world under every SWARM scene.
 *
 * Near-black green-charged void: a wandering volt light pool, a deep violet
 * counter-pool (so the world still reads Vello), a scrolling masked grid,
 * sparse scanline texture, and a vignette. Noise-driven so no frame is dead.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { noise2D } from "@remotion/noise";
import { SW } from "./theme";

export const SwarmBackground: React.FC<{
  /** 0..1 volt pool strength (hero beats = high) */
  intensity?: number;
  /** flip the accent pool violet→cyan for variety */
  cool?: boolean;
}> = ({ intensity = 1, cool = false }) => {
  const frame = useCurrentFrame();

  const vx = 0.32 + 0.09 * noise2D("swvx", frame / 230, 0);
  const vy = 0.3 + 0.07 * noise2D("swvy", 0, frame / 250);
  const ax = 0.74 + 0.08 * noise2D("swax", frame / 260, 1);
  const ay = 0.72 + 0.07 * noise2D("sway", 2, frame / 240);
  const grid = (frame * 0.4) % 72;

  const accent = cool ? SW.cyan : SW.violet;

  return (
    <AbsoluteFill style={{ backgroundColor: SW.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(58% 52% at ${vx * 100}% ${vy * 100}%, ${SW.volt}30, transparent 62%)`,
          opacity: 0.5 + 0.5 * intensity,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(50% 50% at ${ax * 100}% ${ay * 100}%, ${accent}22, transparent 60%)`,
        }}
      />
      {/* scrolling grid, masked center-weighted */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(214,255,80,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(214,255,80,0.05) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          backgroundPosition: `${grid}px ${grid * 0.55}px`,
          opacity: 0.45,
          WebkitMaskImage:
            "radial-gradient(circle at 50% 46%, black, transparent 78%)",
          maskImage:
            "radial-gradient(circle at 50% 46%, black, transparent 78%)",
        }}
      />
      {/* faint scanlines for broadcast texture */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.016) 0px, rgba(255,255,255,0.016) 1px, transparent 1px, transparent 4px)",
          opacity: 0.6,
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: "inset 0 0 380px 120px rgba(0,0,0,0.8)" }}
      />
    </AbsoluteFill>
  );
};
