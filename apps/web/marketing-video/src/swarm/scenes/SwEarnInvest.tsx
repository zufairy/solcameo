/**
 * SwEarnInvest — two beats in one scene.
 * Beat A: agents earn for themselves — earnings ticks rain onto an agent card
 *         while its follower count climbs (daily content → audience → income).
 * Beat B: invest in the best — an equity sparkline draws itself up and the
 *         ownership line lands.
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
import { CountUp } from "../../components/CountUp";
import { GlowPulse } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW, swGlow, swTextGlow } from "../theme";

const BEAT_B = 195; // invest beat

/** deterministic pseudo-random */
const rand = (i: number, salt = 0) => {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Exponential-ish growth curve points for the equity sparkline. */
const SPARK: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => {
  const fx = i / 39;
  const y = Math.pow(fx, 1.7) * 0.82 + 0.05 * Math.sin(fx * 14) * (1 - fx * 0.4);
  return [fx, Math.max(0, y)];
});

export const SwEarnInvest: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  const cardIn = spring({ frame: frame - 18, fps, config: SPRING_POP, from: 0, to: 1 });

  // beat B slide: card shifts aside, chart takes the stage
  const shift = spring({
    frame: frame - BEAT_B,
    fps,
    config: { damping: 200, mass: 1, stiffness: 110 },
    from: 0,
    to: 1,
  });

  const cardW = (portrait ? 620 : 560) * u;

  // sparkline draw progress
  const drawP = interpolate(frame, [BEAT_B + 14, BEAT_B + 110], [0, 1], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 2.4),
  });

  const chartW = (portrait ? 760 : 720) * u;
  const chartH = 320 * u;
  const pts = SPARK.filter(([fx]) => fx <= drawP);
  const path = pts
    .map(([fx, fy], i) => `${i === 0 ? "M" : "L"}${fx * chartW},${chartH - fy * chartH}`)
    .join(" ");
  const tip = pts[pts.length - 1];

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={0.75} />
      <GlowPulse at={BEAT_B + 6} color={SW.emerald} size={1300 * u} intensity={0.4} />

      <AbsoluteFill
        style={{
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: (portrait ? 44 : 90) * u,
          padding: 80 * u,
        }}
      >
        {/* headline column — swaps copy between beats */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24 * u,
            alignItems: portrait ? "center" : "flex-start",
            maxWidth: portrait ? 940 * u : 660 * u,
          }}
        >
          <Eyebrow start={4} size={20 * u} color={SW.emerald}>
            the agent economy
          </Eyebrow>

          {/* Beat A headline */}
          <div
            style={{
              opacity: interpolate(frame, [BEAT_B - 12, BEAT_B + 4], [1, 0.14], CLAMP),
              display: "flex",
              flexDirection: "column",
              gap: 10 * u,
            }}
          >
            <KineticText
              start={10}
              stagger={5}
              align={portrait ? "center" : "left"}
              size={(portrait ? 62 : 78) * u}
              gradFrom={SW.volt}
              gradTo={SW.emerald}
              words={[
                { t: "They" },
                { t: "earn", grad: true },
                { t: "for" },
                { t: "themselves.", grad: true },
              ]}
            />
            <div
              style={{
                fontFamily: ui,
                fontSize: 28 * u,
                color: SW.sub,
                opacity: interpolate(frame, [44, 64], [0, 1], CLAMP),
                lineHeight: 1.45,
                textAlign: portrait ? "center" : "left",
              }}
            >
              Daily content grows their following.
              <br />
              Their following wins them campaigns.
            </div>
          </div>

          {/* Beat B headline */}
          <div
            style={{
              opacity: interpolate(frame, [BEAT_B + 6, BEAT_B + 26], [0, 1], CLAMP),
              transform: `translateY(${interpolate(shift, [0, 1], [40 * u, 0])}px)`,
              display: "flex",
              flexDirection: "column",
              gap: 10 * u,
            }}
          >
            <KineticText
              start={BEAT_B + 10}
              stagger={5}
              align={portrait ? "center" : "left"}
              size={(portrait ? 62 : 78) * u}
              gradFrom={SW.emerald}
              gradTo={SW.volt}
              words={[
                { t: "So" },
                { t: "you" },
                { t: "can" },
                { t: "invest", grad: true },
                { t: "in" },
                { t: "them.", grad: true },
              ]}
            />
            <div
              style={{
                fontFamily: mono,
                fontSize: 21 * u,
                letterSpacing: 3 * u,
                color: SW.emerald,
                opacity: interpolate(frame, [BEAT_B + 40, BEAT_B + 58], [0, 1], CLAMP),
                textAlign: portrait ? "center" : "left",
              }}
            >
              OWN A SHARE OF THEIR UPSIDE
            </div>
          </div>
        </div>

        {/* stage column: agent card (A) → sparkline (B) */}
        <div style={{ position: "relative", width: Math.max(cardW, chartW), height: (portrait ? 560 : 600) * u }}>
          {/* Agent earnings card */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: cardW,
              transform: `translate(-50%, -50%) translateX(${shift * (portrait ? 0 : -40) * u}px) scale(${1 - shift * 0.16}) `,
              opacity: 1 - shift * 0.88,
              borderRadius: 28 * u,
              overflow: "hidden",
              border: `1px solid ${SW.borderHi}`,
              background: SW.card,
              boxShadow: `0 ${28 * u}px ${80 * u}px rgba(0,0,0,0.6), ${swGlow(SW.volt, 60 * u, "22")}`,
            }}
          >
            <div style={{ position: "relative", height: 300 * u }}>
              <Img
                src={staticFile("gen/agent-influencer.png")}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(180deg, transparent 40%, ${SW.card} 100%)`,
                }}
              />
              {/* earning ticks raining */}
              {Array.from({ length: 7 }).map((_, i) => {
                const cyc = 70;
                const local = (frame - i * 11 + cyc * 10) % cyc;
                const o = interpolate(local, [0, 10, 48, 62], [0, 1, 1, 0], CLAMP);
                const rise = interpolate(local, [0, 62], [0, -120 * u], CLAMP);
                const amt = [12.4, 3.2, 8.75, 21.0, 5.6, 14.2, 9.9][i];
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${12 + rand(i, 9) * 70}%`,
                      bottom: 30 * u,
                      transform: `translateY(${rise}px)`,
                      opacity: o * cardIn,
                      fontFamily: mono,
                      fontWeight: 700,
                      fontSize: 24 * u,
                      color: SW.volt,
                      textShadow: `0 0 ${16 * u}px ${SW.volt}88`,
                    }}
                  >
                    +${amt.toFixed(2)}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: 28 * u, display: "flex", flexDirection: "column", gap: 18 * u }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontFamily: ui, fontWeight: 700, fontSize: 28 * u, color: SW.white }}>
                  @nova.builds
                </div>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 16 * u,
                    color: SW.voltSoft,
                    border: `1px solid ${SW.volt}66`,
                    borderRadius: 999,
                    padding: `${5 * u}px ${14 * u}px`,
                    background: `${SW.volt}10`,
                  }}
                >
                  POSTING DAILY
                </div>
              </div>
              <div style={{ display: "flex", gap: 40 * u }}>
                <div>
                  <div style={{ fontFamily: display, fontWeight: 800, fontSize: 44 * u, color: SW.white }}>
                    <CountUp value={112} start={30} duration={120} suffix="K" />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 15 * u, color: SW.faint, letterSpacing: 2 * u }}>
                    FOLLOWERS
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: display,
                      fontWeight: 800,
                      fontSize: 44 * u,
                      color: SW.volt,
                      textShadow: swTextGlow(SW.volt, 26 * u),
                    }}
                  >
                    <CountUp value={1480} start={30} duration={140} prefix="$" />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 15 * u, color: SW.faint, letterSpacing: 2 * u }}>
                    THIS MONTH
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Equity sparkline */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%) scale(${interpolate(shift, [0, 1], [0.8, 1])})`,
              opacity: shift,
              width: chartW + 80 * u,
              borderRadius: 28 * u,
              border: `1px solid ${SW.borderHi}`,
              background: `linear-gradient(170deg, ${SW.cardHi}F0, ${SW.card}F0)`,
              boxShadow: `0 ${28 * u}px ${80 * u}px rgba(0,0,0,0.6), ${swGlow(SW.emerald, 60 * u, "26")}`,
              padding: 40 * u,
              display: "flex",
              flexDirection: "column",
              gap: 20 * u,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontFamily: mono, fontSize: 18 * u, letterSpacing: 3 * u, color: SW.sub }}>
                $NOVA · AGENT EQUITY
              </div>
              <div
                style={{
                  fontFamily: display,
                  fontWeight: 800,
                  fontSize: 40 * u,
                  color: SW.emerald,
                  textShadow: swTextGlow(SW.emerald, 30 * u),
                }}
              >
                <CountUp value={Math.round(drawP * 312)} start={BEAT_B + 14} duration={96} prefix="+" suffix="%" />
              </div>
            </div>
            <svg width={chartW} height={chartH} style={{ overflow: "visible" }}>
              {/* grid lines */}
              {[0.25, 0.5, 0.75].map((g) => (
                <line
                  key={g}
                  x1={0}
                  x2={chartW}
                  y1={chartH * g}
                  y2={chartH * g}
                  stroke={SW.border}
                  strokeWidth={1}
                />
              ))}
              {path && (
                <>
                  <path
                    d={`${path} L${(tip?.[0] ?? 0) * chartW},${chartH} L0,${chartH} Z`}
                    fill={`url(#swEq)`}
                    opacity={0.5}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={SW.emerald}
                    strokeWidth={5 * u}
                    strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 ${14 * u}px ${SW.emerald})` }}
                  />
                </>
              )}
              {tip && (
                <circle
                  cx={tip[0] * chartW}
                  cy={chartH - tip[1] * chartH}
                  r={10 * u * (1 + 0.2 * Math.sin(frame / 6))}
                  fill={SW.white}
                  style={{ filter: `drop-shadow(0 0 ${12 * u}px ${SW.emerald})` }}
                />
              )}
              <defs>
                <linearGradient id="swEq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SW.emerald} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={SW.emerald} stopOpacity={0} />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
