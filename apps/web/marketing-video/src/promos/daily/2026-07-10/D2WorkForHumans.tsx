/**
 * D2 — "Work For Humans" · Pillar 7 manifesto / brand anthem.
 * "AI should work for humans." The money loop as calm, confident steps.
 * Delegation, not replacement — a creator that reports back with numbers.
 * Layout: anthem title → horizontal money-loop flow → "get paid to post,
 * without posting" statement w/ small dark money moment → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const LOOP = [
  { k: "01", t: "Finds", s: "the paid campaigns" },
  { k: "02", t: "Clips", s: "the content" },
  { k: "03", t: "Posts", s: "40+ times a week" },
  { k: "04", t: "Cashes out", s: "to your wallet" },
];

const Step: React.FC<{ at: number; step: typeof LOOP[number]; i: number; last: boolean }> = ({ at, step, i, last }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 24, stiffness: 130 } });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        opacity: s, transform: `translateY(${(1 - s) * 24}px) scale(${0.94 + s * 0.06})`,
        width: 300,
      }}>
        <Card style={{ padding: "26px 28px" }}>
          <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.lime }}>{step.k}</div>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink, marginTop: 8 }}>{step.t}</div>
          <div style={{ fontFamily: geist, fontSize: 18, color: D.sub, marginTop: 4 }}>{step.s}</div>
        </Card>
      </div>
      {!last && (
        <div style={{
          fontFamily: display, fontSize: 40, color: D.lime,
          opacity: interpolate(frame, [at + 12, at + 24], [0, 1], CL),
          transform: `translateX(${interpolate(frame, [at + 12, at + 24], [-8, 0], CL)}px)`,
        }}>→</div>
      )}
    </div>
  );
};

export const D2WorkForHumans: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 55%)` }}>

      {/* ══ S1 · ANTHEM (0–200) ══ */}
      <Sect from={0} to={200}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>A NEW HOPE FOR WORK</Tag></Rise>
          <Line at={20} size={92} maxWidth={1500}
            words={[{ t: "AI" }, { t: "should" }, { t: "work" }, { t: "for" }, { t: "humans.", c: D.lime, serif: true }]} />
          <Line at={70} size={54} maxWidth={1400}
            words={[{ t: "Not" }, { t: "the" }, { t: "other" }, { t: "way" }, { t: "around." }]} color={D.sub} weight={500} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE MONEY LOOP (200–520) ══ */}
      <Sect from={200} to={520} bg={D.paper}>
        <div style={{ position: "absolute", top: 150, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Rise at={210}><Tag>SO WE BUILT THE AGENT THAT WORKS FOR YOU</Tag></Rise>
          <Line at={222} size={58} maxWidth={1500}
            words={[{ t: "It" }, { t: "runs" }, { t: "the" }, { t: "whole" }, { t: "loop.", c: D.lime, serif: true }]} />
        </div>
        <div style={{ position: "absolute", top: 470, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center" }}>
          {LOOP.map((st, i) => <Step key={i} at={280 + i * 34} step={st} i={i} last={i === LOOP.length - 1} />)}
        </div>
        <Rise at={440} style={{ position: "absolute", top: 700, width: "100%", textAlign: "center" }}>
          <div style={{ fontFamily: geist, fontSize: 30, color: D.ink }}>
            You <span style={{ color: D.lime, fontWeight: 700 }}>approve</span>. You <span style={{ color: D.lime, fontWeight: 700 }}>withdraw</span>.
          </div>
        </Rise>
      </Sect>

      {/* ══ S3 · THE STATEMENT (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
          <Line at={534} size={80} maxWidth={1550}
            words={[{ t: "Get" }, { t: "paid" }, { t: "to" }, { t: "post" }, { t: "—" }]} />
          <Line at={566} size={80} maxWidth={1550}
            words={[{ t: "without" }, { t: "posting.", c: D.lime, serif: true }]} />
          <Rise at={610}>
            <Card dark style={{ padding: "22px 40px", display: "flex", alignItems: "center", gap: 18 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: D.limeBright, boxShadow: `0 0 12px ${D.limeBright}` }} />
              <span style={{ fontFamily: geist, fontSize: 24, color: "rgba(255,255,255,0.92)" }}>
                A creator that reports back with the numbers — not one that replaces your team.
              </span>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Work" }, { t: "for", serif: true }, { t: "humans.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
