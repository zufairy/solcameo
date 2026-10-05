/**
 * SwMarket — the skills & tools marketplace. A wave of skill tiles cascades
 * in (each with its own tint + icon glyph), INSTALL pips flick on, and the
 * "unlimited styles" line closes the argument.
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
import { GlowPulse, LightSweep } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW, AGENT_TINTS, swGlow } from "../theme";

const SKILLS = [
  { t: "HOOK LAB", g: "◇" },
  { t: "AUTO-EDIT", g: "✂" },
  { t: "VOICE PACKS", g: "♪" },
  { t: "TREND RADAR", g: "◎" },
  { t: "B-ROLL GEN", g: "▣" },
  { t: "CAPTION FX", g: "¶" },
  { t: "PERSONA STUDIO", g: "✦" },
  { t: "SOUND PACKS", g: "≋" },
  { t: "THUMB SMITH", g: "▲" },
  { t: "REMIX ENGINE", g: "↻" },
  { t: "LIP-SYNC PRO", g: "◉" },
  { t: "STORY ARCS", g: "∿" },
] as const;

export const SwMarket: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  const cols = portrait ? 3 : 4;
  const tileW = (portrait ? 300 : 330) * u;
  const tileH = 120 * u;

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={0.7} cool />
      <GlowPulse at={16} color={SW.violet} size={1400 * u} intensity={0.35} y={40} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 44 * u,
          padding: 80 * u,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
          <Eyebrow start={4} size={20 * u} color={SW.violet}>
            for builders
          </Eyebrow>
          <KineticText
            start={12}
            stagger={4}
            size={(portrait ? 60 : 80) * u}
            gradFrom={SW.violet}
            gradTo={SW.volt}
            words={[
              { t: "A" },
              { t: "marketplace", grad: true },
              { t: "of" },
              { t: "skills" },
              { t: "&" },
              { t: "tools." },
            ]}
          />
        </div>

        {/* tile wave */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, ${tileW}px)`,
            gap: 22 * u,
          }}
        >
          {SKILLS.map((sk, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const delay = 34 + (row + col) * 9; // diagonal wave
            const s = spring({
              frame: frame - delay,
              fps,
              config: SPRING_POP,
              from: 0,
              to: 1,
            });
            const tint = AGENT_TINTS[i % AGENT_TINTS.length];
            const installed = frame > delay + 46;
            const pulse = 1 + 0.05 * Math.sin(frame / 22 + i * 1.3);
            return (
              <div
                key={sk.t}
                style={{
                  width: tileW,
                  height: tileH,
                  borderRadius: 22 * u,
                  border: `1px solid ${installed ? `${tint}88` : SW.border}`,
                  background: `linear-gradient(160deg, ${SW.cardHi}EE, ${SW.card}EE)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 18 * u,
                  padding: `0 ${22 * u}px`,
                  opacity: s,
                  position: "relative",
                  overflow: "hidden",
                  transform: `translateY(${interpolate(s, [0, 1], [70 * u, 0])}px) scale(${interpolate(s, [0, 1], [0.8, 1]) * (installed ? pulse : 1)})`,
                  boxShadow: installed
                    ? `0 ${10 * u}px ${34 * u}px rgba(0,0,0,0.5), ${swGlow(tint, 34 * u, "3A")}`
                    : `0 ${10 * u}px ${30 * u}px rgba(0,0,0,0.45)`,
                }}
              >
                <div
                  style={{
                    width: 58 * u,
                    height: 58 * u,
                    borderRadius: 15 * u,
                    background: `${tint}1C`,
                    border: `1px solid ${tint}66`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 28 * u,
                    color: tint,
                    fontFamily: ui,
                  }}
                >
                  {sk.g}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 * u }}>
                  <div
                    style={{
                      fontFamily: display,
                      fontWeight: 700,
                      fontSize: 22 * u,
                      letterSpacing: 1.5 * u,
                      color: SW.white,
                    }}
                  >
                    {sk.t}
                  </div>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 14 * u,
                      letterSpacing: 2 * u,
                      color: installed ? tint : SW.faint,
                      display: "flex",
                      alignItems: "center",
                      gap: 7 * u,
                    }}
                  >
                    <span
                      style={{
                        width: 8 * u,
                        height: 8 * u,
                        borderRadius: "50%",
                        background: installed ? tint : SW.faint,
                        boxShadow: installed ? `0 0 ${8 * u}px ${tint}` : undefined,
                        display: "inline-block",
                      }}
                    />
                    {installed ? "INSTALLED" : "INSTALL"}
                  </div>
                </div>
                <LightSweep start={delay + 40} dur={26} />
              </div>
            );
          })}
        </div>

        <div
          style={{
            fontFamily: mono,
            fontSize: 23 * u,
            letterSpacing: 7 * u,
            textTransform: "uppercase",
            color: SW.voltSoft,
            opacity: interpolate(frame, [200, 224], [0, 1], CLAMP),
          }}
        >
          unlimited styles · install and go
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
