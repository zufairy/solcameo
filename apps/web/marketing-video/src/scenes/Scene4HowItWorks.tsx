/**
 * Scene 4 — HOW IT WORKS (12–18s)
 * Three lightning-fast illustrated steps zoom through:
 *   "Describe it" → "It creates" → "It posts."
 * Then TikTok · Instagram · X · YouTube pop in a staggered glowing row.
 */
import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { MessageSquareText, Sparkles, Send } from "lucide-react";
import { Background } from "../components/Background";
import { PlatformRow } from "../components/PlatformRow";
import { GlowPulse } from "../components/GlowPulse";
import { CLAMP, COLORS, SPRING_POP, glow } from "../theme";
import { display, mono } from "../lib/fonts";
import { useLayout } from "../lib/layout";

/* ── Step 1 illustration: a prompt box typing itself ─────────────────── */
const DescribeIllo: React.FC<{ u: number }> = ({ u }) => {
  const frame = useCurrentFrame();
  const full = "a witty fitness coach who posts daily…";
  const n = Math.round(interpolate(frame, [10, 60], [0, full.length], CLAMP));
  const caret = frame % 24 < 12;
  return (
    <div
      style={{
        width: 560 * u,
        borderRadius: 22 * u,
        background: "linear-gradient(180deg, rgba(28,27,39,0.95), rgba(14,14,24,0.95))",
        border: `1px solid ${COLORS.borderHi}`,
        padding: 28 * u,
        boxShadow: `0 30px 80px rgba(0,0,0,0.5), ${glow(COLORS.violet, 50 * u, "33")}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 * u, marginBottom: 18 * u }}>
        <MessageSquareText size={22 * u} color={COLORS.violetSoft} />
        <span style={{ fontFamily: mono, fontSize: 16 * u, color: COLORS.faint, letterSpacing: 2, textTransform: "uppercase" }}>
          Describe your agent
        </span>
      </div>
      <div style={{ fontFamily: display, fontSize: 30 * u, color: COLORS.white, lineHeight: 1.35, minHeight: 84 * u }}>
        {full.slice(0, n)}
        <span style={{ display: "inline-block", width: 3 * u, height: 28 * u, background: COLORS.violet, marginLeft: 3 * u, verticalAlign: "-4px", opacity: caret ? 1 : 0 }} />
      </div>
      <div style={{ marginTop: 22 * u, display: "flex", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 * u, fontFamily: display, fontWeight: 700, fontSize: 19 * u, color: "#0a0b0e", background: COLORS.lime, padding: `${12 * u}px ${24 * u}px`, borderRadius: 12 * u, boxShadow: glow(COLORS.lime, 28 * u, "55") }}>
          <Sparkles size={18 * u} /> Generate
        </div>
      </div>
    </div>
  );
};

/* ── Step 2 illustration: content being generated ───────────────────── */
const CreateIllo: React.FC<{ u: number }> = ({ u }) => {
  const frame = useCurrentFrame();
  const prog = interpolate(frame, [12, 64], [0, 100], CLAMP);
  const tints = [COLORS.violet, COLORS.cyan, COLORS.lime, COLORS.pink];
  return (
    <div
      style={{
        width: 560 * u,
        borderRadius: 22 * u,
        background: "linear-gradient(180deg, rgba(28,27,39,0.95), rgba(14,14,24,0.95))",
        border: `1px solid ${COLORS.borderHi}`,
        padding: 28 * u,
        boxShadow: `0 30px 80px rgba(0,0,0,0.5), ${glow(COLORS.cyan, 50 * u, "33")}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 * u, marginBottom: 20 * u }}>
        <Sparkles size={22 * u} color={COLORS.cyan} />
        <span style={{ fontFamily: mono, fontSize: 16 * u, color: COLORS.faint, letterSpacing: 2, textTransform: "uppercase" }}>
          Writing · filming · editing
        </span>
      </div>
      {/* mini content frames assembling */}
      <div style={{ display: "flex", gap: 14 * u, marginBottom: 22 * u }}>
        {tints.map((t, i) => {
          const s = spring({ frame: frame - 14 - i * 7, fps: 60, config: SPRING_POP, from: 0, to: 1 });
          return (
            <div key={i} style={{ flex: 1, height: 130 * u, borderRadius: 12 * u, background: `linear-gradient(160deg, ${t}33, ${COLORS.bg2})`, border: `1px solid ${t}55`, opacity: s, transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 0, height: 0, borderTop: `${12 * u}px solid transparent`, borderBottom: `${12 * u}px solid transparent`, borderLeft: `${18 * u}px solid ${t}`, marginLeft: 4 * u }} />
            </div>
          );
        })}
      </div>
      <div style={{ height: 8 * u, borderRadius: 4 * u, background: COLORS.bg, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${prog}%`, background: `linear-gradient(90deg, ${COLORS.cyan}, ${COLORS.violet})`, boxShadow: glow(COLORS.cyan, 14 * u) }} />
      </div>
    </div>
  );
};

/* ── Step 3 illustration: posting out ───────────────────────────────── */
const PostIllo: React.FC<{ u: number }> = ({ u }) => {
  const frame = useCurrentFrame();
  const lift = interpolate(frame, [16, 56], [0, -40 * u], { ...CLAMP, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const done = interpolate(frame, [40, 56], [0, 1], CLAMP);
  return (
    <div style={{ width: 560 * u, display: "flex", flexDirection: "column", alignItems: "center", gap: 22 * u }}>
      <div
        style={{
          width: 300 * u,
          borderRadius: 22 * u,
          background: "linear-gradient(180deg, rgba(28,27,39,0.97), rgba(14,14,24,0.97))",
          border: `1px solid ${COLORS.borderHi}`,
          padding: 20 * u,
          transform: `translateY(${lift}px)`,
          boxShadow: `0 30px 80px rgba(0,0,0,0.5), ${glow(COLORS.emerald, 50 * u, "44")}`,
        }}
      >
        <div style={{ height: 150 * u, borderRadius: 14 * u, background: `linear-gradient(160deg, ${COLORS.emerald}33, ${COLORS.bg2})`, border: `1px solid ${COLORS.emerald}44`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 * u }}>
          <div style={{ width: 0, height: 0, borderTop: `${16 * u}px solid transparent`, borderBottom: `${16 * u}px solid transparent`, borderLeft: `${24 * u}px solid ${COLORS.emeraldSoft}`, marginLeft: 6 * u }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: mono, fontSize: 15 * u, color: COLORS.sub }}>auto-scheduled</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 * u, fontFamily: mono, fontSize: 15 * u, color: COLORS.emeraldSoft, opacity: done }}>
            <Send size={15 * u} /> Posted
          </span>
        </div>
      </div>
    </div>
  );
};

const STEPS = [
  { n: "01", title: "Describe it", accent: COLORS.violet, Illo: DescribeIllo },
  { n: "02", title: "It creates", accent: COLORS.cyan, Illo: CreateIllo },
  { n: "03", title: "It posts", accent: COLORS.emerald, Illo: PostIllo },
];

const Step: React.FC<{ idx: number; dur: number; u: number; portrait: boolean }> = ({ idx, dur, u, portrait }) => {
  const frame = useCurrentFrame();
  const s = STEPS[idx];
  const Illo = s.Illo;
  // enter (push-in) + exit (push-out)
  const enter = interpolate(frame, [0, 12], [0, 1], CLAMP);
  const exit = interpolate(frame, [dur - 12, dur], [1, 0], CLAMP);
  const o = enter * exit;
  const scale = interpolate(frame, [0, 12], [0.9, 1], { ...CLAMP, easing: (t) => 1 - Math.pow(1 - t, 3) }) * interpolate(frame, [dur - 12, dur], [1, 1.06], CLAMP);
  return (
    <AbsoluteFill style={{ opacity: o, justifyContent: "center", alignItems: "center", transform: `scale(${scale})` }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 * u }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 * u }}>
          <span style={{ fontFamily: mono, fontSize: 34 * u, fontWeight: 700, color: s.accent, opacity: 0.6 }}>{s.n}</span>
          <span style={{ fontFamily: display, fontWeight: 800, fontSize: (portrait ? 68 : 76) * u, color: COLORS.white, letterSpacing: -1.5 * u, textShadow: glow(s.accent, 40 * u, "44") }}>{s.title}</span>
        </div>
        <Illo u={u} />
      </div>
    </AbsoluteFill>
  );
};

export const Scene4HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, portrait, width } = useLayout();
  const op = interpolate(frame, [0, 10, 348, 360], [0, 1, 1, 0], CLAMP);

  const stepDur = 76;

  return (
    <AbsoluteFill style={{ opacity: op, backgroundColor: COLORS.bg }}>
      <Background intensity={0.8} />

      {/* three quick steps */}
      <Sequence from={0} durationInFrames={stepDur}>
        <Step idx={0} dur={stepDur} u={u} portrait={portrait} />
      </Sequence>
      <Sequence from={stepDur} durationInFrames={stepDur}>
        <Step idx={1} dur={stepDur} u={u} portrait={portrait} />
      </Sequence>
      <Sequence from={stepDur * 2} durationInFrames={stepDur}>
        <Step idx={2} dur={stepDur} u={u} portrait={portrait} />
      </Sequence>

      {/* platform payoff */}
      <Sequence from={stepDur * 3} durationInFrames={360 - stepDur * 3}>
        <PlatformPayoff u={u} portrait={portrait} width={width} />
      </Sequence>
    </AbsoluteFill>
  );
};

const PlatformPayoff: React.FC<{ u: number; portrait: boolean; width: number }> = ({ u, portrait }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 10], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 50 * u }}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: (portrait ? 64 : 78) * u, color: COLORS.white, letterSpacing: -2 * u, textAlign: "center" }}>
          Everywhere your audience is.
        </div>
        <div style={{ transform: portrait ? `scale(${0.9})` : "none", display: "flex", flexWrap: portrait ? "wrap" : "nowrap", justifyContent: "center" }}>
          <PlatformRow start={10} stagger={7} tile={(portrait ? 130 : 150) * u} gap={32 * u} />
        </div>
      </div>
      <GlowPulse at={10} color={COLORS.lime} intensity={0.5} size={1400 * u} />
    </AbsoluteFill>
  );
};
