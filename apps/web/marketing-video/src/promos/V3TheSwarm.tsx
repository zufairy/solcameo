/**
 * V3 — "The Swarm" · scale & awe film (30s, 16:9).
 * Angle: spectacle. One creator vs a swarm of 200 unique AI creators.
 * Visual: card multiplication grid + orbital swarm + market countups.
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate, random,
} from "remotion";
import { SwarmBackground } from "../swarm/SwarmBackground";
import { GlowPulse } from "../components/GlowPulse";
import { CountUp } from "../components/CountUp";
import {
  SW, swTextGlow, CLAMP, SPRING_POP, display, mono,
  KineticText, Eyebrow, Plate, Pop, Chip, VoltLine, Outro, Finish,
} from "./kit";

const W = 1920, H = 1080;
const AVATARS = [
  "gen/agent-influencer.png", "gen/agent-clipper.png",
  "gen/agent-trader.png", "gen/agent-anime.png",
];
const TINTS = [SW.volt, SW.cyan, SW.violet, SW.pink, SW.amber, SW.emerald];

/* grid of agent tiles that floods in */
const GRID_COLS = 10, GRID_ROWS = 4;
const AgentTile: React.FC<{ i: number; at: number }> = ({ i, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const col = i % GRID_COLS, row = Math.floor(i / GRID_COLS);
  const delay = at + (col + row * 1.6) * 2.4 + random(`d${i}`) * 5;
  const s = spring({ frame: frame - delay, fps, config: { damping: 13, mass: 0.6 }, from: 0, to: 1 });
  const tint = TINTS[i % TINTS.length];
  const bob = Math.sin(frame / 16 + i) * 3;
  const size = 132;
  return (
    <div
      style={{
        position: "absolute",
        left: 150 + col * 165,
        top: 300 + row * 165 + bob,
        width: size, height: size, borderRadius: 26,
        background: SW.card,
        border: `1.5px solid ${tint}55`,
        boxShadow: `inset 0 1.5px 0 rgba(255,255,255,0.07), 0 0 26px ${tint}22`,
        opacity: s,
        transform: `scale(${0.5 + 0.5 * s})`,
        overflow: "hidden",
      }}
    >
      <Img src={staticFile(AVATARS[i % AVATARS.length])} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.9, filter: `hue-rotate(${(i * 37) % 60 - 30}deg)` }} />
      <div style={{ position: "absolute", bottom: 6, right: 8, width: 10, height: 10, borderRadius: 99, background: tint, boxShadow: `0 0 10px ${tint}` }} />
    </div>
  );
};

/* orbiting dots for the finale swarm */
const Orbiter: React.FC<{ i: number; at: number }> = ({ i, at }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0) return null;
  const rad = 190 + (i % 5) * 62 + random(`r${i}`) * 30;
  const speed = 0.014 + (i % 7) * 0.0035;
  const ang = random(`a${i}`) * Math.PI * 2 + t * speed;
  const x = W / 2 + Math.cos(ang) * rad * 1.35;
  const y = 470 + Math.sin(ang) * rad * 0.62;
  const tint = TINTS[i % TINTS.length];
  const o = interpolate(t, [0, 18], [0, 0.95], CLAMP);
  const sz = 7 + (i % 4) * 3.5;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: sz, height: sz, borderRadius: 99, background: tint, boxShadow: `0 0 ${sz * 1.8}px ${tint}`, opacity: o * (Math.sin(ang) > 0 ? 1 : 0.55) }} />
  );
};

export const V3TheSwarm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hookOut = interpolate(frame, [156, 176], [1, 0], CLAMP);
  const gridIn = interpolate(frame, [172, 190], [0, 1], CLAMP);
  const gridOut = interpolate(frame, [416, 438], [1, 0], CLAMP);
  const orbitIn = interpolate(frame, [432, 452], [0, 1], CLAMP);
  const orbitOut = interpolate(frame, [688, 712], [1, 0], CLAMP);

  return (
    <AbsoluteFill style={{ background: SW.bg }}>
      <SwarmBackground intensity={0.45} />

      {/* ── HOOK: 1 vs 200 ── */}
      {frame < 180 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 42, opacity: hookOut }}>
          <KineticText
            start={8} stagger={5} size={84} weight={600} maxWidth={1500}
            words={[
              { t: "A" }, { t: "creator" }, { t: "posts" }, { t: "3" }, { t: "clips" }, { t: "a" }, { t: "day." },
            ]}
          />
          <div
            style={{
              fontFamily: display, fontWeight: 700, fontSize: 300, letterSpacing: -10,
              color: SW.volt, textShadow: swTextGlow(SW.volt, 70),
              transform: `scale(${spring({ frame: frame - 78, fps, config: SPRING_POP, from: 0.7, to: 1 })})`,
              opacity: spring({ frame: frame - 78, fps, config: SPRING_POP, from: 0, to: 1 }),
              lineHeight: 0.9,
            }}
          >
            200
          </div>
          <KineticText
            start={96} stagger={4} size={70} weight={600}
            words={[{ t: "A" }, { t: "swarm", color: SW.volt }, { t: "posts" }, { t: "two" }, { t: "hundred." }]}
          />
        </AbsoluteFill>
      )}

      {/* ── THE FLOOD (grid) ── */}
      {frame >= 172 && frame < 440 && (
        <AbsoluteFill style={{ opacity: Math.min(gridIn, gridOut) }}>
          <div style={{ position: "absolute", top: 96, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
            <Chip size={22}>THE SWARM</Chip>
            <KineticText
              start={188} stagger={4} size={72} weight={700} maxWidth={1560}
              words={[
                { t: "Every" }, { t: "agent" }, { t: "unique.", color: SW.volt },
                { t: "Face." }, { t: "Voice." }, { t: "Memory.", color: SW.volt },
              ]}
            />
          </div>
          {Array.from({ length: GRID_COLS * GRID_ROWS }, (_, i) => (
            <AgentTile key={i} i={i} at={206} />
          ))}
          <div style={{ position: "absolute", bottom: 74, width: "100%", display: "flex", justifyContent: "center" }}>
            <Pop at={330}>
              <Chip size={21} color={SW.sub}>NO TEMPLATES · NO TWO VIDEOS ALIKE · ANTI-SLOP BY CONSTRUCTION</Chip>
            </Pop>
          </div>
        </AbsoluteFill>
      )}

      {/* ── ORBIT + MARKET ── */}
      {frame >= 432 && frame < 716 && (
        <AbsoluteFill style={{ opacity: Math.min(orbitIn, orbitOut) }}>
          <GlowPulse at={446} color={SW.volt} size={1400} intensity={0.5} />
          {/* core glyph */}
          <div style={{ position: "absolute", left: W / 2 - 92, top: 380, width: 184, height: 184, borderRadius: 46, overflow: "hidden", boxShadow: `0 0 80px ${SW.volt}66` }}>
            <Img src={staticFile("brand/vellosquare.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          {Array.from({ length: 64 }, (_, i) => <Orbiter key={i} i={i} at={446} />)}

          <div style={{ position: "absolute", top: 110, width: "100%", display: "flex", justifyContent: "center" }}>
            <KineticText
              start={452} stagger={4} size={72} weight={700} maxWidth={1500}
              words={[
                { t: "Built" }, { t: "for" }, { t: "a" },
                { t: "$152B", color: SW.volt }, { t: "market." },
              ]}
            />
          </div>

          {/* market stat plates */}
          <div style={{ position: "absolute", bottom: 96, width: "100%", display: "flex", justifyContent: "center", gap: 40 }}>
            {[
              { at: 520, label: "INFLUENCER MARKET BY 2031", v: 152, prefix: "$", suffix: "B" },
              { at: 560, label: "ENGAGEMENT VS HUMAN CREATORS", v: 3, prefix: "", suffix: "×" },
              { at: 600, label: "BRANDS ALREADY USING AI PERSONAS", v: 73, prefix: "", suffix: "%" },
            ].map((s, i) => (
              <Pop key={i} at={s.at}>
                <Plate glowColor={SW.volt} style={{ padding: "28px 42px", minWidth: 380, textAlign: "center" }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 76, color: SW.white }}>
                    <CountUp value={s.v} start={s.at + 5} duration={40} prefix={s.prefix} suffix={s.suffix} />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: SW.sub, marginTop: 8 }}>{s.label}</div>
                </Plate>
              </Pop>
            ))}
          </div>
        </AbsoluteFill>
      )}

      <Outro at={720} cta="Own a piece of the swarm — free for 30 days" />
      <Finish />
    </AbsoluteFill>
  );
};
