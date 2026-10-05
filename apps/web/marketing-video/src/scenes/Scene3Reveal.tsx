/**
 * Scene 3 — THE REVEAL (7–12s)
 * "Meet your AI influencer." An illustrated avatar assembles from particles
 * inside a glowing agent card. Violet energy, confident.
 *
 * The card materializes: particles converge, the avatar resolves out of blur,
 * a neon ring draws around it, and it settles with a violet bloom.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { Background } from "../components/Background";
import { Particles } from "../components/Particles";
import { GlowPulse } from "../components/GlowPulse";
import { AgentCard } from "../components/AgentCard";
import { KineticText, Eyebrow } from "../components/KineticText";
import { CLAMP, COLORS, SPRING, glow } from "../theme";
import { ui } from "../lib/fonts";
import { useLayout } from "../lib/layout";

/* particles that fly INWARD and condense into the card */
const Converge: React.FC<{ cx: number; cy: number; until: number }> = ({
  cx,
  cy,
  until,
}) => {
  const frame = useCurrentFrame();
  const seed = (i: number, s = 0) => {
    const x = Math.sin((i + 1) * 17.13 + s * 31.7) * 9999;
    return x - Math.floor(x);
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: 60 }).map((_, i) => {
        const ang = seed(i, 1) * Math.PI * 2;
        const rad = 360 + seed(i, 2) * 520;
        const p = interpolate(frame, [0, until], [1, 0], {
          ...CLAMP,
          easing: (t) => 1 - Math.pow(1 - t, 3),
        });
        const x = cx + Math.cos(ang) * rad * p;
        const y = cy + Math.sin(ang) * rad * p;
        const o = interpolate(frame, [0, until * 0.4, until], [0, 0.9, 0], CLAMP);
        const sz = 2 + seed(i, 3) * 3;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: sz,
              height: sz,
              borderRadius: "50%",
              background: COLORS.violetSoft,
              opacity: o,
              boxShadow: `0 0 ${sz * 4}px ${COLORS.violet}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const Scene3Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { u, portrait } = useLayout();

  const op = interpolate(frame, [0, 10, 288, 300], [0, 1, 1, 0], CLAMP);

  // card materialization
  const a = spring({ frame: frame - 24, fps, config: SPRING, from: 0, to: 1 });
  const cardScale = interpolate(a, [0, 1], [0.82, 1]);
  const cardBlur = interpolate(a, [0, 1], [16, 0]);
  const ring = interpolate(frame, [24, 70], [0, 1], CLAMP);

  const cardW = (portrait ? 480 : 430) * u;
  // approximate card center for converge origin
  const cx = portrait ? width / 2 : width * 0.7;
  const cy = portrait ? height * 0.62 : height / 2;

  const titleSize = (portrait ? 88 : 96) * u;

  const TextBlock = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18 * u,
        alignItems: portrait ? "center" : "flex-start",
        textAlign: portrait ? "center" : "left",
      }}
    >
      <Eyebrow start={6} size={24 * u} color={COLORS.violetSoft}>
        Meet your
      </Eyebrow>
      <KineticText
        start={12}
        stagger={6}
        size={titleSize}
        align={portrait ? "center" : "left"}
        words={[{ t: "AI" }, { t: "influencer", grad: true }]}
        gradFrom={COLORS.violetSoft}
        gradTo={COLORS.violet}
        maxWidth={700 * u}
      />
      <div
        style={{
          fontFamily: ui,
          fontSize: 26 * u,
          color: COLORS.sub,
          maxWidth: 460 * u,
          opacity: interpolate(frame, [40, 60], [0, 1], CLAMP),
          lineHeight: 1.4,
        }}
      >
        Built in minutes. Has a face, a voice, and a point of view.
      </div>
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: COLORS.bg }}>
      <Background intensity={1} />
      <Particles count={40} color={COLORS.violetSoft} opacity={0.4} />
      <Converge cx={cx} cy={cy} until={56} />

      <AbsoluteFill
        style={{
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: portrait ? 56 * u : 110 * u,
          padding: portrait ? "0 70px" : "0 130px",
        }}
      >
        {!portrait && TextBlock}
        <div
          style={{
            position: "relative",
            transform: `scale(${cardScale})`,
            filter: `blur(${cardBlur}px)`,
            opacity: a,
          }}
        >
          {/* expanding neon ring behind the card */}
          <div
            style={{
              position: "absolute",
              inset: -50 * u,
              borderRadius: 60 * u,
              border: `2px solid ${COLORS.violet}`,
              opacity: ring * 0.6,
              transform: `scale(${interpolate(ring, [0, 1], [0.7, 1.05])})`,
              boxShadow: glow(COLORS.violet, 60 * u, "55"),
            }}
          />
          <AgentCard
            avatar="gen/agent-influencer.png"
            name="Nova"
            handle="@nova.live"
            accent={COLORS.violet}
            w={cardW}
            objectPosition="center 26%"
            stat="1.2M"
            statLabel="followers"
            glowStrength={0.9}
          />
        </div>
        {portrait && TextBlock}
      </AbsoluteFill>

      <GlowPulse at={24} color={COLORS.violet} intensity={0.7} x={(cx / width) * 100} y={(cy / height) * 100} size={1300 * u} />
    </AbsoluteFill>
  );
};
