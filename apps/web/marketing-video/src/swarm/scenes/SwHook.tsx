/**
 * SwHook — the flip. "One creator posts 3 clips a day. A swarm posts 200."
 * Beat 1 lands quiet and human; beat 2 detonates with the volt number.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { CLAMP, SPRING_POP } from "../../theme";
import { display, mono } from "../../lib/fonts";
import { useLayout } from "../../lib/layout";
import { KineticText, Eyebrow } from "../../components/KineticText";
import { Particles } from "../../components/Particles";
import { GlowPulse } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW, swTextGlow } from "../theme";

const BEAT2 = 118; // frame where the swarm line detonates

export const SwHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  // beat 1 dims + drifts up once beat 2 hits
  const b1Fade = interpolate(frame, [BEAT2 - 8, BEAT2 + 6], [1, 0.16], CLAMP);
  const b1Up = interpolate(frame, [BEAT2 - 8, BEAT2 + 10], [0, -56 * u], CLAMP);

  // giant 200 pops on beat 2
  const s200 = spring({
    frame: frame - BEAT2,
    fps,
    config: SPRING_POP,
    from: 0,
    to: 1,
  });
  const shake = interpolate(
    frame,
    [BEAT2, BEAT2 + 3, BEAT2 + 6, BEAT2 + 9],
    [0, 7, -4, 0],
    CLAMP,
  );

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={0.5} />
      <Particles count={26} color={SW.voltSoft} opacity={0.35} />
      <GlowPulse at={BEAT2} color={SW.volt} size={1500 * u} intensity={0.5} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: 80 * u,
          transform: `translateX(${shake}px)`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 26 * u,
          }}
        >
          <Eyebrow start={4} size={21 * u} color={SW.sub}>
            the creator economy just flipped
          </Eyebrow>

          <div
            style={{
              opacity: b1Fade,
              transform: `translateY(${b1Up}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6 * u,
            }}
          >
            <KineticText
              start={18}
              stagger={5}
              size={(portrait ? 62 : 74) * u}
              weight={700}
              words={[
                { t: "One" },
                { t: "creator" },
                { t: "posts" },
                { t: "3" },
                { t: "clips" },
                { t: "a" },
                { t: "day." },
              ]}
            />
          </div>

          {/* Beat 2 — the detonation */}
          <div
            style={{
              display: "flex",
              flexDirection: portrait ? "column" : "row",
              alignItems: "center",
              gap: portrait ? 8 * u : 34 * u,
              opacity: s200,
            }}
          >
            <KineticText
              start={BEAT2}
              stagger={4}
              size={(portrait ? 78 : 96) * u}
              words={[{ t: "A" }, { t: "swarm" }, { t: "posts" }]}
            />
            <div
              style={{
                fontFamily: display,
                fontWeight: 800,
                fontSize: (portrait ? 170 : 210) * u,
                lineHeight: 0.95,
                letterSpacing: -6 * u,
                color: SW.volt,
                textShadow: swTextGlow(SW.volt, 90 * u),
                transform: `scale(${interpolate(s200, [0, 1], [1.7, 1])})`,
              }}
            >
              200
            </div>
          </div>

          <div
            style={{
              fontFamily: mono,
              fontSize: 24 * u,
              letterSpacing: 10 * u,
              textTransform: "uppercase",
              color: SW.voltSoft,
              opacity: interpolate(frame, [BEAT2 + 26, BEAT2 + 44], [0, 1], CLAMP),
            }}
          >
            every single day
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
