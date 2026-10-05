/**
 * AgentCard — THE visual signature of the film.
 *
 * A glowing glass card holding an illustrated AI-influencer avatar. It recurs
 * and multiplies across scenes (reveal → how-it-works → magic → economy), so
 * it's built to look great at any size and to read as a real product object:
 * neon-ringed avatar, name + handle, a live pulse, and a metric strip.
 *
 * Sizing is driven by a single `w` (width in px); everything else scales from
 * it, so the same component works as a hero card or a tiny grid tile.
 */
import React from "react";
import { Img, staticFile } from "remotion";
import { COLORS, glow } from "../theme";
import { display, mono } from "../lib/fonts";

export const AgentCard: React.FC<{
  avatar: string; // staticFile path
  name: string;
  handle: string;
  accent?: string;
  w?: number;
  /** focal point for the avatar crop */
  objectPosition?: string;
  /** small metric shown bottom-right, e.g. "+$128" or a live <CountUp/> */
  stat?: React.ReactNode;
  statLabel?: string;
  live?: boolean;
  /** 0..1 — dial the outer glow up on hero cards */
  glowStrength?: number;
  style?: React.CSSProperties;
}> = ({
  avatar,
  name,
  handle,
  accent = COLORS.violet,
  w = 360,
  objectPosition = "center 28%",
  stat,
  statLabel = "earned",
  live = true,
  glowStrength = 0.6,
  style,
}) => {
  const pad = w * 0.05;
  const radius = w * 0.075;
  const avatarH = w * 0.62;

  return (
    <div
      style={{
        width: w,
        borderRadius: radius,
        background:
          "linear-gradient(180deg, rgba(28,27,39,0.92), rgba(14,14,24,0.92))",
        border: `1px solid ${COLORS.borderHi}`,
        padding: pad,
        position: "relative",
        overflow: "hidden",
        backdropFilter: "blur(8px)",
        boxShadow: `0 ${w * 0.06}px ${w * 0.16}px rgba(0,0,0,0.55), ${glow(accent, w * 0.12, glowStrength > 0.5 ? "55" : "33")}`,
        ...style,
      }}
    >
      {/* accent corner bloom */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 80% at 0% 0%, ${accent}2e, transparent 58%)`,
        }}
      />
      {/* top accent hairline */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }}
      />

      {/* avatar with neon ring */}
      <div
        style={{
          position: "relative",
          height: avatarH,
          borderRadius: radius * 0.85,
          overflow: "hidden",
          border: `1.5px solid ${accent}77`,
          boxShadow: `inset 0 0 ${w * 0.12}px ${accent}33`,
        }}
      >
        <Img
          src={staticFile(avatar)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(0deg, rgba(8,8,16,0.85), transparent 55%)",
          }}
        />
        {live && (
          <div
            style={{
              position: "absolute",
              top: pad * 0.7,
              left: pad * 0.7,
              display: "flex",
              alignItems: "center",
              gap: w * 0.018,
              padding: `${w * 0.012}px ${w * 0.03}px`,
              borderRadius: 999,
              background: "rgba(8,8,16,0.6)",
              border: `1px solid ${COLORS.border}`,
              fontFamily: mono,
              fontSize: w * 0.038,
              color: COLORS.white,
              letterSpacing: 1,
            }}
          >
            <span
              style={{
                width: w * 0.028,
                height: w * 0.028,
                borderRadius: "50%",
                background: COLORS.emeraldSoft,
                boxShadow: `0 0 ${w * 0.03}px ${COLORS.emeraldSoft}`,
              }}
            />
            LIVE
          </div>
        )}
      </div>

      {/* identity + metric */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: pad,
          gap: pad,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: display,
              fontWeight: 700,
              fontSize: w * 0.085,
              color: COLORS.white,
              letterSpacing: -w * 0.0015,
              lineHeight: 1,
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: w * 0.045,
              color: COLORS.sub,
              marginTop: w * 0.018,
            }}
          >
            {handle}
          </div>
        </div>
        {stat && (
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: mono,
                fontWeight: 700,
                fontSize: w * 0.075,
                color: COLORS.emeraldSoft,
                textShadow: glow(COLORS.emerald, w * 0.06, "55"),
              }}
            >
              {stat}
            </div>
            <div
              style={{
                fontFamily: mono,
                fontSize: w * 0.038,
                color: COLORS.faint,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {statLabel}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
