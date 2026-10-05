/**
 * SwLogo — the vello reveal using the real wordmark (public/brand/lo.png).
 * Glyph-led entrance: scale-settle spring, expanding volt ring, light sweep
 * across the wordmark, then the positioning line tracks in underneath.
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
import { mono } from "../../lib/fonts";
import { useLayout } from "../../lib/layout";
import { Eyebrow } from "../../components/KineticText";
import { Particles } from "../../components/Particles";
import { GlowPulse, LightSweep } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW } from "../theme";

export const SwLogo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  const enter = spring({ frame: frame - 10, fps, config: SPRING_POP, from: 0, to: 1 });
  const settle = spring({
    frame: frame - 10,
    fps,
    config: { damping: 200, mass: 1, stiffness: 120 },
    from: 0,
    to: 1,
  });

  const logoW = (portrait ? 760 : 880) * u;
  const scale = interpolate(enter, [0, 1], [1.35, 1]);
  const blur = interpolate(enter, [0, 1], [14, 0], CLAMP);

  // expanding ring on the landing beat
  const ringP = interpolate(frame, [16, 64], [0, 1], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });
  const ringO = interpolate(frame, [16, 26, 64], [0, 0.8, 0], CLAMP);

  // tagline
  const tagO = interpolate(frame, [76, 96], [0, 1], CLAMP);
  const tagLS = interpolate(frame, [76, 116], [22 * u, 11 * u], CLAMP);

  // slow exhale drift so the resting logo never sits dead
  const breathe = Math.sin(frame / 38) * 4 * u;

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={1} />
      <Particles count={34} color={SW.voltSoft} opacity={0.4} burstAt={14} />
      <GlowPulse at={14} color={SW.volt} size={1700 * u} intensity={0.6} />

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        {/* volt ring */}
        <div
          style={{
            position: "absolute",
            width: 320 * u + ringP * 1500 * u,
            height: 320 * u + ringP * 1500 * u,
            borderRadius: "50%",
            border: `${Math.max(1, 5 * (1 - ringP))}px solid ${SW.volt}`,
            opacity: ringO,
            boxShadow: `0 0 ${60 * u}px ${SW.volt}55, inset 0 0 ${40 * u}px ${SW.volt}33`,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 44 * u,
            transform: `translateY(${breathe}px)`,
          }}
        >
          <div
            style={{
              position: "relative",
              opacity: enter,
              transform: `scale(${scale})`,
              filter: `blur(${blur}px) drop-shadow(0 0 ${46 * u}px ${SW.volt}66) drop-shadow(0 ${10 * u}px ${60 * u}px rgba(0,0,0,0.6))`,
              overflow: "hidden",
              borderRadius: 8 * u,
            }}
          >
            <Img
              src={staticFile("brand/lo.png")}
              style={{ width: logoW, display: "block" }}
            />
            <LightSweep start={34} dur={36} />
          </div>

          <div
            style={{
              fontFamily: mono,
              fontSize: 26 * u,
              letterSpacing: tagLS,
              textTransform: "uppercase",
              color: SW.white,
              opacity: tagO,
              textShadow: `0 0 ${30 * u}px ${SW.volt}44`,
            }}
          >
            the&nbsp;ai&nbsp;influencer&nbsp;network
          </div>

          <div style={{ opacity: interpolate(settle, [0.7, 1], [0, 1], CLAMP) }}>
            <Eyebrow start={120} size={19 * u} color={SW.faint}>
              brands&nbsp;·&nbsp;builders&nbsp;·&nbsp;investors
            </Eyebrow>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
