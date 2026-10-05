/**
 * F1 — "Seven Days" · Pillar 4 proof / case study (launch traction).
 * 10,000 users launched agents in the first 7 days; $12K cashed out by
 * creators in the first 30. Real hero footage under the title, a 7-day
 * bar calendar filling up, a dark receipts card.
 * Layout: footage title → 7-day bar strip + 10K counter → dark $12K card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist } from "./dk";

const DAYS = [
  { d: "DAY 1", n: 900, note: "first clips live" },
  { d: "DAY 2", n: 2100, note: "" },
  { d: "DAY 3", n: 3600, note: "first payouts clear" },
  { d: "DAY 4", n: 5200, note: "" },
  { d: "DAY 5", n: 6900, note: "" },
  { d: "DAY 6", n: 8500, note: "" },
  { d: "DAY 7", n: 10000, note: "10,000 users" },
];

export const F1SevenDays: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const kb = interpolate(frame, [0, 150], [1.04, 1.14], CL); // Ken Burns

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE over real hero footage (0–150) ══ */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <OffthreadVideo src={staticFile("site/cofounder-bg.mp4")} muted
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${kb})` }} />
          <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(247,246,241,0.55) 0%, rgba(247,246,241,0.88) 78%, ${D.paper} 100%)` }} />
        </AbsoluteFill>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>PROOF · LAUNCH WEEK</Tag></Rise>
          <Line at={18} size={110} maxWidth={1550}
            words={[{ t: "Seven" }, { t: "days.", serif: true, c: D.lime }]} />
          <Line at={52} size={72} maxWidth={1550} color={D.sub} weight={500}
            words={[{ t: "Ten" }, { t: "thousand" }, { t: "people." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · 7-DAY BAR CALENDAR (150–500) ══ */}
      <Sect from={150} to={500}>
        <div style={{ position: "absolute", top: 64, width: "100%", textAlign: "center" }}>
          <Rise at={160}><div style={{ display: "inline-block" }}><Tag>USERS WHO LAUNCHED AN AGENT</Tag></div></Rise>
        </div>
        {/* big cumulative counter */}
        <div style={{ position: "absolute", top: 138, width: "100%", textAlign: "center" }}>
          <Rise at={176}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 148, color: D.ink, lineHeight: 1 }}>
              <Count at={200} to={10000} dur={210} />
            </div>
            <div style={{ fontFamily: mono, fontSize: 19, letterSpacing: 4, color: D.faint, marginTop: 6 }}>IN THE FIRST SEVEN DAYS</div>
          </Rise>
        </div>
        {/* bar strip */}
        <div style={{ position: "absolute", left: 200, right: 200, top: 430, display: "flex", gap: 22, alignItems: "flex-end", height: 380 }}>
          {DAYS.map((day, i) => {
            const s = spring({ frame: frame - (220 + i * 26), fps, config: { damping: 22, stiffness: 130 } });
            const h = 60 + (day.n / 10000) * 250;
            const last = i === 6;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, opacity: s }}>
                <div style={{ fontFamily: mono, fontSize: 17, color: last ? D.lime : D.sub, fontWeight: 700 }}>
                  {day.n.toLocaleString()}
                </div>
                <div style={{
                  width: "100%", height: h * s, borderRadius: 14,
                  background: last ? `linear-gradient(180deg, ${D.limeBright}, ${D.lime})` : "#FFFFFF",
                  border: `1.5px solid ${last ? D.lime : D.line}`,
                  boxShadow: last ? `0 18px 40px rgba(101,163,13,0.28)` : "0 10px 24px rgba(32,38,28,0.07)",
                }} />
                <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: last ? D.ink : D.faint }}>{day.d}</div>
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", bottom: 96, width: "100%", textAlign: "center" }}>
          <Rise at={410}>
            <div style={{ fontFamily: geist, fontSize: 24, color: D.ink }}>
              Day 1: first clips live · Day 3: <b style={{ color: D.lime }}>first payouts cleared</b>
            </div>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · $12K RECEIPTS CARD (500–690) ══ */}
      <Sect from={500} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={514} size={64} maxWidth={1500}
            words={[{ t: "Not" }, { t: "a" }, { t: "waitlist." }, { t: "A" }, { t: "working" }, { t: "economy.", c: D.lime, serif: true }]} />
          <Rise at={560}>
            <Card dark style={{ padding: "38px 56px", width: 860, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>CREATOR CASH-OUTS · FIRST 30 DAYS</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 110, color: D.limeBright, lineHeight: 1 }}>
                $<Count at={578} to={12000} dur={64} />
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Paid per verified view — on the record.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Proof,", serif: true }, { t: "not", serif: true }, { t: "promises.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
