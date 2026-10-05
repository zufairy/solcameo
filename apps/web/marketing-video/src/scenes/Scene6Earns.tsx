/**
 * Scene 6 — IT EARNS (24–29s)
 * "And it earns on-chain." A grid of earning agent cards, USDC coins flowing,
 * earnings counting up, settled-on-Solana cue.
 */
import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { noise2D } from "@remotion/noise";
import { Background } from "../components/Background";
import { AgentCard } from "../components/AgentCard";
import { CountUp } from "../components/CountUp";
import { CLAMP, COLORS, SPRING, glow } from "../theme";
import { display, mono } from "../lib/fonts";
import { useLayout } from "../lib/layout";

/* floating USDC coin */
const Coin: React.FC<{ x: number; y: number; size: number; seed: number; delay: number }> = ({ x, y, size, seed, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - delay, fps, config: SPRING, from: 0, to: 1 });
  const float = noise2D("coin" + seed, frame / 70, 0) * 16;
  const spin = Math.sin(frame / 40 + seed) * 18;
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        opacity: pop * 0.95,
        transform: `translateY(${float}px) scale(${pop}) rotateY(${spin}deg)`,
      }}
    >
      <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: `radial-gradient(circle at 38% 34%, ${COLORS.emeraldSoft}, ${COLORS.emerald} 70%, #066047)`, border: `2px solid ${COLORS.emeraldSoft}`, boxShadow: glow(COLORS.emerald, size * 0.5, "77"), display: "flex", alignItems: "center", justifyContent: "center", fontFamily: display, fontWeight: 800, fontSize: size * 0.42, color: "#03241a" }}>
        $
      </div>
    </div>
  );
};

const AGENTS = [
  { avatar: "gen/agent-influencer.png", name: "Nova", handle: "@nova", accent: COLORS.violet, earn: 1280, op: "center 26%" },
  { avatar: "gen/agent-trader.png", name: "DegenJin", handle: "@jin", accent: COLORS.emerald, earn: 2110, op: "center 24%" },
  { avatar: "gen/agent-anime.png", name: "Mika", handle: "@mika", accent: COLORS.pink, earn: 760, op: "center 20%" },
  { avatar: "gen/agent-clipper.png", name: "ClipKing", handle: "@clip", accent: COLORS.lime, earn: 940, op: "center" },
];

export const Scene6Earns: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();
  const op = interpolate(frame, [0, 10, 288, 300], [0, 1, 1, 0], CLAMP);

  const titleO = interpolate(frame, [8, 26], [0, 1], CLAMP);
  const titleY = spring({ frame: frame - 4, fps, config: SPRING, from: 22 * u, to: 0 });

  const cardW = (portrait ? 420 : 300) * u;
  const total = AGENTS.reduce((a, b) => a + b.earn, 0);

  const coins = [
    { x: 10, y: 26, size: 70 * u, seed: 1, delay: 30 },
    { x: 88, y: 30, size: 54 * u, seed: 2, delay: 46 },
    { x: 16, y: 74, size: 46 * u, seed: 3, delay: 60 },
    { x: 82, y: 70, size: 64 * u, seed: 4, delay: 38 },
    { x: 50, y: 12, size: 40 * u, seed: 5, delay: 54 },
  ];

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: COLORS.bg }}>
      <Background intensity={0.85} warm />

      {/* flowing coins */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {coins.map((c) => (
          <Coin key={c.seed} {...c} />
        ))}
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 44 * u }}>
        {/* headline */}
        <div style={{ textAlign: "center", opacity: titleO, transform: `translateY(${titleY}px)` }}>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: (portrait ? 68 : 84) * u, color: COLORS.white, letterSpacing: -2 * u, textShadow: glow(COLORS.emerald, 50 * u, "33") }}>
            And it earns{" "}
            <span style={{ background: `linear-gradient(100deg, ${COLORS.emeraldSoft}, ${COLORS.lime})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              on-chain.
            </span>
          </div>
        </div>

        {/* earning grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: portrait ? "repeat(2, auto)" : "repeat(4, auto)",
            gap: portrait ? 24 * u : 26 * u,
          }}
        >
          {AGENTS.map((a, i) => {
            const delay = 24 + i * 8;
            const s = spring({ frame: frame - delay, fps, config: SPRING, from: 0, to: 1 });
            const fy = noise2D("af" + i, frame / 50, 0) * 5 * u;
            return (
              <div key={a.name} style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [40 * u, 0]) + fy}px) scale(${interpolate(s, [0, 1], [0.9, 1])})` }}>
                <AgentCard
                  avatar={a.avatar}
                  name={a.name}
                  handle={a.handle}
                  accent={a.accent}
                  w={cardW}
                  objectPosition={a.op}
                  live={false}
                  stat={<CountUp value={a.earn} start={delay + 8} duration={56} prefix="$" />}
                  statLabel="earned"
                />
              </div>
            );
          })}
        </div>

        {/* total + Solana cue */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 * u, opacity: interpolate(frame, [80, 100], [0, 1], CLAMP) }}>
          <div style={{ fontFamily: mono, fontSize: 22 * u, color: COLORS.sub }}>Paid out today</div>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 40 * u, color: COLORS.emeraldSoft, textShadow: glow(COLORS.emerald, 40 * u, "55") }}>
            <CountUp value={total} start={84} duration={60} prefix="$" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 * u, fontFamily: mono, fontSize: 16 * u, color: COLORS.emeraldSoft, background: `${COLORS.emerald}1a`, border: `1px solid ${COLORS.emerald}44`, borderRadius: 999, padding: `${8 * u}px ${16 * u}px` }}>
            <span style={{ width: 8 * u, height: 8 * u, borderRadius: "50%", background: COLORS.emeraldSoft, boxShadow: glow(COLORS.emerald, 10 * u) }} />
            Settled on Solana · USDC
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
