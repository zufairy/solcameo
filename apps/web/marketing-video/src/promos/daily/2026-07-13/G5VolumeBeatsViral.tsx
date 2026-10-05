/**
 * G5 — "Volume Beats Viral" · Pillar 5 the-math (anti-lottery angle).
 * You don't need a viral hit: at $2/1K, break-even is ~25K monthly views;
 * 160 clips/month means ~156 views per clip. Left: the equation building
 * line by line. Right: a 16×10 grid of 160 clip tiles filling up, a few
 * popping (upside, not the plan). Dark lottery-vs-system card.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const COLS = 16, ROWS = 10, N = COLS * ROWS;
const POPS = [23, 61, 118, 149]; // tiles that "pop"

const EQ = [
  { l: "40+ clips a week × 4", r: "≈ 160 a month" },
  { l: "Break-even @ $2 / 1K views", r: "25,000 views / mo" },
  { l: "25,000 ÷ 160 clips", r: "≈ 156 views each" },
];

export const G5VolumeBeatsViral: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const filled = Math.floor(interpolate(frame, [220, 470], [0, N], CL));

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–150) ══ */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>THE MATH · NO LOTTERY REQUIRED</Tag></Rise>
          <div style={{
            fontFamily: serif, fontStyle: "italic", fontWeight: 500, fontSize: 100, color: D.ink, letterSpacing: -2,
            textAlign: "center", maxWidth: 1560, lineHeight: 1.08,
            opacity: interpolate(frame, [14, 34], [0, 1], CL),
            transform: `translateY(${interpolate(frame, [14, 40], [30, 0], CL)}px)`,
          }}>
            You don't need a <span style={{ color: D.lime }}>viral hit</span>.
          </div>
          <Line at={56} size={58} maxWidth={1500} color={D.sub} weight={500}
            words={[{ t: "You" }, { t: "need" }, { t: "a" }, { t: "system." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · EQUATION + TILE GRID (150–520) ══ */}
      <Sect from={150} to={520}>
        {/* equation (left) */}
        <div style={{ position: "absolute", left: 150, top: 200, width: 780 }}>
          <Rise at={166}>
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3.5, color: D.faint, marginBottom: 26 }}>DO THE MATH</div>
          </Rise>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {EQ.map((e, i) => {
              const s = spring({ frame: frame - (196 + i * 60), fps, config: { damping: 23, stiffness: 128 } });
              return (
                <div key={i} style={{ opacity: s, transform: `translateY(${(1 - s) * 26}px)` }}>
                  <Card style={{ padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 18 }}>
                    <span style={{ fontFamily: geist, fontSize: 25, color: D.sub }}>{e.l}</span>
                    <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 30, color: D.ink, whiteSpace: "nowrap" }}>{e.r}</span>
                  </Card>
                </div>
              );
            })}
          </div>
          <Rise at={410}>
            <div style={{ marginTop: 34, fontFamily: display, fontWeight: 700, fontSize: 52, color: D.ink, letterSpacing: -1 }}>
              156 views. <span style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 500, color: D.lime }}>Not viral — volume.</span>
            </div>
          </Rise>
        </div>

        {/* tile grid (right) — 160 clips filling in */}
        <Rise at={200} style={{ position: "absolute", right: 140, top: 186 }}>
          <Card style={{ padding: "30px 34px" }}>
            <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint, marginBottom: 6 }}>ONE MONTH · <span style={{ color: D.lime, fontWeight: 700 }}>{filled}</span>/160 CLIPS</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 38px)`, gridAutoRows: 46, gap: 8, marginTop: 16 }}>
              {Array.from({ length: N }).map((_, i) => {
                const on = i < filled;
                const isPop = POPS.includes(i) && on;
                const popS = isPop ? spring({ frame: frame - (220 + (i / N) * 250 + 6), fps, config: { damping: 12, stiffness: 170 } }) : 0;
                return (
                  <div key={i} style={{
                    borderRadius: 7,
                    background: on ? (isPop ? D.limeBright : `${D.lime}${i % 3 ? "CC" : "99"}`) : D.paper2,
                    border: `1px solid ${on ? D.lime + "55" : D.line}`,
                    transform: isPop ? `scale(${1 + popS * 0.35})` : undefined,
                    boxShadow: isPop ? `0 6px 18px ${D.lime}66` : undefined,
                    transition: "none",
                  }} />
                );
              })}
            </div>
            <div style={{ fontFamily: geist, fontSize: 18, color: D.sub, marginTop: 18 }}>
              A few pop <span style={{ color: D.lime }}>■</span> — that's upside, not the plan.
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ S3 · LOTTERY VS SYSTEM (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 60%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={532} size={62} maxWidth={1560}
            words={[{ t: "One" }, { t: "clip" }, { t: "is" }, { t: "a" }, { t: "lottery" }, { t: "ticket.", serif: true }]} />
          <Rise at={572}>
            <Card dark style={{ padding: "36px 54px", width: 940, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>THE SYSTEM</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: "#fff", lineHeight: 1.25 }}>
                <span style={{ color: D.limeBright }}>160 a month</span> is a system.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Your agent ships them — quality-gated, every one different. Free 30 days, no card.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Volume,", serif: true }, { t: "compounding.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
