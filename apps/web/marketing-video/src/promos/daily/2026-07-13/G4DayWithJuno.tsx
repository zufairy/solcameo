/**
 * G4 — "A Day With Juno" · Pillar 9 persona showcase (day-in-the-life angle).
 * One agent, hour by hour: a horizontal timeline ribbon drawing left→right
 * with alternating up/down beat cards (06:00 scan → 09:00 claim → 12:40 ship
 * → 03:12 still posting w/ real footage phone → 08:00 report), then the
 * dark morning-report card. Distinct layout: centered horizontal ribbon.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const BEATS = [
  { h: "06:00", t: "Scans trends", d: "what's clipping today", up: true },
  { h: "09:00", t: "Claims a campaign", d: "$2 / 1K verified views", up: false },
  { h: "12:40", t: "Six clips shipped", d: "hooked · captioned · gated", up: true },
  { h: "03:12", t: "Still posting", d: "you're asleep", up: false },
  { h: "08:00", t: "Report's waiting", d: "what shipped, what earned", up: true },
];

export const G4DayWithJuno: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ribbonW = 1200; // ends x=1430 so the last beat clears the phone frame at right

  const drawn = interpolate(frame, [200, 480], [ribbonW, 0], CL);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · MEET JUNO (0–150) ══ */}
      <Sect from={0} to={150} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>PERSONA · ON THE CLOCK</Tag></Rise>
          <div style={{
            fontFamily: serif, fontStyle: "italic", fontWeight: 500, fontSize: 120, color: D.ink, letterSpacing: -2,
            opacity: interpolate(frame, [14, 34], [0, 1], CL),
            transform: `translateY(${interpolate(frame, [14, 40], [30, 0], CL)}px)`,
          }}>
            Meet <span style={{ color: D.lime }}>Juno</span>.
          </div>
          <Line at={54} size={54} maxWidth={1500} color={D.sub} weight={500}
            words={[{ t: "An" }, { t: "agent." }, { t: "Her" }, { t: "whole" }, { t: "day," }, { t: "in" }, { t: "thirty" }, { t: "seconds." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · TIMELINE RIBBON (150–540) ══ */}
      <Sect from={150} to={540}>
        <div style={{ position: "absolute", top: 66, width: "100%", textAlign: "center" }}>
          <Rise at={160}><div style={{ display: "inline-block" }}><Tag>JUNO · ONE DAY, ON SHIFT THE WHOLE TIME</Tag></div></Rise>
        </div>

        {/* ribbon line */}
        <svg width={ribbonW} height="8" style={{ position: "absolute", left: 230, top: 536 }}>
          <line x1="0" y1="4" x2={ribbonW} y2="4" stroke={D.lime} strokeWidth="3.5"
            strokeDasharray={ribbonW} strokeDashoffset={drawn} strokeLinecap="round" />
        </svg>

        {/* beats */}
        {BEATS.map((b, i) => {
          const at = 210 + i * 56;
          const s = spring({ frame: frame - at, fps, config: { damping: 23, stiffness: 128 } });
          const x = 230 + (ribbonW / (BEATS.length - 1)) * i;
          const asleep = i === 3;
          return (
            <div key={i}>
              {/* node */}
              <div style={{
                position: "absolute", left: x - 13, top: 527, width: 26, height: 26, borderRadius: 99,
                background: asleep ? D.dark : D.limeBright, border: `4px solid ${D.paper}`,
                boxShadow: `0 0 0 2px ${asleep ? D.dark : D.lime}`,
                transform: `scale(${s})`,
              }} />
              {/* time */}
              <div style={{
                position: "absolute", left: x - 60, width: 120, top: b.up ? 566 : 476, textAlign: "center",
                fontFamily: mono, fontSize: 19, fontWeight: 700, letterSpacing: 1, color: asleep ? D.ink : D.lime, opacity: s,
              }}>{b.h}</div>
              {/* card */}
              <div style={{
                position: "absolute", left: x - 150, width: 300, top: b.up ? 300 : 620,
                opacity: s, transform: `translateY(${(1 - s) * (b.up ? 30 : -30)}px)`,
              }}>
                <Card dark={asleep} style={{ padding: "20px 24px", textAlign: "center" }}>
                  <div style={{ fontFamily: display, fontWeight: 650, fontSize: 27, color: asleep ? "#fff" : D.ink }}>{b.t}</div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: asleep ? D.limeBright : D.sub, marginTop: 6 }}>{b.d}</div>
                </Card>
              </div>
            </div>
          );
        })}

        {/* phone with real footage — what 03:12 looks like */}
        <Rise at={400} style={{ position: "absolute", right: 96, top: 190 }}>
          <div style={{ width: 246, height: 520, borderRadius: 38, padding: 10, background: D.dark, boxShadow: "0 26px 60px rgba(32,38,28,0.30)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 30, overflow: "hidden", position: "relative", background: "#000" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", left: 12, bottom: 14, fontFamily: mono, fontSize: 12.5, letterSpacing: 1, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "5px 11px" }}>
                03:12 · posting
              </div>
            </div>
          </div>
        </Rise>

        {/* juno chip (left) */}
        <Rise at={180} style={{ position: "absolute", left: 96, top: 176 }}>
          <Card style={{ padding: "18px 26px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: `linear-gradient(135deg, ${D.limeBright}, ${D.lime})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: display, fontWeight: 700, fontSize: 26, color: "#0A0C08" }}>J</div>
            <div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 26, color: D.ink }}>JUNO</div>
              <div style={{ fontFamily: mono, fontSize: 14, color: D.sub }}>minted in 15 min · never hired</div>
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ S3 · MORNING REPORT (540–690) ══ */}
      <Sect from={540} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={552} size={64} maxWidth={1500}
            words={[{ t: "You" }, { t: "wake" }, { t: "up" }, { t: "to" }, { t: "a" }, { t: "report.", c: D.lime, serif: true }]} />
          <Rise at={590}>
            <Card dark style={{ padding: "34px 54px", width: 880 }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 20, textAlign: "center" }}>08:00 · JUNO'S WEEK, SO FAR</div>
              {[
                ["Clips shipped", "41", false],
                ["Verified views", "96,400", false],
                ["Earned @ $2/1K", "$192.80", true],
              ].map(([k, v, hot], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0", borderBottom: i < 2 ? "1.5px solid rgba(255,255,255,0.12)" : "none" }}>
                  <span style={{ fontFamily: geist, fontSize: 22, color: "rgba(255,255,255,0.75)" }}>{k as string}</span>
                  <span style={{ fontFamily: mono, fontWeight: 700, fontSize: hot ? 40 : 30, color: hot ? D.limeBright : "#fff" }}>{v as string}</span>
                </div>
              ))}
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Minted,", serif: true }, { t: "not", serif: true }, { t: "hired.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
