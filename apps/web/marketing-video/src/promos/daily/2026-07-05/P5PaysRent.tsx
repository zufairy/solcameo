/**
 * P5 — "Pays Its Own Rent" · Pillar 5 the math.
 * $50/mo, deducted from the agent's earnings first. At $2/1k verified views it
 * breaks even at 25,000 views — a slow week for a working clipper.
 * Layout: a P&L receipt + break-even bar + everything-above-is-yours counter.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const LineItem: React.FC<{ at: number; label: string; val: string; accent?: boolean; sub?: boolean }> =
  ({ at, label, val, accent, sub }) => {
    const frame = useCurrentFrame();
    const s = spring({ frame: frame - at, fps: 30, config: { damping: 24, stiffness: 130 } });
    return (
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        opacity: s, transform: `translateX(${(1 - s) * 24}px)`,
        padding: sub ? "8px 0" : "14px 0", borderBottom: sub ? "none" : `1px solid ${D.line}`,
      }}>
        <span style={{ fontFamily: sub ? mono : geist, fontSize: sub ? 18 : 24, color: sub ? D.faint : D.ink, fontWeight: sub ? 400 : 600 }}>{label}</span>
        <span style={{ fontFamily: display, fontWeight: 700, fontSize: sub ? 24 : 34, color: accent ? D.lime : D.ink }}>{val}</span>
      </div>
    );
  };

export const P5PaysRent: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const beFill = interpolate(frame, [540, 640], [0, 100], CL);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · HOOK (0–180) ══ */}
      <Sect from={0} to={180}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
          <Rise at={8}><Tag>THE MATH</Tag></Rise>
          <Line at={18} size={104} maxWidth={1400}
            words={[{ t: "Here's" }, { t: "the" }, { t: "math.", c: D.lime, serif: true }]} />
          <Rise at={80}>
            <div style={{ fontFamily: mono, fontSize: 30, color: D.sub, letterSpacing: 2 }}>
              25,000 views × <span style={{ color: D.lime }}>$2 / 1k</span> = <span style={{ color: D.ink, fontWeight: 700 }}>$50</span>
            </div>
          </Rise>
          <Rise at={130}>
            <div style={{ fontFamily: geist, fontSize: 26, color: D.faint }}>That's the whole bill. Watch.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE RECEIPT (180–470) ══ */}
      <Sect from={180} to={470}>
        <div style={{ position: "absolute", top: 88, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={190}><Tag>MONTHLY P&L · ONE AGENT</Tag></Rise>
          <Line at={200} size={54} maxWidth={1500}
            words={[{ t: "It" }, { t: "pays" }, { t: "its" }, { t: "own" }, { t: "rent.", c: D.lime, serif: true }]} />
        </div>
        <Rise at={230} style={{ position: "absolute", left: 0, right: 0, top: 320, display: "flex", justifyContent: "center" }}>
          <Card style={{ padding: "40px 50px", width: 760 }}>
            <LineItem at={244} label="Vello subscription" val="−$50" sub />
            <LineItem at={244} label="Rate (verified views)" val="$2 / 1,000" />
            <LineItem at={276} label="Break-even" val="25,000 views" accent />
            <LineItem at={308} label="Deducted from earnings first" val="✓" sub />
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 15, color: D.faint, letterSpacing: 1, marginBottom: 8 }}>
                <span>PROGRESS TO BREAK-EVEN</span><span><Count at={344} to={25000} dur={70} /> / 25,000</span>
              </div>
              <div style={{ height: 16, borderRadius: 99, background: D.paper2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${interpolate(frame, [344, 414], [0, 100], CL)}%`, background: D.limeBright, borderRadius: 99 }} />
              </div>
              <div style={{ fontFamily: geist, fontSize: 19, color: D.sub, marginTop: 14 }}>A slow week for a working clipper.</div>
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ S3 · EVERYTHING ABOVE IS YOURS (470–700) ══ */}
      <Sect from={470} to={700}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36 }}>
          <Line at={482} size={60} maxWidth={1400}
            words={[{ t: "Everything" }, { t: "above" }, { t: "that" }, { t: "is" }, { t: "yours.", c: D.lime, serif: true }]} />
          <Card dark style={{ padding: "44px 56px", width: 720, textAlign: "center" }}>
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: "rgba(255,255,255,0.5)" }}>CASHED OUT THIS MONTH · AFTER RENT</div>
            <Count at={540} to={1140} prefix="$" dur={90} style={{ fontFamily: display, fontWeight: 700, fontSize: 128, color: D.limeBright, textShadow: `0 0 40px ${D.limeBright}44` }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: mono, fontSize: 18, color: "rgba(255,255,255,0.72)", letterSpacing: 1 }}>
              <span style={{ color: "#22D3EE" }}>◎</span> STRAIGHT TO YOUR WALLET
            </div>
          </Card>
          <Rise at={620}>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 34, color: D.sub }}>The agent pays its own rent.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={694} headline={[{ t: "Run" }, { t: "the", serif: true }, { t: "numbers.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
