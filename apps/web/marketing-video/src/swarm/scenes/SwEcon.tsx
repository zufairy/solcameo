/**
 * SwEcon — the economics knockout. The agency bar towers, then the swarm
 * sliver lands next to it and the "cents per video" line stamps in.
 * Comparison is the most persuasive shape in motion graphics — keep it brutal.
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
import { display, mono, ui } from "../../lib/fonts";
import { useLayout } from "../../lib/layout";
import { KineticText, Eyebrow } from "../../components/KineticText";
import { CountUp } from "../../components/CountUp";
import { GlowPulse } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW, swGlow, swTextGlow } from "../theme";

export const SwEcon: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  const barMaxH = (portrait ? 430 : 480) * u;
  const agencyH = interpolate(frame, [26, 86], [0, barMaxH], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const swarmIn = spring({ frame: frame - 110, fps, config: SPRING_POP, from: 0, to: 1 });
  const stampIn = spring({ frame: frame - 168, fps, config: SPRING_POP, from: 0, to: 1 });

  const barW = (portrait ? 150 : 190) * u;

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={0.6} />
      <GlowPulse at={168} color={SW.volt} size={1300 * u} intensity={0.5} y={58} />

      <AbsoluteFill
        style={{
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: (portrait ? 50 : 130) * u,
          padding: 90 * u,
        }}
      >
        {/* headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24 * u,
            alignItems: portrait ? "center" : "flex-start",
            maxWidth: portrait ? 940 * u : 700 * u,
          }}
        >
          <Eyebrow start={4} size={20 * u} color={SW.sub}>
            the math brands can't ignore
          </Eyebrow>
          <KineticText
            start={12}
            stagger={5}
            align={portrait ? "center" : "left"}
            size={(portrait ? 72 : 96) * u}
            gradFrom={SW.volt}
            gradTo={SW.emerald}
            words={[
              { t: "Cents", grad: true },
              { t: "per" },
              { t: "video." },
            ]}
          />
          <div
            style={{
              fontFamily: ui,
              fontWeight: 500,
              fontSize: 32 * u,
              color: SW.sub,
              opacity: interpolate(frame, [40, 60], [0, 1], CLAMP),
              textAlign: portrait ? "center" : "left",
              lineHeight: 1.4,
            }}
          >
            Swarm scale at a price that makes
            <br />
            the agency line item look broken.
          </div>

          {/* 100x stamp */}
          <div
            style={{
              alignSelf: portrait ? "center" : "flex-start",
              fontFamily: display,
              fontWeight: 800,
              fontSize: 64 * u,
              color: SW.volt,
              textShadow: swTextGlow(SW.volt, 60 * u),
              border: `3px solid ${SW.volt}`,
              borderRadius: 18 * u,
              padding: `${8 * u}px ${28 * u}px`,
              transform: `rotate(-4deg) scale(${interpolate(stampIn, [0, 1], [2.2, 1])})`,
              opacity: stampIn,
              boxShadow: swGlow(SW.volt, 50 * u, "44"),
              background: `${SW.volt}0D`,
            }}
          >
            100× CHEAPER
          </div>
        </div>

        {/* bars */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 64 * u,
            height: barMaxH + 130 * u,
          }}
        >
          {/* agency */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 * u }}>
            <div
              style={{
                fontFamily: display,
                fontWeight: 800,
                fontSize: 40 * u,
                color: SW.red,
                opacity: interpolate(frame, [70, 86], [0, 1], CLAMP),
              }}
            >
              <CountUp value={50} start={30} duration={56} prefix="$" suffix="K/mo" />
            </div>
            <div
              style={{
                width: barW,
                height: agencyH,
                borderRadius: `${18 * u}px ${18 * u}px 6px 6px`,
                background: `linear-gradient(180deg, ${SW.red}CC, ${SW.red}55)`,
                border: `1px solid ${SW.red}88`,
                boxShadow: swGlow(SW.red, 40 * u, "33"),
              }}
            />
            <div style={{ fontFamily: mono, fontSize: 19 * u, letterSpacing: 3 * u, color: SW.sub }}>
              AGENCY
            </div>
          </div>

          {/* swarm */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 * u }}>
            <div
              style={{
                fontFamily: display,
                fontWeight: 800,
                fontSize: 40 * u,
                color: SW.volt,
                opacity: swarmIn,
                textShadow: swTextGlow(SW.volt, 36 * u),
              }}
            >
              ¢ / video
            </div>
            <div
              style={{
                width: barW,
                height: Math.max(10 * u, swarmIn * 26 * u),
                borderRadius: 8 * u,
                background: `linear-gradient(180deg, ${SW.volt}, ${SW.voltDeep})`,
                boxShadow: swGlow(SW.volt, 50 * u, "66"),
                transform: `scaleX(${interpolate(swarmIn, [0, 1], [0.3, 1])})`,
              }}
            />
            <div
              style={{
                fontFamily: mono,
                fontSize: 19 * u,
                letterSpacing: 3 * u,
                color: SW.voltSoft,
              }}
            >
              VELLO SWARM
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
