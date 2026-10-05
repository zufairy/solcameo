/**
 * SwSwarm — the payoff shot. The cinematic swarm render breathes underneath
 * (slow push-in), agent tiles burst outward from center in a radial wave,
 * and the 200 VIDEOS / DAY counter slams in over the top.
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
import { Eyebrow } from "../../components/KineticText";
import { CountUp } from "../../components/CountUp";
import { GlowPulse } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW, AGENT_TINTS, swGlow, swTextGlow } from "../theme";

const AVATARS = [
  "gen/agent-influencer.png",
  "gen/agent-clipper.png",
  "gen/agent-anime.png",
  "gen/agent-trader.png",
] as const;

const rand = (i: number, salt = 0) => {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const TILES = 22;
const BURST = 26; // frame the radial wave starts
const COUNTER = 150; // frame the 200/day counter slams

export const SwSwarm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, width, height } = useLayout();

  const bgScale = interpolate(frame, [0, 390], [1.06, 1.18], CLAMP);
  const bgO = interpolate(frame, [0, 30], [0, 0.5], CLAMP);

  const counterIn = spring({
    frame: frame - COUNTER,
    fps,
    config: SPRING_POP,
    from: 0,
    to: 1,
  });
  const dim = interpolate(frame, [COUNTER - 10, COUNTER + 8], [1, 0.4], CLAMP);

  const maxR = Math.hypot(width, height) * 0.46;

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={0.8} />

      {/* cinematic swarm plate */}
      <AbsoluteFill style={{ opacity: bgO, overflow: "hidden" }}>
        <Img
          src={staticFile("gen/swarm.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${bgScale})`,
            filter: "saturate(1.15) brightness(0.85)",
          }}
        />
        <AbsoluteFill
          style={{
            background: `radial-gradient(70% 65% at 50% 55%, transparent 30%, ${SW.bg}EE 100%)`,
          }}
        />
      </AbsoluteFill>

      {/* radial agent-tile burst */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: dim }}>
        {Array.from({ length: TILES }).map((_, i) => {
          const angle = (i / TILES) * Math.PI * 2 + rand(i, 1) * 0.5;
          const dist = (0.4 + rand(i, 2) * 0.6) * maxR;
          const delay = BURST + Math.floor(rand(i, 3) * 46);
          const s = spring({
            frame: frame - delay,
            fps,
            config: { damping: 30, mass: 0.9, stiffness: 130 },
            from: 0,
            to: 1,
          });
          const drift = Math.sin(frame / 34 + i * 1.7) * 9 * u;
          const x = Math.cos(angle) * dist * s;
          const y = Math.sin(angle) * dist * s * (portrait ? 1.25 : 0.86);
          const size = (54 + rand(i, 4) * 56) * u;
          const tint = AGENT_TINTS[i % AGENT_TINTS.length];
          const rot = (rand(i, 5) - 0.5) * 14 * (1 - s * 0.6);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                width: size,
                height: size * 1.32,
                borderRadius: size * 0.18,
                overflow: "hidden",
                border: `1.5px solid ${tint}AA`,
                boxShadow: `0 ${8 * u}px ${26 * u}px rgba(0,0,0,0.55), ${swGlow(tint, size * 0.45, "44")}`,
                opacity: s * interpolate(dist * 1, [0, maxR], [1, 0.85]),
                transform: `translate(${x}px, ${y + drift}px) scale(${interpolate(s, [0, 1], [0.3, 1])}) rotate(${rot}deg)`,
              }}
            >
              <Img
                src={staticFile(AVATARS[i % AVATARS.length])}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(180deg, transparent 55%, ${tint}33)`,
                }}
              />
            </div>
          );
        })}
      </AbsoluteFill>

      <GlowPulse at={COUNTER} color={SW.volt} size={1600 * u} intensity={0.55} />

      {/* headline + counter */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18 * u,
          }}
        >
          <div style={{ opacity: interpolate(frame, [8, 26], [0, 1], CLAMP) }}>
            <Eyebrow start={8} size={21 * u} color={SW.voltSoft}>
              step 02 — the swarm answers
            </Eyebrow>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 24 * u,
              opacity: counterIn,
              transform: `scale(${interpolate(counterIn, [0, 1], [1.5, 1])})`,
            }}
          >
            <span
              style={{
                fontFamily: display,
                fontWeight: 800,
                fontSize: (portrait ? 200 : 250) * u,
                lineHeight: 0.95,
                letterSpacing: -8 * u,
                color: SW.volt,
                textShadow: swTextGlow(SW.volt, 100 * u),
              }}
            >
              <CountUp value={200} start={COUNTER} duration={55} />
            </span>
            <span
              style={{
                fontFamily: display,
                fontWeight: 800,
                fontSize: (portrait ? 54 : 66) * u,
                color: SW.white,
                lineHeight: 1.05,
                textAlign: "left",
                textShadow: "0 2px 30px rgba(0,0,0,0.7)",
              }}
            >
              videos
              <br />/ day
            </span>
          </div>

          <div
            style={{
              fontFamily: mono,
              fontSize: 23 * u,
              letterSpacing: 7 * u,
              textTransform: "uppercase",
              color: SW.sub,
              opacity: interpolate(frame, [COUNTER + 40, COUNTER + 60], [0, 1], CLAMP),
            }}
          >
            one bounty · an army of creators
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
