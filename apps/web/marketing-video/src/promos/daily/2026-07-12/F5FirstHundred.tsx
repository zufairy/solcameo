/**
 * F5 — "The First $100" · Pillar 1 consumer hook (a different door in).
 * Your first $100 online is the hardest — the failed-hustle list gets struck
 * through, then the agent path: mint in 15 min, $2/1K verified views,
 * $100 = 50K views, week-one numbers. Editorial serif storytelling +
 * a climbing $ meter. No footage — pure type film (keeps batch varied).
 * Layout: serif title → struck list + $100 meter → dark free-month card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const TRIED = ["The course", "The dropshipping store", "The survey apps", "The reselling flips"];
const PATH = [
  { t: "Mint an agent", d: "15 minutes, in the browser" },
  { t: "It finds paid campaigns", d: "$1–3 per 1K verified views" },
  { t: "It clips all night", d: "40+ posts a week, quality-gated" },
];

export const F5FirstHundred: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const dollars = interpolate(frame, [330, 470], [0, 100], CL);
  const meterViews = Math.round((dollars / 2) * 1000); // $2/1K

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · EDITORIAL TITLE (0–150) ══ */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 24 }}>
          <Rise at={8}><Tag>A DIFFERENT DOOR IN</Tag></Rise>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 500, fontSize: 108, color: D.ink, letterSpacing: -2, opacity: interpolate(frame, [14, 34], [0, 1], CL), transform: `translateY(${interpolate(frame, [14, 40], [30, 0], CL)}px)` }}>
            Your first <span style={{ color: D.lime }}>$100</span> online
          </div>
          <Line at={52} size={72} maxWidth={1500} color={D.sub} weight={500}
            words={[{ t: "is" }, { t: "the" }, { t: "hardest." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · STRUCK LIST + $100 METER (150–520) ══ */}
      <Sect from={150} to={520}>
        {/* the things you tried (left) */}
        <div style={{ position: "absolute", left: 190, top: 170, width: 700 }}>
          <Rise at={166}>
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: D.faint, marginBottom: 24 }}>YOU'VE PROBABLY TRIED</div>
          </Rise>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {TRIED.map((t, i) => {
              const s = spring({ frame: frame - (186 + i * 20), fps, config: { damping: 22, stiffness: 130 } });
              const strike = interpolate(frame, [270 + i * 14, 296 + i * 14], [0, 100], CL);
              return (
                <div key={i} style={{ opacity: s, transform: `translateX(${(1 - s) * -26}px)`, position: "relative", display: "inline-block", alignSelf: "flex-start" }}>
                  <span style={{ fontFamily: display, fontWeight: 600, fontSize: 44, color: D.sub }}>{t}</span>
                  <div style={{ position: "absolute", left: -6, top: "54%", width: `${strike}%`, maxWidth: "104%", height: 4, background: D.ink, borderRadius: 4 }} />
                </div>
              );
            })}
          </div>
          {/* the path */}
          <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 14 }}>
            <Rise at={330}>
              <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 34, color: D.lime }}>Here's a different path:</div>
            </Rise>
            {PATH.map((p, i) => {
              const s = spring({ frame: frame - (352 + i * 26), fps, config: { damping: 22, stiffness: 130 } });
              return (
                <div key={i} style={{ opacity: s, transform: `translateY(${(1 - s) * 20}px)`, display: "flex", alignItems: "baseline", gap: 16 }}>
                  <span style={{ fontFamily: mono, fontSize: 18, color: D.lime, fontWeight: 700 }}>0{i + 1}</span>
                  <div>
                    <span style={{ fontFamily: display, fontWeight: 650, fontSize: 30, color: D.ink }}>{p.t}</span>
                    <span style={{ fontFamily: mono, fontSize: 16, color: D.faint, marginLeft: 14 }}>{p.d}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* $100 meter (right) */}
        <Rise at={300} style={{ position: "absolute", right: 170, top: 230, width: 620 }}>
          <Card style={{ padding: "36px 40px" }}>
            <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>THE FIRST $100 · @ $2 / 1K VERIFIED VIEWS</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 20 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 130, color: D.lime, lineHeight: 1 }}>${Math.round(dollars)}</div>
              <div style={{ fontFamily: mono, fontSize: 17, color: D.sub }}>= {meterViews.toLocaleString()} views</div>
            </div>
            <div style={{ position: "relative", height: 18, borderRadius: 99, background: D.paper2, marginTop: 28, border: `1px solid ${D.line}`, overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, width: `${dollars}%`, background: `linear-gradient(90deg, ${D.lime}, ${D.limeBright})` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontFamily: mono, fontSize: 14, color: D.faint }}>
              <span>$0</span><span>50,000 views · $100</span>
            </div>
            <div style={{ height: 1.5, background: D.line, margin: "24px 0 16px" }} />
            <div style={{ fontFamily: geist, fontSize: 21, color: D.ink }}>
              Working clippers hit this in <b style={{ color: D.lime }}>week one</b>.
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ S3 · FREE MONTH CARD (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 60%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={532} size={64} maxWidth={1500}
            words={[{ t: "Start" }, { t: "at" }, { t: "zero." }, { t: "Don't" }, { t: "stay", c: D.lime, serif: true }, { t: "there.", c: D.lime, serif: true }]} />
          <Rise at={572}>
            <Card dark style={{ padding: "36px 54px", width: 860, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>GETTING IN</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 50, color: "#fff", lineHeight: 1.25 }}>
                Free for <span style={{ color: D.limeBright }}>30 days</span>. No card.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>After that: $50/mo — deducted from the agent's earnings first.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "The", serif: true }, { t: "first", serif: true }, { t: "$100.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
