/**
 * D3 — "The Rate Card" · Pillar 5 the math.
 * $1–3 per 1,000 verified views → a live payout calculator, break-even at
 * ~25K monthly views, then the agent pays its own rent ($50/mo from earnings).
 * Layout: title → rate card + live calculator w/ break-even marker →
 * dark "pays its own rent" card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const TIERS = [
  { r: "$1", cap: "floor" },
  { r: "$2", cap: "typical" },
  { r: "$3", cap: "top campaigns" },
];

export const D3TheRateCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* calculator: views climb 0 → 60K across S2; earnings = views/1000 * 2 */
  const views = interpolate(frame, [240, 430], [0, 60000], CL);
  const earn = (views / 1000) * 2;
  const beFrac = Math.min(1, views / 60000); // bar fill
  const breakevenX = 25000 / 60000; // marker at 25K on a 0–60K bar

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–140) ══ */}
      <Sect from={0} to={140}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>THE MATH</Tag></Rise>
          <Line at={18} size={104} maxWidth={1500}
            words={[{ t: "Get" }, { t: "paid" }, { t: "per" }, { t: "view", c: D.lime, serif: true }, { t: "—" }] } />
          <Line at={52} size={62} maxWidth={1500}
            words={[{ t: "not" }, { t: "per" }, { t: "post." }]} color={D.sub} weight={500} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · RATE CARD + CALCULATOR (140–500) ══ */}
      <Sect from={140} to={500}>
        <div style={{ position: "absolute", top: 70, width: "100%", textAlign: "center" }}>
          <Rise at={150}><div style={{ display: "inline-block" }}><Tag>$1–3 PER 1,000 VERIFIED VIEWS</Tag></div></Rise>
        </div>

        {/* rate card (left) */}
        <div style={{ position: "absolute", left: 150, top: 230, width: 640 }}>
          <Rise at={168}>
            <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: 3, color: D.faint, marginBottom: 18 }}>RATE CARD · PER 1K VIEWS</div>
          </Rise>
          <div style={{ display: "flex", gap: 18 }}>
            {TIERS.map((t, i) => {
              const s = spring({ frame: frame - (196 + i * 22), fps, config: { damping: 20, stiffness: 140 } });
              return (
                <div key={i} style={{ flex: 1, opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>
                  <Card style={{ padding: "28px 20px", textAlign: "center", border: i === 1 ? `2px solid ${D.lime}` : undefined }}>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 64, color: i === 1 ? D.lime : D.ink }}>{t.r}</div>
                    <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, letterSpacing: 1, marginTop: 4 }}>{t.cap}</div>
                  </Card>
                </div>
              );
            })}
          </div>
          <Rise at={280} style={{ marginTop: 22 }}>
            <div style={{ fontFamily: geist, fontSize: 22, color: D.ink }}>
              Your agent posts <b style={{ color: D.lime }}>40+ clips a week</b>, paid on every verified view.
            </div>
          </Rise>
        </div>

        {/* calculator (right) */}
        <div style={{ position: "absolute", right: 150, top: 230, width: 640 }}>
          <Rise at={220}>
            <Card style={{ padding: "30px 34px" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>LIVE PAYOUT · @ $2 / 1K</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 22 }}>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 14, color: D.faint }}>MONTHLY VIEWS</div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: D.ink }}>{Math.round(views).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: mono, fontSize: 14, color: D.faint }}>EARNINGS</div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: D.lime }}>${Math.round(earn).toLocaleString()}</div>
                </div>
              </div>
              {/* progress bar with break-even marker */}
              <div style={{ position: "relative", height: 16, borderRadius: 99, background: D.paper2, marginTop: 26, overflow: "hidden", border: `1px solid ${D.line}` }}>
                <div style={{ position: "absolute", inset: 0, width: `${beFrac * 100}%`, background: `linear-gradient(90deg, ${D.lime}, ${D.limeBright})`, borderRadius: 99 }} />
              </div>
              <div style={{ position: "relative", height: 34, marginTop: 6 }}>
                <div style={{ position: "absolute", left: `${breakevenX * 100}%`, transform: "translateX(-50%)", textAlign: "center" }}>
                  <div style={{ width: 2, height: 10, background: D.ink, margin: "0 auto" }} />
                  <div style={{ fontFamily: mono, fontSize: 13, color: D.ink, letterSpacing: 1, marginTop: 2 }}>BREAK-EVEN · 25K</div>
                </div>
              </div>
            </Card>
          </Rise>
          <Rise at={400} style={{ marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: geist, fontSize: 22, color: D.ink }}>
              <span style={{ color: D.lime, fontSize: 24 }}>✓</span>
              Break-even ≈ 25K monthly views — week-one numbers.
            </div>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · PAYS ITS OWN RENT (500–690) ══ */}
      <Sect from={500} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={514} size={66} maxWidth={1500}
            words={[{ t: "After" }, { t: "that," }, { t: "the" }, { t: "agent" }, { t: "pays" }, { t: "its" }, { t: "own" }, { t: "rent.", c: D.lime, serif: true }]} />
          <Rise at={560}>
            <Card dark style={{ padding: "36px 52px", width: 780, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>BILLING · MONTH TWO</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: "#fff", lineHeight: 1.25 }}>
                <span style={{ color: D.limeBright }}>$50/mo</span> — auto-deducted from<br />the agent's own earnings, first.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Free for 30 days. No card. Cancel in one click.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Do", serif: true }, { t: "the", serif: true }, { t: "math.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
