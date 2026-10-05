/**
 * Scene 1 — HOOK (0–3s)
 * Black. A single line snaps in word-by-word with kinetic glow. Particles
 * drift. Ends on a fast glow pulse that hands off to the problem scene.
 * "What if your brand never stopped posting?"
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Background } from "../components/Background";
import { Particles } from "../components/Particles";
import { GlowPulse, LightSweep } from "../components/GlowPulse";
import { KineticText } from "../components/KineticText";
import { CLAMP, COLORS } from "../theme";
import { useLayout } from "../lib/layout";

export const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();

  // overall scene fade so the cut in/out is never a hard pop
  const op = interpolate(frame, [0, 8, 168, 180], [0, 1, 1, 0], CLAMP);
  const size = (portrait ? 96 : 110) * u;

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: COLORS.bg }}>
      {/* mostly-black hook — keep the violet pool subtle */}
      <Background intensity={0.35} />
      <Particles count={46} color={COLORS.violetSoft} opacity={0.55} />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: portrait ? "0 80px" : "0 200px",
        }}
      >
        <KineticText
          start={6}
          stagger={7}
          size={size}
          maxWidth={portrait ? 900 : 1500}
          words={[
            { t: "What" },
            { t: "if" },
            { t: "your" },
            { t: "brand" },
            { t: "never", grad: true },
            { t: "stopped", grad: true },
            { t: "posting?", grad: true },
          ]}
          gradFrom={COLORS.lime}
          gradTo={COLORS.violet}
        />
      </AbsoluteFill>

      {/* fast glow pulse on the closing beat */}
      <GlowPulse at={150} color={COLORS.violet} intensity={0.8} size={1500 * u} />
      <LightSweep start={60} dur={40} />
    </AbsoluteFill>
  );
};
