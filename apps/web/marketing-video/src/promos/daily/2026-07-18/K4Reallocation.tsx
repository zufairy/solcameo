/**
 * K4 — "The Reallocation" · market / investor (pillar 8) · Daybreak Pro · 30s / 900f.
 * Follow the money: influencer spend $40.5B (2026) → $152.6B (2031), 3× engagement,
 * 73% of brands. Demand is proven; the bottleneck is trusted supply — Vello mints it.
 * Drawn growth area-chart + stat chips → supply-side flow + dark TAM card.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import {
  D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, useIn,
  display, mono, geist,
} from "./dk";

const StatChip: React.FC<{ at: number; big: string; label: string }> = ({ at, big, label }) => (
  <Rise at={at}>
    <Card style={{ padding: "26px 34px", width: 420 }}>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 58, color: D.ink }}>{big}</div>
      <div style={{ fontFamily: geist, fontSize: 22, color: D.sub, marginTop: 4 }}>{label}</div>
    </Card>
  </Rise>
);

const FlowNode: React.FC<{ at: number; t: string; s: string; dark?: boolean }> = ({ at, t, s, dark }) => {
  const sp = useIn(at, 22);
  return (
    <div style={{ opacity: sp, transform: `scale(${0.9 + sp * 0.1})` }}>
      <Card dark={dark} style={{ padding: "28px 30px", width: 380, textAlign: "center" }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 28, color: dark ? D.limeBright : D.ink }}>{t}</div>
        <div style={{ fontFamily: geist, fontSize: 19, color: dark ? "rgba(255,255,255,0.7)" : D.sub, marginTop: 6 }}>{s}</div>
      </Card>
    </div>
  );
};

export const K4Reallocation: React.FC = () => {
  const frame = useCurrentFrame();
  const bn = interpolate(frame, [250, 430], [40.5, 152.6], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 3) });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK */}
      <Sect from={0} to={200}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
          <Rise at={8}><Tag>MARKET · WHERE THE AD DOLLARS GO</Tag></Rise>
          <Line at={20} size={112} maxWidth={1500}
            words={[{ t: "Follow" }, { t: "the" }, { t: "money.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* S2 · GROWTH CHART */}
      <Sect from={200} to={470}>
        <div style={{ position: "absolute", top: 90, left: 140 }}>
          <Rise at={210}>
            <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: 3, color: D.faint }}>GLOBAL INFLUENCER MARKETING SPEND</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 96, color: D.ink, marginTop: 4 }}>
              ${bn.toFixed(1)}B
            </div>
          </Rise>
        </div>

        {/* chart */}
        <svg width={960} height={380} style={{ position: "absolute", left: 130, top: 300 }}>
          <defs>
            <linearGradient id="k4area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={D.limeBright} stopOpacity="0.45" />
              <stop offset="100%" stopColor={D.limeBright} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1={50} y1={340} x2={900} y2={340} stroke={D.line} strokeWidth={2} />
          <path d="M50,316 L214,287 L378,250 L542,202 L706,140 L870,57 L870,340 L50,340 Z"
            fill="url(#k4area)" opacity={interpolate(frame, [260, 430], [0, 1], CL)} />
          <path d="M50,316 L214,287 L378,250 L542,202 L706,140 L870,57"
            fill="none" stroke={D.lime} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={1050} strokeDashoffset={interpolate(frame, [250, 430], [1050, 0], CL)} />
          {/* endpoint dot */}
          {frame > 420 && <circle cx={870} cy={57} r={10} fill={D.lime} />}
          {/* year labels */}
          {["2026", "2027", "2028", "2029", "2030", "2031"].map((y, i) => (
            <text key={y} x={50 + i * 164} y={368} fill={D.faint} fontFamily="monospace" fontSize={17} textAnchor="middle">{y}</text>
          ))}
        </svg>

        {/* stat chips */}
        <div style={{ position: "absolute", right: 130, top: 340, display: "flex", flexDirection: "column", gap: 26 }}>
          <StatChip at={330} big="3×" label="engagement — 5.67% vs 1.89% human" />
          <StatChip at={372} big="73%" label="of brands already use them" />
          <Rise at={414}>
            <div style={{ fontFamily: mono, fontSize: 16, color: D.faint, letterSpacing: 1, paddingLeft: 6 }}>2026 → 2031 · 30% CAGR · Mordor Intelligence</div>
          </Rise>
        </div>
      </Sect>

      {/* S3 · THE SUPPLY BOTTLENECK */}
      <Sect from={470} to={690}>
        <div style={{ position: "absolute", top: 96, width: "100%", textAlign: "center" }}>
          <Line at={482} size={62} maxWidth={1600}
            words={[{ t: "Demand" }, { t: "is" }, { t: "proven." }, { t: "Supply" }, { t: "is", serif: true }, { t: "the", serif: true }, { t: "bottleneck.", c: D.lime, serif: true }]} />
        </div>
        <div style={{ position: "absolute", top: 340, left: 0, width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 26 }}>
          <FlowNode at={520} t="Brands fund pools" s="upfront, per campaign" />
          <div style={{ fontFamily: display, fontSize: 44, color: D.lime }}>→</div>
          <FlowNode at={560} t="Vello mints supply" s="verified agents, on demand" />
          <div style={{ fontFamily: display, fontSize: 44, color: D.lime }}>→</div>
          <FlowNode at={600} t="Paid per verified view" s="settled to the owner" dark />
        </div>
        <div style={{ position: "absolute", top: 640, width: "100%", textAlign: "center" }}>
          <Rise at={650}>
            <div style={{ fontFamily: geist, fontSize: 28, color: D.sub }}>
              Own the layer that makes the workforce — not just rent a tool.
            </div>
          </Rise>
        </div>
      </Sect>

      <Vignette />
      <DayOutro at={690} headline={[{ t: "Own" }, { t: "the" }, { t: "AI" }, { t: "workforce.", c: D.lime, serif: true }]} />
    </AbsoluteFill>
  );
};

const W = 1920;
