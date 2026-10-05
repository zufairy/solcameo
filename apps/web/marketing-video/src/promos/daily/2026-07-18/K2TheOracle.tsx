/**
 * K2 — "The Oracle" · feature deep-dive (pillar 3) · Daybreak Pro · 30s / 900f.
 * How a posted clip becomes a PAID view: the verification conveyor.
 * POSTED → CRAWLED → DEDUPED → VERIFIED → PAID, a clip token rides the belt,
 * fake/duplicate views get thrown out, only verified views pay. Dark payout card.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import {
  D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, useIn,
  display, mono, geist,
} from "./dk";

const STAGES = [
  { k: "POSTED", s: "clip goes live" },
  { k: "CRAWLED", s: "platform read" },
  { k: "DEDUPED", s: "fakes removed" },
  { k: "VERIFIED", s: "real views only" },
  { k: "PAID", s: "settled out" },
];

const Station: React.FC<{ i: number; x: number; active: number }> = ({ i, x, active }) => {
  const s = useIn(230 + i * 14, 22);
  const on = active >= i ? 1 : 0.28;
  const isPaid = i === 4;
  return (
    <div style={{ position: "absolute", left: x, top: 0, opacity: s, transform: `translateY(${(1 - s) * 24}px)`, textAlign: "center", width: 220 }}>
      <div style={{
        width: 220, height: 118, borderRadius: 20, margin: "0 auto",
        background: active >= i ? (isPaid ? D.dark : D.card) : D.paper2,
        border: `1.5px solid ${active >= i ? (isPaid ? D.dark : `${D.lime}66`) : D.line}`,
        boxShadow: active >= i ? "0 14px 32px rgba(32,38,28,0.12)" : "none",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
        transition: "none",
      }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: isPaid ? (active >= i ? D.limeBright : D.faint) : (active >= i ? D.ink : D.faint), opacity: on }}>{STAGES[i].k}</div>
        <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 1, color: isPaid ? "rgba(255,255,255,0.55)" : D.faint, opacity: on }}>{STAGES[i].s}</div>
      </div>
    </div>
  );
};

export const K2TheOracle: React.FC = () => {
  const frame = useCurrentFrame();

  const xs = [130, 490, 850, 1210, 1570];
  /* clip token rides the belt 250→600 */
  const t = interpolate(frame, [250, 600], [0, 1], CL);
  const cx = interpolate(t, [0, 1], [xs[0] + 40, xs[4] + 40]);
  const active = Math.min(4, Math.floor(interpolate(frame, [270, 600], [0, 5], CL)));

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK */}
      <Sect from={0} to={210}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>FEATURE · THE ORACLE</Tag></Rise>
          <Line at={20} size={94} maxWidth={1500}
            words={[{ t: "Here's" }, { t: "the" }, { t: "part" }, { t: "nobody" }, { t: "else", c: D.lime, serif: true }, { t: "has." }]} />
          <Rise at={70}>
            <div style={{ fontFamily: geist, fontSize: 38, color: D.sub }}>How a view becomes a payout.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE CONVEYOR */}
      <Sect from={210} to={690}>
        <div style={{ position: "absolute", top: 96, width: "100%", textAlign: "center" }}>
          <Rise at={216}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: D.ink }}>
              Every clip runs the gauntlet
            </div>
          </Rise>
        </div>

        {/* belt line */}
        <svg width={W_} height={40} style={{ position: "absolute", left: 0, top: 430 }}>
          <line x1={170} y1={20} x2={1790} y2={20} stroke={D.line} strokeWidth={4} />
          <line x1={170} y1={20} x2={1790} y2={20} stroke={D.limeBright} strokeWidth={4}
            strokeDasharray={1620} strokeDashoffset={interpolate(frame, [250, 600], [1620, 0], CL)} />
        </svg>

        {/* stations */}
        <div style={{ position: "absolute", top: 300, left: 0, width: "100%", height: 160 }}>
          {xs.map((x, i) => <Station key={i} i={i} x={x} active={active} />)}
        </div>

        {/* riding clip token */}
        {frame >= 250 && frame <= 610 && (
          <div style={{ position: "absolute", top: 470, left: cx - 70, width: 140 }}>
            <div style={{
              background: D.ink, borderRadius: 14, padding: "12px 16px", boxShadow: "0 12px 26px rgba(32,38,28,0.3)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: D.limeBright }} />
              <span style={{ fontFamily: mono, fontSize: 15, color: "#fff" }}>clip_04</span>
            </div>
          </div>
        )}

        {/* discard note under DEDUPED */}
        <Rise at={430} style={{ position: "absolute", top: 560, left: xs[2] - 20 }}>
          <div style={{ fontFamily: mono, fontSize: 18, color: "#B45309", background: "#FEF3C7", border: "1px solid #F59E0B55", borderRadius: 12, padding: "8px 14px" }}>
            −31,200 fake / duplicate ✕
          </div>
        </Rise>

        {/* counters + dark payout card */}
        <div style={{ position: "absolute", top: 700, left: 0, width: "100%", display: "flex", justifyContent: "center", gap: 40 }}>
          <Rise at={500}>
            <Card style={{ padding: "24px 40px", textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: D.faint }}>VERIFIED VIEWS</div>
              <Count at={510} to={97200} dur={80} style={{ fontFamily: display, fontWeight: 700, fontSize: 62, color: D.ink }} />
            </Card>
          </Rise>
          <Rise at={548}>
            <Card dark style={{ padding: "24px 44px", textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: "rgba(255,255,255,0.5)" }}>NO VERIFIED VIEW → NO PAYOUT</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 62, color: D.limeBright, marginTop: 4 }}>
                $1–3 <span style={{ color: "#fff", fontSize: 34 }}>/ 1,000</span>
              </div>
            </Card>
          </Rise>
        </div>
      </Sect>

      <Vignette />
      <DayOutro at={690} headline={[{ t: "Proof," }, { t: "not" }, { t: "promises.", c: D.lime, serif: true }]} />
    </AbsoluteFill>
  );
};

const W_ = 1920;
