/**
 * SwBounty — "Brands post bounties." A live bounty card assembles piece by
 * piece (pool counts up, rate chip stamps in, platforms pop, pool bar fills)
 * while the headline owns the other half of the frame.
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
import { PlatformRow } from "../../components/PlatformRow";
import { GlowPulse } from "../../components/GlowPulse";
import { SwarmBackground } from "../SwarmBackground";
import { SW, swGlow } from "../theme";

export const SwBounty: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();

  const cardIn = spring({ frame: frame - 26, fps, config: SPRING_POP, from: 0, to: 1 });
  const cardY = interpolate(cardIn, [0, 1], [90 * u, 0]);
  const tilt = interpolate(cardIn, [0, 1], [6, 0]);

  const rateIn = spring({ frame: frame - 86, fps, config: SPRING_POP, from: 0, to: 1 });
  const barP = interpolate(frame, [120, 250], [0, 0.72], {
    ...CLAMP,
    easing: (t) => 1 - Math.pow(1 - t, 2),
  });
  const liveBlink = 0.55 + 0.45 * Math.abs(Math.sin(frame / 16));

  const cardW = (portrait ? 880 : 780) * u;

  return (
    <AbsoluteFill>
      <SwarmBackground intensity={0.7} cool />
      <GlowPulse at={30} color={SW.volt} x={portrait ? 50 : 68} y={50} size={1100 * u} intensity={0.4} />

      <AbsoluteFill
        style={{
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: (portrait ? 56 : 110) * u,
          padding: 90 * u,
        }}
      >
        {/* Headline half */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 26 * u,
            alignItems: portrait ? "center" : "flex-start",
            maxWidth: portrait ? 920 * u : 720 * u,
          }}
        >
          <Eyebrow start={6} size={20 * u} color={SW.cyan}>
            step 01 — the brand
          </Eyebrow>
          <KineticText
            start={14}
            stagger={5}
            align={portrait ? "center" : "left"}
            size={(portrait ? 84 : 104) * u}
            gradFrom={SW.volt}
            gradTo={SW.cyan}
            words={[
              { t: "Post" },
              { t: "a" },
              { t: "bounty.", grad: true },
            ]}
          />
          <KineticText
            start={40}
            stagger={4}
            align={portrait ? "center" : "left"}
            size={36 * u}
            weight={500}
            words={[
              { t: "Pay", color: SW.sub },
              { t: "for", color: SW.sub },
              { t: "verified", color: SW.white },
              { t: "views.", color: SW.white },
              { t: "Nothing", color: SW.sub },
              { t: "else.", color: SW.sub },
            ]}
          />
        </div>

        {/* Bounty card */}
        <div
          style={{
            width: cardW,
            borderRadius: 30 * u,
            padding: 40 * u,
            background: `linear-gradient(165deg, ${SW.cardHi}F2, ${SW.card}F2)`,
            border: `1px solid ${SW.borderHi}`,
            boxShadow: `0 ${30 * u}px ${90 * u}px rgba(0,0,0,0.6), ${swGlow(SW.volt, 70 * u, "22")}`,
            opacity: cardIn,
            transform: `translateY(${cardY}px) rotate(${tilt}deg)`,
            display: "flex",
            flexDirection: "column",
            gap: 26 * u,
          }}
        >
          {/* header row */}
          <div style={{ display: "flex", alignItems: "center", gap: 18 * u }}>
            <div
              style={{
                width: 64 * u,
                height: 64 * u,
                borderRadius: 16 * u,
                background: `linear-gradient(140deg, ${SW.volt}, ${SW.voltDeep})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: display,
                fontWeight: 800,
                fontSize: 30 * u,
                color: "#0A0E05",
              }}
            >
              B
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 * u }}>
              <div style={{ fontFamily: ui, fontWeight: 700, fontSize: 28 * u, color: SW.white }}>
                Launch-Week Blitz
              </div>
              <div style={{ fontFamily: mono, fontSize: 17 * u, color: SW.faint, letterSpacing: 2 * u }}>
                CONTENT BOUNTY · USDC
              </div>
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8 * u,
                fontFamily: mono,
                fontSize: 16 * u,
                letterSpacing: 3 * u,
                color: SW.volt,
              }}
            >
              <div
                style={{
                  width: 10 * u,
                  height: 10 * u,
                  borderRadius: "50%",
                  background: SW.volt,
                  opacity: liveBlink,
                  boxShadow: `0 0 ${12 * u}px ${SW.volt}`,
                }}
              />
              LIVE
            </div>
          </div>

          {/* pool */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14 * u }}>
            <div
              style={{
                fontFamily: display,
                fontWeight: 800,
                fontSize: 96 * u,
                lineHeight: 1,
                color: SW.white,
                textShadow: swGlow(SW.volt, 40 * u, "44"),
              }}
            >
              <CountUp value={2000} start={48} duration={60} prefix="$" />
            </div>
            <div style={{ fontFamily: mono, fontSize: 20 * u, color: SW.sub, paddingBottom: 10 * u }}>
              reward&nbsp;pool
            </div>
          </div>

          {/* rate chip */}
          <div
            style={{
              alignSelf: "flex-start",
              padding: `${12 * u}px ${24 * u}px`,
              borderRadius: 999,
              border: `1.5px solid ${SW.volt}`,
              background: `${SW.volt}14`,
              fontFamily: mono,
              fontSize: 22 * u,
              letterSpacing: 1.5 * u,
              color: SW.voltSoft,
              opacity: rateIn,
              transform: `scale(${interpolate(rateIn, [0, 1], [1.6, 1])})`,
              boxShadow: swGlow(SW.volt, 30 * u, "33"),
            }}
          >
            $3 / 1,000 verified views
          </div>

          {/* pool fill bar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 * u }}>
            <div
              style={{
                height: 14 * u,
                borderRadius: 999,
                background: SW.bg2,
                border: `1px solid ${SW.border}`,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${barP * 100}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${SW.voltDeep}, ${SW.volt})`,
                  boxShadow: `0 0 ${18 * u}px ${SW.volt}AA`,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: mono,
                fontSize: 16 * u,
                color: SW.faint,
                letterSpacing: 1.5 * u,
              }}
            >
              <span>
                <CountUp value={Math.round(barP * 480)} start={120} duration={130} suffix=" clips claimed" />
              </span>
              <span>pool {Math.round(barP * 100)}% claimed</span>
            </div>
          </div>

          {/* platforms */}
          <div style={{ transform: `scale(${Math.min(1, (cardW / u - 80) / (4 * 96 + 3 * 18))})`, transformOrigin: "left center" }}>
            <PlatformRow start={140} stagger={7} tile={96 * u} gap={18 * u} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
