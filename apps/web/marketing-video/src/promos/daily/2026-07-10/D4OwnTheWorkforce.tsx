/**
 * D4 — "Own The Workforce" · Pillar 8 market / investor angle.
 * The influencer economy used to mean hiring people. Now the agent is an
 * asset you own: ~$1,200/mo gross each, scale to 5,000 → an 8-figure engine.
 * Layout: title → agent asset card + scaling ARR area chart → dark
 * "you own them" card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

/* smooth rising area path over a 560×240 box */
const CW = 560, CH = 240;
const pts = Array.from({ length: 40 }, (_, i) => {
  const x = (i / 39) * CW;
  const t = i / 39;
  const y = CH - Math.pow(t, 1.7) * CH * 0.92 - 6;
  return [x, y] as const;
});
const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
const areaPath = `${linePath} L${CW},${CH} L0,${CH} Z`;

export const D4OwnTheWorkforce: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const draw = interpolate(frame, [250, 430], [1, 0], CL); // dashoffset 1→0 fraction
  const areaReveal = interpolate(frame, [270, 440], [0, 1], CL);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–140) ══ */}
      <Sect from={0} to={140}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>OWN THE AI WORKFORCE</Tag></Rise>
          <Line at={18} size={98} maxWidth={1550}
            words={[{ t: "Stop" }, { t: "renting" }, { t: "creators." }]} />
          <Line at={52} size={98} maxWidth={1550}
            words={[{ t: "Own" }, { t: "the" }, { t: "workforce.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · ASSET CARD + ARR CHART (140–500) ══ */}
      <Sect from={140} to={500}>
        <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center" }}>
          <Rise at={150}><div style={{ display: "inline-block" }}><Tag>EVERY AGENT IS AN ASSET</Tag></div></Rise>
        </div>

        {/* asset holding card (left) */}
        <div style={{ position: "absolute", left: 150, top: 220, width: 640 }}>
          <Rise at={172}>
            <Card style={{ padding: "32px 36px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: D.ink }}>Agent · #0421</div>
                <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 2, color: D.lime, background: `${D.lime}18`, border: `1px solid ${D.lime}55`, borderRadius: 99, padding: "6px 14px" }}>OWNED · 24/7</div>
              </div>
              {[
                { k: "SHARES", v: "1,000,000" },
                { k: "GROSS / MONTH", v: "~$1,200" },
                { k: "PAID ON", v: "verified views" },
                { k: "PAYOUT RAIL", v: "USDC · Stripe · PayPal" },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderTop: i ? `1px solid ${D.line}` : undefined }}>
                  <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: 1, color: D.faint }}>{row.k}</span>
                  <span style={{ fontFamily: display, fontWeight: 600, fontSize: 22, color: i === 1 ? D.lime : D.ink }}>{row.v}</span>
                </div>
              ))}
            </Card>
          </Rise>
        </div>

        {/* ARR chart (right) */}
        <div style={{ position: "absolute", right: 150, top: 220, width: 640 }}>
          <Rise at={230}>
            <Card style={{ padding: "30px 34px" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>SCALE THE FLEET → ARR</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 56, color: D.ink, marginTop: 6 }}>
                $<Count at={280} to={12} dur={150} />M<span style={{ fontFamily: mono, fontSize: 22, color: D.faint, fontWeight: 400 }}>  @ 5,000 agents</span>
              </div>
              <svg width={CW} height={CH} style={{ marginTop: 16, overflow: "visible" }}>
                <defs>
                  <linearGradient id="arrfill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={D.limeBright} stopOpacity="0.42" />
                    <stop offset="100%" stopColor={D.limeBright} stopOpacity="0" />
                  </linearGradient>
                  <clipPath id="reveal"><rect x="0" y="0" width={CW * areaReveal} height={CH} /></clipPath>
                </defs>
                <g clipPath="url(#reveal)">
                  <path d={areaPath} fill="url(#arrfill)" />
                </g>
                <path d={linePath} fill="none" stroke={D.lime} strokeWidth={3}
                  strokeDasharray={1600} strokeDashoffset={draw * 1600} strokeLinecap="round" />
                {/* endpoint dot */}
                <circle cx={CW} cy={pts[pts.length - 1][1]} r={7} fill={D.limeBright}
                  opacity={interpolate(frame, [420, 440], [0, 1], CL)} />
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 14, color: D.faint, marginTop: 4 }}>
                <span>1 agent</span><span>5,000 agents</span>
              </div>
            </Card>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · YOU OWN THEM (500–690) ══ */}
      <Sect from={500} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <div style={{ position: "absolute", top: 120, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={510}><Tag>THE INFLUENCER ECONOMY, OWNED</Tag></Rise>
          <Line at={520} size={64} maxWidth={1500}
            words={[{ t: "You're" }, { t: "not" }, { t: "renting" }, { t: "creators." }, { t: "You" }, { t: "own", c: D.lime }, { t: "them." }]} />
        </div>
        <Rise at={556} style={{ position: "absolute", top: 400, left: "50%", transform: "translateX(-50%)" }}>
          <Card dark style={{ padding: "40px 54px", width: 900 }}>
            <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>PER-AGENT ECONOMICS · BASE CASE</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {[
                { pre: "$", to: 1200, suf: "/mo", cap: "gross per active agent" },
                { pre: "", to: 5000, suf: "", cap: "agents in the fleet" },
                { pre: "$", to: 12, suf: "M", cap: "content-engine ARR" },
              ].map((m, i) => (
                <div key={i} style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 60, color: i === 2 ? D.limeBright : "#fff" }}>
                    <Count at={576} to={m.to} dur={80} prefix={m.pre} suffix={m.suf} />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: "rgba(255,255,255,0.6)", letterSpacing: 1 }}>{m.cap}</div>
                </div>
              ))}
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Own", serif: true }, { t: "the", serif: true }, { t: "workforce.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
