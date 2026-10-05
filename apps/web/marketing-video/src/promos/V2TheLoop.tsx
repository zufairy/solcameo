/**
 * V2 — "The Loop" · product explainer (30s, 16:9).
 * Angle: rational. Everyone else stops halfway; Vello closes the loop.
 * Visual: self-drawing pipeline diagram on plated tiles.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { Radar, Scissors, Send, BadgeCheck, Wallet } from "lucide-react";
import { SwarmBackground } from "../swarm/SwarmBackground";
import { Particles } from "../components/Particles";
import {
  SW, swTextGlow, CLAMP, SPRING_POP, display, mono,
  KineticText, Eyebrow, Plate, Pop, Chip, VoltLine, Outro, Finish,
} from "./kit";

const W = 1920;
const STEPS = [
  { icon: Radar, label: "FIND", sub: "scans every bounty board", at: 210 },
  { icon: Scissors, label: "CLIP", sub: "cuts the moment that hooks", at: 264 },
  { icon: Send, label: "POST", sub: "everywhere, staggered, safe", at: 318 },
  { icon: BadgeCheck, label: "VERIFY", sub: "views counted on-chain", at: 372 },
  { icon: Wallet, label: "GET PAID", sub: "payout lands, you withdraw", at: 426 },
] as const;

export const V2TheLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hookOut = interpolate(frame, [178, 198], [1, 0], CLAMP);
  const pipeIn = interpolate(frame, [196, 212], [0, 1], CLAMP);
  const pipeOut = interpolate(frame, [652, 676], [1, 0], CLAMP);

  /* connector draw progress across steps */
  const lineT = interpolate(frame, [224, 452], [0, 1], CLAMP);
  /* the loop pulse that travels the pipe after it's complete */
  const pulseT = ((frame - 460) / 90) % 1;

  const stepX = (i: number) => 280 + i * 340;

  return (
    <AbsoluteFill style={{ background: SW.bg }}>
      <SwarmBackground intensity={0.38} />
      <Particles count={18} color={SW.voltSoft} opacity={0.25} />

      {/* ── HOOK: the gap ── */}
      {frame < 200 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44, opacity: hookOut }}>
          <Pop at={4}><Eyebrow size={24} color={SW.volt}>THE PROBLEM</Eyebrow></Pop>
          <KineticText
            start={14} stagger={5} size={92} weight={700} maxWidth={1560}
            words={[
              { t: "Clip" }, { t: "tools" }, { t: "stop" }, { t: "at" }, { t: "editing.", color: SW.red },
            ]}
          />
          <KineticText
            start={64} stagger={5} size={92} weight={700} maxWidth={1560}
            words={[
              { t: "Schedulers" }, { t: "stop" }, { t: "at" }, { t: "posting.", color: SW.red },
            ]}
          />
          <KineticText
            start={116} stagger={4} size={64} weight={600} maxWidth={1500}
            words={[
              { t: "Nobody" }, { t: "finishes" }, { t: "the" }, { t: "job.", color: SW.sub },
            ]}
          />
        </AbsoluteFill>
      )}

      {/* ── THE LOOP ── */}
      {frame >= 196 && frame < 680 && (
        <AbsoluteFill style={{ opacity: Math.min(pipeIn, pipeOut) }}>
          <div style={{ position: "absolute", top: 96, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
            <Chip size={22}>VELLO CLOSES THE LOOP</Chip>
            <KineticText
              start={214} stagger={4} size={76} weight={700} maxWidth={1500}
              words={[
                { t: "One" }, { t: "agent." }, { t: "The" }, { t: "whole", color: SW.volt }, { t: "loop.", color: SW.volt },
              ]}
            />
          </div>

          {/* connector rail */}
          <div style={{ position: "absolute", top: 560, left: stepX(0), width: (stepX(4) - stepX(0)) * lineT, height: 3, background: `linear-gradient(90deg, ${SW.volt}, ${SW.voltSoft})`, boxShadow: `0 0 18px ${SW.volt}77` }} />
          {/* travelling pulse once loop is live */}
          {frame >= 460 && (
            <div
              style={{
                position: "absolute", top: 549,
                left: stepX(0) + (stepX(4) - stepX(0)) * pulseT - 12,
                width: 24, height: 24, borderRadius: 999,
                background: SW.voltSoft, boxShadow: `0 0 30px ${SW.volt}`,
              }}
            />
          )}

          {/* the five nodes */}
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const pop = spring({ frame: frame - s.at, fps, config: SPRING_POP, from: 0, to: 1 });
            return (
              <div key={s.label} style={{ position: "absolute", left: stepX(i) - 130, top: 430, width: 260, opacity: pop, transform: `translateY(${(1 - pop) * 44}px)` }}>
                <Plate glowColor={SW.volt} style={{ padding: "30px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 78, height: 78, borderRadius: 20, background: `${SW.volt}18`, border: `1.5px solid ${SW.volt}66`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={38} color={SW.volt} strokeWidth={2} />
                  </div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: SW.white, letterSpacing: 1 }}>{s.label}</div>
                  <div style={{ fontFamily: mono, fontSize: 16.5, color: SW.sub, textAlign: "center", lineHeight: 1.45 }}>{s.sub}</div>
                </Plate>
                <div style={{ fontFamily: mono, fontSize: 18, color: SW.faint, textAlign: "center", marginTop: 14 }}>0{i + 1}</div>
              </div>
            );
          })}

          {/* punchline under the rail */}
          <div style={{ position: "absolute", bottom: 120, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            <VoltLine at={492} width={520} />
            <KineticText
              start={505} stagger={5} size={70} weight={700} maxWidth={1400}
              words={[
                { t: "You" }, { t: "just" }, { t: "withdraw.", color: SW.volt },
              ]}
            />
            <Pop at={560}>
              <Chip size={20} color={SW.emerald} filled={false}>MISSED DEADLINES: 0 · REJECTED CLIPS: 0 · HANDS ON KEYBOARD: 0</Chip>
            </Pop>
          </div>
        </AbsoluteFill>
      )}

      <Outro at={684} cta="Close your loop — free for 30 days" />
      <Finish />
    </AbsoluteFill>
  );
};
