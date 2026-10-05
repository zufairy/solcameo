/**
 * F3 — "Claim to Cash-out" · Pillar 2 product walkthrough (Campaigns → Earn).
 * Operator POV: open Campaigns, agent claims a $2/1K campaign, clips + posts,
 * verified views tick live, then the dark wallet card with Stripe/PayPal/USDC.
 * Layout: title → 3-step horizontal flow w/ drawn connector → dark wallet
 * cash-out card → outro. 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist } from "./dk";

const RAILS = ["Stripe", "PayPal", "USDC"];

export const F3ClaimToCashout: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lineW = 1240;
  const drawn = interpolate(frame, [230, 420], [lineW, 0], CL);
  const views = interpolate(frame, [330, 470], [0, 92150], CL);
  const earn = (views / 1000) * 2;

  const Step: React.FC<{ at: number; x: number; k: string; title: string; children: React.ReactNode }> =
    ({ at, x, k, title, children }) => {
      const s = spring({ frame: frame - at, fps, config: { damping: 23, stiffness: 130 } });
      return (
        <div style={{ position: "absolute", left: x, top: 300, width: 480, opacity: s, transform: `translateY(${(1 - s) * 32}px)` }}>
          <div style={{
            width: 56, height: 56, borderRadius: 99, margin: "0 auto 16px",
            background: D.limeBright, color: "#0A0C08", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: display, fontWeight: 700, fontSize: 24, boxShadow: `0 6px 0 ${D.lime}`,
          }}>{k}</div>
          <Card style={{ padding: "26px 30px", minHeight: 300 }}>
            <div style={{ fontFamily: display, fontWeight: 650, fontSize: 30, color: D.ink, textAlign: "center", marginBottom: 18 }}>{title}</div>
            {children}
          </Card>
        </div>
      );
    };

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–150) ══ */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>WALKTHROUGH · CAMPAIGNS → EARN</Tag></Rise>
          <Line at={18} size={96} maxWidth={1550}
            words={[{ t: "From" }, { t: "claim" }, { t: "to" }, { t: "cash-out.", c: D.lime, serif: true }]} />
          <Line at={56} size={58} maxWidth={1550} color={D.sub} weight={500}
            words={[{ t: "You" }, { t: "tap" }, { t: "twice." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · 3-STEP FLOW (150–520) ══ */}
      <Sect from={150} to={520}>
        <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center" }}>
          <Rise at={160}><div style={{ display: "inline-block" }}><Tag>LIVE CAMPAIGNS ARE PAYING $1–3 / 1K VERIFIED VIEWS</Tag></div></Rise>
        </div>

        {/* connector line across the three steps */}
        <svg width={lineW} height="8" style={{ position: "absolute", left: 340, top: 324 }}>
          <line x1="0" y1="4" x2={lineW} y2="4" stroke={D.lime} strokeWidth="3"
            strokeDasharray={lineW} strokeDashoffset={drawn} strokeLinecap="round" />
        </svg>

        <Step at={196} x={130} k="1" title="Claim a campaign">
          <div style={{ borderRadius: 16, border: `1.5px solid ${D.line}`, background: D.paper, padding: "18px 20px" }}>
            <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: 2, color: D.faint }}>CAMPAIGN · SKINCARE LAUNCH</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink }}>$2 <span style={{ fontSize: 18, color: D.sub, fontWeight: 500 }}>/ 1K views</span></div>
              <div style={{ fontFamily: mono, fontSize: 14, color: D.lime, border: `1.5px solid ${D.lime}55`, borderRadius: 99, padding: "6px 14px", background: `${D.lime}12` }}>CLAIMED ✓</div>
            </div>
            <div style={{ fontFamily: mono, fontSize: 14, color: D.faint, marginTop: 10 }}>pool funded upfront · pays per verified view</div>
          </div>
        </Step>

        <Step at={244} x={720} k="2" title="Agent clips + posts">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
            {["TikTok", "Reels", "Shorts", "X"].map((p, i) => {
              const s = spring({ frame: frame - (280 + i * 12), fps, config: { damping: 18, stiffness: 150 } });
              return (
                <div key={p} style={{
                  opacity: s, transform: `scale(${0.7 + s * 0.3})`,
                  fontFamily: mono, fontSize: 17, color: D.ink, background: "#fff",
                  border: `1.5px solid ${D.line}`, borderRadius: 99, padding: "10px 22px",
                }}>{p} ✓</div>
              );
            })}
          </div>
          <div style={{ textAlign: "center", marginTop: 22 }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 58, color: D.ink }}>
              <Count at={300} to={41} dur={80} />
            </div>
            <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 2, color: D.faint }}>CLIPS THIS WEEK · AUTO-POSTED</div>
          </div>
        </Step>

        <Step at={292} x={1310} k="3" title="Views verified live">
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: 2, color: D.faint }}>VERIFIED VIEWS</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, color: D.ink }}>{Math.round(views).toLocaleString()}</div>
            <div style={{ height: 1.5, background: D.line, margin: "14px 0" }} />
            <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: 2, color: D.faint }}>EARNED @ $2 / 1K</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, color: D.lime }}>${earn.toFixed(2)}</div>
          </div>
        </Step>
      </Sect>

      {/* ══ S3 · WALLET CASH-OUT (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={532} size={62} maxWidth={1500}
            words={[{ t: "Then" }, { t: "the" }, { t: "second" }, { t: "tap:" }, { t: "cash", c: D.lime, serif: true }, { t: "out.", c: D.lime, serif: true }]} />
          <Rise at={572}>
            <Card dark style={{ padding: "36px 52px", width: 880 }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 20 }}>WALLET · AVAILABLE TO WITHDRAW</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 84, color: D.limeBright, lineHeight: 1 }}>$184.30</div>
                <div style={{
                  fontFamily: display, fontWeight: 700, fontSize: 28, color: "#0A0C08",
                  background: D.limeBright, borderRadius: 16, padding: "18px 36px",
                  boxShadow: `0 8px 0 ${D.lime}`,
                  transform: `scale(${1 + Math.sin(Math.max(0, frame - 620) / 16) * 0.02})`,
                }}>Withdraw →</div>
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "24px 0 18px" }} />
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {RAILS.map((r) => (
                  <div key={r} style={{ fontFamily: mono, fontSize: 16, color: "rgba(255,255,255,0.85)", border: "1.5px solid rgba(255,255,255,0.25)", borderRadius: 99, padding: "8px 20px" }}>{r}</div>
                ))}
                <div style={{ fontFamily: geist, fontSize: 19, color: "rgba(255,255,255,0.6)", marginLeft: "auto" }}>your pick — same money</div>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Claim.", serif: true }, { t: "Clip.", serif: true }, { t: "Cash", c: D.lime, serif: true }, { t: "out.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
