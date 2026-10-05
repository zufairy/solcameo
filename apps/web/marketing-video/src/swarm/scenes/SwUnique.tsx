/**
 * SwUnique — "No two videos look alike." Three phone-frame creators float in
 * 3D parallax, each with its own face, tint, and caption style; the
 * MEMORY / PERSONA / CONTROL chips stamp in to explain why.
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
import { display, mono, ui } from "../../lib/fonts";
import { useLayout } from "../../lib/layout";
import { KineticText, Eyebrow } from "../../components/KineticText";
import { SwarmBackground } from "../SwarmBackground";
import { GlowPulse } from "../../components/GlowPulse";
import { SW, swGlow } from "../theme";

const PHONES = [
  {
    img: "gen/agent-influencer.png",
    tint: SW.volt,
    handle: "@nova.builds",
    caption: "day 47 of building in public",
    followers: "112K",
  },
  {
    img: "gen/agent-anime.png",
    tint: SW.cyan,
    handle: "@yumi.clips",
    caption: "this brand actually surprised me",
    followers: "86K",
  },
  {
    img: "gen/agent-clipper.png",
    tint: SW.violet,
    handle: "@reelsmith",
    caption: "POV: your ad budget meets math",
    followers: "203K",
  },
] as const;

const CHIPS = [
  { t: "MEMORY", d: "remembers what worked", c: SW.volt },
  { t: "PERSONA", d: "authored by its builder", c: SW.cyan },
  { t: "CONTROL", d: "you direct every agent", c: SW.violet },
] as const;

export const SwUnique: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  const phoneW = (portrait ? 250 : 300) * u;
  const phoneH = phoneW * 1.78;

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={0.65} cool />
      <GlowPulse at={20} color={SW.cyan} size={1300 * u} intensity={0.35} y={42} />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 40 * u,
          flexDirection: "column",
          padding: 70 * u,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 * u }}>
          <Eyebrow start={4} size={20 * u} color={SW.sub}>
            unique by construction
          </Eyebrow>
          <KineticText
            start={12}
            stagger={4}
            size={(portrait ? 64 : 84) * u}
            gradFrom={SW.cyan}
            gradTo={SW.volt}
            words={[
              { t: "No" },
              { t: "two" },
              { t: "videos" },
              { t: "look" },
              { t: "alike.", grad: true },
            ]}
          />
        </div>

        {/* phone trio */}
        <div
          style={{
            display: "flex",
            gap: (portrait ? 26 : 56) * u,
            alignItems: "center",
            transform: portrait ? `scale(0.92)` : undefined,
          }}
        >
          {PHONES.map((p, i) => {
            const enter = spring({
              frame: frame - (34 + i * 12),
              fps,
              config: SPRING_POP,
              from: 0,
              to: 1,
            });
            const float = Math.sin(frame / 42 + i * 2.2) * 9 * u;
            const tiltY = (i - 1) * 9;
            const lift = i === 1 ? -22 * u : 0;
            return (
              <div
                key={p.handle}
                style={{
                  width: phoneW,
                  height: phoneH,
                  borderRadius: phoneW * 0.12,
                  overflow: "hidden",
                  position: "relative",
                  border: `2px solid ${p.tint}99`,
                  background: SW.card,
                  boxShadow: `0 ${26 * u}px ${70 * u}px rgba(0,0,0,0.65), ${swGlow(p.tint, 50 * u, "3A")}`,
                  opacity: enter,
                  transform: `perspective(1400px) rotateY(${tiltY}deg) translateY(${interpolate(enter, [0, 1], [120 * u, 0]) + float + lift}px) scale(${interpolate(enter, [0, 1], [0.85, 1])})`,
                }}
              >
                <Img
                  src={staticFile(p.img)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                {/* UI chrome overlay */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 22%, transparent 55%, rgba(0,0,0,0.82) 100%)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: 16 * u,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontFamily: mono,
                      fontSize: 14 * u,
                      color: SW.white,
                      letterSpacing: 1 * u,
                    }}
                  >
                    <span style={{ color: p.tint }}>● REC</span>
                    <span>{p.followers}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 * u }}>
                    <div
                      style={{
                        fontFamily: ui,
                        fontWeight: 700,
                        fontSize: 19 * u,
                        color: p.tint,
                      }}
                    >
                      {p.handle}
                    </div>
                    <div
                      style={{
                        fontFamily: ui,
                        fontWeight: 500,
                        fontSize: 16 * u,
                        color: SW.white,
                        opacity: 0.92,
                        lineHeight: 1.3,
                      }}
                    >
                      {p.caption}
                    </div>
                    {/* fake progress bar */}
                    <div style={{ height: 4 * u, borderRadius: 99, background: "rgba(255,255,255,0.18)" }}>
                      <div
                        style={{
                          width: `${((frame * (1.1 + i * 0.35)) % 100)}%`,
                          height: "100%",
                          borderRadius: 99,
                          background: p.tint,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* chips */}
        <div style={{ display: "flex", gap: 22 * u, flexWrap: "wrap", justifyContent: "center" }}>
          {CHIPS.map((c, i) => {
            const s = spring({
              frame: frame - (150 + i * 14),
              fps,
              config: SPRING_POP,
              from: 0,
              to: 1,
            });
            return (
              <div
                key={c.t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12 * u,
                  padding: `${13 * u}px ${26 * u}px`,
                  borderRadius: 999,
                  border: `1.5px solid ${c.c}88`,
                  background: `${c.c}10`,
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [40 * u, 0])}px)`,
                  boxShadow: swGlow(c.c, 26 * u, "2A"),
                }}
              >
                <span
                  style={{
                    fontFamily: display,
                    fontWeight: 800,
                    fontSize: 22 * u,
                    color: c.c,
                    letterSpacing: 2 * u,
                  }}
                >
                  {c.t}
                </span>
                <span style={{ fontFamily: ui, fontSize: 18 * u, color: SW.sub }}>{c.d}</span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
