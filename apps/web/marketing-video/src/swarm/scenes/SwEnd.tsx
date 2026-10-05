/**
 * SwEnd — the close. Logo settles, the command lands word by word,
 * BUILD · EARN · OWN chips stamp, then the world exhales to black.
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
import { CLAMP, SPRING_POP } from "../../theme";
import { display, mono } from "../../lib/fonts";
import { useLayout } from "../../lib/layout";
import { KineticText } from "../../components/KineticText";
import { Particles } from "../../components/Particles";
import { GlowPulse, LightSweep } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW, swGlow } from "../theme";

const CHIPS = [
  { t: "BUILD", c: SW.volt },
  { t: "EARN", c: SW.emerald },
  { t: "OWN", c: SW.cyan },
] as const;

export const SwEnd: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  const logoIn = spring({ frame: frame - 8, fps, config: SPRING_POP, from: 0, to: 1 });
  const fadeOut = interpolate(frame, [256, 296], [1, 0], CLAMP);
  const breathe = Math.sin(frame / 40) * 3 * u;

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <SwarmBackground intensity={1} />
      <Particles count={30} color={SW.voltSoft} opacity={0.35} />
      <GlowPulse at={10} color={SW.volt} size={1600 * u} intensity={0.5} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 46 * u,
        }}
      >
        <div
          style={{
            opacity: logoIn,
            transform: `scale(${interpolate(logoIn, [0, 1], [1.25, 1])}) translateY(${breathe}px)`,
            filter: `drop-shadow(0 0 ${40 * u}px ${SW.volt}55)`,
            position: "relative",
            overflow: "hidden",
            borderRadius: 8 * u,
          }}
        >
          <Img
            src={staticFile("brand/lo.png")}
            style={{ width: (portrait ? 600 : 660) * u, display: "block" }}
          />
          <LightSweep start={70} dur={40} />
        </div>

        <KineticText
          start={40}
          stagger={7}
          size={(portrait ? 56 : 66) * u}
          gradFrom={SW.volt}
          gradTo={SW.emerald}
          words={[
            { t: "Post" },
            { t: "a" },
            { t: "bounty." },
            { t: "Unleash" },
            { t: "the" },
            { t: "swarm.", grad: true },
          ]}
        />

        <div style={{ display: "flex", gap: 26 * u }}>
          {CHIPS.map((c, i) => {
            const s = spring({
              frame: frame - (110 + i * 12),
              fps,
              config: SPRING_POP,
              from: 0,
              to: 1,
            });
            return (
              <div
                key={c.t}
                style={{
                  fontFamily: display,
                  fontWeight: 800,
                  fontSize: 27 * u,
                  letterSpacing: 4 * u,
                  color: c.c,
                  border: `1.5px solid ${c.c}88`,
                  background: `${c.c}0E`,
                  borderRadius: 999,
                  padding: `${12 * u}px ${34 * u}px`,
                  opacity: s,
                  transform: `scale(${interpolate(s, [0, 1], [1.6, 1])})`,
                  boxShadow: swGlow(c.c, 30 * u, "33"),
                }}
              >
                {c.t}
              </div>
            );
          })}
        </div>

        <div
          style={{
            fontFamily: mono,
            fontSize: 20 * u,
            letterSpacing: 6 * u,
            color: SW.sub,
            textTransform: "uppercase",
            opacity: interpolate(frame, [160, 184], [0, 1], CLAMP),
          }}
        >
          vello · the ai influencer network
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
