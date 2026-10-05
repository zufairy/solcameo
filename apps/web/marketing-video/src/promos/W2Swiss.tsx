/**
 * W2 — "THE FACTS" · Swiss/International-style stat poster film (~27s).
 * Design: paper white, brutal grid, giant ink numerals, volt bars,
 * variable-font weight animation. Rapid-fire facts.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { display, mono } from "../lib/fonts";

const PAPER = "#F4F3EE", INK = "#111511", VOLT = "#A3E635";
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Grid: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.5 }}>
    {[480, 960, 1440].map((x) => <div key={x} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: `${INK}14` }} />)}
    <div style={{ position: "absolute", left: 0, right: 0, top: 540, height: 1, background: `${INK}14` }} />
  </AbsoluteFill>
);

/* one full-frame fact card */
const Fact: React.FC<{ at: number; out: number; n: string; unit?: string; label: string; idx: string; invert?: boolean }> =
  ({ at, out, n, unit, label, idx, invert }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || frame > out + 6) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 150 } });
  const o = interpolate(frame, [out, out + 5], [1, 0], CL);
  const wght = Math.round(interpolate(s, [0, 1], [300, 700]));
  const bg = invert ? INK : PAPER, fg = invert ? PAPER : INK;
  const barW = interpolate(frame, [at + 4, at + 22], [0, 560], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 3) });
  return (
    <AbsoluteFill style={{ background: bg, opacity: o }}>
      <Grid />
      <div style={{ position: "absolute", left: 120, top: 108, fontFamily: mono, fontSize: 26, letterSpacing: 8, color: fg }}>{idx} / THE FACTS</div>
      <div style={{ position: "absolute", right: 120, top: 108, width: 16, height: 16, background: VOLT }} />
      <div style={{ position: "absolute", left: 104, top: 250, fontFamily: display, fontVariationSettings: `'wght' ${wght}`, fontSize: 430, letterSpacing: -26, lineHeight: 0.86, color: fg, transform: `translateY(${(1 - s) * 90}px)`, opacity: s }}>
        {n}<span style={{ fontSize: 190, letterSpacing: -6 }}>{unit}</span>
      </div>
      <div style={{ position: "absolute", left: 120, top: 760, width: barW, height: 20, background: VOLT }} />
      <div style={{ position: "absolute", left: 120, top: 812, fontFamily: display, fontWeight: 600, fontSize: 54, letterSpacing: -1.5, color: fg, maxWidth: 1500, opacity: interpolate(frame, [at + 10, at + 22], [0, 1], CL) }}>
        {label}
      </div>
    </AbsoluteFill>
  );
};

export const W2Swiss: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 700, fps, config: { damping: 15, stiffness: 150 } });
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {/* title beat */}
      {frame < 68 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: INK }}>
          <Grid />
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 220, letterSpacing: -10, color: PAPER, transform: `scale(${interpolate(frame, [0, 12], [1.3, 1], CL)})`, opacity: interpolate(frame, [0, 8, 60, 67], [0, 1, 1, 0], CL) }}>
            THE FACTS<span style={{ color: VOLT }}>.</span>
          </div>
        </AbsoluteFill>
      )}
      <Fact at={68} out={200} idx="01" n="$40" unit="B" label="Influencer marketing today. Growing to $152B by 2031." />
      <Fact at={200} out={330} idx="02" n="41" unit="%" label="Yearly growth of the AI-creator slice. The fastest lane." invert />
      <Fact at={330} out={460} idx="03" n="3" unit="×" label="Virtual creators out-engage humans. 5.67% vs 1.89%." />
      <Fact at={460} out={575} idx="04" n="73" unit="%" label="Of brands already pay AI personas. You're not early — you're on time." invert />
      <Fact at={575} out={695} idx="05" n="$0" unit="" label="Cost of a brand-ready creator on Vello. Was $380K in 2022." />
      {/* CTA */}
      {frame >= 695 && (
        <AbsoluteFill style={{ background: INK, alignItems: "center", justifyContent: "center", gap: 44 }}>
          <Grid />
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 210, opacity: s, transform: `scale(${0.85 + 0.15 * s})` }} />
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 96, letterSpacing: -4, color: PAPER, opacity: s }}>
            Read the numbers. <span style={{ color: VOLT }}>Then act.</span>
          </div>
          <div style={{ fontFamily: mono, fontSize: 30, letterSpacing: 10, color: VOLT, opacity: interpolate(frame, [730, 745], [0, 1], CL) }}>VELLO.GG</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
