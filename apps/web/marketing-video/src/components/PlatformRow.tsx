/**
 * PlatformRow — TikTok · Instagram · X · YouTube popping in a staggered,
 * glowing row. Inline SVG brand glyphs (no raster), each in a glass tile that
 * springs up + blooms on its beat. The "it posts everywhere" payoff.
 */
import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { CLAMP, COLORS, SPRING_POP, glow } from "../theme";

const TikTok: React.FC<{ s: number; c: string }> = ({ s, c }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <path
      d="M16.5 3c.3 2.1 1.6 3.6 3.7 3.9v2.6c-1.3.1-2.5-.3-3.7-1v5.6c0 3.4-2.6 5.9-5.9 5.9-2 0-3.8-1-4.8-2.6-1.7-2.7-.5-6.6 3-7.3.6-.1 1.2-.1 1.9 0v2.7c-.3-.1-.6-.1-.9-.1-1.3 0-2.3 1.2-2 2.6.2 1 1.1 1.6 2.1 1.5 1.2-.1 2-1 2-2.3V3h2.6z"
      fill={c}
    />
  </svg>
);

const Instagram: React.FC<{ s: number; c: string }> = ({ s, c }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="18" height="18" rx="5.5" stroke={c} strokeWidth="2" />
    <circle cx="12" cy="12" r="4" stroke={c} strokeWidth="2" />
    <circle cx="17.2" cy="6.8" r="1.3" fill={c} />
  </svg>
);

const XLogo: React.FC<{ s: number; c: string }> = ({ s, c }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <path
      d="M3 3l7.2 9.6L3.3 21h2.2l5.5-6.3L15.7 21H21l-7.5-10 6.6-8h-2.2l-5.1 5.9L8.3 3H3z"
      fill={c}
    />
  </svg>
);

const YouTube: React.FC<{ s: number; c: string }> = ({ s, c }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <rect x="2" y="5" width="20" height="14" rx="4.5" fill={c} />
    <path d="M10 8.5l5.5 3.5L10 15.5v-7z" fill={COLORS.bg} />
  </svg>
);

const ICONS = [
  { Comp: TikTok, color: "#25F4EE", label: "TikTok" },
  { Comp: Instagram, color: "#E1306C", label: "Instagram" },
  { Comp: XLogo, color: "#FFFFFF", label: "X" },
  { Comp: YouTube, color: "#FF0000", label: "YouTube" },
] as const;

export const PlatformRow: React.FC<{
  start?: number;
  stagger?: number;
  tile?: number; // tile size px
  gap?: number;
}> = ({ start = 0, stagger = 6, tile = 120, gap = 28 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", gap }}>
      {ICONS.map(({ Comp, color, label }, i) => {
        const t = frame - (start + i * stagger);
        const s = spring({ frame: t, fps, config: SPRING_POP, from: 0, to: 1 });
        const y = interpolate(s, [0, 1], [tile * 0.5, 0]);
        const bloom = interpolate(t, [0, 6, 22], [0, 1, 0.45], CLAMP);
        return (
          <div
            key={label}
            style={{
              width: tile,
              height: tile,
              borderRadius: tile * 0.26,
              background:
                "linear-gradient(180deg, rgba(28,27,39,0.95), rgba(14,14,24,0.95))",
              border: `1px solid ${COLORS.borderHi}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: s,
              transform: `translateY(${y}px) scale(${interpolate(s, [0, 1], [0.7, 1])})`,
              boxShadow: `0 ${tile * 0.12}px ${tile * 0.3}px rgba(0,0,0,0.5), ${glow(color, tile * 0.3 * bloom, "66")}`,
            }}
          >
            <Comp s={tile * 0.5} c={color} />
          </div>
        );
      })}
    </div>
  );
};
