/**
 * X2 — "Receipts" · Pillar 4 proof/case studies.
 * Layout: ledger dossier — full-width stat rows with counting numbers,
 * lime rules, dark verification card. 30s · 900 frames · Daybreak Pro.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";
import { interpolate } from "remotion";

const Row: React.FC<{
  at: number; idx: string; big: React.ReactNode; cap: string; sub: string;
}> = ({ at, idx, big, cap, sub }) => {
  const frame = useCurrentFrame();
  const w = interpolate(frame, [at + 6, at + 40], [0, 1560], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 3) });
  return (
    <Rise at={at}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 40, padding: "6px 0" }}>
        <div style={{ fontFamily: mono, fontSize: 20, color: D.faint, letterSpacing: 2, width: 60 }}>{idx}</div>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 118, color: D.ink, letterSpacing: -5, width: 560 }}>{big}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: geist, fontSize: 30, fontWeight: 600, color: D.ink, lineHeight: 1.3 }}>{cap}</div>
          <div style={{ fontFamily: mono, fontSize: 17, color: D.faint, marginTop: 8, letterSpacing: 1.5 }}>{sub}</div>
        </div>
      </div>
      <div style={{ width: w, height: 3, background: D.limeBright, borderRadius: 3, marginLeft: 100 }} />
    </Rise>
  );
};

export const X2Receipts: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK (0–190) */}
      <Sect from={0} to={190}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36 }}>
          <Rise at={8}><Tag>PROOF</Tag></Rise>
          <Line at={20} size={110} maxWidth={1500}
            words={[{ t: "Receipts,", serif: true, c: D.lime }, { t: "not" }, { t: "promises." }]} />
          <Line at={64} size={38} color={D.sub} maxWidth={1100} weight={500} stagger={3}
            words={[{ t: "In" }, { t: "this" }, { t: "niche," }, { t: "nobody" }, { t: "believes" }, { t: "a" }, { t: "pitch." }, { t: "Good.", serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE LEDGER (190–620) */}
      <Sect from={190} to={620}>
        <div style={{ position: "absolute", top: 80, left: 180 }}>
          <Rise at={200}><Tag>THE LEDGER · LIVE ON VELLO.GG</Tag></Rise>
        </div>
        <div style={{ position: "absolute", top: 200, left: 180, right: 180, display: "flex", flexDirection: "column", gap: 44 }}>
          <Row at={230} idx="R1"
            big={<Count at={236} to={30} prefix="$" suffix="K/mo" dur={50} />}
            cap="AI clipping agency — three people, zero editors"
            sub="42,000 CLIPS A MONTH · RUN ON VELLO AGENTS" />
          <Row at={330} idx="R2"
            big={<Count at={336} to={10000} dur={55} />}
            cap="users in seven days — zero human creators"
            sub="60+ POSTS A DAY · BOUNTY-DRIVEN LAUNCH" />
          <Row at={430} idx="R3"
            big={<Count at={436} to={12} prefix="$" suffix="K" dur={45} />}
            cap="her first 30 days — one operator, one roster"
            sub="AGENT INCOME, CASHED OUT" />
        </div>
      </Sect>

      {/* S3 · VERIFIED (620–760) */}
      <Sect from={620} to={760}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Rise at={632}>
            <Card dark style={{ padding: "52px 70px", width: 900, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: 4, color: "rgba(255,255,255,0.55)" }}>EVERY NUMBER</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 74, color: "#fff", margin: "14px 0", letterSpacing: -2 }}>
                verified <span style={{ color: D.limeBright, fontFamily: serif, fontStyle: "italic" }}>before</span> payout
              </div>
              <div style={{ fontFamily: mono, fontSize: 18, color: "rgba(255,255,255,0.75)", letterSpacing: 2 }}>
                <span style={{ color: "#22D3EE" }}>◎</span> ORACLE-CHECKED VIEWS · SETTLED ON SOLANA
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S4 · OUTRO (760–900) */}
      <DayOutro at={756} headline={[{ t: "See" }, { t: "the" }, { t: "numbers.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
